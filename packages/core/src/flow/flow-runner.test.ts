import { describe, expect, it } from 'vitest'

import { FlowSchema } from '../model/schemas.js'
import { RunEngine } from '../run/run-engine.js'
import { SecretResolver } from '../secrets/secret-resolver.js'
import { TokenInfoStore } from '../secrets/token-info-store.js'
import { HistoryStore } from '../storage/history-store.js'
import { LibraryPaths } from '../storage/paths.js'
import { WorkspaceStore } from '../storage/workspace-store.js'
import { FakeTransport, MemorySecretStore } from '../testing/fakes.js'
import { MemoryFileSystem } from '../testing/memory-file-system.js'
import { evaluateAssert, FlowRunner, judgeStep } from './flow-runner.js'
import { FlowStateStore } from './flow-state.js'

async function createHarness(
    responder: (body: string) => string | { status: number; body: string },
) {
    const fs = new MemoryFileSystem()
    const paths = new LibraryPaths('/library')
    const workspaces = new WorkspaceStore(fs, paths)
    const secrets = new MemorySecretStore()
    const transport = new FakeTransport((request) => responder(request.body ?? ''))

    const engine = new RunEngine({
        workspaces,
        history: new HistoryStore(fs, paths),
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

    const state = new FlowStateStore(fs, paths)

    return { workspaces, transport, state, flows: new FlowRunner(workspaces, engine, state) }
}

const loginFlow = FlowSchema.parse({
    id: 'smoke',
    name: 'Smoke',
    steps: [
        {
            id: 'login',
            name: 'Логин',
            query: 'mutation Login { login { accessToken } }',
            extract: { token: 'data.login.accessToken' },
            assert: [{ path: 'data.login.accessToken', op: 'exists' }],
        },
        {
            id: 'me',
            name: 'Профиль',
            query: 'query Me { me { id } }',
            variables: { token: '{{token}}' },
            assert: [{ path: 'data.me.id', op: 'eq', value: 'u1' }],
        },
    ],
})

describe('FlowRunner', () => {
    it('пробрасывает извлечённое значение в следующий шаг', async () => {
        const harness = await createHarness((body) =>
            body.includes('login')
                ? '{"data":{"login":{"accessToken":"tok-123"}}}'
                : '{"data":{"me":{"id":"u1"}}}',
        )

        const result = await harness.flows.runFlow('api', loginFlow)

        expect(result.ok).toBe(true)
        expect(result.context.token).toBe('tok-123')

        const secondCall = JSON.parse(harness.transport.exchanges[1]?.request.body ?? '{}') as {
            variables: Record<string, unknown>
        }
        expect(secondCall.variables.token).toBe('tok-123')
    })

    it('падает на нужном шаге и пропускает остальные', async () => {
        const harness = await createHarness((body) =>
            body.includes('login')
                ? '{"data":{"login":{"accessToken":"tok-123"}}}'
                : '{"data":{"me":{"id":"WRONG"}}}',
        )

        const result = await harness.flows.runFlow('api', loginFlow)

        expect(result.ok).toBe(false)
        expect(result.steps[0]?.ok).toBe(true)
        expect(result.steps[1]?.ok).toBe(false)
        expect(result.steps[1]?.asserts[0]?.message).toContain('ожидалось eq "u1"')
    })

    it('останавливает флоу после падения и помечает хвост как пропущенный', async () => {
        const harness = await createHarness(() => '{"data":{"login":null}}')

        const result = await harness.flows.runFlow('api', loginFlow)

        expect(result.steps[0]?.ok).toBe(false)
        expect(result.steps[1]?.skipped).toBe(true)
        expect(harness.transport.exchanges).toHaveLength(1)
    })
})

describe('evaluateAssert', () => {
    const payload = { status: 200, ok: true, data: { user: { id: 'u1', tags: ['a', 'b'] } } }

    it('проверяет равенство и существование', () => {
        expect(evaluateAssert({ path: 'status', op: 'eq', value: 200 }, payload).passed).toBe(true)
        expect(evaluateAssert({ path: 'data.user.id', op: 'exists' }, payload).passed).toBe(true)
        expect(evaluateAssert({ path: 'data.user.name', op: 'notExists' }, payload).passed).toBe(
            true,
        )
    })

    it('проверяет вхождение в массив и число', () => {
        expect(evaluateAssert({ path: 'data.user.tags', op: 'contains', value: 'b' }, payload).passed).toBe(
            true,
        )
        expect(evaluateAssert({ path: 'status', op: 'lt', value: 300 }, payload).passed).toBe(true)
        expect(evaluateAssert({ path: 'status', op: 'gt', value: 300 }, payload).passed).toBe(false)
    })

    it('объясняет расхождение в сообщении', () => {
        const result = evaluateAssert({ path: 'status', op: 'eq', value: 404 }, payload)

        expect(result.passed).toBe(false)
        expect(result.message).toBe('status: ожидалось eq 404, получено 200')
    })
})

describe('цепочка авторизации', () => {
    /**
     * Готовит workspace, где заголовок окружения подставляет токен, а цепочка
     * `auth` назначена источником этого токена.
     */
    async function createAuthHarness() {
        const harness = await createHarness(() =>
            JSON.stringify({ data: { login: { accessToken: 'fresh' } } }),
        )

        const [workspace] = await harness.workspaces.listWorkspaces()
        if (!workspace) throw new Error('Workspace не создан')

        const full = await harness.workspaces.getWorkspace(workspace.id)

        await harness.workspaces.saveWorkspace({
            ...full,
            environments: full.environments.map((environment) => ({
                ...environment,
                headers: { authorization: 'Bearer {{accessToken}}', 'x-tenant': 'acme' },
                variables: { accessToken: 'expired-token' },
                recovery: {
                    flowId: 'auth',
                    onExpiry: true,
                    onError: true,
                    refreshMarginSec: 60,
                    statuses: [401],
                    messagePatterns: ['token is not valid'],
                    maxAttempts: 1,
                    enabled: true,
                },
            })),
        })

        return { ...harness, workspaceId: workspace.id }
    }

    const authFlow = FlowSchema.parse({
        id: 'auth',
        name: 'Авторизация',
        steps: [
            {
                id: 'login',
                name: 'Логин',
                query: 'mutation Login { login { accessToken } }',
                extract: { accessToken: 'data.login.accessToken' },
            },
        ],
    })

    it('не подставляет истёкший токен в собственный запрос логина', async () => {
        const harness = await createAuthHarness()

        await harness.flows.runFlow(harness.workspaceId, authFlow)

        const sent = harness.transport.exchanges.at(-1)?.request.headers ?? {}
        expect(sent.authorization).toBeUndefined()
        // Остальные заголовки окружения нужны и логину — они остаются.
        expect(sent['x-tenant']).toBe('acme')
    })

    it('обычная цепочка токен подставляет', async () => {
        const harness = await createAuthHarness()

        await harness.flows.runFlow(harness.workspaceId, {
            ...authFlow,
            id: 'smoke',
        })

        const sent = harness.transport.exchanges.at(-1)?.request.headers ?? {}
        expect(sent.authorization).toBe('Bearer expired-token')
    })
})

describe('имя переменной токена', () => {
    /** Цепочка извлекает значение под другим именем, чем стоит в заголовке. */
    const renamingFlow = FlowSchema.parse({
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
    })

    it('выводится из секретов окружения, если extract называет значение иначе', async () => {
        const harness = await createHarness(() =>
            JSON.stringify({ data: { login: { accessToken: 'fresh' } } }),
        )

        const [item] = await harness.workspaces.listWorkspaces()
        if (!item) throw new Error('Workspace не создан')

        const workspace = await harness.workspaces.getWorkspace(item.id)

        await harness.workspaces.saveWorkspace({
            ...workspace,
            environments: workspace.environments.map((environment) => ({
                ...environment,
                headers: { authorization: 'Bearer {{accessToken}}' },
                variables: {
                    accessToken: `keychain://${workspace.id}/${environment.id}/accessToken`,
                },
                recovery: {
                    flowId: 'auth',
                    onExpiry: true,
                    onError: true,
                    refreshMarginSec: 60,
                    statuses: [401],
                    messagePatterns: [],
                    maxAttempts: 1,
                    enabled: true,
                },
            })),
        })

        const run = await harness.flows.runFlow(item.id, renamingFlow)

        // Секрета в хранилище ещё нет — до первого логина так и должно быть.
        // Цепочка обязана дойти до сервера, а не упасть на раскрытии переменной.
        expect(run.ok).toBe(true)
        expect(harness.transport.exchanges).toHaveLength(1)
        expect(harness.transport.exchanges[0]?.request.headers.authorization).toBeUndefined()
    })
})

describe('ожидаемый результат шага', () => {
    /** Негативный тест: без токена сервер отказывает, после отказа цепочка идёт дальше. */
    const negativeFlow = FlowSchema.parse({
        id: 'negative',
        name: 'Negative',
        steps: [
            {
                id: 'anonymous',
                name: 'Без токена',
                query: 'query Me { me { id } }',
                expect: 'error',
                assert: [{ path: 'errors.0.message', op: 'contains', value: 'Unauthorized' }],
            },
            {
                id: 'ping',
                name: 'Дальше',
                query: 'query Ping { ping }',
            },
        ],
    })

    it('засчитывает ожидаемую ошибку и продолжает цепочку', async () => {
        const harness = await createHarness((body) =>
            body.includes('Me')
                ? { status: 401, body: '{"errors":[{"message":"Unauthorized"}],"data":null}' }
                : '{"data":{"ping":true}}',
        )

        const result = await harness.flows.runFlow('api', negativeFlow)

        expect(result.ok).toBe(true)
        expect(result.steps.map((step) => [step.ok, step.skipped])).toEqual([
            [true, false],
            [true, false],
        ])
    })

    it('проваливает негативный шаг, если запрос неожиданно прошёл', async () => {
        const harness = await createHarness(() => '{"data":{"me":{"id":"u1"},"ping":true}}')

        const result = await harness.flows.runFlow('api', negativeFlow)

        expect(result.ok).toBe(false)
        expect(result.steps[0]?.error).toMatch(/Ожидалась ошибка/)
        expect(result.steps[1]?.skipped).toBe(true)
    })

    it('проваливает негативный шаг с ошибкой не той природы', async () => {
        const harness = await createHarness(
            () => '{"errors":[{"message":"Internal server error"}],"data":null}',
        )

        const result = await harness.flows.runFlow('api', negativeFlow)

        expect(result.steps[0]?.ok).toBe(false)
        expect(result.steps[0]?.error).toBe('Проверки шага не прошли')
    })

    it('в режиме any решают только проверки', () => {
        const failed = { ok: false, status: 400, errors: [{}] }

        expect(judgeStep('any', failed, true)).toEqual({ ok: true })
        expect(judgeStep('any', { ok: true, status: 200 }, false).ok).toBe(false)
        expect(judgeStep('success', failed, true).ok).toBe(false)
    })
})

describe('числовые проверки и длина', () => {
    it('eqNum сравнивает числа независимо от записи', () => {
        const check = (actual: unknown, value: unknown) =>
            evaluateAssert({ path: 'v', op: 'eqNum', value }, { v: actual }).passed

        expect(check('10.000000', 10)).toBe(true)
        expect(check(10, '10.00')).toBe(true)
        expect(check('0.10', 0.1)).toBe(true)
        expect(check('-0', 0)).toBe(true)
        expect(check('100000000000000000001', '100000000000000000001')).toBe(true)
        expect(check('10.0001', 10)).toBe(false)
        expect(check('abc', 10)).toBe(false)
        expect(check(null, 10)).toBe(false)
    })

    it('len проверяет длину массива, строки и объекта', () => {
        const check = (actual: unknown, value: unknown) =>
            evaluateAssert({ path: 'v', op: 'len', value }, { v: actual }).passed

        expect(check([1, 2, 3], 3)).toBe(true)
        expect(check('abcd', 4)).toBe(true)
        expect(check({ a: 1, b: 2 }, 2)).toBe(true)
        expect(check([1], 2)).toBe(false)
        expect(check(undefined, 0)).toBe(false)
    })
})

describe('переменные прогона', () => {
    const clientFlow = FlowSchema.parse({
        id: 'client',
        name: 'Client',
        variables: { clientId: 'c-default', orderKey: '{{$uuid}}' },
        steps: [
            {
                id: 'first',
                name: 'Первый',
                query: 'query One($clientId: ID!, $key: String!) { one }',
                variables: { clientId: '{{clientId}}', key: '{{orderKey}}' },
            },
            {
                id: 'second',
                name: 'Второй',
                query: 'query Two($clientId: ID!, $key: String!) { two }',
                variables: { clientId: '{{clientId}}', key: '{{orderKey}}' },
            },
        ],
    })

    function sentVariables(harness: { transport: FakeTransport }, index: number) {
        return (
            JSON.parse(harness.transport.exchanges[index]?.request.body ?? '{}') as {
                variables: Record<string, unknown>
            }
        ).variables
    }

    it('подставляет константы цепочки и раскрывает генератор один раз на прогон', async () => {
        const harness = await createHarness(() => '{"data":{"one":1}}')

        const result = await harness.flows.runFlow('api', clientFlow)

        expect(result.ok).toBe(true)
        expect(sentVariables(harness, 0).clientId).toBe('c-default')

        const key = sentVariables(harness, 0).key
        expect(key).toMatch(/^[0-9a-f-]{36}$/)
        expect(sentVariables(harness, 1).key).toBe(key)
    })

    it('значения запуска важнее констант цепочки', async () => {
        const harness = await createHarness(() => '{"data":{"one":1}}')

        await harness.flows.runFlow('api', clientFlow, { variables: { clientId: 'c-42' } })

        expect(sentVariables(harness, 0).clientId).toBe('c-42')
        expect(sentVariables(harness, 1).clientId).toBe('c-42')
    })
})

describe('набор цепочек', () => {
    const passing = FlowSchema.parse({
        id: 'smoke-billing-one',
        name: 'Один',
        tags: ['smoke'],
        steps: [{ id: 's1', name: 'Шаг', query: 'query One { one }' }],
    })
    const failing = FlowSchema.parse({
        id: 'smoke-billing-two',
        name: 'Два',
        tags: ['smoke'],
        steps: [
            {
                id: 's1',
                name: 'Шаг',
                query: 'query Two { two }',
                assert: [{ path: 'data.two', op: 'eq', value: 'нет' }],
            },
        ],
    })

    it('прогоняет весь набор, даже если цепочка упала', async () => {
        const harness = await createHarness(() => '{"data":{"one":1,"two":2}}')
        await harness.workspaces.saveFlow('api', passing)
        await harness.workspaces.saveFlow('api', failing)

        const results = await harness.flows.runMany('api', [
            passing.id,
            failing.id,
            'нет-такой-цепочки',
        ])

        expect(results.map((run) => run.ok)).toEqual([true, false, false])
        expect(results[2]?.error).toMatch(/нет-такой-цепочки/)
    })

    it('параллельный прогон записывает итоги обеих цепочек', async () => {
        const harness = await createHarness(() => '{"data":{"one":1,"two":2}}')
        await harness.workspaces.saveFlow('api', passing)
        await harness.workspaces.saveFlow('api', failing)

        await harness.flows.runMany('api', [passing.id, failing.id], { parallel: true })

        // Обе цепочки заканчиваются почти одновременно: запись «прочитать —
        // дописать — сохранить» без очереди теряла одну из строк.
        const state = await harness.state.read('api')
        expect(Object.keys(state).sort()).toEqual([passing.id, failing.id].sort())
    })

    it('параллельный прогон даёт те же итоги в том же порядке', async () => {
        const harness = await createHarness(() => '{"data":{"one":1,"two":2}}')
        await harness.workspaces.saveFlow('api', passing)
        await harness.workspaces.saveFlow('api', failing)

        const results = await harness.flows.runMany('api', [passing.id, failing.id], {
            parallel: true,
        })

        expect(results.map((run) => run.flowId)).toEqual([passing.id, failing.id])
        expect(results.map((run) => run.ok)).toEqual([true, false])
    })

    it('запоминает дату зелёного прогона и не стирает её падением', async () => {
        const harness = await createHarness((body) =>
            body.includes('One') ? '{"data":{"one":1}}' : '{"data":{"two":2}}',
        )
        await harness.workspaces.saveFlow('api', passing)

        await harness.flows.run('api', passing.id)
        const green = await harness.state.get('api', passing.id)
        expect(green?.lastGreenAt).toBeTruthy()

        // Та же цепочка с проверкой, которая не пройдёт.
        await harness.workspaces.saveFlow('api', {
            ...passing,
            steps: [
                {
                    ...passing.steps[0]!,
                    assert: [{ path: 'data.one', op: 'eq' as const, value: 'нет' }],
                },
            ],
        })
        await harness.flows.run('api', passing.id)

        const after = await harness.state.get('api', passing.id)
        expect(after?.ok).toBe(false)
        expect(after?.failedStep).toBe('Шаг')
        expect(after?.lastGreenAt).toBe(green?.lastGreenAt)
    })
})
