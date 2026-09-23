use std::path::PathBuf;

use log::LevelFilter;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_log::{RotationStrategy, Target, TargetKind};
use tauri_plugin_opener::OpenerExt;

/// Имя файла журнала в системном каталоге логов приложения.
const LOG_FILE_NAME: &str = "resolvr";

/// Предельный размер файла журнала; при превышении файл ротируется.
const MAX_LOG_FILE_BYTES: u128 = 5 * 1024 * 1024;

/// Плагин журнала: файл в системном каталоге логов и stdout.
///
/// Хранится один предыдущий файл (`KeepOne`): журнал нужен для разбора
/// последних сбоев, а не как архив. В отладочной сборке собственный код
/// пишет и `debug`-записи; сторонние крейты остаются на `info`, иначе
/// журнал тонет в сообщениях webview и HTTP-стека.
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let builder = tauri_plugin_log::Builder::new()
        .clear_targets()
        .targets([
            Target::new(TargetKind::LogDir {
                file_name: Some(LOG_FILE_NAME.to_string()),
            }),
            Target::new(TargetKind::Stdout),
        ])
        .rotation_strategy(RotationStrategy::KeepOne)
        .max_file_size(MAX_LOG_FILE_BYTES)
        .level(LevelFilter::Info);

    #[cfg(debug_assertions)]
    let builder = builder.level_for("resolvr_lib", LevelFilter::Debug);

    builder.build()
}

/// Перенаправляет паники в журнал.
///
/// В release-профиле `panic = "abort"`: процесс завершается сразу, и без
/// хука от паники не остаётся следа. Хук выполняется до abort, поэтому
/// запись успевает попасть в файл. Трасса стека в release-сборке без
/// символов (`strip = true`), но место паники указывается всегда.
pub fn install_panic_hook() {
    std::panic::set_hook(Box::new(|info| {
        let location = info
            .location()
            .map(|location| format!("{}:{}", location.file(), location.line()))
            .unwrap_or_else(|| "неизвестно".to_string());
        let payload = info
            .payload()
            .downcast_ref::<&str>()
            .map(|message| (*message).to_string())
            .or_else(|| info.payload().downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "без сообщения".to_string());
        let backtrace = std::backtrace::Backtrace::force_capture();

        log::error!("Паника в {location}: {payload}\n{backtrace}");
        log::logger().flush();
    }));
}

/// Записывает в журнал версию приложения и систему при старте.
pub fn log_startup<R: Runtime>(app: &AppHandle<R>) {
    log::info!(
        "Resolvr {} запущен: {} {} ({})",
        app.package_info().version,
        tauri_plugin_os::platform(),
        tauri_plugin_os::version(),
        tauri_plugin_os::arch(),
    );
}

/// Каталог журнала; создаётся, если его ещё нет.
fn ensure_log_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("Не удалось определить каталог журнала: {error}"))?;
    std::fs::create_dir_all(&dir)
        .map_err(|error| format!("Не удалось создать каталог журнала: {error}"))?;

    Ok(dir)
}

/// Открывает каталог журнала в файловом менеджере системы.
///
/// Каталог открывается из Rust, а не из webview: так не приходится
/// расширять fs-scope интерфейса на системный каталог логов.
pub fn open_dir<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let dir = ensure_log_dir(app)?;

    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|error| {
            log::error!("Не удалось открыть каталог журнала: {error}");
            format!("Не удалось открыть каталог журнала: {error}")
        })
}

#[tauri::command]
pub fn open_log_dir<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    open_dir(&app)
}

/// Путь к каталогу журнала — для текста диагностики.
#[tauri::command]
pub fn log_dir_path<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    Ok(ensure_log_dir(&app)?.to_string_lossy().to_string())
}
