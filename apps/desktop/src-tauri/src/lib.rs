mod http;
mod keychain;
mod logs;
mod menu;
mod watcher;
mod webview_guard;
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
    webview_guard::prepare_environment();

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
        // Буфер обмена через Rust: WebKitGTK запрещает странице
        // `navigator.clipboard.writeText`, и копирование на Linux не работало.
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let handle = app.handle();
            logs::log_startup(handle);
            webview_guard::log_environment();
            watcher::init(handle);

            // Меню сразу строится на языке из настроек: пересборка меню при
            // старте на Linux повреждала память GTK.
            let language = menu::initial_language(handle);
            app.manage(menu::MenuLanguage(std::sync::Mutex::new(language)));
            let menu = menu::build_menu(handle, language)?;
            app.set_menu(menu)?;

            if let Some(main_window) = app.get_webview_window("main") {
                webview_guard::watch(&main_window);
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
