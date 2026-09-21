import { buildSchema } from 'graphql'
import { describe, expect, it } from 'vitest'

import { buildOperation, buildSelectionSetForType } from './selection-set-builder.js'

const schema = buildSchema(`
    scalar DateTime

    enum Role {
        ADMIN
        USER
    }

    input UserFilter {
        role: Role!
        search: String
        limit: Int!
    }

    type Address {
        city: String!
        street: String!
    }

    type User {
        id: ID!
        email: String!
        role: Role!
        createdAt: DateTime
        address: Address!
        friends: [User!]!
        posts(first: Int!): [Post!]!
    }

    type Post {
        id: ID!
        title: String!
        author: User!
    }

    type Query {
        user(id: ID!): User
        users(filter: UserFilter!, offset: Int): [User!]!
    }

    type Mutation {
        createUser(input: UserFilter!): User!
    }
`)

describe('buildOperation', () => {
    it('собирает запрос с переменными для обязательных аргументов', () => {
        const built = buildOperation(schema, { kind: 'query', fieldName: 'user', depth: 1 })

        expect(built.operationName).toBe('User')
        expect(built.query).toContain('query User($id: ID!)')
        expect(built.query).toContain('user(id: $id)')
        expect(built.variables).toEqual({ id: '' })
    })

    it('раскрывает вложенные объекты на заданную глубину', () => {
        const built = buildOperation(schema, { kind: 'query', fieldName: 'user', depth: 2 })

        expect(built.query).toContain('address {')
        expect(built.query).toContain('city')
    })

    it('обрывает циклическую связь User → friends → User', () => {
        const built = buildOperation(schema, { kind: 'query', fieldName: 'user', depth: 4 })

        // `friends` ведёт обратно в User, который уже есть в ветке, поэтому
        // поле не раскрывается и обход завершается.
        expect(built.query).not.toContain('friends')
        expect(built.query.split('\n').length).toBeLessThan(30)
    })

    it('пропускает поля с обязательными аргументами внутри выборки', () => {
        const built = buildOperation(schema, { kind: 'query', fieldName: 'user', depth: 3 })

        expect(built.query).not.toContain('posts')
    })

    it('строит скелет переменных для input-типа с обязательными полями', () => {
        const built = buildOperation(schema, { kind: 'query', fieldName: 'users', depth: 1 })

        expect(built.variables).toEqual({ filter: { role: 'ADMIN', limit: 0 } })
        expect(built.query).toContain('$filter: UserFilter!')
        // Необязательный `offset` без значения по умолчанию в запрос не попадает.
        expect(built.query).not.toContain('offset')
    })

    it('даёт мутации осмысленное имя операции', () => {
        const built = buildOperation(schema, { kind: 'mutation', fieldName: 'createUser' })

        expect(built.query.startsWith('mutation CreateUserMutation(')).toBe(true)
    })

    it('сообщает о поле, которого нет в схеме', () => {
        expect(() => buildOperation(schema, { kind: 'query', fieldName: 'missing' })).toThrow(
            /отсутствует в типе Query/,
        )
    })
})

describe('buildSelectionSetForType', () => {
    it('возвращает набор скалярных полей типа', () => {
        const selection = buildSelectionSetForType(schema, 'Address', 1)

        expect(selection).toContain('city')
        expect(selection).toContain('street')
    })

    it('для скалярного типа возвращает пустую строку', () => {
        expect(buildSelectionSetForType(schema, 'DateTime', 2)).toBe('')
    })
})
