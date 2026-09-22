import { buildSchema } from 'graphql'
import { describe, expect, it } from 'vitest'

import { describeType, findTypeUsages, listTypes, searchFields } from './schema-explorer.js'

const schema = buildSchema(`
    "Пользователь системы"
    type User implements Node {
        id: ID!
        "Почта"
        email: String!
        role: Role
        posts(first: Int = 10, after: String): [Post!]!
        legacy: String @deprecated(reason: "use email")
    }
    interface Node { id: ID! }
    type Post implements Node { id: ID!, author: User! }
    enum Role { ADMIN USER }
    input UserFilter { role: Role, email: String }
    union SearchResult = User | Post
    type Query {
        me: User
        users(filter: UserFilter!): [User!]!
        search(q: String!): [SearchResult!]!
    }
    type Mutation { rename(id: ID!, name: String!): User }
`)

describe('describeType', () => {
    it('описывает объектный тип с полями, аргументами и интерфейсами', () => {
        const user = describeType(schema, 'User')

        expect(user?.kind).toBe('object')
        expect(user?.description).toBe('Пользователь системы')
        expect(user?.interfaces).toEqual(['Node'])
        expect(user?.fields.map((field) => field.name)).toEqual([
            'id', 'email', 'role', 'posts', 'legacy',
        ])

        const posts = user?.fields.find((field) => field.name === 'posts')
        expect(posts?.type).toBe('[Post!]!')
        expect(posts?.namedType).toBe('Post')
        expect(posts?.args.map((arg) => `${arg.name}=${arg.defaultValue ?? ''}`)).toEqual([
            'first=10', 'after=',
        ])
        expect(user?.fields.find((field) => field.name === 'legacy')?.deprecationReason).toBe(
            'use email',
        )
    })

    it('различает корневые типы, enum, union и interface', () => {
        expect(describeType(schema, 'Query')?.root).toBe('query')
        expect(describeType(schema, 'Mutation')?.root).toBe('mutation')
        expect(describeType(schema, 'Role')?.enumValues.map((value) => value.name)).toEqual([
            'ADMIN', 'USER',
        ])
        expect(describeType(schema, 'SearchResult')?.possibleTypes).toEqual(['User', 'Post'])
        expect(describeType(schema, 'Node')?.possibleTypes.sort()).toEqual(['Post', 'User'])
        expect(describeType(schema, 'Nope')).toBeUndefined()
    })
})

describe('findTypeUsages', () => {
    it('находит тип как поле, аргумент и поле input-типа', () => {
        const usages = findTypeUsages(schema, 'Role')

        expect(usages).toEqual(
            expect.arrayContaining([
                { typeName: 'User', fieldName: 'role', role: 'field' },
                { typeName: 'UserFilter', fieldName: 'role', role: 'input-field' },
            ]),
        )

        const filter = findTypeUsages(schema, 'UserFilter')
        expect(filter).toEqual([
            { typeName: 'Query', fieldName: 'users', role: 'argument', argumentName: 'filter' },
        ])
    })
})

describe('списки и поиск', () => {
    it('перечисляет типы без служебных и фильтрует по имени', () => {
        const names = listTypes(schema).map((entry) => entry.name)
        expect(names).not.toContain('__Schema')
        expect(names).toContain('User')

        expect(listTypes(schema, 'post').map((entry) => entry.name)).toEqual(['Post'])
        expect(listTypes(schema).find((entry) => entry.name === 'Role')?.fieldCount).toBe(2)
    })

    it('ищет поля по всем типам', () => {
        const hits = searchFields(schema, 'mail')

        expect(hits.map((hit) => `${hit.typeName}.${hit.fieldName}`)).toEqual([
            'User.email', 'UserFilter.email',
        ])
        expect(searchFields(schema, '')).toEqual([])
    })
})
