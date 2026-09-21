import type {
    IHttpRequest,
    IHttpResponse,
    ISubscriptionHandlers,
    ISubscriptionRequest,
    ITransport,
    IUnsubscribe,
} from '@resolvr/core'
import { invoke } from '@tauri-apps/api/core'
import { createClient } from 'graphql-ws'

/**
 * Транспорт приложения.
 *
 * HTTP идёт через Rust: webview подчиняется CORS, а dev-эндпоинты его почти
 * никогда не настраивают. WebSocket-подписки, наоборот, открываются прямо из
 * webview — на них CORS не распространяется, а нативный `WebSocket` даёт
 * мгновенную доставку событий без промежуточного канала событий Tauri.
 */
export class TauriTransport implements ITransport {
    public async request(request: IHttpRequest): Promise<IHttpResponse> {
        return invoke<IHttpResponse>('http_request', {
            input: {
                url: request.url,
                method: request.method,
                headers: request.headers,
                body: request.body,
                timeoutMs: request.timeoutMs,
                acceptInvalidCerts: request.acceptInvalidCerts,
            },
        })
    }

    public subscribe(request: ISubscriptionRequest, handlers: ISubscriptionHandlers): IUnsubscribe {
        const client = createClient({
            url: request.url,
            connectionParams: request.headers,
            lazy: false,
            retryAttempts: 3,
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
                        error instanceof Error ? error : new Error(describeWsError(error)),
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

/** Ошибка graphql-ws приходит массивом GraphQL-ошибок или событием закрытия. */
function describeWsError(error: unknown): string {
    if (Array.isArray(error)) {
        return error
            .map((item) =>
                typeof item === 'object' && item !== null && 'message' in item
                    ? String((item as { message: unknown }).message)
                    : JSON.stringify(item),
            )
            .join('; ')
    }

    if (typeof error === 'object' && error !== null && 'reason' in error) {
        const closeEvent = error as { code?: number; reason?: string }

        return `Connection closed (${closeEvent.code ?? '—'}): ${closeEvent.reason || 'no reason'}`
    }

    return JSON.stringify(error)
}
