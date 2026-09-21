import { describe, expect, it } from 'vitest'

import { FlowRunner } from '../flow/flow-runner.js'
import { FlowSchema } from '../model/schemas.js'
import { SecretResolver } from '../secrets/secret-resolver.js'
import { TokenInfoStore } from '../secrets/token-info-store.js'
import { HistoryStore } from '../storage/history-store.js'
import { LibraryPaths } from '../storage/paths.js'
import { WorkspaceStore } from '../storage/workspace-store.js'
import { FakeTransport, MemorySecretStore } from '../testing/fakes.js'
import { MemoryFileSystem } from '../testing/memory-file-system.js'
import { matchesRecovery, RunEngine } from './run-engine.js'

/**
 * Стенд с цепочкой авторизации.
 *
 * Сервер отвечает 401, пока в заголовке нет токена, выданного логином, — так же
 * ведёт себя настоящий бэкенд с протухшей сессией.
 */
async function createHarness() {
    const fs = new MemoryFileSystem()
    const paths = new LibraryPaths('/library')
    const workspaces = new WorkspaceStore(fs, paths)
    const secrets = new MemorySecretStore()

    const transport = new FakeTransport((request) => {
        const payload = JSON.parse(request.body ?? '{}') as { query?: string }

        if (payload.query?.includes('login')) {
            return '{"data":{"login":{"accessToken":"fresh-token"}}}'
        }

        return request.headers.authorization === 'Bearer fresh-token'
            ? '{"data":{"me":{"id":"u1"}}}'
            : { status: 401, body: '{"errors":[{"message":"Unauthorized"}],"data":null}' }
    })

    const engine = new RunEngine({
        workspaces,
        history: new HistoryStore(fs, paths),
        resolver: new SecretResolver(secrets),
        tokens: new TokenInfoStore(fs, paths),
        transport,
        secrets,
    })
    engine.setFlowExecutor(new FlowRunner(workspaces, engine))

    await workspaces.init()
    const workspace = await workspaces.createWorkspace({
        name: 'API',
        endpointUrl: 'https://api.example.com/graphql',
    })
    await workspaces.createCollection('api', 'Users')
    await workspaces.saveOperation('api', {
        collectionId: 'users',
        name: 'me',
        query: 'query Me { me { id } }',
    })
    await workspaces.saveFlow(
        'api',
        FlowSchema.parse({
            id: 'auth',
            name: 'Авторизация',
            steps: [
                {
                    id: 'login',
                    name: 'Логин',
                    query: 'mutation Login { login { accessToken } }',
                    extract: { token: 'data.login.accessToken' },
                },
            ],
        }),
    )

    // Заголовок окружения подставляет токен, добытый цепочкой.
    workspace.environments[0]!.headers = { authorization: 'Bearer {{token}}' }
    await workspaces.saveWorkspace(workspace)

    return { workspaces, workspace, engine, transport }
}

describe('цепочка подготовки', () => {
    it('выполняется перед операцией и отдаёт значения в заголовки', async () => {
        const harness = await createHarness()
        const operation = await harness.workspaces.getOperation('api', {
            collectionId: 'users',
            name: 'me',
        })

        await harness.workspaces.saveOperation('api', {
            collectionId: 'users',
            name: 'me',
            query: operation.query,
            prerequisiteFlow: 'auth',
        })

        const result = await harness.engine.run({ workspaceId: 'api', operationRef: 'users/me' })

        expect(result.ok).toBe(true)
        expect(result.data).toEqual({ me: { id: 'u1' } })
        expect(result.flowRuns?.[0]).toMatchObject({
            kind: 'prerequisite',
            flowId: 'auth',
            ok: true,
        })
    })

    it('без привязки цепочки запрос уходит как есть', async () => {
        const harness = await createHarness()

        const result = await harness.engine.run({ workspaceId: 'api', operationRef: 'users/me' })

        expect(result.status).toBe(401)
        expect(result.flowRuns).toBeUndefined()
    })
})

