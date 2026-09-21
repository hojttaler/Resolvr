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
        const skeleton = buildVariablesSkeleton('query Q($id: ID!) { user(id: $id) { id } }', undefined)

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
        ;(option?.apply as (view: EditorView, completion: unknown, from: number, to: number) => void)(
            view,
            option,
            result?.from ?? cursor,
            cursor,
        )

        expect(view.state.doc.toString()).toBe('{ "filter": { "role": "ADMIN" } }')
        view.destroy()
    })
})
