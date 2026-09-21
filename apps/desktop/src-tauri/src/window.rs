use tauri::{Manager, WebviewWindow, Window};

#[cfg(target_os = "macos")]
use window_vibrancy::{
    apply_vibrancy, clear_vibrancy, NSVisualEffectMaterial, NSVisualEffectState,
};

/// Применяет нативное размытие фона окна.
///
/// `HudWindow` даёт нейтральный полупрозрачный материал, который одинаково
/// уместно выглядит в светлой и тёмной темах и, в отличие от `Sidebar`, не
/// перекрашивает всё окно в цвет боковой панели. Радиус скругления задаётся
/// явно, иначе на macOS 26 края материала выходят за границу окна.
#[cfg(target_os = "macos")]
pub fn apply_window_effects(window: &WebviewWindow) -> Result<(), String> {
    apply_material(window, "hud")
}

/// Применяет выбранный материал размытия.
///
/// Материалы различаются плотностью: `hud` нейтрален, `sidebar` заметно
/// светлее, `under-window` почти прозрачен и сильнее показывает содержимое
/// экрана под окном. `none` полностью отключает эффект — окно становится
/// обычным непрозрачным.
#[cfg(target_os = "macos")]
fn apply_material(window: &WebviewWindow, material: &str) -> Result<(), String> {
    if material == "none" {
        return clear_vibrancy(window)
            .map(|_| ())
            .map_err(|error| format!("Не удалось отключить размытие: {error}"));
    }

    let effect = match material {
        "sidebar" => NSVisualEffectMaterial::Sidebar,
        "under-window" => NSVisualEffectMaterial::UnderWindowBackground,
        "popover" => NSVisualEffectMaterial::Popover,
        "window" => NSVisualEffectMaterial::WindowBackground,
        _ => NSVisualEffectMaterial::HudWindow,
    };

    apply_vibrancy(window, effect, Some(NSVisualEffectState::Active), Some(12.0))
        .map_err(|error| format!("Не удалось применить размытие: {error}"))
}

/// Меняет материал окна по запросу из настроек.
#[tauri::command]
pub fn set_window_material(app: tauri::AppHandle, material: String) -> Result<(), String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("Главное окно не найдено".to_string())
    };

    #[cfg(target_os = "macos")]
    {
        apply_material(&window, &material)
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (window, material);
        Ok(())
    }
}

/// На остальных платформах окно остаётся с обычным непрозрачным фоном —
/// приложение продолжает работать, просто без эффекта размытия.
#[cfg(not(target_os = "macos"))]
pub fn apply_window_effects(_window: &WebviewWindow) -> Result<(), String> {
    Ok(())
}

/// Начинает системное перетаскивание окна.
///
/// Заголовок окна скрыт (`titleBarStyle: Overlay`), поэтому за перетаскивание
/// отвечает полоса вкладок в интерфейсе.
#[tauri::command]
pub fn start_window_drag(window: Window) -> Result<(), String> {
    window
        .start_dragging()
        .map_err(|error| format!("Не удалось начать перетаскивание окна: {error}"))
}

/// Показывает окно после того, как интерфейс отрисовал сохранённый лейаут.
///
/// Окно создаётся скрытым: иначе при запуске был бы виден кадр с пустой
/// раскладкой до применения сохранённого состояния сессии.
#[tauri::command]
pub fn show_main_window(window: Window) -> Result<(), String> {
    window
        .show()
        .map_err(|error| format!("Не удалось показать окно: {error}"))?;
    window
        .set_focus()
        .map_err(|error| format!("Не удалось передать фокус окну: {error}"))
}
