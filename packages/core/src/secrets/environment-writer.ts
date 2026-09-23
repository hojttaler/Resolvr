import { ErrorCodeEnum, ResolvrError } from '../model/errors.js'
import type { WorkspaceStore } from '../storage/workspace-store.js'
import { readJwtInfo } from './jwt.js'
import type { SecretResolver } from './secret-resolver.js'
import type { TokenInfoStore } from './token-info-store.js'

export interface IEnvironmentValue {
    /** Имя переменной окружения. */
    name: string
    value: string
    /** Хранить в хранилище секретов; в файле workspace останется только ссылка. */
    secret: boolean
}

export interface IEnvironmentWriteOptions {
    /** Имя переменной, для которой заводится `Authorization: Bearer {{name}}`. */
    authHeaderFor?: string
}

/**
 * Запись значений в переменные окружения.
 *
 * Одна точка для ручного «сохранить в окружение» из ответа и для правил
 * автосохранения операции: секреты уходят в хранилище секретов, срок жизни
 * JWT запоминается для индикатора и заблаговременного обновления.
 */
export class EnvironmentWriter {
    private readonly _workspaces: WorkspaceStore
    private readonly _resolver: SecretResolver
    private readonly _tokens: TokenInfoStore

    constructor(workspaces: WorkspaceStore, resolver: SecretResolver, tokens: TokenInfoStore) {
        this._workspaces = workspaces
        this._resolver = resolver
        this._tokens = tokens
    }

    /**
     * Записывает значения в окружение одной записью файла workspace.
     *
     * @throws ResolvrError ENVIRONMENT_NOT_FOUND — окружения нет в workspace.
     */
    public async save(
        workspaceId: string,
        environmentId: string,
        values: IEnvironmentValue[],
        options: IEnvironmentWriteOptions = {},
    ): Promise<void> {
        if (values.length === 0) return

        const workspace = await this._workspaces.getWorkspace(workspaceId)
        const environment = workspace.environments.find((item) => item.id === environmentId)
        if (!environment) {
            throw new ResolvrError(
                ErrorCodeEnum.ENVIRONMENT_NOT_FOUND,
                `Окружение "${environmentId}" не найдено в workspace "${workspaceId}"`,
                { workspaceId, environmentId },
            )
        }

        const variables = { ...environment.variables }
        for (const item of values) {
            variables[item.name] = item.secret
                ? await this._resolver.storeSecret(
                      workspaceId,
                      environmentId,
                      item.name,
                      item.value,
                  )
                : item.value
        }

        const headers = options.authHeaderFor
            ? { ...environment.headers, authorization: `Bearer {{${options.authHeaderFor}}}` }
            : environment.headers

        await this._workspaces.saveWorkspace({
            ...workspace,
            environments: workspace.environments.map((item) =>
                item.id === environmentId ? { ...item, variables, headers } : item,
            ),
        })

        // Срок жизни из `exp` позволяет обновить токен заранее и показать
        // остаток времени в шапке.
        for (const item of values) {
            const info = readJwtInfo(item.value)
            if (!info) continue

            await this._tokens.set(workspaceId, environmentId, {
                expiresAt: info.expiresAt.toISOString(),
                subject: info.subject,
            })
        }
    }
}

/**
 * Приводит значение из ответа к строке переменной окружения.
 *
 * Строка сохраняется как есть, числа и логические — текстом, объекты и
 * массивы — компактным JSON: так их можно подставить в переменные запроса.
 */
export function toEnvironmentValue(value: unknown): string {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return String(value)
    }

    return JSON.stringify(value ?? null)
}
