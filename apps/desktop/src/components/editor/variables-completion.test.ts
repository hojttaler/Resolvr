import { CompletionContext } from '@codemirror/autocomplete'
import { json } from '@codemirror/lang-json'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { buildSchema } from 'graphql'
import { describe, expect, it } from 'vitest'

import {
    buildVariablesSkeleton,
    collectQueryVariables,
    createVariablesCompletion,
    findInputObjectFields,
    insertInputFields,
} from './variables-completion.js'

const schema = buildSchema(`
    enum Role {
        ADMIN
        USER
    }

    input UserFilter {
        role: Role!
        limit: Int!
        search: String
    }

    type User {
        id: ID!
    }

    type Query {
        user(id: ID!): User
        users(filter: UserFilter!): [User!]!
    }
`)

describe('collectQueryVariables', () => {
    it('находит переменные операции с их типами', () => {
        const variables = collectQueryVariables(
            'query GetUser($id: ID!, $verbose: Boolean) { user(id: $id) { id } }',
        )

        expect(variables).toEqual([
            { name: 'id', typeName: 'ID!', required: true },
            { name: 'verbose', typeName: 'Boolean', required: false },
        ])
    })

    it('на незавершённом черновике ничего не предлагает вместо падения', () => {
        expect(collectQueryVariables('query GetUser($id: ID!) { user(')).toEqual([])
    })
})

describe('buildVariablesSkeleton', () => {
    it('заполняет переменные значениями по типу из схемы', () => {
        const skeleton = buildVariablesSkeleton(
            'query Users($filter: UserFilter!) { users(filter: $filter) { id } }',
            schema,
        )

        // Обязательные поля input-типа раскрыты, необязательный `search` — нет.
        expect(skeleton).toEqual({ filter: { role: 'ADMIN', limit: 0 } })
    })

    it('не затирает уже введённые значения', () => {
        const skeleton = buildVariablesSkeleton(
            'query GetUser($id: ID!, $verbose: Boolean) { user(id: $id) { id } }',
            schema,
            { id: 'u1' },
        )

        expect(skeleton.id).toBe('u1')
        expect(skeleton.verbose).toBe(false)
    })

    it('без схемы оставляет переменные пустыми, но не теряет их', () => {
        const skeleton = buildVariablesSkeleton(
            'query Q($id: ID!) { user(id: $id) { id } }',
            undefined,
        )

        expect(skeleton).toEqual({ id: null })
    })
})

describe('createVariablesCompletion', () => {
    const query =
        'query Users($filter: UserFilter!, $verbose: Boolean) { users(filter: $filter) { id } }'

    function complete(doc: string, cursor = doc.length) {
        const state = EditorState.create({ doc, extensions: [json()] })
        const source = createVariablesCompletion(
            () => query,
            () => schema,
        )

        return source(new CompletionContext(state, cursor, true))
    }

    it('в позиции имени предлагает переменные операции', () => {
        const result = complete('{ "')

        expect(result?.options.map((option) => option.label)).toEqual(['"filter"', '"verbose"'])
    })

    it('внутри объекта предлагает поля input-типа', () => {
        const result = complete('{ "filter": { "')

        expect(result?.options.map((option) => option.label)).toEqual([
            '"role"',
            '"limit"',
            '"search"',
        ])
    })

    it('в позиции значения enum-поля предлагает варианты enum', () => {
        const result = complete('{ "filter": { "role": "')

        expect(result?.options.map((option) => option.label)).toEqual(['"ADMIN"', '"USER"'])
        expect(result?.options[0]?.detail).toBe('Role')
    })

    it('для булевой переменной предлагает true и false', () => {
        const result = complete('{ "verbose": ')

        expect(result?.options.map((option) => option.label)).toEqual(['true', 'false'])
    })

    it('вставка значения не оставляет висячую кавычку от автозакрытия', () => {
        // Редактор сам дописывает закрывающую кавычку, курсор оказывается между
        // ними — раньше подсказка вставлялась перед ней и в поле оставалась
        // лишняя кавычка.
        const doc = '{ "filter": { "role": "" } }'
        const cursor = doc.indexOf('""') + 1
        const view = new EditorView({
            state: EditorState.create({ doc, extensions: [json()] }),
        })

        const source = createVariablesCompletion(
            () => query,
            () => schema,
        )
        const result = source(new CompletionContext(view.state, cursor, true))
        const option = result?.options[0]

        expect(typeof option?.apply).toBe('function')
        ;(
            option?.apply as (
                view: EditorView,
                completion: unknown,
                from: number,
                to: number,
            ) => void
        )(view, option, result?.from ?? cursor, cursor)

        expect(view.state.doc.toString()).toBe('{ "filter": { "role": "ADMIN" } }')
        view.destroy()
    })
})

