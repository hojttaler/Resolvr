import { buildSchema, introspectionFromSchema } from 'graphql'
import { describe, expect, it } from 'vitest'

import { EnvironmentSchema } from '../model/schemas.js'
import { RunEngine } from '../run/run-engine.js'
import { SecretResolver } from '../secrets/secret-resolver.js'
import { TokenInfoStore } from '../secrets/token-info-store.js'
import { HistoryStore } from '../storage/history-store.js'
import { LibraryPaths } from '../storage/paths.js'
import { WorkspaceStore } from '../storage/workspace-store.js'
import { FakeTransport, MemorySecretStore } from '../testing/fakes.js'
import { MemoryFileSystem } from '../testing/memory-file-system.js'
import { SchemaService } from './schema-service.js'

describe('интроспекция с авторизацией', () => {
    it('использует выбранное окружение и секрет, сохраняя поля с совпадающими именами', async () => {
        const fs = new MemoryFileSystem()
        const paths = new LibraryPaths('/library')
        const workspaces = new WorkspaceStore(fs, paths)
        const secrets = new MemorySecretStore()
        const resolver = new SecretResolver(secrets)
        const history = new HistoryStore(fs, paths)
        const remote = buildSchema('type Query { token: String, product: ID }')
        const transport = new FakeTransport((request) =>
            request.headers.authorization === 'Bearer token' &&
            request.headers['x-tenant'] === 'staging'
                ? JSON.stringify({ data: introspectionFromSchema(remote) })
                : { status: 401, body: '{"errors":[{"message":"Unauthorized"}]}' },
        )
        const runner = new RunEngine({
            workspaces,
            history,
            resolver,
            tokens: new TokenInfoStore(fs, paths),
            transport,
            secrets,
        })
        const service = new SchemaService(fs, paths, runner)

        await workspaces.init()
        const workspace = await workspaces.createWorkspace({
            name: 'Private',
            endpointUrl: 'https://private.invalid/graphql',
        })
        const endpoint = workspace.endpoints[0]
        if (!endpoint) throw new Error('Missing endpoint fixture')
        workspace.environments.push(
            EnvironmentSchema.parse({
                id: 'staging',
                name: 'Staging',
                headers: { 'x-tenant': 'staging' },
                auth: { type: 'bearer', tokenVariable: 'accessToken' },
            }),
        )
        await workspaces.saveWorkspace(workspace)

        await expect(service.introspect(workspace.id, endpoint)).rejects.toThrow('HTTP 401')
        expect(await service.getSdl(workspace.id, endpoint.id)).toBeUndefined()

        const staging = workspace.environments.find((entry) => entry.id === 'staging')
        if (!staging) throw new Error('Missing environment fixture')
        staging.variables.accessToken = await resolver.storeSecret(
            workspace.id,
            staging.id,
            'accessToken',
            'token',
        )
        await workspaces.saveWorkspace(workspace)

        const cache = await service.introspect(workspace.id, endpoint, {
            environmentId: staging.id,
            timeoutMs: 2500,
        })
        expect(cache.sdl).toContain('token: String')
        expect(transport.exchanges.at(-1)?.request.timeoutMs).toBe(2500)
        expect(await service.getSchema(workspace.id, endpoint.id)).toBeDefined()
        expect(await history.list(workspace.id)).toEqual([])
    })
})
