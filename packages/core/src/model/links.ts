/**
 * Ссылки `resolvr://` — чтобы отправить коллеге «посмотри вот этот запрос»
 * и он открылся у него в приложении, а не пересылать текст запроса.
 *
 * Формат: `resolvr://open?workspace=<id>&operation=<collection/name>` или
 * `resolvr://open?workspace=<id>&flow=<id>`. Параметры кодируются как в URL.
 */
export const APP_LINK_SCHEME = 'resolvr'

export interface IAppLink {
    workspaceId: string
    operationRef?: string
    flowId?: string
}

export function formatAppLink(link: IAppLink): string {
    const params = new URLSearchParams({ workspace: link.workspaceId })
    if (link.operationRef) params.set('operation', link.operationRef)
    if (link.flowId) params.set('flow', link.flowId)

    return `${APP_LINK_SCHEME}://open?${params.toString()}`
}

/** Разбирает ссылку; `undefined` для чужой схемы или ссылки без workspace. */
export function parseAppLink(raw: string): IAppLink | undefined {
    let url: URL
    try {
        url = new URL(raw)
    } catch {
        return undefined
    }

    if (url.protocol !== `${APP_LINK_SCHEME}:`) return undefined

    const workspaceId = url.searchParams.get('workspace')
    if (!workspaceId) return undefined

    const operationRef = url.searchParams.get('operation') ?? undefined
    const flowId = url.searchParams.get('flow') ?? undefined

    return { workspaceId, operationRef, flowId }
}
