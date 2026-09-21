import { buildSchema } from 'graphql'
import { describe, expect, it } from 'vitest'

import {
    buildSchemaSummary,
    listRootFields,
    printTypeLimited,
    searchSchema,
} from './schema-summary.js'

/** Схема с большим числом корневых полей — как у реального гейтвея. */
const bigSchema = buildSchema(`
    type User {
        id: ID!
        email: String!
        accessToken: String
    }

    input SignInInput {
        email: String!
        password: String!
    }

    type Query {
        ${Array.from({ length: 120 }, (_, index) => `item${index}(id: ID!): User`).join('\n')}
    }

    type Mutation {
        signIn(input: SignInInput!): User!
        refreshAccessToken: String!
    }
`)

describe('buildSchemaSummary', () => {
    it('отдаёт счётчики и образцы вместо полного перечня', () => {
        // Полный список корневых операций у крупной схемы сам по себе занимает
        // тысячи токенов, поэтому в сводке его быть не должно.
        const summary = buildSchemaSummary(bigSchema)

        expect(summary.queryCount).toBe(120)
        expect(summary.mutationCount).toBe(2)
        expect(summary.sampleQueries).toHaveLength(15)
        expect(JSON.stringify(summary).length).toBeLessThan(1500)
    })
})

describe('searchSchema', () => {
    it('находит поля по подстроке с указанием владельца', () => {
        const hits = searchSchema(bigSchema, 'accessToken')

        expect(hits.map((hit) => hit.path)).toEqual([
            'User.accessToken',
            'Mutation.refreshAccessToken',
        ])
    })

    it('находит типы по имени', () => {
        const hits = searchSchema(bigSchema, 'SignInInput')

        expect(hits[0]).toMatchObject({ kind: 'type', path: 'SignInInput' })
    })

    it('ограничивает выдачу, чтобы ответ не разрастался', () => {
        const hits = searchSchema(bigSchema, 'item', 10)

        expect(hits).toHaveLength(10)
    })
})

describe('listRootFields', () => {
    it('отдаёт раздел постранично', () => {
        const page = listRootFields(bigSchema, 'queries', 20, 30)

        expect(page.total).toBe(120)
        expect(page.fields).toHaveLength(30)
        expect(page.fields[0]?.name).toBe('item20')
    })
})

describe('printTypeLimited', () => {
    it('печатает небольшой тип целиком', () => {
        const printed = printTypeLimited(bigSchema, 'SignInInput')

        expect(printed?.truncated).toBe(false)
        expect(printed?.sdl).toContain('password')
    })

    it('обрезает длинный тип, сообщая о числе оставшихся полей', () => {
        const printed = printTypeLimited(bigSchema, 'Query', 20)

        expect(printed?.truncated).toBe(true)
        expect(printed?.totalFields).toBe(120)
        expect(printed?.sdl).toContain('и ещё 100 полей')
    })

    it('возвращает undefined для неизвестного типа', () => {
        expect(printTypeLimited(bigSchema, 'Missing')).toBeUndefined()
    })
})
