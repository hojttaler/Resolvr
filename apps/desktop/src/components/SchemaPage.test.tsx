import { buildSchema } from 'graphql'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useAppStore } from '../state/store.js'
import { SchemaPage } from './SchemaPage.js'

const schema = buildSchema(`
    type Big { a1: Int a2: Int a3: Int a4: Int a5: Int a6: Int a7: Int a8: Int a9: Int }
    input Small { x: Int y: Int }
    type Query { big: Big }
`)

function seed(typeName: string): void {
    useAppStore.setState({
        schema,
        tabs: [
            {
                id: 't-schema',
                kind: 'schema',
                workspaceId: 'ws',
                schemaType: typeName,
                title: typeName,
                dirty: false,
                pinned: false,
                queryCursor: { anchor: 0, head: 0, scrollTop: 0 },
                variablesCursor: { anchor: 0, head: 0, scrollTop: 0 },
                bottomTab: 'variables',
                responseTab: 'response',
            },
        ],
        activeTabId: 't-schema',
        schemaNav: { 't-schema': { history: [typeName], index: 0 } },
    })
}

describe('SchemaPage', () => {
    it('фильтр полей не переносится на следующий тип', () => {
        // Регрессия: фильтр, набранный на типе с длинным списком, оставался
        // в состоянии и прятал все поля типа, у которого поля фильтра нет.
        seed('Big')
        const { rerender } = render(<SchemaPage tabId="t-schema" />)

        fireEvent.change(screen.getByPlaceholderText('Фильтр полей…'), { target: { value: 'a9' } })
        expect(screen.getByText('a9')).toBeTruthy()
        expect(screen.queryByText('a1')).toBeNull()

        useAppStore.getState().navigateSchema('t-schema', 'Small')
        rerender(<SchemaPage tabId="t-schema" />)

        expect(screen.getByText('x')).toBeTruthy()
        expect(screen.getByText('y')).toBeTruthy()
        expect(screen.queryByText('Ничего не найдено')).toBeNull()
    })
})
