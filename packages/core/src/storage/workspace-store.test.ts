import { describe, expect, it } from 'vitest'

import { MemoryFileSystem } from '../testing/memory-file-system.js'
import { LibraryPaths } from './paths.js'
import { detectOperationKind, parseOperationRef, WorkspaceStore } from './workspace-store.js'

function createStore(): { store: WorkspaceStore; fs: MemoryFileSystem } {
    const fs = new MemoryFileSystem()
    const store = new WorkspaceStore(fs, new LibraryPaths('/library'))

    return { store, fs }
}

describe('WorkspaceStore', () => {
    it('создаёт workspace с окружением по умолчанию и находит его в списке', async () => {
        const { store } = createStore()
        await store.init()

        const created = await store.createWorkspace({
            name: 'Backend API',
            endpointUrl: 'https://api.example.com/graphql',
        })

        expect(created.id).toBe('backend-api')
        expect(created.endpoints).toHaveLength(1)
        expect(created.defaultEnvironmentId).toBe('default')

        const list = await store.listWorkspaces()
        expect(list.map((item) => item.id)).toEqual(['backend-api'])
    })

    it('не позволяет создать workspace с уже занятым идентификатором', async () => {
        const { store } = createStore()
        await store.createWorkspace({ name: 'Backend' })

        await expect(store.createWorkspace({ name: 'Backend' })).rejects.toThrow(
            /уже существует/,
        )
    })

    it('сохраняет операцию как пару .graphql + .meta.json и читает её обратно', async () => {
        const { store, fs } = createStore()
        await store.createWorkspace({ name: 'API' })
        await store.createCollection('api', 'Users')

        const query = 'query GetUser($id: ID!) {\n  user(id: $id) {\n    id\n  }\n}\n'
        await store.saveOperation('api', {
            collectionId: 'users',
            name: 'getUser',
            query,
            variables: { id: '42' },
        })

        expect(fs.snapshot()).toContain('/library/workspaces/api/collections/users/getUser.graphql')
        expect(fs.snapshot()).toContain(
            '/library/workspaces/api/collections/users/getUser.meta.json',
        )

        const operation = await store.getOperation('api', {
            collectionId: 'users',
            name: 'getUser',
        })

        expect(operation.query).toBe(query)
        expect(operation.variables).toEqual({ id: '42' })
        expect(operation.kind).toBe('query')
    })

    it('подхватывает операцию, созданную мимо приложения, и ставит её в конец порядка', async () => {
        const { store, fs } = createStore()
        await store.createWorkspace({ name: 'API' })
        await store.createCollection('api', 'Users')
        await store.saveOperation('api', {
            collectionId: 'users',
            name: 'aaa',
            query: 'query Aaa { __typename }',
        })

        // Файл появился напрямую на диске — так работает агент через MCP.
        await fs.writeTextAtomic(
            '/library/workspaces/api/collections/users/zzz.graphql',
            'query Zzz { __typename }\n',
        )

        const operations = await store.listOperations('api', 'users')
        expect(operations.map((item) => item.name)).toEqual(['aaa', 'zzz'])
    })

    it('удаляет операцию вместе с записью о порядке', async () => {
        const { store } = createStore()
        await store.createWorkspace({ name: 'API' })
        await store.createCollection('api', 'Users')
        await store.saveOperation('api', {
            collectionId: 'users',
            name: 'getUser',
            query: 'query GetUser { __typename }',
        })

        await store.deleteOperation('api', { collectionId: 'users', name: 'getUser' })

        const collection = await store.getCollection('api', 'users')
        expect(collection.order).toEqual([])
        await expect(
            store.getOperation('api', { collectionId: 'users', name: 'getUser' }),
        ).rejects.toThrow(/не найдена/)
    })

    it('сообщает понятную ошибку для испорченного JSON-файла', async () => {
        const { store, fs } = createStore()
        await fs.writeTextAtomic('/library/workspaces/broken/workspace.json', '{ "id": ')

        await expect(store.getWorkspace('broken')).rejects.toThrow(/Некорректный JSON/)
    })
})

describe('detectOperationKind', () => {
    it('различает query, mutation и subscription', () => {
        expect(detectOperationKind('query Q { a }')).toBe('query')
        expect(detectOperationKind('mutation M { a }')).toBe('mutation')
        expect(detectOperationKind('subscription S { a }')).toBe('subscription')
    })

    it('считает незапарсившийся черновик обычным query', () => {
        expect(detectOperationKind('query { unclosed')).toBe('query')
    })
})

describe('parseOperationRef', () => {
    it('разбирает корректную ссылку', () => {
        expect(parseOperationRef('users/getUser')).toEqual({
            collectionId: 'users',
            name: 'getUser',
        })
    })

    it('отвергает ссылку без коллекции', () => {
        expect(() => parseOperationRef('getUser')).toThrow(/collection\/operation/)
    })
})

