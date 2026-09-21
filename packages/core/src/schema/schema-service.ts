import {
    buildClientSchema,
    buildSchema,
    getIntrospectionQuery,
    printSchema,
    type GraphQLSchema,
    type IntrospectionQuery,
} from 'graphql'

import { ErrorCodeEnum, ResolvrError } from '../model/errors.js'
import { SchemaCacheSchema, type IEndpoint, type ISchemaCache } from '../model/schemas.js'
import type { IFileSystem } from '../ports/file-system.js'
import type { ITransport } from '../ports/transport.js'
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
    private readonly _transport: ITransport
    private readonly _memoryCache = new Map<string, { hash: string; schema: GraphQLSchema }>()

    constructor(fs: IFileSystem, paths: LibraryPaths, transport: ITransport) {
        this._fs = fs
        this._paths = paths
        this._transport = transport
    }

    /** Запрашивает схему у эндпоинта и обновляет кэш, сохраняя прошлый снимок. */
    public async introspect(workspaceId: string, endpoint: IEndpoint): Promise<ISchemaCache> {
        const response = await this._transport.request({
            url: endpoint.url,
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                accept: 'application/json',
                ...endpoint.headers,
            },
            body: JSON.stringify({ query: getIntrospectionQuery({ descriptions: true }) }),
            acceptInvalidCerts: endpoint.acceptInvalidCerts,
        })

        if (response.status < 200 || response.status >= 300) {
            throw new ResolvrError(
                ErrorCodeEnum.SCHEMA_UNAVAILABLE,
                `Интроспекция вернула HTTP ${response.status} (${endpoint.url})`,
                { endpointId: endpoint.id, status: response.status },
            )
        }

        const payload = this._parseIntrospection(response.body, endpoint)
        const sdl = printSchema(buildClientSchema(payload))

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

        await writeJsonFile(
            this._fs,
            this._paths.schemaCacheFile(workspaceId, endpoint.id),
            cache,
        )
        this._memoryCache.delete(cacheKey(workspaceId, endpoint.id))

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

    private _parseIntrospection(body: string, endpoint: IEndpoint): IntrospectionQuery {
        let parsed: { data?: IntrospectionQuery; errors?: { message?: string }[] }
        try {
            parsed = JSON.parse(body) as typeof parsed
        } catch {
            throw new ResolvrError(
                ErrorCodeEnum.SCHEMA_UNAVAILABLE,
                `Эндпоинт ${endpoint.url} вернул не-JSON ответ на интроспекцию`,
                { endpointId: endpoint.id },
            )
        }

        if (parsed.errors?.length) {
            throw new ResolvrError(
                ErrorCodeEnum.SCHEMA_UNAVAILABLE,
                `Интроспекция отклонена сервером: ${parsed.errors[0]?.message ?? 'без сообщения'}`,
                { endpointId: endpoint.id, errorCount: parsed.errors.length },
            )
        }

        if (!parsed.data?.__schema) {
            throw new ResolvrError(
                ErrorCodeEnum.SCHEMA_UNAVAILABLE,
                `Ответ интроспекции не содержит __schema (${endpoint.url})`,
                { endpointId: endpoint.id },
            )
        }

        return parsed.data
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
