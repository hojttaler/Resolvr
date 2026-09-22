import type { IHistoryEntry, IOperation, ITabState, IWorkspace } from '@resolvr/core'

import { buildSchema } from 'graphql'

import { useAppStore } from '../state/store.js'

/**
 * Данные для витрины интерфейса.
 *
 * Витрина рендерит настоящие компоненты вне Tauri, поэтому состояние
 * подставляется напрямую в store. Это позволяет снимать экраны приложения и
 * проверять вёрстку, не поднимая окно и не выполняя реальные запросы.
 */
const JWT =
    'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.' +
    'eyJzdWIiOiAiZGVtb0BleGFtcGxlLmNvbSIsICJyb2xlIjogIkFETUlOIiwgImV4cCI6IDQxMDI0NDQ4MDB9' +
    'iLCJpYXQiOjE3NTUwMDAwMDAsImV4cCI6MTc1NTAwMzYwMH0.' +
    'kZ4nQ0mS8pVYb3H2rT9wLxJvA6cEdF1gKmNpQrStUvWxYzAbCdEfGhIjKlMnOpQrStUvWxYz'

export const showcaseWorkspace: IWorkspace = {
    id: 'development',
    name: 'Development',
    description: '',
    endpoints: [
        {
            id: 'default',
            name: 'Default',
            url: 'https://api.shop.example/graphql',
            headers: {},
            acceptInvalidCerts: false,
        },
    ],
    environments: [
        {
            id: 'default',
            name: 'Default',
            production: false,
            variables: { accessToken: 'keychain://development/default/accessToken' },
            headers: { authorization: 'Bearer {{accessToken}}' },
            auth: { type: 'none' },
            recovery: {
                flowId: 'sign-in',
                statuses: [401, 403],
                messagePatterns: ['authorization', 'access denied'],
                maxAttempts: 1,
                enabled: true,
                onExpiry: true,
                onError: true,
                refreshMarginSec: 60,
            },
            // Токен на исходе: витрина должна показывать предупреждающий вид.
            tokenExpiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
            tokenSubject: 'demo@example.com',
        },
        {
            id: 'staging',
            name: 'Staging',
            production: false,
            variables: {},
            headers: {},
            auth: { type: 'none' },
        },
    ],
    defaultEndpointId: 'default',
    defaultEnvironmentId: 'default',
    layout: { preset: 'classic', sizes: {}, sidebarCollapsed: false, sidebarTab: 'collections' },
    createdAt: '2026-08-12T16:32:17.151Z',
    updatedAt: '2026-09-08T10:00:00.000Z',
}

const QUERY = `query Products($input: ProductFilter!) {
  products(input: $input) {
    sessionId
    device
    retryAfter
    timeout
    cooldown
    emailCooldown
  }
}
`

const VARIABLES = `{
  "input": {
    "service": "EXAMPLE",
    "identity": "demo@example.com",
    "device": "EMAIL",
    "type": "REGISTRATION",
    "captcha": {
      "clientToken": ""
    }
  }
}
`

