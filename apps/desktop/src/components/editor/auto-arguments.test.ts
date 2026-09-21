import { json } from '@codemirror/lang-json'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { buildSchema } from 'graphql'
import { graphql } from 'cm6-graphql'
import { describe, expect, it, vi } from 'vitest'

import { autoArguments } from './auto-arguments.js'

const schema = buildSchema(`
    enum Device {
        EMAIL
        SMS
    }

    input ProductFilter {
        service: String!
        identity: String!
        device: Device!
    }

    type ProductsResult {
        sessionId: ID!
        timeout: Int!
    }

    type User {
        id: ID!
        email: String!
    }

    type Query {
        products(input: ProductFilter!): ProductsResult!
        user(id: ID!): User
        me: User
        search(term: String, limit: Int = 10): [User!]!
    }
`)

interface IHarness {
    view: EditorView
    onVariablesAdded: ReturnType<typeof vi.fn>
}

/**
 * Редактор с подключённой автоподстановкой.
 *
 * Расширение реагирует на завершение автодополнения, поэтому вставка имени поля
 * имитируется транзакцией с тем же `userEvent`, что порождает CodeMirror.
 */
function createHarness(doc: string): IHarness {
    const onVariablesAdded = vi.fn()
    const view = new EditorView({
        state: EditorState.create({
            doc,
            extensions: [
                graphql(schema),
                json(),
                autoArguments({ getSchema: () => schema, onVariablesAdded }),
            ],
        }),
    })

    return { view, onVariablesAdded }
}

/** Имитирует принятие подсказки: вставку имени поля в указанную позицию. */
async function completeField(harness: IHarness, at: number, field: string): Promise<void> {
    harness.view.dispatch({
        changes: { from: at, insert: field },
        selection: { anchor: at + field.length },
        userEvent: 'input.complete',
    })

    // Изменения откладываются на микротакт, чтобы не править документ во время
    // применения транзакции.
    await Promise.resolve()
    await Promise.resolve()
}

describe('autoArguments', () => {
    it('подставляет обязательный аргумент и объявляет переменную', async () => {
        const doc = 'query Products {\n  \n}\n'
        const harness = createHarness(doc)

        await completeField(harness, doc.indexOf('\n  \n') + 3, 'products')

        expect(harness.view.state.doc.toString()).toContain(
            'query Products($input: ProductFilter!)',
        )
        expect(harness.view.state.doc.toString()).toContain('products(input: $input)')
        harness.view.destroy()
    })

    it('отдаёт скелет значений для новых переменных', async () => {
        const doc = 'query Products {\n  \n}\n'
        const harness = createHarness(doc)

        await completeField(harness, doc.indexOf('\n  \n') + 3, 'products')

        expect(harness.onVariablesAdded).toHaveBeenCalledWith({
            input: { service: '', identity: '', device: 'EMAIL' },
        })
        harness.view.destroy()
    })

    it('дописывает переменную к уже существующему списку', async () => {
        const doc = 'query Mixed($id: ID!) {\n  user(id: $id) {\n    id\n  }\n  \n}\n'
        const harness = createHarness(doc)

        await completeField(harness, doc.lastIndexOf('\n  \n') + 3, 'products')

        expect(harness.view.state.doc.toString()).toContain(
            'query Mixed($id: ID!, $input: ProductFilter!)',
        )
        harness.view.destroy()
    })

    it('превращает анонимную операцию в именованную форму с переменными', async () => {
        const doc = '{\n  \n}\n'
        const harness = createHarness(doc)

        await completeField(harness, doc.indexOf('\n  \n') + 3, 'products')

        expect(harness.view.state.doc.toString()).toContain('query ($input: ProductFilter!) {')
        harness.view.destroy()
    })

    it('не трогает поля без обязательных аргументов', async () => {
        const doc = 'query Me {\n  \n}\n'
        const harness = createHarness(doc)

        await completeField(harness, doc.indexOf('\n  \n') + 3, 'me')

        expect(harness.view.state.doc.toString()).toBe('query Me {\n  me\n}\n')
        expect(harness.onVariablesAdded).not.toHaveBeenCalled()
        harness.view.destroy()
    })

    it('пропускает необязательные аргументы и аргументы со значением по умолчанию', async () => {
        const doc = 'query Search {\n  \n}\n'
        const harness = createHarness(doc)

        await completeField(harness, doc.indexOf('\n  \n') + 3, 'search')

        // `term` необязателен, у `limit` есть значение по умолчанию.
        expect(harness.view.state.doc.toString()).toBe('query Search {\n  search\n}\n')
        harness.view.destroy()
    })

    it('переиспользует уже объявленную переменную с тем же именем', async () => {
        const doc = 'query Reuse($input: ProductFilter!) {\n  \n}\n'
        const harness = createHarness(doc)

        await completeField(harness, doc.indexOf('\n  \n') + 3, 'products')

        const text = harness.view.state.doc.toString()
        expect(text).toContain('products(input: $input)')
        // Повторного объявления быть не должно — документ остался бы невалидным.
        expect(text.match(/\$input: ProductFilter!/g)).toHaveLength(1)
        expect(harness.onVariablesAdded).not.toHaveBeenCalled()
        harness.view.destroy()
    })
})
