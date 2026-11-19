import {
    buildClientSchema,
    buildSchema,
    printSchema,
    type GraphQLSchema,
    type IntrospectionQuery,
} from 'graphql'

import { ErrorCodeEnum, ResolvrError } from '../model/errors.js'
import { SchemaCacheSchema, type IEndpoint, type ISchemaCache } from '../model/schemas.js'
import type { IFileSystem } from '../ports/file-system.js'
import type { RunEngine } from '../run/run-engine.js'
import { readJsonFile, writeJsonFile } from '../storage/json.js'
import type { LibraryPaths } from '../storage/paths.js'

/**
 * Интроспекция схемы и работа с её кэшем.
 *
 * Схема живёт в `.cache/schema.<endpoint>.json` в виде SDL: это читаемо,
 * компактнее сырой интроспекции и позволяет сравнивать версии текстом.
 * Предыдущий снимок сохраняется отдельно — на нём строится diff «что изменилось
 * после деплоя».
 */
export class SchemaService {
    private readonly _fs: IFileSystem
    private readonly _paths: LibraryPaths
    private readonly _runner: Pick<RunEngine, 'runIntrospection'>
    private readonly _memoryCache = new Map<string, { hash: string; schema: GraphQLSchema }>()

    constructor(fs: IFileSystem, paths: LibraryPaths, runner: Pick<RunEngine, 'runIntrospection'>) {
        this._fs = fs
        this._paths = paths
        this._runner = runner
    }

    /** Запрашивает схему у эндпоинта и обновляет кэш, сохраняя прошлый снимок. */
    public async introspect(
        workspaceId: string,
        endpoint: IEndpoint,
        options: { environmentId?: string; timeoutMs?: number } = {},
    ): Promise<ISchemaCache> {
        const response = await this._runner.runIntrospection({
            workspaceId,
            endpointId: endpoint.id,
            environmentId: options.environmentId,
            timeoutMs: options.timeoutMs,
        })

        if (response.status < 200 || response.status >= 300) {
            throw new ResolvrError(
                ErrorCodeEnum.SCHEMA_UNAVAILABLE,
                `Интроспекция вернула HTTP ${response.status}`,
                { endpointId: endpoint.id, status: response.status },
            )
        }

        if (response.invalidBody) {
            throw new ResolvrError(
                ErrorCodeEnum.SCHEMA_UNAVAILABLE,
                'Ответ интроспекции не удалось разобрать как объект JSON',
                { endpointId: endpoint.id },
            )
        }
        if (response.error !== undefined) {
            throw new ResolvrError(
                ErrorCodeEnum.SCHEMA_UNAVAILABLE,
                `Интроспекция отклонена сервером: ${response.error}`,
                { endpointId: endpoint.id },
            )
        }
        if (
            response.data === null ||
            typeof response.data !== 'object' ||
            !('__schema' in response.data)
        ) {
            throw new ResolvrError(
                ErrorCodeEnum.SCHEMA_UNAVAILABLE,
                'Ответ интроспекции не содержит __schema',
                { endpointId: endpoint.id },
            )
        }

        const schema = buildClientSchema(response.data as IntrospectionQuery)
        const sdl = printSchema(schema)

        const current = await this._readCache(workspaceId, endpoint.id)
        if (current && current.sdl !== sdl) {
            await writeJsonFile(
                this._fs,
                this._paths.schemaPreviousFile(workspaceId, endpoint.id),
                current,
            )
        }

        const cache: ISchemaCache = SchemaCacheSchema.parse({
            endpointId: endpoint.id,
            fetchedAt: new Date().toISOString(),
            hash: hashText(sdl),
            sdl,
        })

        await writeJsonFile(this._fs, this._paths.schemaCacheFile(workspaceId, endpoint.id), cache)
        this._memoryCache.set(cacheKey(workspaceId, endpoint.id), { hash: cache.hash, schema })

        return cache
    }

    /** SDL из кэша; `undefined`, если интроспекция ещё не выполнялась. */
    public async getSdl(workspaceId: string, endpointId: string): Promise<string | undefined> {
        return (await this._readCache(workspaceId, endpointId))?.sdl
    }

    /**
     * Собранная схема для автокомплита и валидации. Результат кэшируется в
     * памяти по хешу SDL: сборка схемы дорогая, а редактор просит её на каждое
     * изменение документа.
     */
    public async getSchema(
        workspaceId: string,
        endpointId: string,
    ): Promise<GraphQLSchema | undefined> {
        const cache = await this._readCache(workspaceId, endpointId)
        if (!cache) return undefined

        const key = cacheKey(workspaceId, endpointId)
        const cached = this._memoryCache.get(key)
        if (cached && cached.hash === cache.hash) return cached.schema

        const schema = buildSchema(cache.sdl, { assumeValidSDL: true })
        this._memoryCache.set(key, { hash: cache.hash, schema })

        return schema
    }

    public async getPreviousSdl(
        workspaceId: string,
        endpointId: string,
    ): Promise<string | undefined> {
        const cache = await readJsonFile(
            this._fs,
            this._paths.schemaPreviousFile(workspaceId, endpointId),
            SchemaCacheSchema,
        )

        return cache?.sdl
    }

    /** Загружает схему из SDL-файла на диске, минуя интроспекцию. */
    public async importSdl(
        workspaceId: string,
        endpointId: string,
        sdl: string,
    ): Promise<ISchemaCache> {
        buildSchema(sdl, { assumeValidSDL: false })

        const cache: ISchemaCache = SchemaCacheSchema.parse({
            endpointId,
            fetchedAt: new Date().toISOString(),
            hash: hashText(sdl),
            sdl,
        })

        await writeJsonFile(this._fs, this._paths.schemaCacheFile(workspaceId, endpointId), cache)
        this._memoryCache.delete(cacheKey(workspaceId, endpointId))

        return cache
    }

    private async _readCache(
        workspaceId: string,
        endpointId: string,
    ): Promise<ISchemaCache | undefined> {
        return readJsonFile(
            this._fs,
            this._paths.schemaCacheFile(workspaceId, endpointId),
            SchemaCacheSchema,
        )
    }
}

function cacheKey(workspaceId: string, endpointId: string): string {
    return `${workspaceId}:${endpointId}`
}

/**
 * Быстрый некриптографический хеш (FNV-1a) для ответа на вопрос «менялся ли
 * SDL». Криптостойкость здесь не требуется, а реализация одинаково работает
 * в Node и в webview без асинхронного `crypto.subtle`.
 */
export function hashText(text: string): string {
    let hash = 0x811c9dc5
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193) >>> 0
    }

    return hash.toString(16).padStart(8, '0')
}
