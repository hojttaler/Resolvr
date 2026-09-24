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
    'eyJhbGciOiAiUlMyNTYiLCAidHlwIjogIkpXVCJ9.' +
    'eyJzdWIiOiAiZGVtb0BleGFtcGxlLmNvbSIsICJyb2xlIjogIkFETUlOIiwgImV4cCI6IDQxMDI0NDQ4MDB9.' +
    'demo-signature-not-a-real-token'

export const showcaseWorkspace: IWorkspace = {
    id: 'shop',
    name: 'Shop',
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
            id: 'staging',
            name: 'Staging',
            production: false,
            variables: { accessToken: 'keychain://shop/staging/accessToken' },
            headers: { authorization: 'Bearer {{accessToken}}' },
            auth: { type: 'none' },
            recovery: {
                flowId: 'sign-in',
                statuses: [401, 403],
                messagePatterns: ['unauthorized', 'token expired'],
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
            id: 'production',
            name: 'Production',
            production: true,
            variables: {},
            headers: {},
            auth: { type: 'none' },
        },
    ],
    defaultEndpointId: 'default',
    defaultEnvironmentId: 'staging',
    layout: { preset: 'classic', sizes: {}, sidebarCollapsed: false, sidebarTab: 'collections' },
    createdAt: '2026-08-12T16:32:17.151Z',
    updatedAt: '2026-09-08T10:00:00.000Z',
}

const QUERY = `query Products($filter: ProductFilter!, $first: Int = 20) {
  products(filter: $filter, first: $first) {
    totalCount
    edges {
      node {
        id
        name
        price {
          amount
          currency
        }
        inStock
      }
    }
  }
}
`

