use tauri::menu::{AboutMetadataBuilder, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use crate::logs;

/// Событие выбора пункта меню, доставляемое в интерфейс.
pub const MENU_EVENT: &str = "menu-action";

/// Подписи меню на одном языке.
///
/// Интерфейс присылает выбранный язык командой `set_menu_language`, и меню
/// пересобирается: нативная строка меню не умеет менять подписи на месте.
struct Labels {
    about: &'static str,
    settings: &'static str,
    logs_open: &'static str,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    hide: &'static str,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    hide_others: &'static str,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    show_all: &'static str,
    quit: &'static str,
    file: &'static str,
    tab_new: &'static str,
    tab_close: &'static str,
    operation_save: &'static str,
    operation_save_as: &'static str,
    workspace_new: &'static str,
    workspace_settings: &'static str,
    edit: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    editor_format: &'static str,
    palette: &'static str,
    view: &'static str,
    layout_classic: &'static str,
    layout_inspector: &'static str,
    layout_focus: &'static str,
    sidebar_toggle: &'static str,
    response_toggle: &'static str,
    fullscreen: &'static str,
    run: &'static str,
    operation_run: &'static str,
    operation_stop: &'static str,
    schema_refresh: &'static str,
    schema_diff: &'static str,
    flow_run: &'static str,
    agent_activity: &'static str,
    window: &'static str,
    minimize: &'static str,
    /// «Zoom» на macOS: так называется системный пункт.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    zoom: &'static str,
    /// Тот же пункт на Windows и Linux, где привычно «Maximize».
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    maximize: &'static str,
    close_window: &'static str,
    about_comments: &'static str,
}

const EN: Labels = Labels {
    about: "About Resolvr",
    settings: "Settings…",
    logs_open: "Open Logs",
    hide: "Hide Resolvr",
    hide_others: "Hide Others",
    show_all: "Show All",
    quit: "Quit Resolvr",
    file: "File",
    tab_new: "New Tab",
    tab_close: "Close Tab",
    operation_save: "Save Operation",
    operation_save_as: "Save As…",
    workspace_new: "New Workspace…",
    workspace_settings: "Workspace Settings…",
    edit: "Edit",
    undo: "Undo",
    redo: "Redo",
    cut: "Cut",
    copy: "Copy",
    paste: "Paste",
    select_all: "Select All",
    editor_format: "Format Query",
    palette: "Command Palette…",
    view: "View",
    layout_classic: "Layout: Classic",
    layout_inspector: "Layout: Inspector",
    layout_focus: "Layout: Focus",
    sidebar_toggle: "Toggle Sidebar",
    response_toggle: "Expand Response",
    fullscreen: "Full Screen",
    run: "Run",
    operation_run: "Run Operation",
    operation_stop: "Stop",
    schema_refresh: "Refresh Schema",
    schema_diff: "Compare with Previous Schema",
    flow_run: "Run Flow",
    agent_activity: "Agent Activity…",
    window: "Window",
    minimize: "Minimize",
    zoom: "Zoom",
    maximize: "Maximize",
    close_window: "Close Window",
    about_comments: "GraphQL client with persistent state and agent access",
};

const RU: Labels = Labels {
    about: "О Resolvr",
    settings: "Настройки…",
    logs_open: "Открыть логи",
    hide: "Скрыть Resolvr",
    hide_others: "Скрыть остальные",
    show_all: "Показать все",
    quit: "Завершить Resolvr",
    file: "Файл",
    tab_new: "Новая вкладка",
    tab_close: "Закрыть вкладку",
    operation_save: "Сохранить операцию",
    operation_save_as: "Сохранить как…",
    workspace_new: "Новый workspace…",
    workspace_settings: "Настройки workspace…",
    edit: "Правка",
    undo: "Отменить",
    redo: "Повторить",
    cut: "Вырезать",
    copy: "Копировать",
    paste: "Вставить",
    select_all: "Выбрать все",
    editor_format: "Отформатировать запрос",
    palette: "Палитра команд…",
    view: "Вид",
    layout_classic: "Лейаут: Classic",
    layout_inspector: "Лейаут: Inspector",
    layout_focus: "Лейаут: Focus",
    sidebar_toggle: "Показать/скрыть сайдбар",
    response_toggle: "Развернуть ответ",
    fullscreen: "Во весь экран",
    run: "Запуск",
    operation_run: "Выполнить операцию",
    operation_stop: "Остановить",
    schema_refresh: "Обновить схему",
    schema_diff: "Сравнить со схемой до обновления",
    flow_run: "Запустить цепочку",
    agent_activity: "Действия агента…",
    window: "Окно",
    minimize: "Свернуть",
    zoom: "Развернуть",
    maximize: "Развернуть",
    close_window: "Закрыть окно",
    about_comments: "GraphQL-клиент с сохранением состояния и доступом для агента",
};

fn labels_for(language: &str) -> &'static Labels {
    if language == "ru" {
        &RU
    } else {
        &EN
    }
}

