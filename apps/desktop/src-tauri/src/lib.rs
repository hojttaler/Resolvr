mod http;
mod keychain;
mod logs;
mod menu;
mod watcher;
mod window;

use tauri::{Emitter, Manager, WindowEvent};

/// Событие «окно вот-вот закроется».
///
/// Интерфейс обязан за это время синхронно сбросить несохранённые черновики на
/// диск: без такого сигнала последние секунды набора текста терялись бы при
/// обычном закрытии окна.
const BEFORE_QUIT_EVENT: &str = "before-quit";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logs::install_panic_hook();

    tauri::Builder::default()
        // Журнал подключается первым, чтобы в него попадали ошибки
        // инициализации остальных плагинов.
        .plugin(logs::plugin())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Ссылки resolvr://… открывают операцию или цепочку; схема
        // регистрируется в Info.plist при сборке.
        .plugin(tauri_plugin_deep_link::init())
        // Обновления из GitHub Releases: подпись minisign, независимая от Apple.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            let handle = app.handle();
            logs::log_startup(handle);
            watcher::init(handle);

            // Стартовый язык — английский; интерфейс сразу переключит на
            // выбранный в настройках.
            let menu = menu::build_menu(handle, "en")?;
            app.set_menu(menu)?;

            if let Some(main_window) = app.get_webview_window("main") {
                if let Err(error) = window::apply_window_effects(&main_window) {
                    // Отсутствие размытия не мешает работать — приложение
                    // просто получает обычный фон.
                    log::warn!("Эффекты окна не применены: {error}");
                }
            }

            Ok(())
        })
        .on_menu_event(|app, event| {
            menu::handle_menu_event(app, event.id().as_ref());
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let _ = window.emit(BEFORE_QUIT_EVENT, ());
            }
        })
        .invoke_handler(tauri::generate_handler![
            http::http_request,
            keychain::keychain_get,
            keychain::keychain_set,
            keychain::keychain_delete,
            watcher::watch_library,
            watcher::unwatch_library,
            window::start_window_drag,
            window::show_main_window,
            window::set_window_material,
            menu::set_menu_language,
            logs::open_log_dir,
            logs::log_dir_path,
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение");
}
