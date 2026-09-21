import type { IEnvironment, IWorkspace } from '../model/schemas.js'
import type { WorkspaceStore } from '../storage/workspace-store.js'
import { findJwt, readJwtInfo } from './jwt.js'
import type { SecretResolver } from './secret-resolver.js'
import type { TokenInfoStore } from './token-info-store.js'

export interface IRememberedToken {
    /** Имя переменной окружения, под которым сохранён токен. */
    variable: string
    expiresAt?: string
    subject?: string
}

/**
 * Сохранение токена, добытого цепочкой.
 *
 * Без этого значения жили только внутри одного запроса: заголовок
 * `Bearer {{accessToken}}` снова оказывался нераскрытым, и логин повторялся
 * перед каждым вызовом. Теперь токен попадает в Keychain, в окружение уходит
 * ссылка на него, а рядом запоминается срок жизни — по нему обновление
 * происходит заранее.
 */
export class TokenKeeper {
    private readonly _workspaces: WorkspaceStore
    private readonly _resolver: SecretResolver
    private readonly _tokens: TokenInfoStore

    constructor(workspaces: WorkspaceStore, resolver: SecretResolver, tokens: TokenInfoStore) {
        this._workspaces = workspaces
        this._resolver = resolver
        this._tokens = tokens
    }

    /**
     * Запоминает первый JWT из контекста цепочки.
     *
     * Возвращает `undefined`, если токена в контексте нет: не всякая цепочка
     * занимается авторизацией, и это нормально.
     */
    public async remember(
        workspaceId: string,
        environmentId: string | undefined,
        context: Record<string, unknown>,
        tokenVariable?: string,
    ): Promise<IRememberedToken | undefined> {
        const workspace = await this._workspaces.getWorkspace(workspaceId)
        const environment = this._pickEnvironment(workspace, environmentId)
        if (!environment) return undefined

        const found = pickToken(context, environment.headers, tokenVariable)
        if (!found) return undefined

        const { name, value } = found

        const reference = await this._resolver.storeSecret(
            workspace.id,
            environment.id,
            name,
            value,
        )

        environment.variables[name] = reference
        await this._workspaces.saveWorkspace(workspace)

        // Срок берётся из JWT, даже если значение пришло готовым заголовком
        // вида `Bearer eyJ…`. Хранится отдельно от workspace: это личное.
        const info = readJwtInfo(value)
        if (info) {
            await this._tokens.set(workspace.id, environment.id, {
                expiresAt: info.expiresAt.toISOString(),
                subject: info.subject,
            })
        }

        return {
            variable: name,
            expiresAt: info?.expiresAt.toISOString(),
            subject: info?.subject,
        }
    }

    private _pickEnvironment(
        workspace: IWorkspace,
        environmentId: string | undefined,
    ): IEnvironment | undefined {
        const wanted = environmentId ?? workspace.defaultEnvironmentId

        return (
            workspace.environments.find((item) => item.id === wanted) ?? workspace.environments[0]
        )
    }
}

/**
 * Выбирает, какое значение контекста считать токеном.
 *
 * Порядок важен: явно заданное имя, затем имя, на которое ссылается заголовок
 * окружения, и лишь потом догадка по виду JWT. Бэкенд может отдавать заголовок
 * целиком (`Bearer eyJ…`) или непрозрачный токен, поэтому опираться только на
 * форму значения нельзя.
 */
export function pickToken(
    context: Record<string, unknown>,
    headers: Record<string, string>,
    tokenVariable?: string,
): { name: string; value: string } | undefined {
    const readString = (name: string): string | undefined => {
        const value = context[name]

        return typeof value === 'string' && value.length > 0 ? value : undefined
    }

    if (tokenVariable) {
        const value = readString(tokenVariable)

        return value ? { name: tokenVariable, value } : undefined
    }

    for (const placeholder of collectPlaceholders(headers)) {
        const value = readString(placeholder)
        if (value) return { name: placeholder, value }
    }

    const jwt = findJwt(context)
    if (jwt) return { name: jwt.name, value: jwt.token }

    // Единственное строковое значение тоже считается токеном: цепочка,
    // извлекающая ровно одно поле, почти всегда добывает именно его.
    const strings = Object.entries(context).filter(
        ([, value]) => typeof value === 'string' && value.length > 0,
    )
    if (strings.length === 1) {
        const [name, value] = strings[0] as [string, string]

        return { name, value }
    }

    return undefined
}

/** Имена переменных, на которые ссылаются заголовки окружения. */
function collectPlaceholders(headers: Record<string, string>): string[] {
    const names: string[] = []

    for (const value of Object.values(headers)) {
        for (const match of value.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)) {
            if (match[1]) names.push(match[1])
        }
    }

    return names
}