/** Заполняет store состоянием, похожим на рабочую сессию. */
export function seedShowcase(): void {
    const now = Date.now()

    useAppStore.setState({
        // Витрина работает без файловой системы: чтение вернуло бы пустой
        // журнал и стёрло подготовленные записи.
        loadActivity: async () => undefined,
        ready: true,
        workspace: showcaseWorkspace,
        workspaces: [showcaseWorkspace],
        tree: [
            {
                collection: { id: 'authorization', name: 'Authorization', description: '', order: [], headers: {} },
                operations: [
                    makeOperation('authorization', 'Products', 'query'),
                    makeOperation('authorization', 'SignIn', 'query'),
                    makeOperation('authorization', 'SignIn', 'mutation'),
                    makeOperation('authorization', 'Me', 'query'),
                ],
            },
            {
                collection: { id: 'users', name: 'Users', description: '', order: [], headers: {} },
                operations: [makeOperation('users', 'Me', 'query')],
            },
            {
                collection: { id: 'catalog', name: 'Catalog', description: '', order: [], headers: {} },
                operations: [makeOperation('catalog', 'Categories', 'query')],
            },
        ],
        flows: [
            {
                id: 'sign-in',
                name: 'Sign in',
                description: '',
                steps: [
                    { id: 's1', name: 'Шаг 1', operationRef: 'authorization/SignIn', variables: {}, extract: { operationId: 'data.signIn.operationId' }, assert: [], continueOnFailure: false },
                    { id: 's2', name: 'Шаг 2', operationRef: 'authorization/SignIn', variables: {}, extract: { accessToken: 'data.signIn.accessToken' }, assert: [], continueOnFailure: false },
                ],
            },
        ],
        history: [
            makeHistory('Products', 200, true, 142, now - 60_000),
            makeHistory('Orders', 200, true, 388, now - 180_000),
            makeHistory('CreateOrder', 200, false, 96, now - 240_000),
        ],
        tabs: [
            { ...makeTab('tab-1', 'Новый запрос'), dirty: true },
            { ...makeTab('tab-2', 'Products'), operationRef: 'authorization/Products' },
        ],
        activeTabId: 'tab-2',
        contents: {
            'tab-1': { query: 'query {\n  \n}\n', variables: '{}', headers: {} },
            'tab-2': { query: QUERY, variables: VARIABLES, headers: {} },
        },
        runs: {
            'tab-2': {
                status: 'done',
                events: [],
                result: {
                    ok: false,
                    status: 200,
                    statusText: 'OK',
                    headers: { 'content-type': 'application/json' },
                    body: '{}',
                    data: {
                        signIn: {
                            accessToken: JWT,
                            refreshToken: 'rt-9f2b41ca',
                            expiresIn: 3600,
                            params: {},
                            profile: {
                                id: 'u-1',
                                email: 'demo@example.com',
                                disabledUntil: null,
                                enabled: true,
                                reason: null,
                            },
                        },
                    },
                    errors: [{ message: 'Authorization token is not valid', status: 500 }],
                    kind: 'query',
                    durationMs: 188,
                    responseBytes: 85,
                    requestHeaders: { 'content-type': 'application/json' },
                    unresolvedHeaders: ['authorization'],
                    endpointId: 'default',
                    environmentId: 'default',
                },
            },
        },
        activitySessions: [
            {
                sessionId: 's-showcase',
                startedAt: new Date(now - 300_000).toISOString(),
                client: { name: 'claude-code', version: '2.1' },
                plan: {
                    kind: 'plan',
                    sessionId: 's-showcase',
                    seq: 1,
                    ts: new Date(now - 300_000).toISOString(),
                    goal: 'Проверить, что логин выдаёт токен и профиль читается по нему',
                    steps: ['Загрузить схему', 'Выполнить логин', 'Прочитать профиль'],
                },
                entries: [
                    {
                        kind: 'call',
                        sessionId: 's-showcase',
                        seq: 2,
                        ts: new Date(now - 280_000).toISOString(),
                        tool: 'introspect',
                        intent: 'Загружаю схему гейтвея, чтобы знать доступные операции',
                        expectation: 'В схеме есть signIn и signIn',
                        step: 0,
                        args: { workspaceId: 'development' },
                        ok: true,
                        durationMs: 412,
                        summary: 'схема default, 184 320 символов SDL',
                        result: { endpointId: 'default', sdlLength: 184_320 },
                        truncated: false,
                    },
                    {
                        kind: 'call',
                        sessionId: 's-showcase',
                        seq: 3,
                        ts: new Date(now - 240_000).toISOString(),
                        tool: 'run',
                        intent: 'Выполняю логин и забираю accessToken',
                        step: 1,
                        args: { workspaceId: 'development', ref: 'authorization/SignIn' },
                        ok: true,
                        durationMs: 188,
                        summary: 'HTTP 200, успех, 188 мс',
                        result: { ok: true, status: 200, data: { signIn: { accessToken: JWT } } },
                        truncated: false,
                    },
                    {
                        kind: 'note',
                        sessionId: 's-showcase',
                        seq: 4,
                        ts: new Date(now - 230_000).toISOString(),
                        text: 'Токен получен и подставляется в заголовок; перехожу к чтению профиля',
                        step: 1,
                    },
                    {
                        kind: 'call',
                        sessionId: 's-showcase',
                        seq: 5,
                        ts: new Date(now - 200_000).toISOString(),
                        tool: 'operation_get',
                        intent: 'Читаю операцию, которой нет — проверяю поведение на ошибке',
                        step: 2,
                        args: { workspaceId: 'development', ref: 'users/missing' },
                        ok: false,
                        durationMs: 4,
                        summary: 'ошибка: OPERATION_NOT_FOUND',
                        error: 'Операция "users/missing" не найдена',
                        truncated: false,
                    },
                ],
                stats: {
                    totalCalls: 3,
                    failedCalls: 1,
                    durationMs: 604,
                    lastActivityAt: new Date(now - 200_000).toISOString(),
                },
            },
        ],
    })
}

function makeOperation(
    collectionId: string,
    name: string,
    kind: 'query' | 'mutation',
): IOperation {
    return {
        collectionId,
        name,
        description: '',
        variables: {},
        headers: {},
        query: QUERY,
        kind,
        updatedAt: '2026-09-01T10:00:00.000Z',
    }
}

function makeTab(id: string, title: string): ITabState {
    return {
        id,
        kind: 'operation',
        workspaceId: 'development',
        title,
        dirty: false,
        pinned: false,
        environmentId: 'default',
        endpointId: 'default',
        queryCursor: { anchor: 0, head: 0, scrollTop: 0 },
        variablesCursor: { anchor: 0, head: 0, scrollTop: 0 },
        bottomTab: 'variables' as const,
        responseTab: 'response' as const,
    }
}