/// Собирает нативное меню приложения.
///
/// Меню строится нативным, а не рисуется в HTML: на macOS это единственный
/// способ получить системную строку меню, привычные разделы и работающие
/// сочетания клавиш, включая стандартные Edit-команды в текстовых полях.
/// Ускорители заданы как `CmdOrCtrl`, чтобы на Windows и Linux работал Ctrl.
pub fn build_menu<R: Runtime>(app: &AppHandle<R>, language: &str) -> tauri::Result<Menu<R>> {
    let l = labels_for(language);

    let app_menu = Submenu::with_items(
        app,
        "Resolvr",
        true,
        &[
            &PredefinedMenuItem::about(app, Some(l.about), Some(about_metadata(app, l)))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "settings", l.settings, true, Some("CmdOrCtrl+,"))?,
            &MenuItem::with_id(app, "logs.open", l.logs_open, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
        ],
    )?;
    // Скрытие приложения — понятие macOS; в GTK эти пункты не работают.
    #[cfg(target_os = "macos")]
    app_menu.append_items(&[
        &PredefinedMenuItem::hide(app, Some(l.hide))?,
        &PredefinedMenuItem::hide_others(app, Some(l.hide_others))?,
        &PredefinedMenuItem::show_all(app, Some(l.show_all))?,
        &PredefinedMenuItem::separator(app)?,
    ])?;
    app_menu.append(&PredefinedMenuItem::quit(app, Some(l.quit))?)?;

    let file_menu = Submenu::with_items(
        app,
        l.file,
        true,
        &[
            &MenuItem::with_id(app, "tab.new", l.tab_new, true, Some("CmdOrCtrl+T"))?,
            &MenuItem::with_id(app, "tab.close", l.tab_close, true, Some("CmdOrCtrl+W"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "operation.save", l.operation_save, true, Some("CmdOrCtrl+S"))?,
            &MenuItem::with_id(
                app,
                "operation.saveAs",
                l.operation_save_as,
                true,
                Some("CmdOrCtrl+Shift+S"),
            )?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "workspace.new", l.workspace_new, true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(
                app,
                "workspace.settings",
                l.workspace_settings,
                true,
                Some("CmdOrCtrl+Shift+,"),
            )?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        l.edit,
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(l.undo))?,
            &PredefinedMenuItem::redo(app, Some(l.redo))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(l.cut))?,
            &PredefinedMenuItem::copy(app, Some(l.copy))?,
            &PredefinedMenuItem::paste(app, Some(l.paste))?,
            // Свой пункт вместо predefined на всех платформах: системный
            // `selectAll:` уходит напрямую в WKWebView/GTK, и обработчик
            // панели ответа не получает сочетание. Интерфейс сам решает, что
            // выделять, и для полей ввода вызывает стандартное выделение.
            &MenuItem::with_id(app, "edit.selectAll", l.select_all, true, Some("CmdOrCtrl+A"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "editor.format", l.editor_format, true, Some("CmdOrCtrl+Shift+F"))?,
            &MenuItem::with_id(app, "palette.open", l.palette, true, Some("CmdOrCtrl+K"))?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        l.view,
        true,
        &[
            &MenuItem::with_id(app, "layout.classic", l.layout_classic, true, Some("CmdOrCtrl+1"))?,
            &MenuItem::with_id(app, "layout.inspector", l.layout_inspector, true, Some("CmdOrCtrl+2"))?,
            &MenuItem::with_id(app, "layout.focus", l.layout_focus, true, Some("CmdOrCtrl+3"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "sidebar.toggle", l.sidebar_toggle, true, Some("CmdOrCtrl+B"))?,
            &MenuItem::with_id(app, "response.toggle", l.response_toggle, true, Some("CmdOrCtrl+Shift+E"))?,
            &PredefinedMenuItem::separator(app)?,
            &*fullscreen_item(app, l)?,
        ],
    )?;

    let run_menu = Submenu::with_items(
        app,
        l.run,
        true,
        &[
            &MenuItem::with_id(app, "operation.run", l.operation_run, true, Some("CmdOrCtrl+Return"))?,
            &MenuItem::with_id(app, "operation.stop", l.operation_stop, true, Some("CmdOrCtrl+."))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "schema.refresh", l.schema_refresh, true, Some("CmdOrCtrl+R"))?,
            &MenuItem::with_id(app, "schema.diff", l.schema_diff, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "flow.run", l.flow_run, true, Some("CmdOrCtrl+Shift+Return"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "agent.activity", l.agent_activity, true, Some("CmdOrCtrl+Shift+A"))?,
        ],
    )?;

    let window_menu = build_window_menu(app, l)?;

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

/// Сведения для окна «О Resolvr».
///
/// На macOS системная панель берёт недостающее из Info.plist, а GTK-диалог
/// на Linux показывает только переданное — с пустыми метаданными он пуст.
fn about_metadata<'a, R: Runtime>(
    app: &AppHandle<R>,
    l: &Labels,
) -> tauri::menu::AboutMetadata<'a> {
    let builder = AboutMetadataBuilder::new()
        .name(Some("Resolvr"))
        .version(Some(app.package_info().version.to_string()))
        .comments(Some(l.about_comments))
        .copyright(Some("© hojttaler"))
        .website(Some("https://github.com/hojttaler/Resolvr"))
        .website_label(Some("GitHub"))
        .license(Some("FSL-1.1-Apache-2.0"));

    // Иконка окна по умолчанию — первая PNG из `bundle.icon` (32×32), для
    // диалога она слишком мелкая. На macOS панель берёт иконку из бандла.
    #[cfg(not(target_os = "macos"))]
    let builder = builder.icon(
        tauri::image::Image::from_bytes(include_bytes!("../icons/128x128.png"))
            .ok()
            .map(tauri::image::Image::to_owned),
    );

    builder.build()
}

/// «Во весь экран»: в GTK predefined-пункта нет, переключение делает Rust.
fn fullscreen_item<R: Runtime>(
    app: &AppHandle<R>,
    l: &Labels,
) -> tauri::Result<Box<dyn IsMenuItem<R>>> {
    #[cfg(target_os = "macos")]
    return Ok(Box::new(PredefinedMenuItem::fullscreen(app, Some(l.fullscreen))?));

    #[cfg(not(target_os = "macos"))]
    return Ok(Box::new(MenuItem::with_id(
        app,
        "view.fullscreen",
        l.fullscreen,
        true,
        Some("F11"),
    )?));
}

/// Раздел «Окно».
///
/// Predefined-пункты minimize/maximize/close_window в GTK не
/// поддерживаются и остаются неактивными, поэтому вне macOS раздел
/// собирается из обычных пунктов, которые обрабатывает Rust.
fn build_window_menu<R: Runtime>(app: &AppHandle<R>, l: &Labels) -> tauri::Result<Submenu<R>> {
    #[cfg(target_os = "macos")]
    return Submenu::with_items(
        app,
        l.window,
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(l.minimize))?,
            &PredefinedMenuItem::maximize(app, Some(l.zoom))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, Some(l.close_window))?,
        ],
    );

    #[cfg(not(target_os = "macos"))]
    return Submenu::with_items(
        app,
        l.window,
        true,
        &[
            &MenuItem::with_id(app, "window.minimize", l.minimize, true, None::<&str>)?,
            &MenuItem::with_id(app, "window.maximize", l.maximize, true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "window.close", l.close_window, true, None::<&str>)?,
        ],
    );
}

