use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Событие выбора пункта меню, доставляемое в интерфейс.
pub const MENU_EVENT: &str = "menu-action";

/// Собирает нативное меню приложения.
///
/// Меню строится нативным, а не рисуется в HTML: на macOS это единственный
/// способ получить системную строку меню, привычные разделы и работающие
/// сочетания клавиш, включая стандартные Edit-команды в текстовых полях.
pub fn build_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let app_menu = Submenu::with_items(
        app,
        "Resolvr",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("О Resolvr"), Some(AboutMetadata::default()))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", "Настройки…", true, Some("Cmd+,"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, Some("Скрыть Resolvr"))?,
            &PredefinedMenuItem::hide_others(app, Some("Скрыть остальные"))?,
            &PredefinedMenuItem::show_all(app, Some("Показать все"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, Some("Завершить Resolvr"))?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "Файл",
        true,
        &[
            &MenuItem::with_id(app, "tab.new", "Новая вкладка", true, Some("Cmd+T"))?,
            &MenuItem::with_id(app, "tab.close", "Закрыть вкладку", true, Some("Cmd+W"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "operation.save", "Сохранить операцию", true, Some("Cmd+S"))?,
            &MenuItem::with_id(
                app,
                "operation.saveAs",
                "Сохранить как…",
                true,
                Some("Cmd+Shift+S"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "workspace.new", "Новый workspace…", true, Some("Cmd+N"))?,
            &MenuItem::with_id(
                app,
                "workspace.settings",
                "Настройки workspace…",
                true,
                Some("Cmd+Shift+,"),
            )?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Правка",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("Отменить"))?,
            &PredefinedMenuItem::redo(app, Some("Повторить"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("Вырезать"))?,
            &PredefinedMenuItem::copy(app, Some("Копировать"))?,
            &PredefinedMenuItem::paste(app, Some("Вставить"))?,
            &PredefinedMenuItem::select_all(app, Some("Выбрать все"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "editor.format", "Отформатировать запрос", true, Some("Cmd+Shift+F"))?,
            &MenuItem::with_id(app, "palette.open", "Палитра команд…", true, Some("Cmd+K"))?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "Вид",
        true,
        &[
            &MenuItem::with_id(app, "layout.classic", "Лейаут: Classic", true, Some("Cmd+1"))?,
            &MenuItem::with_id(app, "layout.inspector", "Лейаут: Inspector", true, Some("Cmd+2"))?,
            &MenuItem::with_id(app, "layout.focus", "Лейаут: Focus", true, Some("Cmd+3"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "sidebar.toggle", "Показать/скрыть сайдбар", true, Some("Cmd+B"))?,
            &MenuItem::with_id(app, "response.toggle", "Развернуть ответ", true, Some("Cmd+Shift+E"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, Some("Во весь экран"))?,
        ],
    )?;

    let run_menu = Submenu::with_items(
        app,
        "Запуск",
        true,
        &[
            &MenuItem::with_id(app, "operation.run", "Выполнить операцию", true, Some("Cmd+Return"))?,
            &MenuItem::with_id(app, "operation.stop", "Остановить", true, Some("Cmd+."))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "schema.refresh", "Обновить схему", true, Some("Cmd+R"))?,
            &MenuItem::with_id(app, "schema.diff", "Сравнить со схемой до обновления", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "flow.run", "Запустить флоу", true, Some("Cmd+Shift+Return"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                "agent.activity",
                "Действия агента…",
                true,
                Some("Cmd+Shift+A"),
            )?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Окно",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("Свернуть"))?,
            &PredefinedMenuItem::maximize(app, Some("Развернуть"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some("Закрыть окно"))?,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &run_menu,
            &window_menu,
        ],
    )
}

/// Пересылает выбранный пункт меню в интерфейс.
///
/// Логика команд живёт в интерфейсе — там же, где состояние вкладок и
/// редактора, поэтому Rust только транслирует идентификатор пункта.
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.emit(MENU_EVENT, id.to_string());
    }
}
