//! Наблюдение за процессом страницы WebKitGTK на Linux.
//!
//! Страницу рисует отдельный процесс WebKit. Когда он падает или его убивает
//! система за превышение памяти, Rust-часть продолжает жить, а окно становится
//! пустым; в журнал при этом ничего не попадает — ни паники, ни ошибки
//! интерфейса. Здесь причина записывается в журнал, а страница перезагружается:
//! черновики лежат на диске, и интерфейс поднимается с тем же состоянием.
//!
//! Там же до создания окна отключается рендерер DMA-BUF на драйвере NVIDIA —
//! самая частая причина таких падений.

use tauri::{Runtime, WebviewWindow};

/// Переменная WebKitGTK, отключающая рендерер DMA-BUF.
#[cfg(target_os = "linux")]
const DISABLE_DMABUF: &str = "WEBKIT_DISABLE_DMABUF_RENDERER";

/// Готовит окружение WebKitGTK до создания окна. Вне Linux ничего не делает.
///
/// С проприетарным драйвером NVIDIA рендерер DMA-BUF в WebKitGTK роняет
/// процесс страницы или оставляет окно пустым. Рендерер отключается, только
/// если пользователь не задал переменную сам; решение пишется в журнал.
/// Вызывается до запуска потоков: `set_var` небезопасен при параллельном
/// чтении окружения.
pub fn prepare_environment() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var_os(DISABLE_DMABUF).is_some() {
            return;
        }

        let nvidia = std::path::Path::new("/proc/driver/nvidia/version").exists()
            || std::path::Path::new("/sys/module/nvidia").exists();
        if nvidia {
            std::env::set_var(DISABLE_DMABUF, "1");
        }
    }
}

/// Пишет в журнал, какой рендерер выбран: сам журнал поднимается позже, чем
/// нужно выставить переменную.
pub fn log_environment() {
    #[cfg(target_os = "linux")]
    match std::env::var(DISABLE_DMABUF) {
        Ok(value) => log::info!("WebKitGTK: {DISABLE_DMABUF}={value}"),
        Err(_) => log::info!("WebKitGTK: рендерер DMA-BUF включён"),
    }
}

/// Подписывается на завершение процесса страницы. Вне Linux ничего не делает.
pub fn watch<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "linux")]
    {
        use webkit2gtk::{WebProcessTerminationReason, WebViewExt};

        let result = window.with_webview(|webview| {
            webview
                .inner()
                .connect_web_process_terminated(|view, reason| {
                    let reason = match reason {
                        WebProcessTerminationReason::Crashed => "процесс упал",
                        WebProcessTerminationReason::ExceededMemoryLimit => {
                            "превышен лимит памяти"
                        }
                        WebProcessTerminationReason::TerminatedByApi => "завершён приложением",
                        _ => "причина неизвестна",
                    };
                    log::error!(
                        "Процесс страницы WebKitGTK завершился: {reason}; интерфейс перезагружается"
                    );
                    view.reload();
                });
        });

        if let Err(error) = result {
            log::warn!("Наблюдение за процессом страницы не подключено: {error}");
        }
    }

    #[cfg(not(target_os = "linux"))]
    let _ = window;
}
