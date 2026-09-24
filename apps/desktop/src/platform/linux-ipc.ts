/**
 * IPC на Linux — через `postMessage`, а не через URI-схему `ipc://`.
 *
 * На Linux Tauri по умолчанию отправляет каждую команду запросом к схеме
 * `ipc://`, и ответ отдаёт `wry` через `webkit_uri_scheme_request_finish_with_response`.
 * Обе трассировки падения с повреждением кучи (`malloc(): unaligned … chunk`)
 * на WebKitGTK пришлись ровно на этот путь. Если запрос к `ipc://` завершился
 * ошибкой, Tauri штатно и навсегда переходит на `postMessage`, где ответ
 * возвращается в главном потоке без объекта запроса WebKit. Здесь такой отказ
 * имитируется до первой команды; единственное предупреждение Tauri об этом
 * попадает в журнал.
 *
 * Модуль импортируется первым: команды, отправленные раньше, ушли бы по старому пути.
 */
const IPC_SCHEME = 'ipc://'

function isLinuxWebKit(): boolean {
    if (typeof navigator === 'undefined') return false

    const agent = navigator.userAgent

    return agent.includes('Linux') && !agent.includes('Android')
}

if (typeof window !== 'undefined' && isLinuxWebKit()) {
    const originalFetch = window.fetch.bind(window)

    window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        if (url.startsWith(IPC_SCHEME)) {
            return Promise.reject(new TypeError('Resolvr: IPC через ipc:// отключён на Linux'))
        }

        return originalFetch(input, init)
    }
}

export {}
