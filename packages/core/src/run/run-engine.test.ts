import { beforeEach, describe, expect, it } from 'vitest'

import { HistoryStore } from '../storage/history-store.js'
import { LibraryPaths } from '../storage/paths.js'
import { WorkspaceStore } from '../storage/workspace-store.js'
import { SecretResolver } from '../secrets/secret-resolver.js'
import { TokenInfoStore } from '../secrets/token-info-store.js'
import { SECRET_MASK } from '../secrets/secret-resolver.js'
import { FakeTransport, MemorySecretStore } from '../testing/fakes.js'
import { MemoryFileSystem } from '../testing/memory-file-system.js'
import { readPath, RunEngine, toWebSocketUrl } from './run-engine.js'

interface IHarness {
    fs: MemoryFileSystem
    workspaces: WorkspaceStore
    history: HistoryStore
    secrets: MemorySecretStore
    transport: FakeTransport
    engine: RunEngine
}

async function createHarness(
    responder: (body: string) => string = () => '{"data":{"ok":true}}',
): Promise<IHarness> {
    const fs = new MemoryFileSystem()
    const paths = new LibraryPaths('/library')
    const workspaces = new WorkspaceStore(fs, paths)
    const history = new HistoryStore(fs, paths)
    const secrets = new MemorySecretStore()
    const transport = new FakeTransport((request) => responder(request.body ?? ''))

    const engine = new RunEngine({
        workspaces,
        history,
        resolver: new SecretResolver(secrets),
        tokens: new TokenInfoStore(fs, paths),
        transport,
        secrets,
    })

    await workspaces.init()
    await workspaces.createWorkspace({
        name: 'API',
        endpointUrl: 'https://api.example.com/graphql',
    })

    return { fs, workspaces, history, secrets, transport, engine }
}

describe('RunEngine', () => {
    let harness: IHarness

    beforeEach(async () => {
        harness = await createHarness()
    })

    it('выполняет ad-hoc запрос и записывает его в историю', async () => {
        const result = await harness.engine.run({
            workspaceId: 'api',
            query: 'query Ping { ok }',
            operationName: 'Ping',
        })

        expect(result.ok).toBe(true)
        expect(result.data).toEqual({ ok: true })

        const entries = await harness.history.list('api')
        expect(entries).toHaveLength(1)
        expect(entries[0]?.operationName).toBe('Ping')
        expect(entries[0]?.kind).toBe('query')
    })

    it('считает ответ с GraphQL-ошибками неуспешным при HTTP 200', async () => {
        const failing = await createHarness(() => '{"data":null,"errors":[{"message":"boom"}]}')

        const result = await failing.engine.run({
            workspaceId: 'api',
            query: 'query Ping { ok }',
        })

        expect(result.status).toBe(200)
        expect(result.ok).toBe(false)
        expect(result.errors).toHaveLength(1)
    })

    it('подставляет секрет в заголовок, но в историю пишет маску', async () => {
        const workspace = await harness.workspaces.getWorkspace('api')
        await harness.secrets.set(
            { workspace: 'api', environment: 'default', key: 'token' },
            'super-secret-token',
        )

        workspace.environments[0]!.variables = { token: 'keychain://api/default/token' }
        workspace.endpoints[0]!.headers = { authorization: 'Bearer {{token}}' }
        await harness.workspaces.saveWorkspace(workspace)

        const result = await harness.engine.run({
            workspaceId: 'api',
            query: 'query Ping { ok }',
            variables: { token: '{{token}}' },
        })

        // На сервер ушёл настоящий токен...
        const sentHeaders = harness.transport.exchanges[0]?.request.headers ?? {}
        expect(sentHeaders.authorization).toBe('Bearer super-secret-token')

        // ...а наружу отдаётся замаскированная версия.
        expect(result.requestHeaders.authorization).toBe(SECRET_MASK)

        const entries = await harness.history.list('api')
        expect(JSON.stringify(entries[0]?.variables)).not.toContain('super-secret-token')
        expect(entries[0]?.variables).toEqual({ token: SECRET_MASK })
    })

    it('логинится автоматически и переиспользует токен до истечения TTL', async () => {
        const transport = new FakeTransport((request) => {
            const payload = JSON.parse(request.body ?? '{}') as { query?: string }

            return payload.query?.includes('login')
                ? '{"data":{"login":{"accessToken":"fresh-token"}}}'
                : '{"data":{"me":{"id":"1"}}}'
        })

        const fs = new MemoryFileSystem()
        const paths = new LibraryPaths('/library')
        const workspaces = new WorkspaceStore(fs, paths)
        const secrets = new MemorySecretStore()
        const engine = new RunEngine({
            workspaces,
            history: new HistoryStore(fs, paths),
            resolver: new SecretResolver(secrets),
            tokens: new TokenInfoStore(fs, paths),
            transport,
            secrets,
        })

        await workspaces.init()
        const workspace = await workspaces.createWorkspace({
            name: 'API',
            endpointUrl: 'https://api.example.com/graphql',
        })
        await workspaces.createCollection('api', 'Auth')
        await workspaces.saveOperation('api', {
            collectionId: 'auth',
            name: 'login',
            query: 'mutation Login { login { accessToken } }',
        })

        workspace.environments[0]!.auth = {
            type: 'login',
            operationRef: 'auth/login',
            tokenPath: 'data.login.accessToken',
            storeAs: 'accessToken',
            headerName: 'Authorization',
            prefix: 'Bearer ',
            ttlSeconds: 3300,
            variables: {},
        }
        await workspaces.saveWorkspace(workspace)

        await engine.run({ workspaceId: 'api', query: 'query Me { me { id } }' })
        await engine.run({ workspaceId: 'api', query: 'query Me { me { id } }' })

        const loginCalls = transport.exchanges.filter((exchange) =>
            exchange.request.body?.includes('login'),
        )
        expect(loginCalls).toHaveLength(1)

        const lastHeaders = transport.exchanges.at(-1)?.request.headers ?? {}
        expect(lastHeaders.authorization).toBe('Bearer fresh-token')
    })

    it('сообщает, какого эндпоинта не хватает', async () => {
        await expect(
            harness.engine.run({
                workspaceId: 'api',
                query: 'query Ping { ok }',
                endpointId: 'missing',
            }),
        ).rejects.toThrow(/Эндпоинт "missing" не найден/)
    })
})

describe('readPath', () => {
    it('идёт по объектам и индексам массива', () => {
        const source = { data: { users: [{ id: 'u1' }, { id: 'u2' }] } }

        expect(readPath(source, 'data.users.1.id')).toBe('u2')
    })

    it('возвращает undefined на несуществующем пути', () => {
        expect(readPath({ a: 1 }, 'a.b.c')).toBeUndefined()
    })
})

describe('toWebSocketUrl', () => {
    it('переводит http и https в ws и wss', () => {
        expect(toWebSocketUrl('http://localhost:4000/graphql')).toBe('ws://localhost:4000/graphql')
        expect(toWebSocketUrl('https://api.example.com/graphql')).toBe(
            'wss://api.example.com/graphql',
        )
    })
})