const VARIABLES = `{
  "filter": {
    "category": "AUDIO",
    "inStock": true,
    "priceRange": {
      "max": 50000
    }
  },
  "first": 20
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
                collection: { id: 'catalog', name: 'Catalog', description: '', order: [], headers: {} },
                operations: [
                    makeOperation('catalog', 'Products', 'query'),
                    makeOperation('catalog', 'Product', 'query'),
                    makeOperation('catalog', 'Categories', 'query'),
                    makeOperation('catalog', 'UpdatePrice', 'mutation'),
                ],
            },
            {
                collection: { id: 'orders', name: 'Orders', description: '', order: [], headers: {} },
                operations: [
                    makeOperation('orders', 'Orders', 'query'),
                    makeOperation('orders', 'CreateOrder', 'mutation'),
                ],
            },
            {
                collection: { id: 'account', name: 'Account', description: '', order: [], headers: {} },
                operations: [makeOperation('account', 'Me', 'query'), makeOperation('account', 'SignIn', 'mutation')],
            },
        ],
        flows: [
            {
                id: 'sign-in',
                name: 'Sign in',
                description: '',
                steps: [
                    { id: 's1', name: 'Request code', operationRef: 'account/SignIn', variables: {}, extract: { challengeId: 'data.signIn.challengeId' }, assert: [], expect: 'success', continueOnFailure: false },
                    { id: 's2', name: 'Confirm code', operationRef: 'account/SignIn', variables: {}, extract: { accessToken: 'data.signIn.accessToken' }, assert: [], expect: 'success', continueOnFailure: false },
                ],
            },
        ],
        history: [
            makeHistory('Products', 200, true, 142, now - 60_000),
            makeHistory('Orders', 200, true, 388, now - 180_000),
            makeHistory('CreateOrder', 200, false, 96, now - 240_000),
        ],
        tabs: [
            { ...makeTab('tab-1', 'New request'), dirty: true },
            { ...makeTab('tab-2', 'Products'), operationRef: 'catalog/Products' },
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
                        products: {
                            totalCount: 128,
                            edges: [
                                {
                                    node: {
                                        id: 'prod_01HZ',
                                        name: 'Studio Headphones',
                                        price: { amount: 24900, currency: 'USD' },
                                        inStock: true,
                                        tags: ['audio', 'wired', 'over-ear'],
                                    },
                                },
                                {
                                    node: {
                                        id: 'prod_01J2',
                                        name: 'Desk Speaker Pair',
                                        price: { amount: 18900, currency: 'USD' },
                                        inStock: true,
                                        tags: [],
                                    },
                                },
                                {
                                    node: {
                                        id: 'prod_01K7',
                                        name: 'USB Microphone',
                                        price: { amount: 9900, currency: 'USD' },
                                        inStock: false,
                                        signature: JWT,
                                    },
                                },
                            ],
                        },
                    },
                    errors: [{ message: 'Unauthorized: token expired', path: ['products'], extensions: { code: 'UNAUTHENTICATED' } }],
                    kind: 'query',
                    durationMs: 188,
                    responseBytes: 1_412,
                    requestHeaders: { 'content-type': 'application/json' },
                    unresolvedHeaders: ['authorization'],
                    endpointId: 'default',
                    environmentId: 'staging',
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
                    goal: 'Verify that sign-in returns a token and the catalog is readable with it',
                    steps: ['Load the schema', 'Sign in', 'Read the catalog'],
                },
                entries: [
                    {
                        kind: 'call',
                        sessionId: 's-showcase',
                        seq: 2,
                        ts: new Date(now - 280_000).toISOString(),
                        tool: 'introspect',
                        intent: 'Loading the schema to learn the available operations',
                        expectation: 'The schema has signIn and products',
                        step: 0,
                        args: { workspaceId: 'shop' },
                        ok: true,
                        durationMs: 412,
                        summary: 'schema default, 184,320 characters of SDL',
                        result: { endpointId: 'default', sdlLength: 184_320 },
                        truncated: false,
                    },
                    {
                        kind: 'call',
                        sessionId: 's-showcase',
                        seq: 3,
                        ts: new Date(now - 240_000).toISOString(),
                        tool: 'run',
                        intent: 'Signing in and taking the accessToken',
                        step: 1,
                        args: { workspaceId: 'shop', ref: 'account/SignIn' },
                        ok: true,
                        durationMs: 188,
                        summary: 'HTTP 200, ok, 188 ms',
                        result: { ok: true, status: 200, data: { signIn: { accessToken: JWT } } },
                        truncated: false,
                    },
                    {
                        kind: 'note',
                        sessionId: 's-showcase',
                        seq: 4,
                        ts: new Date(now - 230_000).toISOString(),
                        text: 'Token obtained and substituted into the header; moving on to the catalog',
                        step: 1,
                    },
                    {
                        kind: 'call',
                        sessionId: 's-showcase',
                        seq: 5,
                        ts: new Date(now - 200_000).toISOString(),
                        tool: 'operation_get',
                        intent: 'Reading an operation that does not exist — checking the error path',
                        step: 2,
                        args: { workspaceId: 'shop', ref: 'catalog/missing' },
                        ok: false,
                        durationMs: 4,
                        summary: 'error: OPERATION_NOT_FOUND',
                        error: 'Operation "catalog/missing" not found',
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
        saveToEnvironment: [],
        query: QUERY,
        kind,
        updatedAt: '2026-09-01T10:00:00.000Z',
    }
}

function makeTab(id: string, title: string): ITabState {
    return {
        id,
        kind: 'operation',
        workspaceId: 'shop',
        title,
        dirty: false,
        pinned: false,
        environmentId: 'staging',
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
        workspaceId: 'shop',
        endpointId: 'default',
        environmentId: 'staging',
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
        responseTruncated: false,
        responseHeaders: {},
        requestHeaders: {},
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
                workspaceId: 'shop',
                title: 'Flows run',
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
                environmentId: 'staging',
                environmentName: 'Staging',
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
                                { stepId: 's1', name: 'Request code', ok: true, skipped: false, status: 200, durationMs: 210, asserts: [], extracted: {} },
                                { stepId: 's2', name: 'Confirm code', ok: true, skipped: false, status: 200, durationMs: 202, asserts: [], extracted: { accessToken: 'eyJ…' } },
                            ],
                        },
                    },
                    {
                        flowId: 'catalog-smoke',
                        flowName: 'Catalog smoke',
                        run: {
                            flowId: 'catalog-smoke',
                            ok: false,
                            durationMs: 188,
                            context: {},
                            steps: [
                                {
                                    stepId: 's1',
                                    name: 'Products',
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
                                { stepId: 's2', name: 'Orders', ok: false, skipped: true, durationMs: 0, asserts: [], extracted: {} },
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
    "A registered customer."
    type User implements Node {
        id: ID!
        "Email address; unique within the shop."
        email: String!
        role: Role!
        profile: Profile
        "Orders of the user, newest first."
        orders(first: Int = 20, after: String, status: OrderStatus): OrderConnection!
        legacyName: String @deprecated(reason: "Используйте profile.displayName")
    }
    interface Node { id: ID! }
    type Profile { displayName: String!, avatarUrl: String, locale: String }
    type Order implements Node { id: ID!, status: OrderStatus!, total: Money!, user: User! }
    type OrderConnection { edges: [OrderEdge!]!, totalCount: Int! }
    type OrderEdge { node: Order!, cursor: String! }
    "Amount in the smallest currency unit."
    type Money { amount: Int!, currency: Currency! }
    enum Role { ADMIN, MANAGER, USER }
    enum OrderStatus { NEW, PAID, SHIPPED, CANCELLED }
    enum Currency { USD, EUR, RUB }
    input ProductFilter { category: String, inStock: Boolean, priceRange: PriceRange }
    input PriceRange { min: Int, max: Int }
    type Product { id: ID!, name: String!, price: Money!, inStock: Boolean!, tags: [String!]! }
    type ProductConnection { edges: [ProductEdge!]!, totalCount: Int! }
    type ProductEdge { node: Product!, cursor: String! }
    type SignInResult { accessToken: String!, expiresIn: Int! }
    union SearchResult = User | Order
    type Query {
        "The current user for the token."
        me: User
        user(id: ID!): User
        users(role: Role, first: Int = 50): [User!]!
        search(query: String!, limit: Int = 10): [SearchResult!]!
        order(id: ID!): Order
        "Catalog with filters and cursor pagination."
        products(filter: ProductFilter!, first: Int = 20, after: String): ProductConnection!
    }
    type Mutation {
        signIn(email: String!, password: String!): SignInResult!
        createOrder(productIds: [ID!]!): Order!
        cancelOrder(id: ID!, reason: String): Order!
    }
    type Subscription { orderUpdated(userId: ID!): Order! }
`)

