import {
    FOLDER_SEPARATOR,
    parseGraphqlBody,
    uniqueName,
    type IImportBundle,
    type IImportedCollection,
    type IImportedEnvironment,
    type IImportedOperation,
} from './bundle.js'

/**
 * Insomnia export v4 (`_type: "export"`).
 *
 * Ресурсы связаны через `parentId`: workspace → request_group → request.
 * Группа первого уровня становится коллекцией, вложенные — префиксом имени.
 * Окружения Insomnia хранят переменные вложенным объектом — он сплющивается
 * в `a.b.c`, а подстановки `{{ _.name }}` переписываются в наши `{{name}}`.
 */
interface IInsomniaResource {
    _type?: string
    _id?: string
    parentId?: string | null
    name?: string
    description?: string
    body?: { mimeType?: string; text?: string }
    headers?: Array<{ name?: string; value?: string; disabled?: boolean }>
    data?: Record<string, unknown>
}

interface IInsomniaExport {
    _type?: string
    __export_format?: number
    resources?: IInsomniaResource[]
}

export function isInsomniaExport(value: unknown): value is IInsomniaExport {
    const candidate = value as IInsomniaExport | null

    return Boolean(
        candidate && typeof candidate === 'object' && candidate._type === 'export' && Array.isArray(candidate.resources),
    )
}

/** `{{ _.token }}` → `{{token}}`. */
export function normalizeInsomniaTemplates(text: string): string {
    return text.replace(/\{\{\s*_\.([\w.]+)\s*\}\}/g, '{{$1}}')
}

function flattenData(data: Record<string, unknown>, prefix = ''): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [key, value] of Object.entries(data)) {
        const path = prefix ? `${prefix}.${key}` : key
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            Object.assign(result, flattenData(value as Record<string, unknown>, path))
        } else {
            result[path] = typeof value === 'string' ? value : JSON.stringify(value)
        }
    }

    return result
}

export function convertInsomniaExport(source: IInsomniaExport): IImportBundle {
    const resources = source.resources ?? []
    const byId = new Map(resources.map((resource) => [resource._id ?? '', resource]))

    /** Цепочка групп от корня до ресурса — без workspace. */
    function groupChain(resource: IInsomniaResource): IInsomniaResource[] {
        const chain: IInsomniaResource[] = []
        let current = resource.parentId ? byId.get(resource.parentId) : undefined
        while (current && current._type === 'request_group') {
            chain.unshift(current)
            current = current.parentId ? byId.get(current.parentId) : undefined
        }

        return chain
    }

    const collections = new Map<string, IImportedCollection>()
    const namesByCollection = new Map<string, Set<string>>()
    const collectionNames = new Set<string>()
    let skipped = 0

    for (const resource of resources) {
        if (resource._type !== 'request') continue

        const parsed = resource.body?.text ? parseGraphqlBody(normalizeInsomniaTemplates(resource.body.text)) : undefined
        const isGraphql = resource.body?.mimeType === 'application/graphql' || parsed !== undefined
        if (!isGraphql || !parsed) {
            skipped += 1
            continue
        }

        const chain = groupChain(resource)
        const topName = chain[0]?.name?.trim() || 'Insomnia'
        const topId = chain[0]?._id ?? '__root__'
        let collection = collections.get(topId)
        if (!collection) {
            collection = { name: uniqueName(topName, collectionNames), operations: [] }
            collections.set(topId, collection)
            namesByCollection.set(topId, new Set())
        }

        const prefix = chain.slice(1).map((group) => group.name?.trim() || 'Group').join(FOLDER_SEPARATOR)
        const label = resource.name?.trim() || 'Untitled'
        const headers: Record<string, string> = {}
        for (const header of resource.headers ?? []) {
            if (!header.name || header.disabled) continue
            headers[header.name] = normalizeInsomniaTemplates(header.value ?? '')
        }

        const operation: IImportedOperation = {
            name: uniqueName(prefix ? `${prefix}${FOLDER_SEPARATOR}${label}` : label, namesByCollection.get(topId)!),
            query: parsed.query,
            variables: parsed.variables,
            headers,
            description: resource.description || undefined,
        }
        collection.operations.push(operation)
    }

    const environments: IImportedEnvironment[] = []
    for (const resource of resources) {
        if (resource._type !== 'environment' || !resource.data) continue
        const variables = flattenData(resource.data)
        if (Object.keys(variables).length === 0) continue

        // Базовое окружение Insomnia называется по workspace — читаемее без него.
        const parent = resource.parentId ? byId.get(resource.parentId) : undefined
        const isBase = parent?._type === 'workspace'
        environments.push({
            name: isBase ? 'Base' : resource.name?.trim() || 'Environment',
            variables,
        })
    }

    return { source: 'insomnia', collections: [...collections.values()], environments, skipped }
}
