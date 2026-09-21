/**
 * Абстракция сетевого транспорта.
 *
 * В GUI реализуется Rust-командой (обход CORS, произвольные заголовки,
 * опциональный приём самоподписанных сертификатов), в MCP-сервере — обычным
 * `fetch` и `graphql-ws`.
 */
export interface ITransport {
    request(request: IHttpRequest): Promise<IHttpResponse>

    /**
     * Открывает GraphQL-подписку. Возвращает функцию отписки; вызов её обязан
     * закрыть соединение и прекратить доставку событий в `handlers`.
     */
    subscribe(request: ISubscriptionRequest, handlers: ISubscriptionHandlers): IUnsubscribe
}

export interface IHttpRequest {
    url: string
    method: 'GET' | 'POST'
    headers: Record<string, string>
    /** Тело в виде готовой строки; сериализацию делает вызывающий код. */
    body?: string
    timeoutMs?: number
    /** Разрешает самоподписанные сертификаты — только для локальных стендов. */
    acceptInvalidCerts?: boolean
}

export interface IHttpResponse {
    status: number
    statusText: string
    headers: Record<string, string>
    body: string
    /** Тайминги в миллисекундах, измеренные транспортом. */
    timings: IResponseTimings
}

export interface IResponseTimings {
    /** Полное время от отправки до получения последнего байта. */
    totalMs: number
    /** Время до первого байта ответа, если транспорт умеет его измерять. */
    firstByteMs?: number
}

export interface ISubscriptionRequest {
    url: string
    headers: Record<string, string>
    query: string
    variables?: Record<string, unknown>
    operationName?: string
    acceptInvalidCerts?: boolean
}

export interface ISubscriptionHandlers {
    onNext(payload: unknown): void
    onError(error: Error): void
    onComplete(): void
    /** Вызывается при установке соединения — UI показывает индикатор «подключено». */
    onConnected?(): void
}

export type IUnsubscribe = () => void