function makeHistory(
    name: string,
    status: number,
    ok: boolean,
    durationMs: number,
    at: number,
): IHistoryEntry {
    return {
        id: `${name}-${at}`,
        ts: new Date(at).toISOString(),
        workspaceId: 'development',
        endpointId: 'default',
        environmentId: 'default',
        operationName: name,
        kind: 'query' as const,
        query: QUERY,
        variables: {},
        status,
        ok,
        durationMs,
        errorCount: ok ? 0 : 1,
        responseBytes: 512,
        responsePreview: ok ? '{"data":{…}}' : '{"errors":[{"message":"Access denied"}]}',
    }
}

/** Вкладка-отчёт с одной пройденной и одной упавшей цепочкой. */
export function seedReport(): void {
    const tabId = 'tab-report'
    const state = useAppStore.getState()

    useAppStore.setState({
        tabs: [
            ...state.tabs,
            {
                id: tabId,
                kind: 'report',
                workspaceId: 'development',
                title: 'Прогон цепочек',
                dirty: false,
                pinned: false,
                queryCursor: { anchor: 0, head: 0, scrollTop: 0 },
                variablesCursor: { anchor: 0, head: 0, scrollTop: 0 },
                bottomTab: 'variables',
                responseTab: 'response',
            },
        ],
        activeTabId: tabId,
        reports: {
            [tabId]: {
                startedAt: new Date(Date.now() - 90_000).toISOString(),
                finishedAt: new Date().toISOString(),
                environmentId: 'default',
                environmentName: 'Default',
                entries: [
                    {
                        flowId: 'sign-in',
                        flowName: 'Sign in',
                        run: {
                            flowId: 'sign-in',
                            ok: true,
                            durationMs: 412,
                            context: { accessToken: 'eyJ…' },
                            steps: [
                                { stepId: 's1', name: 'SignIn', ok: true, skipped: false, status: 200, durationMs: 210, asserts: [], extracted: {} },
                                { stepId: 's2', name: 'SignIn', ok: true, skipped: false, status: 200, durationMs: 202, asserts: [], extracted: { accessToken: 'eyJ…' } },
                            ],
                        },
                    },
                    {
                        flowId: 'profile-smoke',
                        flowName: 'Profile smoke',
                        run: {
                            flowId: 'profile-smoke',
                            ok: false,
                            durationMs: 188,
                            context: {},
                            steps: [
                                {
                                    stepId: 's1',
                                    name: 'Me',
                                    ok: false,
                                    skipped: false,
                                    status: 200,
                                    durationMs: 188,
                                    extracted: {},
                                    asserts: [
                                        {
                                            assert: { path: 'data.me.email', op: 'eq', value: 'admin@example.com' },
                                            passed: false,
                                            actual: 'demo@example.com',
                                            message: 'ожидалось admin@example.com, получено demo@example.com',
                                        },
                                    ],
                                },
                                { stepId: 's2', name: 'Categories', ok: false, skipped: true, durationMs: 0, asserts: [], extracted: {} },
                            ],
                        },
                    },
                ],
            },
        },
    })
}

/** Схема витрины — небольшая, но со всеми родами типов для браузера схемы. */
export const SHOWCASE_SCHEMA = buildSchema(`
    "Пользователь платформы."
    type User implements Node {
        id: ID!
        "Адрес электронной почты; уникален в пределах сервиса."
        email: String!
        role: Role!
        profile: Profile
        "Заказы пользователя, новые первыми."
        orders(first: Int = 20, after: String, status: OrderStatus): OrderConnection!
        legacyName: String @deprecated(reason: "Используйте profile.displayName")
    }
    interface Node { id: ID! }
    type Profile { displayName: String!, avatarUrl: String, locale: String }
    type Order implements Node { id: ID!, status: OrderStatus!, total: Money!, user: User! }
    type OrderConnection { edges: [OrderEdge!]!, totalCount: Int! }
    type OrderEdge { node: Order!, cursor: String! }
    "Денежная сумма в минимальных единицах валюты."
    type Money { amount: Int!, currency: Currency! }
    enum Role { ADMIN, MANAGER, USER }
    enum OrderStatus { NEW, PAID, SHIPPED, CANCELLED }
    enum Currency { USD, EUR, RUB }
    input ProductFilter { service: String!, identity: String!, device: DeviceKind!, type: String! }
    enum DeviceKind { EMAIL, SMS }
    type ProductsResult { sessionId: ID!, retryAfter: Int, cooldown: Int }
    union SearchResult = User | Order
    type Query {
        "Текущий пользователь по токену."
        me: User
        user(id: ID!): User
        users(role: Role, first: Int = 50): [User!]!
        search(query: String!, limit: Int = 10): [SearchResult!]!
        order(id: ID!): Order
    }
    type Mutation {
        products(input: ProductFilter!): ProductsResult!
        signIn(sessionId: ID!, code: String!): User!
        cancelOrder(id: ID!, reason: String): Order!
    }
    type Subscription { orderUpdated(userId: ID!): Order! }
`)

/** Открывает тип в браузере схемы. */
export function seedSchemaBrowser(typeName: string): void {
    useAppStore.setState({ schema: SHOWCASE_SCHEMA, schemaFetchedAt: new Date().toISOString() })
    useAppStore.getState().openSchemaTab(typeName)
}
