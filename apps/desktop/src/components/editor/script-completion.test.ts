import { CompletionContext } from '@codemirror/autocomplete'
import { javascript } from '@codemirror/lang-javascript'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { buildSchema } from 'graphql'
import { describe, expect, it } from 'vitest'

import { createScriptCompletion } from './script-completion.js'
import { buildScriptContext, type IScriptContextInput } from './script-context.js'

const schema = buildSchema(`
    input Contact { email: String, phone: String }
    input SearchInput { contacts: [Contact!]! }
    type Profile { id: ID!, displayName: String, internalCode: String }
    type Query { profiles(filter: SearchInput): [Profile!]! }
`)

const input: IScriptContextInput = {
    schema,
    operationName: 'Find',
    query: `
        query Ignored { profiles { internalCode } }
        query Find($filter: SearchInput!) {
            people: profiles(filter: $filter) { ...Summary }
            people: profiles(filter: $filter) { userId: id }
        }
        fragment Summary on Profile { ... on Profile { name: displayName } }
    `,
    variables: { custom: { 'started-at': '2026-01-01' } },
    requestHeaders: ['X-Custom-Request', 'Accept'],
    inheritedHeaders: ['accept', 'X-Workspace-Header'],
    responseHeaders: ['x-custom-response'],
}

function fixture(text: string, phase: 'preRequest' | 'postRequest', override: Partial<IScriptContextInput> = {}) {
    const pos = text.includes('|') ? text.indexOf('|') : text.length
    const state = EditorState.create({
        doc: text.replace('|', ''),
        selection: { anchor: pos },
        extensions: [javascript()],
    })
    const source = createScriptCompletion(buildScriptContext({ ...input, ...override }), phase)

    return { state, pos, result: source(new CompletionContext(state, pos, true)) }
}

async function labels(text: string, phase: 'preRequest' | 'postRequest', override?: Partial<IScriptContextInput>) {
    return (await fixture(text, phase, override).result)?.options.map((option) => option.label)
}

describe('автодополнение скриптов', () => {
    it('предлагает переменные, вложенные input-типы и заполненные ключи JSON', async () => {
        expect(await labels('request.variables.', 'preRequest')).toEqual(['filter', 'custom'])
        expect(await labels('request.variables.filter.contacts[0].', 'preRequest')).toEqual(['email', 'phone'])
        expect(await labels('request.variables.custom.', 'preRequest')).toEqual(['started-at'])
        expect(await labels('request.variables.', 'preRequest', { query: 'query {' })).toEqual(['custom'])
        expect(await labels('request.', 'postRequest')).toBeUndefined()
    })

    it('показывает алиасы и объединяет поля выбора из фрагментов, списков и повторов', async () => {
        expect(await labels('response.data.', 'postRequest')).toEqual(['people'])
        expect(await labels('response.data.people?.[index]?.', 'postRequest'))
            .toEqual(expect.arrayContaining(['name', 'userId']))
        expect(await labels('response.data.people[0].', 'postRequest')).not.toContain('internalCode')
        expect(await labels('response.data.people[0].', 'postRequest', { schema: undefined })).toContain('name')
        expect(await labels('response.errors[0].', 'postRequest')).toContain('message')
        expect(await labels('response.', 'preRequest')).toBeUndefined()
        expect(await labels('// response.data.', 'postRequest')).toBeUndefined()
        expect(await labels('"response.data."', 'postRequest')).toBeUndefined()
    })

    it('различает заголовки текущего запроса, унаследованные и полученные от сервера', async () => {
        const request = await fixture('request.headers.', 'preRequest').result
        expect(request?.options).toEqual(expect.arrayContaining([
            expect.objectContaining({ label: 'Accept', detail: expect.stringMatching(/Request header|Заголовок запроса/) }),
            expect.objectContaining({ label: 'X-Workspace-Header', detail: expect.stringMatching(/Inherited|Унаследованный/) }),
        ]))
        expect(request?.options.map((option) => option.label)).not.toContain('accept')
        expect(await labels('response.headers[', 'postRequest')).toEqual(expect.arrayContaining(['x-custom-response', 'retry-after']))
    })

    it.each([
        ['request.headers.X-Cus|', 'request.headers["X-Custom-Request"]'],
        ['request.headers.X|', 'request.headers["X-Custom-Request"]'],
        ['request.headers["X-C|"]', 'request.headers["X-Custom-Request"]'],
        ["request.headers['X-C|']", 'request.headers["X-Custom-Request"]'],
        ['request.headers[|]', 'request.headers["X-Custom-Request"]'],
        ['request.headers?.X|', 'request.headers?.["X-Custom-Request"]'],
    ])('подставляет валидный доступ к заголовку из %s', async (text, expected) => {
        const { result, state, pos } = fixture(text, 'preRequest')
        const completion = await result
        const option = completion?.options.find((item) => item.label === 'X-Custom-Request')
        const apply = option?.apply
        if (!completion || !option || typeof apply !== 'function') throw new Error('Нет автодополнения заголовка')
        const view = new EditorView({ state })
        try {
            apply(view, option, completion.from, pos)
            expect(view.state.doc.toString()).toBe(expected)
        } finally {
            view.destroy()
        }
    })
})
