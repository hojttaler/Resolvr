import { invoke, isTauri } from '@tauri-apps/api/core'
import { error as writeError, warn as writeWarn } from '@tauri-apps/plugin-log'

type ILogLevel = 'error' | 'warn'

let installed = false
/** Защита от рекурсии: запись в журнал сама не должна попадать в перехват консоли. */
let forwarding = false

/**
 * Пишет ошибку интерфейса в журнал приложения.
 *
 * Вне Tauri (витрина, тесты) журнала нет — вызов ничего не делает.
 * В сообщение не следует передавать тела запросов, токены и значения
 * переменных окружения: файл журнала прикладывают к баг-репорту.
 */
export function logError(message: string, error?: unknown): void {
    forward('error', error === undefined ? message : `${message}: ${describeError(error)}`)
}

/**
 * Подключает глобальный перехват ошибок интерфейса.
 *
 * Необработанные исключения, отклонённые промисы и вызовы
 * `console.error`/`console.warn` (в том числе предупреждения React)
 * дублируются в журнал; вывод в консоль devtools сохраняется.
 */
export function installLogger(): void {
    if (installed || !isTauri()) return
    installed = true

    window.addEventListener('error', (event) => {
        forward('error', `Необработанная ошибка: ${describeError(event.error ?? event.message)}`)
    })
    window.addEventListener('unhandledrejection', (event) => {
        forward('error', `Необработанный отказ промиса: ${describeError(event.reason)}`)
    })

    wrapConsole('error')
    wrapConsole('warn')
}

/** Открывает каталог журнала в файловом менеджере системы. */
export async function openLogDir(): Promise<void> {
    if (!isTauri()) return

    await invoke('open_log_dir')
}

/** Путь к каталогу журнала или `undefined` вне Tauri и при ошибке. */
export async function readLogDirPath(): Promise<string | undefined> {
    if (!isTauri()) return undefined

    return invoke<string>('log_dir_path').catch(() => undefined)
}

function wrapConsole(level: ILogLevel): void {
    const original = console[level].bind(console)

    console[level] = (...args: unknown[]): void => {
        original(...args)
        forward(level, args.map(describeError).join(' '))
    }
}

function forward(level: ILogLevel, message: string): void {
    if (!isTauri() || forwarding) return

    forwarding = true
    try {
        const write = level === 'error' ? writeError : writeWarn
        // Сбой записи в журнал не показывается и не логируется повторно —
        // иначе недоступный плагин порождал бы бесконечную цепочку ошибок.
        void write(message).catch(() => undefined)
    } catch {
        // Синхронный сбой IPC игнорируется по той же причине.
    } finally {
        forwarding = false
    }
}

function describeError(value: unknown): string {
    if (value instanceof Error) {
        // В WebKit `stack` содержит только кадры, в Chromium — ещё и заголовок.
        const title = `${value.name}: ${value.message}`
        if (!value.stack) return title

        return value.stack.startsWith(title) ? value.stack : `${title}\n${value.stack}`
    }
    if (typeof value === 'string') return value

    try {
        return JSON.stringify(value) ?? String(value)
    } catch {
        return String(value)
    }
}
