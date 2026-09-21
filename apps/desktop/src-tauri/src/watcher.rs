use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use notify::RecursiveMode;
use notify_debouncer_full::{new_debouncer, DebouncedEvent, Debouncer, RecommendedCache};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

/// Событие, доставляемое в webview при изменении файлов библиотеки.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryChangedEvent {
    /// Изменившиеся пути относительно корня библиотеки.
    pub paths: Vec<String>,
}

pub struct WatcherState {
    inner: Mutex<Option<Debouncer<notify::RecommendedWatcher, RecommendedCache>>>,
}

impl WatcherState {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

const EVENT_NAME: &str = "library-changed";
const DEBOUNCE_MS: u64 = 250;

/// Запускает наблюдение за корнем библиотеки.
///
/// Нужно ради сценария «агент правит коллекции через MCP, приложение открыто»:
/// изменившийся на диске файл должен появиться в UI без перезапуска. Каталог
/// `.state` исключён — его пишет само приложение, и реакция на собственные
/// записи привела бы к циклу перерисовок.
#[tauri::command]
pub fn watch_library(
    app: AppHandle,
    state: State<'_, WatcherState>,
    root: String,
) -> Result<(), String> {
    let root_path = PathBuf::from(&root);
    if !root_path.exists() {
        std::fs::create_dir_all(&root_path)
            .map_err(|error| format!("Не удалось создать библиотеку {root}: {error}"))?;
    }

    let app_handle = app.clone();
    let root_for_events = root_path.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(DEBOUNCE_MS),
        None,
        move |result: Result<Vec<DebouncedEvent>, Vec<notify::Error>>| {
            let Ok(events) = result else { return };

            let paths = collect_relevant_paths(&events, &root_for_events);
            if paths.is_empty() {
                return;
            }

            let _ = app_handle.emit(EVENT_NAME, LibraryChangedEvent { paths });
        },
    )
    .map_err(|error| format!("Не удалось запустить наблюдение за файлами: {error}"))?;

    debouncer
        .watch(&root_path, RecursiveMode::Recursive)
        .map_err(|error| format!("Не удалось начать наблюдение за {root}: {error}"))?;

    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Состояние наблюдателя повреждено".to_string())?;
    *guard = Some(debouncer);

    Ok(())
}

#[tauri::command]
pub fn unwatch_library(state: State<'_, WatcherState>) -> Result<(), String> {
    let mut guard = state
        .inner
        .lock()
        .map_err(|_| "Состояние наблюдателя повреждено".to_string())?;
    *guard = None;

    Ok(())
}

/// Отбирает изменения, на которые UI обязан отреагировать.
fn collect_relevant_paths(events: &[DebouncedEvent], root: &Path) -> Vec<String> {
    let mut paths: Vec<String> = events
        .iter()
        .flat_map(|event| event.paths.iter())
        .filter_map(|path| path.strip_prefix(root).ok())
        .map(|path| path.to_string_lossy().to_string())
        // `.state` пишет само приложение, а история запусков не влияет на дерево.
        // Журнал действий агента, наоборот, нужен: панель наблюдения обновляется
        // по этому же событию.
        .filter(|path| !path.starts_with(".state") && !path.contains("/.history/"))
        .filter(|path| !path.ends_with(".tmp"))
        .collect();

    paths.sort();
    paths.dedup();
    paths
}

/// Регистрирует состояние наблюдателя в приложении.
pub fn init(app: &AppHandle) {
    app.manage(WatcherState::new());
}