describe('вставка поля по ПКМ', () => {
    const inputSchema = buildSchema(`
        input Range { min: Int, max: Int = 100 }
        input Filter { range: Range, query: String }
        input Choice @oneOf { id: ID, email: String }
        type Query { find(filters: [Filter!], choice: Choice): Boolean }
    `)
    const query =
        'query Q($filters: [Filter!], $choice: Choice) { find(filters: $filters, choice: $choice) }'

    function editor(doc: string): EditorState {
        return EditorState.create({ doc, extensions: [json()] })
    }

    it('определяет вложенный объект выбранного элемента списка и дополняет только его', () => {
        const text = `{
    "filters": [
        { "range": { "min": 20 } },
        {
            "range": {
                "min": 3
            }
        }
    ]
}`
        const state = editor(text)
        const target = findInputObjectFields(
            state,
            text.lastIndexOf('"range"') + 2,
            query,
            inputSchema,
        )
        expect(target?.typeName).toBe('Range')
        expect(target?.fields.map((field) => field.name)).toEqual(['max'])
        const field = target?.fields[0]
        if (!target || !field) throw new Error('Missing nested schema field')

        const transaction = state.update(insertInputFields(state, target, new Set([field.name]), 4))
        expect(transaction.state.doc.toString()).toBe(
            text.replace('"min": 3', '"min": 3,\n                "max": 100'),
        )
        const { from, to } = transaction.state.selection.main
        expect(transaction.state.doc.sliceString(from, to)).toBe('100')
    })

    it('добавляет поле в пустой компактный объект под курсором', () => {
        const text = '{"filters":[{"range":{}}]}'
        const state = editor(text)
        const target = findInputObjectFields(state, text.indexOf('{}') + 1, query, inputSchema)
        const field = target?.fields.find((item) => item.name === 'min')
        if (!target || !field) throw new Error('Missing nested schema field')

        const transaction = state.update(insertInputFields(state, target, new Set([field.name]), 4))
        expect(transaction.state.doc.toString()).toBe('{"filters":[{"range":{"min": 0}}]}')
    })

    it('не предлагает вставку в корень переменных и в заполненный oneOf', () => {
        const text = '{"choice":{"id":"u1"}}'
        const state = editor(text)

        expect(findInputObjectFields(state, 0, query, inputSchema)).toBeUndefined()
        expect(
            findInputObjectFields(state, text.indexOf('"id"') + 2, query, inputSchema),
        ).toBeUndefined()
    })

    it('добавляет несколько отмеченных полей одной транзакцией', () => {
        const text = '{"filters":[{"range":{}}]}'
        const state = editor(text)
        const target = findInputObjectFields(state, text.indexOf('{}') + 1, query, inputSchema)
        if (!target) throw new Error('Missing input object')

        const transaction = state.update(insertInputFields(state, target, new Set(['max', 'min']), 4))
        expect(transaction.state.doc.toString()).toBe('{"filters":[{"range":{"min": 0, "max": 100}}]}')
    })

    it('сохраняет одно свойство при вставке в oneOf', () => {
        const text = '{"choice":{}}'
        const state = editor(text)
        const target = findInputObjectFields(state, text.indexOf('{}') + 1, query, inputSchema)
        if (!target) throw new Error('Missing oneOf input object')

        expect(target.single).toBe(true)
        const transaction = state.update(insertInputFields(state, target, new Set(['id', 'email']), 4))
        expect(transaction.state.doc.toString()).toBe('{"choice":{"id": ""}}')
    })

    it('не делает предположение при одинаковом имени переменной с разными типами', () => {
        const text = '{"value":{}}'
        const source = 'query A($value: Range) { find } query B($value: Filter) { find }'
        expect(
            findInputObjectFields(editor(text), text.indexOf('{}') + 1, source, inputSchema),
        ).toBeUndefined()
    })
})
