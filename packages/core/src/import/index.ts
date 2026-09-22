import type { WorkspaceStore } from '../storage/workspace-store.js'
import { toSlug } from '../storage/paths.js'
import type { IImportBundle } from './bundle.js'
import { convertInsomniaExport, isInsomniaExport } from './insomnia.js'
import {
    convertPostmanCollection,
    convertPostmanEnvironment,
    isPostmanCollection,
    isPostmanEnvironment,
} from './postman.js'

export * from './bundle.js'
export { convertInsomniaExport, isInsomniaExport, normalizeInsomniaTemplates } from './insomnia.js'
export {
    convertPostmanCollection,
    convertPostmanEnvironment,
    isPostmanCollection,
    isPostmanEnvironment,
} from './postman.js'

/**
 * Распознаёт формат экспорта по содержимому файла и приводит к общему виду.
 * Возвращает `undefined`, если файл не похож ни на один известный формат.
 */
export function parseImportFile(text: string): IImportBundle | undefined {
    let json: unknown
    try {
        json = JSON.parse(text)
    } catch {
        return undefined
    }

    if (isPostmanCollection(json)) return convertPostmanCollection(json)
    if (isPostmanEnvironment(json)) return convertPostmanEnvironment(json)
    if (isInsomniaExport(json)) return convertInsomniaExport(json)

    return undefined
}

export interface IImportResult {
    collections: number
    operations: number
    environments: number
    skipped: number
}

/**
 * Записывает импорт в workspace.
 *
 * Коллекции с занятым именем получают суффикс, а не сливаются: импорт не
 * должен молча переписать чужие операции. Окружения добавляются к
 * существующим; их переменные — обычные, не секреты: в экспортах Postman
 * значения лежат открытым текстом, и притворяться, что они защищены, нельзя.
 */
export async function importBundle(
    workspaces: WorkspaceStore,
    workspaceId: string,
    bundle: IImportBundle,
): Promise<IImportResult> {
    const existing = new Set((await workspaces.listCollections(workspaceId)).map((item) => item.id))
    let operations = 0

    for (const collection of bundle.collections) {
        let id = toSlug(collection.name) || 'imported'
        for (let index = 2; existing.has(id); index += 1) id = `${toSlug(collection.name) || 'imported'}-${index}`
        existing.add(id)

        await workspaces.createCollection(workspaceId, collection.name, id)
        for (const operation of collection.operations) {
            await workspaces.saveOperation(workspaceId, {
                collectionId: id,
                name: operation.name,
                query: operation.query,
                variables: operation.variables,
                headers: operation.headers,
                description: operation.description,
            })
            operations += 1
        }
    }

    if (bundle.environments.length > 0) {
        const workspace = await workspaces.getWorkspace(workspaceId)
        const ids = new Set(workspace.environments.map((item) => item.id))
        for (const environment of bundle.environments) {
            let id = toSlug(environment.name) || 'imported'
            for (let index = 2; ids.has(id); index += 1) id = `${toSlug(environment.name) || 'imported'}-${index}`
            ids.add(id)

            workspace.environments.push({
                id,
                name: environment.name,
                production: false,
                variables: environment.variables,
                headers: {},
                auth: { type: 'none' },
            })
        }
        await workspaces.saveWorkspace(workspace)
    }

    return {
        collections: bundle.collections.length,
        operations,
        environments: bundle.environments.length,
        skipped: bundle.skipped,
    }
}
