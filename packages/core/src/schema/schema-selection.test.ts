import { buildSchema, parse, validate } from 'graphql'
import { describe, expect, it } from 'vitest'

import {
    addSchemaFields,
    addSchemaSelection,
    findSchemaFieldTarget,
    schemaFieldChoices,
    schemaOperations,
    schemaSelectionTargets,
} from './schema-selection.js'

const schema = buildSchema(`
    type User { id: ID!, name: String, friends(page: Int!): [User!]! }
    type Team { id: ID! }
    union SearchResult = User | Team
    type Query { user(id: ID!): User, current: User, search: [SearchResult!]!, ping: String }
    type Subscription { notifications: User, messages: User }
`)

describe('добавление полей из схемы', () => {
    it('выбирает нужную операцию и сохраняет комментарии, фрагменты и существующие аргументы', () => {
        const query = `query First { ping }
# comment stays
query Second($page: Int!) {
  alias: current {
    id # before a new field
    friends(page: $page) { ...UserName }
  }
}
fragment UserName on User { name }
`
        const result = addSchemaSelection(schema, {
            query,
            kind: 'query',
            operationIndex: 1,
            path: ['current'],
            field: 'name',
        })

        expect(result.variables).toEqual({})
        expect(result.query).toContain('query First { ping }\n# comment stays')
        expect(result.query).toContain('id # before a new field')
        expect(result.query).toContain('fragment UserName on User { name }')
        expect(result.query).toMatch(/friends\(page: \$page\) \{ \.\.\.UserName \}\s+name/)
        expect(validate(schema, parse(result.query))).toEqual([])
    })

    it('создаёт недостающую ветку и не перезаписывает переменные документа и JSON', () => {
        const result = addSchemaSelection(schema, {
            query: 'query Existing($id: ID!) { alias: user(id: $id) { id } }\nquery Another { ping }',
            kind: 'query',
            path: ['current', 'friends'],
            field: 'name',
            reservedVariables: ['page'],
        })
        expect(result.variables).toEqual({ page2: 0 })
        expect(result.query).toContain('$id: ID!, $page2: Int!')
        expect(result.query).toContain('friends(page: $page2)')
        expect(validate(schema, parse(result.query))).toEqual([])
    })

    it('добавляет выборку union через inline fragment к новому запросу', () => {
        const result = addSchemaSelection(schema, {
            query: '',
            kind: 'query',
            path: ['search', '... on User'],
            field: 'name',
        })

        expect(result.query).toContain('... on User')
        expect(result.query).toContain('name')
        expect(validate(schema, parse(result.query))).toEqual([])
    })

    it('показывает два алиаса одного типа и добавляет поле только в выбранный', () => {
        const query = 'query Aliases { left: current { id } right: current { id } }'
        const [operation] = schemaOperations(query)
        if (!operation) throw new Error('Missing operation fixture')
        const targets = schemaSelectionTargets(schema, operation, 'User')
        expect(targets.map((target) => target.label)).toEqual(['Aliases › left', 'Aliases › right'])
        const result = addSchemaSelection(schema, {
            query,
            kind: 'query',
            field: 'name',
            target: targets[1],
        })

        expect(result.query).toMatch(/left: current \{ id \} right: current \{ id\s+name/)
        expect(validate(schema, parse(result.query))).toEqual([])
    })

    it('добавляет объявление обязательного аргумента в короткую форму запроса', () => {
        const query = '{ ping }'
        const result = addSchemaSelection(schema, { query, kind: 'query', field: 'user' })

        expect(result.query).toMatch(/^query \(\$id: ID!\) \{/)
        expect(result.variables).toEqual({ id: '' })
        expect(validate(schema, parse(result.query))).toEqual([])
    })

    it('выделяет служебное поле в новой ветке, включая сдвиг выбранного алиаса', () => {
        const query = '{ left: current { id } right: current { id } }'
        const [operation] = schemaOperations(query)
        if (!operation) throw new Error('Missing operation fixture')
        const result = addSchemaSelection(schema, {
            query,
            kind: 'query',
            field: 'friends',
            target: schemaSelectionTargets(schema, operation, 'User')[1],
        })

        const placeholder = result.query.indexOf('__typename')
        expect(result.query).toMatch(/left: current \{ id \} right: current \{ id\s+friends/)
        expect(result.completion).toEqual({
            anchor: placeholder + '__typename'.length,
            head: placeholder,
        })
        expect(validate(schema, parse(result.query))).toEqual([])
    })

    it('открывает подсказку в выбранной ветке и сохраняет заданный пользователем __typename', () => {
        const query = '{ current { __typename } }'
        const result = addSchemaSelection(schema, { query, kind: 'query', field: 'current' })
        const head = query.indexOf('}')

        expect(result.query).toBe(query)
        expect(result.completion).toEqual({ anchor: head, head })
    })

    it('вставляет поля по соседству с существующими без пустых строк', () => {
        const query = 'query {\n  current {\n    id\n  }\n}\n'
        const nested = addSchemaSelection(schema, {
            query,
            kind: 'query',
            path: ['current'],
            field: 'name',
        })
        const root = addSchemaSelection(schema, {
            query: nested.query,
            kind: 'query',
            field: 'ping',
        })

        expect(root.query).toBe('query {\n  current {\n    id\n    name\n  }\n  ping\n}\n')
        expect(validate(schema, parse(root.query))).toEqual([])
    })

    it('сохраняет однострочную выборку', () => {
        const result = addSchemaSelection(schema, {
            query: 'query { current { id } }',
            kind: 'query',
            path: ['current'],
            field: 'name',
        })

        expect(result.query).toBe('query { current { id name } }')
        expect(validate(schema, parse(result.query))).toEqual([])
    })

    it('сохраняет CRLF, табы и комментарий при добавлении вложенной ветки', () => {
        const query = 'query {\r\n\tping # before user\r\n\r\n}'
        const result = addSchemaSelection(schema, { query, kind: 'query', field: 'user' })

        expect(result.query).toBe(
            'query($id: ID!) {\r\n\tping # before user\r\n\tuser(id: $id) {\r\n\t\t__typename\r\n\t}\r\n\r\n}',
        )
        expect(validate(schema, parse(result.query))).toEqual([])
    })

    it('готовит позицию и отступ для подсказки в многострочной ветке', () => {
        const query = 'query {\n  current {\n    id\n  }\n}'
        const head = query.indexOf('  }')
        const result = addSchemaSelection(schema, { query, kind: 'query', field: 'current' })

        expect(result.query).toBe(query)
        expect(result.completion).toEqual({
            anchor: head,
            head,
            insertion: { prefix: '    ', suffix: '\n' },
        })
    })

    it('не редактирует незавершённый текст и не добавляет второе корневое поле подписки', () => {
        expect(() =>
            addSchemaSelection(schema, { query: 'query {', kind: 'query', field: 'ping' }),
        ).toThrow()
        expect(() =>
            addSchemaSelection(schema, {
                query: 'subscription { messages { id } }',
                kind: 'subscription',
                field: 'notifications',
            }),
        ).toThrow()
    })
})

describe('вставка нескольких полей с заданной глубиной', () => {
    it('отмечает существующие поля по имени из схемы, включая алиасы', () => {
        const query = '{ current { userId: id } }'
        const target = findSchemaFieldTarget(schema, query, query.indexOf('userId'))
        if (!target) throw new Error('Missing field target')

        const choices = schemaFieldChoices(schema, target)
        expect(choices.find((choice) => choice.name === 'id')?.selected).toBe(true)
        expect(choices.find((choice) => choice.name === 'name')?.selected).toBe(false)
    })

    it('дополняет только выбранный алиас и объявляет переменные в нужной операции', () => {
        const query = `query First { ping }
query Second($page: Int!) {
  left: current { id }
  right: current {
    friends(page: $page) { id }
    id # keep
  }
}
`
        const target = findSchemaFieldTarget(schema, query, query.indexOf('right:'))
        if (!target) throw new Error('Missing field target')
        const result = addSchemaFields(schema, target, ['name', 'friends'], 2)

        expect(result.query).toBe(
            query
                .replace(
                    '{ id }\n    id # keep',
                    '{ id name friends(page: $page2) { __typename } }\n    id # keep\n    name',
                )
                .replace('$page: Int!)', '$page: Int!, $page2: Int!)'),
        )
        expect(result.variables).toEqual({ page2: 0 })
        expect(validate(schema, parse(result.query))).toEqual([])
    })

    it('ограничивает глубину и сохраняет компактность однострочной выборки', () => {
        const query = '{ ping }'
        const target = findSchemaFieldTarget(schema, query, 0)
        if (!target) throw new Error('Missing query target')
        const shallow = addSchemaFields(schema, target, ['current'], 1)
        const deep = addSchemaFields(schema, target, ['current'], 2)

        expect(shallow.query).toBe('{ ping current { __typename } }')
        expect(deep.query).toBe(
            'query ($page: Int!) { ping current { id name friends(page: $page) { __typename } } }',
        )
        expect(validate(schema, parse(deep.query))).toEqual([])
    })

    it('добавляет типизированные фрагменты union в пустом документе', () => {
        const target = findSchemaFieldTarget(schema, '', 0)
        if (!target) throw new Error('Missing query target')
        const result = addSchemaFields(schema, target, ['search'], 2)

        expect(result.query).toContain('... on User {')
        expect(result.query).toContain('... on Team {')
        expect(validate(schema, parse(result.query))).toEqual([])
    })

    it('ограничивает массовую вставку в корень подписки одной веткой', () => {
        const query = 'subscription { messages { id } }'
        const target = findSchemaFieldTarget(schema, query, 0)
        if (!target) throw new Error('Missing subscription target')
        const result = addSchemaFields(schema, target, ['messages', 'notifications'], 2)

        expect(schemaFieldChoices(schema, target).map((field) => field.name)).toEqual(['messages'])
        expect(result.query).not.toContain('notifications')
        expect(validate(schema, parse(result.query))).toEqual([])
    })
})
