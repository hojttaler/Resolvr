import {
    FOLDER_SEPARATOR,
    parseGraphqlBody,
    parseVariables,
    uniqueName,
    type IImportBundle,
    type IImportedCollection,
    type IImportedEnvironment,
    type IImportedOperation,
} from './bundle.js'

/**
 * Postman Collection v2.1 и Postman Environment.
 *
 * Папки первого уровня становятся коллекциями, запросы без папки — коллекцией
 * с именем самой Postman-коллекции. Вложенные папки сплющиваются в имя
 * операции («Auth / Login»): наши коллекции плоские, и терять структуру
 * целиком было бы хуже, чем удлинить имя. Подстановки `{{var}}` совпадают
 * с нашими и переносятся как есть.
 */
interface IPostmanHeader {
    key?: string
    value?: string
    disabled?: boolean
}

interface IPostmanRequest {
    method?: string
    header?: IPostmanHeader[] | string
    body?: {
        mode?: string
        raw?: string
        graphql?: { query?: string; variables?: string | Record<string, unknown> }
    }
    description?: string | { content?: string }
}

interface IPostmanItem {
    name?: string
    item?: IPostmanItem[]
    request?: IPostmanRequest | string
    description?: string
}

interface IPostmanCollection {
    info?: { name?: string; schema?: string }
    item?: IPostmanItem[]
    variable?: Array<{ key?: string; value?: unknown; disabled?: boolean }>
}

interface IPostmanEnvironment {
    name?: string
    values?: Array<{ key?: string; value?: unknown; enabled?: boolean }>
    _postman_variable_scope?: string
}

export function isPostmanCollection(value: unknown): value is IPostmanCollection {
    const candidate = value as IPostmanCollection | null

    return Boolean(candidate && typeof candidate === 'object' && candidate.info && Array.isArray(candidate.item))
}

export function isPostmanEnvironment(value: unknown): value is IPostmanEnvironment {
    const candidate = value as IPostmanEnvironment | null

    return Boolean(
        candidate &&
            typeof candidate === 'object' &&
            Array.isArray(candidate.values) &&
            (candidate._postman_variable_scope !== undefined || typeof candidate.name === 'string'),
    )
}

function headersOf(request: IPostmanRequest): Record<string, string> {
    const headers: Record<string, string> = {}
    if (!Array.isArray(request.header)) return headers

    for (const header of request.header) {
        if (!header.key || header.disabled) continue
        headers[header.key] = header.value ?? ''
    }

    return headers
}

function operationOf(name: string, item: IPostmanItem): IImportedOperation | undefined {
    const request = item.request
    if (!request || typeof request === 'string') return undefined

    let parsed: { query: string; variables: Record<string, unknown> } | undefined
    if (request.body?.mode === 'graphql' && request.body.graphql?.query) {
        parsed = {
            query: request.body.graphql.query,
            variables: parseVariables(request.body.graphql.variables),
        }
    } else if (request.body?.raw) {
        parsed = parseGraphqlBody(request.body.raw)
    }
    if (!parsed) return undefined

    const description =
        typeof request.description === 'string' ? request.description : request.description?.content

    return {
        name,
        query: parsed.query,
        variables: parsed.variables,
        headers: headersOf(request),
        description: description ?? item.description,
    }
}

export function convertPostmanCollection(source: IPostmanCollection): IImportBundle {
    const rootName = source.info?.name?.trim() || 'Postman'
    const collections: IImportedCollection[] = []
    const collectionNames = new Set<string>()
    let skipped = 0

    function collect(items: IPostmanItem[], target: IImportedOperation[], prefix: string, taken: Set<string>): void {
        for (const item of items) {
            const label = item.name?.trim() || 'Untitled'
            if (Array.isArray(item.item)) {
                collect(item.item, target, prefix ? `${prefix}${FOLDER_SEPARATOR}${label}` : label, taken)
                continue
            }

            const operation = operationOf(uniqueName(prefix ? `${prefix}${FOLDER_SEPARATOR}${label}` : label, taken), item)
            if (operation) target.push(operation)
            else if (item.request) skipped += 1
        }
    }

    const loose: IImportedOperation[] = []
    const looseNames = new Set<string>()

    for (const item of source.item ?? []) {
        if (Array.isArray(item.item)) {
            const operations: IImportedOperation[] = []
            collect(item.item, operations, '', new Set())
            if (operations.length > 0) {
                collections.push({
                    name: uniqueName(item.name?.trim() || 'Folder', collectionNames),
                    operations,
                })
            }
            continue
        }

        const operation = operationOf(uniqueName(item.name?.trim() || 'Untitled', looseNames), item)
        if (operation) loose.push(operation)
        else if (item.request) skipped += 1
    }

    if (loose.length > 0) {
        collections.unshift({ name: uniqueName(rootName, collectionNames), operations: loose })
    }

    const environments: IImportedEnvironment[] = []
    const variables: Record<string, string> = {}
    for (const variable of source.variable ?? []) {
        if (!variable.key || variable.disabled) continue
        variables[variable.key] = stringValue(variable.value)
    }
    if (Object.keys(variables).length > 0) environments.push({ name: rootName, variables })

    return { source: 'postman', collections, environments, skipped }
}

export function convertPostmanEnvironment(source: IPostmanEnvironment): IImportBundle {
    const variables: Record<string, string> = {}
    for (const entry of source.values ?? []) {
        if (!entry.key || entry.enabled === false) continue
        variables[entry.key] = stringValue(entry.value)
    }

    return {
        source: 'postman',
        collections: [],
        environments: [{ name: source.name?.trim() || 'Postman', variables }],
        skipped: 0,
    }
}

function stringValue(value: unknown): string {
    if (value === undefined || value === null) return ''

    return typeof value === 'string' ? value : JSON.stringify(value)
}