/** Открывает тип в браузере схемы. */
export function seedSchemaBrowser(typeName: string): void {
    useAppStore.setState({ schema: SHOWCASE_SCHEMA, schemaFetchedAt: new Date().toISOString() })
    useAppStore.getState().openSchemaTab(typeName)
}

/** Ответ на 20 000 объектов — проверка виртуализации дерева. */
export function seedBigResponse(): void {
    const state = useAppStore.getState()
    const tabId = state.activeTabId
    if (!tabId) return

    const items = Array.from({ length: 20_000 }, (_, index) => ({
        id: `u-${index}`,
        email: `user${index}@example.com`,
        enabled: index % 3 !== 0,
    }))

    useAppStore.setState({
        runs: {
            ...state.runs,
            [tabId]: {
                status: 'done',
                events: [],
                result: {
                    ok: true,
                    status: 200,
                    statusText: 'OK',
                    headers: { 'content-type': 'application/json' },
                    body: '',
                    data: { users: items },
                    // Плашки над деревом — проверка, что смещение виртуального
                    // списка учитывает их высоту.
                    errors: [{ message: 'Partial data: 3 users could not be loaded' }],
                    unresolvedHeaders: ['x-trace'],
                    kind: 'query',
                    durationMs: 812,
                    responseBytes: 1_400_000,
                    requestHeaders: {},
                    endpointId: 'default',
                },
            },
        },
        settings: { ...state.settings, response: { expandDepth: 4 } },
    })
}