describe('перенос операций', () => {
    async function createTwoCollections() {
        const fs = new MemoryFileSystem()
        const store = new WorkspaceStore(fs, new LibraryPaths('/library'))
        await store.init()
        await store.createWorkspace({ name: 'API', endpointUrl: 'https://api.example.com/graphql' })
        await store.createCollection('api', 'Users')
        await store.createCollection('api', 'Admin')
        await store.saveOperation('api', {
            collectionId: 'users',
            name: 'Me',
            query: 'query Me { me { id } }',
            variables: { a: 1 },
            headers: { 'x-a': '1' },
        })

        return store
    }

    it('переносит операцию в другую коллекцию с метаданными', async () => {
        const store = await createTwoCollections()

        await store.moveOperation(
            'api',
            { collectionId: 'users', name: 'Me' },
            { collectionId: 'admin', name: 'Me' },
        )

        const moved = await store.getOperation('api', { collectionId: 'admin', name: 'Me' })
        expect(moved.query).toContain('query Me')
        expect(moved.variables).toEqual({ a: 1 })
        expect(moved.headers).toEqual({ 'x-a': '1' })
        expect(await store.listOperations('api', 'users')).toHaveLength(0)
        expect((await store.getCollection('api', 'admin')).order).toEqual(['Me'])
    })

    it('переименовывает в пределах коллекции и не затирает существующую', async () => {
        const store = await createTwoCollections()

        await store.moveOperation(
            'api',
            { collectionId: 'users', name: 'Me' },
            { collectionId: 'users', name: 'Profile' },
        )
        expect((await store.listOperations('api', 'users')).map((item) => item.name)).toEqual([
            'Profile',
        ])

        await store.saveOperation('api', { collectionId: 'users', name: 'Me', query: '{ a }' })
        await expect(
            store.moveOperation(
                'api',
                { collectionId: 'users', name: 'Me' },
                { collectionId: 'users', name: 'Profile' },
            ),
        ).rejects.toThrow(/уже существует/)
    })

    it('при переименовании оставляет операцию на прежнем месте', async () => {
        const store = await createTwoCollections()
        await store.saveOperation('api', { collectionId: 'users', name: 'List', query: '{ a }' })
        await store.saveOperation('api', { collectionId: 'users', name: 'Create', query: '{ b }' })

        await store.moveOperation(
            'api',
            { collectionId: 'users', name: 'List' },
            { collectionId: 'users', name: 'All' },
        )

        expect((await store.listOperations('api', 'users')).map((item) => item.name)).toEqual([
            'Me',
            'All',
            'Create',
        ])
    })

    it('переписывает ссылки из цепочек и профиля логина на новое имя', async () => {
        const store = await createTwoCollections()
        await store.saveFlow('api', {
            id: 'login',
            name: 'Login',
            description: '',
            steps: [
                {
                    id: 's1',
                    name: 'me',
                    operationRef: 'users/Me',
                    variables: {},
                    extract: {},
                    assert: [],
                    continueOnFailure: false,
                },
                {
                    id: 's2',
                    name: 'other',
                    operationRef: 'admin/Other',
                    variables: {},
                    extract: {},
                    assert: [],
                    continueOnFailure: false,
                },
            ],
        })
        const workspace = await store.getWorkspace('api')
        await store.saveWorkspace({
            ...workspace,
            environments: workspace.environments.map((environment) => ({
                ...environment,
                auth: {
                    type: 'login' as const,
                    operationRef: 'users/Me',
                    tokenPath: 'data.login.token',
                    storeAs: 'token',
                    headerName: 'Authorization',
                    prefix: 'Bearer ',
                    ttlSeconds: 3300,
                    variables: {},
                },
            })),
        })

        await store.moveOperation(
            'api',
            { collectionId: 'users', name: 'Me' },
            { collectionId: 'admin', name: 'Profile' },
        )

        const flow = await store.getFlow('api', 'login')
        expect(flow.steps.map((step) => step.operationRef)).toEqual(['admin/Profile', 'admin/Other'])
        const auth = (await store.getWorkspace('api')).environments[0]?.auth
        expect(auth?.type === 'login' ? auth.operationRef : undefined).toBe('admin/Profile')
    })

    it('ставит перенесённую операцию на указанную позицию', async () => {
        const store = await createTwoCollections()
        await store.saveOperation('api', { collectionId: 'admin', name: 'A', query: '{ a }' })
        await store.saveOperation('api', { collectionId: 'admin', name: 'B', query: '{ b }' })

        await store.moveOperation(
            'api',
            { collectionId: 'users', name: 'Me' },
            { collectionId: 'admin', name: 'Me' },
            { index: 1 },
        )

        expect((await store.listOperations('api', 'admin')).map((item) => item.name)).toEqual([
            'A',
            'Me',
            'B',
        ])
    })
})

describe('порядок операций', () => {
    it('сохраняет порядок, заданный перетаскиванием', async () => {
        const { store } = createStore()
        await store.createWorkspace({ name: 'API' })
        await store.createCollection('api', 'Users')
        for (const name of ['A', 'B', 'C']) {
            await store.saveOperation('api', { collectionId: 'users', name, query: '{ a }' })
        }

        await store.reorderOperations('api', 'users', ['C', 'A', 'B'])

        expect((await store.listOperations('api', 'users')).map((item) => item.name)).toEqual([
            'C',
            'A',
            'B',
        ])
    })

    it('отклоняет порядок, в котором не хватает операций', async () => {
        const { store } = createStore()
        await store.createWorkspace({ name: 'API' })
        await store.createCollection('api', 'Users')
        await store.saveOperation('api', { collectionId: 'users', name: 'A', query: '{ a }' })
        await store.saveOperation('api', { collectionId: 'users', name: 'B', query: '{ b }' })

        await expect(store.reorderOperations('api', 'users', ['B'])).rejects.toThrow(/не совпадает/)
    })
})
