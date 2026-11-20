import { createHmac } from 'node:crypto'
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

    it('применяет скрипты окружения и сохранённого запроса к одному вызову', async () => {
        const workspace = await harness.workspaces.getWorkspace('api')
        workspace.environments[0]!.scripts = {
            preRequest: 'request.variables.count = 2',
            postRequest: 'assert(response.data.ok, "Environment check failed")',
        }
        await harness.workspaces.saveWorkspace(workspace)
        await harness.workspaces.createCollection('api', 'Test')
        await harness.workspaces.saveOperation('api', {
            collectionId: 'test',
            name: 'Ping',
            query: 'query Ping { ok }',
            scripts: {
                preRequest: 'request.variables.count *= 3\nrequest.headers["x-script"] = "set"',
                postRequest: 'assert(response.status === 200, "Missing HTTP 200")',
            },
        })

        const result = await harness.engine.run({ workspaceId: 'api', operationRef: 'test/Ping' })

        expect(result.ok).toBe(true)
        const request = harness.transport.exchanges[0]?.request
        expect(request?.body).toContain('"count":6')
        expect(request?.headers['x-script']).toBe('set')
    })

    it('импортирует HMAC и отправляет подпись с ключом только из выбранного окружения', async () => {
        const workspace = await harness.workspaces.getWorkspace('api')
        const key = 'temporary-test-key'
        await harness.secrets.set({ workspace: 'api', environment: 'default', key: 'hmac' }, key)
        workspace.environments[0]!.variables = { signer: 'keychain://api/default/hmac' }
        workspace.environments[0]!.scripts = { preRequest: 'request.variables.payload = "Привет, Resolvr"' }
        await harness.workspaces.saveWorkspace(workspace)
        const digest = createHmac('sha256', key).update('Привет, Resolvr').digest()

        const result = await harness.engine.run({
            workspaceId: 'api',
            query: 'query Ping { ok }',
            scripts: {
                preRequest: `
                    // import { irrelevant } from "example"
                    import {
                        hmacSha256 as sign,
                    } from '@resolvr/crypto'
                    const payload = request.variables.payload
                    request.headers["x-signature"] = sign("signer", payload)
                    request.headers["x-signature-base64"] = sign("signer", payload, "base64")
                    return
                    assert(false)
                `,
            },
        })

        expect(result.ok).toBe(true)
        const request = harness.transport.exchanges[0]?.request
        expect(request?.headers).toMatchObject({
            'x-signature': digest.toString('hex'),
            'x-signature-base64': digest.toString('base64'),
        })
        expect(JSON.stringify(request)).not.toContain(key)
    })

    it('отклоняет другие импорты и ключи вне выбранного окружения до отправки', async () => {
        const workspace = await harness.workspaces.getWorkspace('api')
        workspace.environments[0]!.variables = {
            plain: 'not-a-secret',
            elsewhere: 'keychain://another/default/hmac',
        }
        await harness.secrets.set({ workspace: 'another', environment: 'default', key: 'hmac' }, 'another-key')
        await harness.workspaces.saveWorkspace(workspace)

        const input = { workspaceId: 'api', query: '{ ok }' }
        await expect(harness.engine.run({
            ...input, scripts: { preRequest: 'import "node:crypto"' },
        })).rejects.toThrow('доступны только встроенные модули Resolvr')
        for (const name of ['plain', 'elsewhere']) {
            await expect(harness.engine.run({
                ...input, scripts: {
                    preRequest: `import { hmacSha256 } from "@resolvr/crypto"; hmacSha256("${name}", "test");`,
                },
            })).rejects.toThrow('Ключ подписи не найден среди секретов выбранного окружения')
        }
        expect(harness.transport.exchanges).toHaveLength(0)
    })

    it('останавливает зависший pre-request и сохраняет ответ при провале post-request', async () => {
        const input = { workspaceId: 'api', query: '{ ok }' }

        await expect(harness.engine.run({
            ...input, scripts: { preRequest: 'while (true) {}' },
        })).rejects.toMatchObject({ code: 'REQUEST_SCRIPT_FAILED' })
        expect(harness.transport.exchanges).toHaveLength(0)

        const result = await harness.engine.run({
            ...input,
            scripts: {
                postRequest: 'assert(typeof fetch === "undefined"); assert(false, "Expected failure")',
            },
        })

        expect(result).toMatchObject({
            ok: false, status: 200, data: { ok: true },
            scriptError: 'Post-request: Expected failure',
        })
    })

    it('запрашивает только отсутствующие значения переменных перед отправкой', async () => {
        const workspace = await harness.workspaces.getWorkspace('api')
        workspace.environments[0]!.variables = { existing: 'kept' }
        await harness.workspaces.saveWorkspace(workspace)
        const result = await harness.engine.run({
            workspaceId: 'api',
            query: '{ ok }',
            variables: { nested: ['{{missing}}', '{{ existing }}', '{{$uuid}}', '{{missing}}'] },
            resolveMissingVariables: async (names) => {
                expect(names).toEqual(['missing'])
                expect(harness.transport.exchanges).toHaveLength(0)
                return { missing: 'filled' }
            },
        })

        expect(result.ok).toBe(true)
        const body = harness.transport.exchanges[0]?.request.body
        expect(body).toContain('"nested":["filled","kept",')
        expect(body).not.toContain('{{')
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

describe('сохранение ответа в окружение', () => {
    it('записывает значения по правилам операции, секрет — ссылкой', async () => {
        const harness = await createHarness(
            () => '{"data":{"login":{"token":"t-1","user":{"id":7}}}}',
        )
        await harness.workspaces.createCollection('api', 'Auth')
        await harness.workspaces.saveOperation('api', {
            collectionId: 'auth',
            name: 'Login',
            query: 'mutation Login { login { token user { id } } }',
            saveToEnvironment: [
                { variable: 'token', path: 'data.login.token', secret: true },
                { variable: 'userId', path: 'data.login.user.id', secret: false },
                { variable: 'missing', path: 'data.nope', secret: false },
            ],
        })

        const result = await harness.engine.run({ workspaceId: 'api', operationRef: 'auth/Login' })

        expect(result.savedVariables).toEqual([
            { name: 'token', secret: true },
            { name: 'userId', secret: false },
        ])
        expect(result.captureWarnings).toHaveLength(1)

        const environment = (await harness.workspaces.getWorkspace('api')).environments[0]
        expect(environment?.variables.userId).toBe('7')
        expect(environment?.variables.token).toBe('keychain://api/default/token')
        expect(
            await harness.secrets.get({ workspace: 'api', environment: 'default', key: 'token' }),
        ).toBe('t-1')
    })

    it('не трогает окружение, если ответ с ошибкой', async () => {
        const harness = await createHarness(
            () => '{"data":{"login":null},"errors":[{"message":"bad password"}]}',
        )

        const result = await harness.engine.run({
            workspaceId: 'api',
            query: 'mutation Login { login { token } }',
            saveToEnvironment: [{ variable: 'token', path: 'data.login.token', secret: false }],
        })

        expect(result.savedVariables).toBeUndefined()
        const environment = (await harness.workspaces.getWorkspace('api')).environments[0]
        expect(environment?.variables.token).toBeUndefined()
    })
})

describe('защита workspace', () => {
    async function protectedHarness(protection: 'confirm' | 'readOnly'): Promise<IHarness> {
        const harness = await createHarness()
        const workspace = await harness.workspaces.getWorkspace('api')
        await harness.workspaces.saveWorkspace({ ...workspace, protection })

        return harness
    }

    it('в режиме confirm пропускает чтение и требует подтверждения на мутацию', async () => {
        const harness = await protectedHarness('confirm')

        await expect(
            harness.engine.run({ workspaceId: 'api', query: 'query Ping { ok }' }),
        ).resolves.toMatchObject({ ok: true })

        await expect(
            harness.engine.run({ workspaceId: 'api', query: 'mutation Pay { pay }' }),
        ).rejects.toThrow(/подтверждения/)
        expect(harness.transport.exchanges).toHaveLength(1)

        await expect(
            harness.engine.run({
                workspaceId: 'api',
                query: 'mutation Pay { pay }',
                confirmed: true,
            }),
        ).resolves.toMatchObject({ ok: true })
    })

    it('в режиме readOnly отвергает мутацию и с подтверждением', async () => {
        const harness = await protectedHarness('readOnly')

        await expect(
            harness.engine.run({
                workspaceId: 'api',
                query: 'mutation Pay { pay }',
                confirmed: true,
            }),
        ).rejects.toThrow(/защищён от записи/)
        expect(harness.transport.exchanges).toHaveLength(0)
    })
})
