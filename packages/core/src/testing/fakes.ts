import type { ISecretRef, ISecretStore } from '../ports/secret-store.js'
import type {
    IHttpRequest,
    IHttpResponse,
    ISubscriptionHandlers,
    ISubscriptionRequest,
    ITransport,
    IUnsubscribe,
} from '../ports/transport.js'

/** Хранилище секретов в памяти — замена Keychain в тестах. */
export class MemorySecretStore implements ISecretStore {
    private readonly _values = new Map<string, string>()

    public async get(ref: ISecretRef): Promise<string | undefined> {
        return this._values.get(key(ref))
    }

    public async set(ref: ISecretRef, value: string): Promise<void> {
        this._values.set(key(ref), value)
    }

    public async delete(ref: ISecretRef): Promise<void> {
        this._values.delete(key(ref))
    }
}

export interface IFakeExchange {
    request: IHttpRequest
    response: IHttpResponse
}

/**
 * Транспорт, отвечающий заранее заданными телами.
 *
 * Хранит все прошедшие через него запросы, что позволяет проверять не только
 * результат, но и то, какие заголовки и переменные реально ушли на сервер —
 * например, что секрет подставился, а в историю попала маска.
 */
export class FakeTransport implements ITransport {
    public readonly exchanges: IFakeExchange[] = []

    private readonly _responder: (request: IHttpRequest) => Partial<IHttpResponse> | string

    constructor(responder: (request: IHttpRequest) => Partial<IHttpResponse> | string) {
        this._responder = responder
    }

    public async request(request: IHttpRequest): Promise<IHttpResponse> {
        const raw = this._responder(request)
        const partial = typeof raw === 'string' ? { body: raw } : raw

        const response: IHttpResponse = {
            status: partial.status ?? 200,
            statusText: partial.statusText ?? 'OK',
            headers: partial.headers ?? { 'content-type': 'application/json' },
            body: partial.body ?? '{"data":{}}',
            timings: partial.timings ?? { totalMs: 1, firstByteMs: 1 },
        }

        this.exchanges.push({ request, response })

        return response
    }

    public subscribe(_request: ISubscriptionRequest, handlers: ISubscriptionHandlers): IUnsubscribe {
        handlers.onConnected?.()

        return () => handlers.onComplete()
    }

    /** Тело последнего запроса, разобранное как GraphQL-конверт. */
    public lastPayload(): { query?: string; variables?: Record<string, unknown> } {
        const last = this.exchanges.at(-1)
        if (!last?.request.body) return {}

        return JSON.parse(last.request.body) as { query?: string; variables?: Record<string, unknown> }
    }
}

function key(ref: ISecretRef): string {
    return `${ref.workspace}:${ref.environment}:${ref.key}`
}
