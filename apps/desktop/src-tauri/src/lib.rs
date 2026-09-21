mod http;
mod keychain;
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
    tauri::Builder::default()
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Ссылки resolvr://… открывают операцию или цепочку; схема
        // регистрируется в Info.plist при сборке.
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let handle = app.handle();
            watcher::init(handle);

            let menu = menu::build_menu(handle)?;
            app.set_menu(menu)?;

            if let Some(main_window) = app.get_webview_window("main") {
                if let Err(error) = window::apply_window_effects(&main_window) {
                    // Отсутствие размытия не мешает работать — приложение
                    // просто получает обычный фон.
                    eprintln!("{error}");
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
        ])
        .run(tauri::generate_context!())
        .expect("не удалось запустить приложение");
}
