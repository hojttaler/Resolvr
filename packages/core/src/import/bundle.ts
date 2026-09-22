/**
 * Промежуточное представление импорта.
 *
 * Postman и Insomnia приводятся к одной форме, а запись в библиотеку делает
 * один код: коллекции с операциями и окружения с переменными. Всё, что не
 * GraphQL (REST-запросы), отбрасывается и считается в `skipped`.
 */
export interface IImportedOperation {
    name: string
    query: string
    variables: Record<string, unknown>
    headers: Record<string, string>
    description?: string
}

export interface IImportedCollection {
    name: string
    operations: IImportedOperation[]
}

export interface IImportedEnvironment {
    name: string
    variables: Record<string, string>
}

export interface IImportBundle {
    source: 'postman' | 'insomnia'
    collections: IImportedCollection[]
    environments: IImportedEnvironment[]
    /** Запросы, которые не удалось распознать как GraphQL. */
    skipped: number
}

/** Разбирает тело запроса вида `{"query": "...", "variables": {...}}`. */
export function parseGraphqlBody(text: string): { query: string; variables: Record<string, unknown> } | undefined {
    const trimmed = text.trim()
    if (trimmed.length === 0) return undefined

    try {
        const parsed = JSON.parse(trimmed) as { query?: unknown; variables?: unknown }
        if (typeof parsed.query !== 'string') return undefined

        return {
            query: parsed.query,
            variables: parseVariables(parsed.variables),
        }
    } catch {
        // Не JSON — возможно, чистый GraphQL-текст.
        return /\b(query|mutation|subscription|fragment)\b|^\s*\{/.test(trimmed)
            ? { query: trimmed, variables: {} }
            : undefined
    }
}

export function parseVariables(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        try {
            const parsed = JSON.parse(value) as unknown

            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? (parsed as Record<string, unknown>)
                : {}
        } catch {
            return {}
        }
    }

    return {}
}

/** Разделитель вложенных папок в имени операции. */
export const FOLDER_SEPARATOR = ' › '

/**
 * Имя операции, пригодное для файла и для ссылки `collection/name`: слэши
 * заменяются на разделитель папок, управляющие символы убираются.
 */
export function safeOperationName(name: string): string {
    return name
        .replace(/[\\/]+/g, FOLDER_SEPARATOR)
        .replace(/[\u0000-\u001f]/g, '')
        .replace(/\s+/g, ' ')
        .trim() || 'Untitled'
}

/** Уникальное имя в пределах списка: «Users», «Users 2», «Users 3». */
export function uniqueName(name: string, taken: Set<string>): string {
    const base = safeOperationName(name)
    let candidate = base
    for (let index = 2; taken.has(candidate); index += 1) candidate = `${base} ${index}`
    taken.add(candidate)

    return candidate
}