describe('цепочка восстановления', () => {
    it('срабатывает на 401 и повторяет запрос с новым токеном', async () => {
        const harness = await createHarness()

        harness.workspace.environments[0]!.recovery = {
            flowId: 'auth',
            statuses: [401],
            messagePatterns: [],
            maxAttempts: 1,
            enabled: true,
            onExpiry: true,
            onError: true,
            refreshMarginSec: 60,
        }
        await harness.workspaces.saveWorkspace(harness.workspace)

        const result = await harness.engine.run({ workspaceId: 'api', operationRef: 'users/me' })

        expect(result.ok).toBe(true)
        expect(result.status).toBe(200)
        expect(result.flowRuns?.map((item) => item.kind)).toEqual(['recovery'])
    })

    it('не зацикливается, когда восстановление не помогает', async () => {
        const fs = new MemoryFileSystem()
        const paths = new LibraryPaths('/library')
        const workspaces = new WorkspaceStore(fs, paths)
        const secrets = new MemorySecretStore()
        const transport = new FakeTransport(() => ({
            status: 401,
            body: '{"errors":[{"message":"Unauthorized"}]}',
        }))

        const tokens = new TokenInfoStore(fs, paths)
        const engine = new RunEngine({
            workspaces,
            history: new HistoryStore(fs, paths),
            resolver: new SecretResolver(secrets),
            tokens,
            transport,
            secrets,
        })
        engine.setFlowExecutor(new FlowRunner(workspaces, engine))

        await workspaces.init()
        const workspace = await workspaces.createWorkspace({
            name: 'API',
            endpointUrl: 'https://api.example.com/graphql',
        })
        await workspaces.saveFlow(
            'api',
            FlowSchema.parse({
                id: 'auth',
                name: 'Авторизация',
                steps: [{ id: 'login', name: 'Логин', query: 'mutation Login { login { t } }' }],
            }),
        )
        workspace.environments[0]!.recovery = {
            flowId: 'auth',
            statuses: [401],
            messagePatterns: [],
            maxAttempts: 2,
            enabled: true,
            onExpiry: true,
            onError: true,
            refreshMarginSec: 60,
        }
        await workspaces.saveWorkspace(workspace)

        const result = await engine.run({ workspaceId: 'api', query: 'query Me { me { id } }' })

        expect(result.ok).toBe(false)
        // Цепочка сама падает на 401, поэтому повтор прекращается сразу.
        expect(result.flowRuns).toHaveLength(1)
        expect(result.flowRuns?.[0]?.ok).toBe(false)
    })
})

describe('заголовки окружения', () => {
    it('применяются ко всем запросам окружения', async () => {
        const harness = await createHarness()

        harness.workspace.environments[0]!.headers = { 'x-tenant': 'acme' }
        await harness.workspaces.saveWorkspace(harness.workspace)

        await harness.engine.run({ workspaceId: 'api', query: 'query Me { me { id } }' })

        expect(harness.transport.exchanges[0]?.request.headers['x-tenant']).toBe('acme')
    })
})

describe('matchesRecovery', () => {
    const rule = { statuses: [401, 403], messagePatterns: ['unauthorized'] }

    it('срабатывает по статусу', () => {
        expect(matchesRecovery(rule, { status: 401, body: '', errors: undefined })).toBe(true)
    })

    it('срабатывает по тексту ошибки при HTTP 200', () => {
        expect(
            matchesRecovery(rule, {
                status: 200,
                body: '',
                errors: [{ message: 'UNAUTHORIZED: token expired' }],
            }),
        ).toBe(true)
    })

    it('не срабатывает на посторонней ошибке', () => {
        expect(
            matchesRecovery(rule, { status: 200, body: '', errors: [{ message: 'not found' }] }),
        ).toBe(false)
    })
})

describe('нераскрытые переменные в заголовках', () => {
    it('не отправляет заголовок с плейсхолдером и сообщает об этом', async () => {
        // Ровно ситуация первого запуска: заголовок окружения ссылается на
        // токен, которого ещё нет. Буквальный `Bearer {{accessToken}}` сервер
        // принял бы за неверный токен и отверг даже запрос логина.
        const harness = await createHarness()

        const result = await harness.engine.run({
            workspaceId: 'api',
            query: 'mutation Login { login { accessToken } }',
        })

        expect(harness.transport.exchanges[0]?.request.headers.authorization).toBeUndefined()
        expect(result.unresolvedHeaders).toEqual(['authorization'])
    })

    it('отправляет заголовок, когда переменная раскрыта цепочкой', async () => {
        const harness = await createHarness()

        harness.workspace.environments[0]!.recovery = {
            flowId: 'auth',
            statuses: [401],
            messagePatterns: [],
            maxAttempts: 1,
            enabled: true,
            onExpiry: true,
            onError: true,
            refreshMarginSec: 60,
        }
        await harness.workspaces.saveWorkspace(harness.workspace)

        const result = await harness.engine.run({ workspaceId: 'api', operationRef: 'users/me' })

        expect(result.ok).toBe(true)
        expect(result.unresolvedHeaders).toBeUndefined()
        expect(harness.transport.exchanges.at(-1)?.request.headers.authorization).toBe(
            'Bearer fresh-token',
        )
    })
})

