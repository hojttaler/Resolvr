import { describe, expect, it } from 'vitest'

import { LibraryPaths } from '../storage/paths.js'
import { WorkspaceStore } from '../storage/workspace-store.js'
import { MemoryFileSystem } from '../testing/memory-file-system.js'
import { importBundle, parseImportFile } from './index.js'

const POSTMAN = JSON.stringify({
    info: { name: 'Shop API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    variable: [{ key: 'baseUrl', value: 'https://api.shop.dev' }],
    item: [
        {
            name: 'Auth',
            item: [
                {
                    name: 'Login',
                    request: {
                        method: 'POST',
                        header: [{ key: 'x-client', value: 'postman' }, { key: 'x-off', value: '1', disabled: true }],
                        body: {
                            mode: 'graphql',
                            graphql: {
                                query: 'mutation Login($email: String!) { login(email: $email) { token } }',
                                variables: '{"email":"a@b.c"}',
                            },
                        },
                    },
                },
                {
                    name: 'Nested',
                    item: [
                        {
                            name: 'Me',
                            request: {
                                method: 'POST',
                                body: { mode: 'raw', raw: '{"query":"{ me { id } }"}' },
                            },
                        },
                    ],
                },
                { name: 'Health', request: { method: 'GET', body: { mode: 'raw', raw: 'ping' } } },
            ],
        },
        {
            name: 'Loose query',
            request: { method: 'POST', body: { mode: 'raw', raw: 'query { version }' } },
        },
    ],
})

const POSTMAN_ENV = JSON.stringify({
    name: 'Staging',
    _postman_variable_scope: 'environment',
    values: [
        { key: 'token', value: 'abc', enabled: true },
        { key: 'old', value: 'x', enabled: false },
    ],
})

const INSOMNIA = JSON.stringify({
    _type: 'export',
    __export_format: 4,
    resources: [
        { _id: 'wrk_1', _type: 'workspace', name: 'Shop' },
        { _id: 'env_base', _type: 'environment', parentId: 'wrk_1', name: 'Base Environment', data: { host: 'shop.dev', auth: { token: 'abc' } } },
        { _id: 'env_prod', _type: 'environment', parentId: 'env_base', name: 'Prod', data: { host: 'shop.com' } },
        { _id: 'fld_users', _type: 'request_group', parentId: 'wrk_1', name: 'Users' },
        { _id: 'fld_admin', _type: 'request_group', parentId: 'fld_users', name: 'Admin' },
        {
            _id: 'req_me',
            _type: 'request',
            parentId: 'fld_users',
            name: 'Me',
            body: { mimeType: 'application/graphql', text: '{"query":"{ me { id } }","variables":{}}' },
            headers: [{ name: 'authorization', value: 'Bearer {{ _.auth.token }}' }],
        },
        {
            _id: 'req_ban',
            _type: 'request',
            parentId: 'fld_admin',
            name: 'Ban',
            body: { mimeType: 'application/graphql', text: '{"query":"mutation { ban }"}' },
        },
        { _id: 'req_rest', _type: 'request', parentId: 'fld_users', name: 'REST', body: { mimeType: 'application/json', text: '{"a":1}' } },
    ],
})

describe('parseImportFile', () => {
    it('Postman: папки → коллекции, вложенные — в имя, не-GraphQL пропускается', () => {
        const bundle = parseImportFile(POSTMAN)

        expect(bundle?.source).toBe('postman')
        expect(bundle?.collections.map((item) => item.name)).toEqual(['Shop API', 'Auth'])
        const auth = bundle?.collections[1]
        expect(auth?.operations.map((item) => item.name)).toEqual(['Login', 'Nested › Me'])
        expect(auth?.operations[0]?.variables).toEqual({ email: 'a@b.c' })
        expect(auth?.operations[0]?.headers).toEqual({ 'x-client': 'postman' })
        expect(bundle?.collections[0]?.operations[0]?.query).toBe('query { version }')
        expect(bundle?.environments).toEqual([{ name: 'Shop API', variables: { baseUrl: 'https://api.shop.dev' } }])
        expect(bundle?.skipped).toBe(1)
    })

    it('Postman: файл окружения', () => {
        const bundle = parseImportFile(POSTMAN_ENV)

        expect(bundle?.collections).toEqual([])
        expect(bundle?.environments).toEqual([{ name: 'Staging', variables: { token: 'abc' } }])
    })

    it('Insomnia: группы, вложенность, шаблоны и окружения', () => {
        const bundle = parseImportFile(INSOMNIA)

        expect(bundle?.source).toBe('insomnia')
        expect(bundle?.collections).toHaveLength(1)
        const users = bundle?.collections[0]
        expect(users?.name).toBe('Users')
        expect(users?.operations.map((item) => item.name)).toEqual(['Me', 'Admin › Ban'])
        expect(users?.operations[0]?.headers.authorization).toBe('Bearer {{auth.token}}')
        expect(bundle?.environments).toEqual([
            { name: 'Base', variables: { host: 'shop.dev', 'auth.token': 'abc' } },
            { name: 'Prod', variables: { host: 'shop.com' } },
        ])
        expect(bundle?.skipped).toBe(1)
    })

    it('чужой JSON и не-JSON не распознаются', () => {
        expect(parseImportFile('{"foo":1}')).toBeUndefined()
        expect(parseImportFile('not json')).toBeUndefined()
    })
})

describe('importBundle', () => {
    it('создаёт коллекции и окружения, не затирая существующие', async () => {
        const fs = new MemoryFileSystem()
        const store = new WorkspaceStore(fs, new LibraryPaths('/library'))
        await store.init()
        await store.createWorkspace({ name: 'API', endpointUrl: 'https://api.example.com/graphql' })
        await store.createCollection('api', 'Auth')

        const result = await importBundle(store, 'api', parseImportFile(POSTMAN)!)

        expect(result).toEqual({ collections: 2, operations: 3, environments: 1, skipped: 1 })
        const collections = await store.listCollections('api')
        expect(collections.map((item) => item.id).sort()).toEqual(['auth', 'auth-2', 'shop-api'])
        expect((await store.listOperations('api', 'auth-2')).map((item) => item.name)).toEqual([
            'Login', 'Nested › Me',
        ])
        const workspace = await store.getWorkspace('api')
        expect(workspace.environments.map((item) => item.id)).toEqual(['default', 'shop-api'])
    })
})
