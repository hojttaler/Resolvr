import { createClient } from 'graphql-ws'
import WebSocket from 'ws'

import { ErrorCodeEnum, ResolvrError } from '../../model/errors.js'
import type {
    IHttpRequest,
    IHttpResponse,
    ISubscriptionHandlers,
    ISubscriptionRequest,
    ITransport,
    IUnsubscribe,
} from '../../ports/transport.js'

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Транспорт для MCP-сервера и CLI.
 *
 * В GUI ту же роль выполняет Rust-реализация: у неё нет CORS-ограничений
 * webview и есть точные тайминги по фазам соединения.
 */
export class NodeTransport implements ITransport {
    private _warnedAboutCerts = false

    public async request(request: IHttpRequest): Promise<IHttpResponse> {
        const startedAt = performance.now()

        if (request.acceptInvalidCerts && !this._warnedAboutCerts) {
            // Встроенный в Node fetch не даёт отключить проверку сертификата для
            // отдельного запроса. В приложении этим занимается Rust-транспорт;
            // здесь остаётся переменная окружения, и о ней нужно сказать явно,
            // а не молча ходить с проверкой и получать непонятную ошибку TLS.
            this._warnedAboutCerts = true
            process.stderr.write(
                'Resolvr: acceptInvalidCerts вне приложения не поддерживается — ' +
                    'запустите процесс с NODE_TLS_REJECT_UNAUTHORIZED=0, если это нужно\n',
            )
        }

        try {
            const response = await fetch(request.url, {
                method: request.method,
                headers: request.headers,
                body: request.body,
                signal: AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS),
            })

            const firstByteMs = performance.now() - startedAt
            const body = await response.text()

            const headers: Record<string, string> = {}
            response.headers.forEach((value, key) => {
                headers[key] = value
            })

            return {
                status: response.status,
                statusText: response.statusText,
                headers,
                body,
                timings: { totalMs: performance.now() - startedAt, firstByteMs },
            }
        } catch (error) {
            throw new ResolvrError(
                ErrorCodeEnum.TRANSPORT_FAILED,
                `Запрос к ${request.url} не выполнен: ${error instanceof Error ? error.message : 'ошибка сети'}`,
                { url: request.url },
            )
        }
    }

    public subscribe(
        request: ISubscriptionRequest,
        handlers: ISubscriptionHandlers,
    ): IUnsubscribe {
        const client = createClient({
            url: request.url,
            webSocketImpl: WebSocket,
            connectionParams: request.headers,
            on: { connected: () => handlers.onConnected?.() },
        })

        const dispose = client.subscribe(
            {
                query: request.query,
                variables: request.variables ?? {},
                operationName: request.operationName,
            },
            {
                next: (value) => handlers.onNext(value),
                error: (error) =>
                    handlers.onError(
                        error instanceof Error ? error : new Error(JSON.stringify(error)),
                    ),
                complete: () => handlers.onComplete(),
            },
        )

        return () => {
            dispose()
            void client.dispose()
        }
    }
}