/// Пересобирает меню на выбранном языке; вызывается интерфейсом при старте
/// и при смене языка в настройках.
#[tauri::command]
pub fn set_menu_language<R: Runtime>(app: AppHandle<R>, language: String) -> Result<(), String> {
    let menu = build_menu(&app, &language).map_err(|error| error.to_string())?;
    app.set_menu(menu).map_err(|error| error.to_string())?;

    Ok(())
}

/// Обрабатывает выбранный пункт меню.
///
/// Логика команд живёт в интерфейсе — там же, где состояние вкладок и
/// редактора, поэтому Rust в основном транслирует идентификатор пункта.
/// Исключение — управление окном и открытие журнала: состояния интерфейса
/// они не касаются, а журнал должен открываться даже при сломанном UI.
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == "logs.open" {
        // Ошибка уже записана в журнал внутри `open_dir`.
        let _ = logs::open_dir(app);
        return;
    }

    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    let result = match id {
        "window.minimize" => window.minimize(),
        "window.maximize" => window.is_maximized().and_then(|maximized| {
            if maximized {
                window.unmaximize()
            } else {
                window.maximize()
            }
        }),
        "window.close" => window.close(),
        "view.fullscreen" => window
            .is_fullscreen()
            .and_then(|fullscreen| window.set_fullscreen(!fullscreen)),
        _ => window.emit(MENU_EVENT, id.to_string()),
    };

    if let Err(error) = result {
        log::warn!("Пункт меню {id} не выполнен: {error}");
    }
}
