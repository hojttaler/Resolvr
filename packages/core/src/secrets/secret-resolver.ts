import type { IEnvironment, IWorkspace } from '../model/schemas.js'
import { parseSecretRef, type ISecretStore } from '../ports/secret-store.js'

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g
export const SECRET_MASK = '••••••••'

/** Результат раскрытия окружения: значения переменных и множество секретных из них. */
export interface IResolvedEnvironment {
    variables: Record<string, string>
    /** Значения, которые нельзя показывать в UI, истории и ответах MCP. */
    secretValues: string[]
    /** Переменные, чьи секреты в хранилище отсутствуют: токен ещё не получен. */
    missing: string[]
}

/**
 * Раскрывает переменные окружения и ссылки на Keychain.
 *
 * Значения секретов существуют только в памяти во время выполнения запроса:
 * на диск и в историю уходит замаскированная версия.
 */
export class SecretResolver {
    private readonly _secrets: ISecretStore

    constructor(secrets: ISecretStore) {
        this._secrets = secrets
    }

    /**
     * Раскрывает все переменные окружения.
     *
     * Ссылки `keychain://` заменяются значениями из хранилища. Отсутствующий
     * секрет — не ошибка: переменная остаётся нераскрытой, заголовок с ней не
     * отправляется, а панель ответа предлагает получить токен. Ошибка здесь
     * ломала бы и саму цепочку логина, которая этот секрет добывает: до первого
     * логина в хранилище пусто, и раскрывать нечего.
     */
    public async resolveEnvironment(
        _workspace: IWorkspace,
        environment: IEnvironment,
    ): Promise<IResolvedEnvironment> {
        const variables: Record<string, string> = {}
        const secretValues: string[] = []
        const missing: string[] = []

        for (const [key, rawValue] of Object.entries(environment.variables)) {
            const ref = parseSecretRef(rawValue)
            if (!ref) {
                variables[key] = rawValue
                continue
            }

            const value = await this._secrets.get(ref)
            if (value === undefined) {
                missing.push(key)
                continue
            }

            variables[key] = value
            if (value.length > 0) secretValues.push(value)
        }

        return { variables, secretValues, missing }
    }

    /** Кладёт значение в Keychain и возвращает ссылку для хранения в `workspace.json`. */
    public async storeSecret(
        workspaceId: string,
        environmentId: string,
        key: string,
        value: string,
    ): Promise<string> {
        const ref = { workspace: workspaceId, environment: environmentId, key }
        await this._secrets.set(ref, value)

        return `keychain://${workspaceId}/${environmentId}/${key}`
    }
}

/** Подставляет `{{var}}` в строку; неизвестный плейсхолдер остаётся как есть. */
export function interpolate(template: string, variables: Record<string, string>): string {
    return template.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
        const value = variables[name]

        return value === undefined ? match : value
    })
}

/** Подставляет переменные во все значения заголовков. */
export function interpolateHeaders(
    headers: Record<string, string>,
    variables: Record<string, string>,
): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
        result[key] = interpolate(value, variables)
    }

    return result
}

/**
 * Остались ли в значении нераскрытые плейсхолдеры `{{name}}`.
 *
 * Отдельный шаблон без флага `g`: у глобального регулярного выражения есть
 * состояние `lastIndex`, из-за которого повторные проверки давали бы через раз
 * ложный отрицательный ответ.
 */
export function hasUnresolvedPlaceholders(value: string): boolean {
    return /\{\{\s*[a-zA-Z0-9_.-]+\s*\}\}/.test(value)
}

/** Рекурсивно подставляет переменные в строковые значения JSON-структуры. */
export function interpolateJson<T>(value: T, variables: Record<string, string>): T {
    if (typeof value === 'string') return interpolate(value, variables) as T
    if (Array.isArray(value)) {
        const items: unknown[] = (value as unknown[]).map((item) =>
            interpolateJson(item, variables),
        )

        return items as T
    }
    if (value !== null && typeof value === 'object') {
        const result: Record<string, unknown> = {}
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            result[key] = interpolateJson(item, variables)
        }

        return result as T
    }

    return value
}

/**
 * Заменяет вхождения секретов на маску.
 *
 * Применяется ко всему, что покидает процесс: записи истории, ответы MCP,
 * сообщения об ошибках. Короткие значения (меньше 4 символов) пропускаются —
 * маскировать их бессмысленно, а ложных срабатываний было бы много.
 */
export function maskSecrets(text: string, secretValues: readonly string[]): string {
    let result = text
    for (const secret of secretValues) {
        if (secret.length < 4) continue
        result = result.split(secret).join(SECRET_MASK)
    }

    return result
}

/** Маскирует секреты внутри произвольной JSON-структуры. */
export function maskSecretsInJson<T>(value: T, secretValues: readonly string[]): T {
    if (secretValues.length === 0) return value

    const masked: unknown = JSON.parse(maskSecrets(JSON.stringify(value), secretValues))

    return masked as T
}

/** Заголовки для показа в UI: значения авторизации всегда скрыты. */
export function maskHeaders(
    headers: Record<string, string>,
    secretValues: readonly string[],
): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(headers)) {
        result[key] = /authorization|cookie|token|secret|api-?key/i.test(key)
            ? SECRET_MASK
            : maskSecrets(value, secretValues)
    }

    return result
}