describe('проактивное обновление токена', () => {
    /** Токен с заданным сроком жизни — как его отдаёт настоящий логин. */
    function makeJwt(secondsFromNow: number): string {
        const encode = (value: object): string => {
            const bytes = new TextEncoder().encode(JSON.stringify(value))

            return btoa(String.fromCharCode(...bytes))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '')
        }

        return `${encode({ alg: 'RS256' })}.${encode({
            exp: Math.floor(Date.now() / 1000) + secondsFromNow,
            sub: 'demo@example.com',
        })}.signature`
    }

    async function createTokenHarness(token: string) {
        const fs = new MemoryFileSystem()
        const paths = new LibraryPaths('/library')
        const workspaces = new WorkspaceStore(fs, paths)
        const secrets = new MemorySecretStore()
        const transport = new FakeTransport((request) => {
            const payload = JSON.parse(request.body ?? '{}') as { query?: string }

            return payload.query?.includes('login')
                ? `{"data":{"login":{"accessToken":"${token}"}}}`
                : '{"data":{"me":{"id":"u1"}}}'
        })

        const tokens = new TokenInfoStore(fs, paths)
        const engine = new RunEngine({
            workspaces,
            history: new HistoryStore(fs, paths),
            resolver: new SecretResolver(secrets),
            tokens,
            transport,
            secrets,
        })
        engine.setFlowExecutor(new FlowRunner(workspaces, engine))

        await workspaces.init()
        const workspace = await workspaces.createWorkspace({
            name: 'API',
            endpointUrl: 'https://api.example.com/graphql',
        })
        await workspaces.saveFlow(
            'api',
            FlowSchema.parse({
                id: 'auth',
                name: 'Авторизация',
                steps: [
                    {
                        id: 'login',
                        name: 'Логин',
                        query: 'mutation Login { login { accessToken } }',
                        extract: { token: 'data.login.accessToken' },
                    },
                ],
            }),
        )
        workspace.environments[0]!.recovery = {
            flowId: 'auth',
            statuses: [401],
            messagePatterns: [],
            maxAttempts: 1,
            enabled: true,
            onExpiry: true,
            onError: true,
            refreshMarginSec: 60,
        }
        await workspaces.saveWorkspace(workspace)

        return { workspaces, workspace, engine, transport, tokens }
    }

    it('обновляет токен заранее, не дожидаясь отказа сервера', async () => {
        const harness = await createTokenHarness(makeJwt(3600))

        // Срок истекает через полминуты — сервер ещё принял бы токен, но
        // обновление до запроса дешевле круга «ошибка → логин → повтор».
        await harness.tokens.set('api', 'default', {
            expiresAt: new Date(Date.now() + 30_000).toISOString(),
        })

        const result = await harness.engine.run({
            workspaceId: 'api',
            query: 'query Me { me { id } }',
        })

        expect(result.flowRuns?.map((item) => item.kind)).toEqual(['refresh'])
        expect(result.ok).toBe(true)
    })

    it('не трогает токен, которому ещё далеко до истечения', async () => {
        const harness = await createTokenHarness(makeJwt(3600))

        await harness.tokens.set('api', 'default', {
            expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
        })

        const result = await harness.engine.run({
            workspaceId: 'api',
            query: 'query Me { me { id } }',
        })

        expect(result.flowRuns).toBeUndefined()
        expect(harness.transport.exchanges).toHaveLength(1)
    })

    it('запоминает срок жизни выданного токена', async () => {
        const harness = await createTokenHarness(makeJwt(1800))

        await harness.tokens.set('api', 'default', {
            expiresAt: new Date(Date.now() - 1000).toISOString(),
        })

        await harness.engine.run({ workspaceId: 'api', query: 'query Me { me { id } }' })

        const info = await harness.tokens.get('api', 'default')
        const expiresAt = new Date(info?.expiresAt ?? 0).getTime()

        expect(expiresAt - Date.now()).toBeGreaterThan(1700_000)
        expect(info?.subject).toBe('demo@example.com')

        // В общий файл workspace личные сведения о токене не попадают.
        const saved = await harness.workspaces.getWorkspace('api')
        expect(saved.environments[0]?.tokenExpiresAt).toBeUndefined()
    })
})
