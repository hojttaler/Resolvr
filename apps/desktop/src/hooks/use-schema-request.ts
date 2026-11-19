import {
    addSchemaSelection,
    schemaOperations,
    schemaSelectionBranch,
    type IOperationKind,
    type ISchemaSelectionTarget,
} from '@resolvr/core'
import type { GraphQLSchema, OperationDefinitionNode } from 'graphql'
import { useDeferredValue, useMemo, useState } from 'react'

import { useT } from '../i18n/index.js'
import { parseVariables, useAppStore } from '../state/store.js'

interface IInsertSchemaField {
    kind: IOperationKind
    field: string
    path?: readonly string[]
    target?: ISchemaSelectionTarget
}

export interface ISchemaRequest {
    title: string | undefined
    operations: OperationDefinitionNode[]
    operation: OperationDefinitionNode | undefined
    operationIndex: number
    selectOperation: (index: number) => void
    invalid: boolean
    message: string | undefined
    insert: (input: IInsertSchemaField) => Promise<void>
}

/** Подключает панель схемы к активному или последнему открытому запросу. */
export function useSchemaRequest(schema: GraphQLSchema | undefined): ISchemaRequest {
    const tab = useAppStore((state) => {
        const active = state.tabs.find((item) => item.id === state.activeTabId)
        if (active?.kind === 'operation') return active

        return (
            state.tabs.find(
                (item) => item.id === state.schemaRequestTabId && item.kind === 'operation',
            ) ?? state.tabs.findLast((item) => item.kind === 'operation')
        )
    })
    const query = useAppStore((state) => (tab ? (state.contents[tab.id]?.query ?? '') : ''))
    const deferredQuery = useDeferredValue(query)
    const [selection, setSelection] = useState<{ tabId?: string; index: number }>({ index: 0 })
    const [message, setMessage] = useState<string>()
    const t = useT()
    const parsed = useMemo(() => readOperations(deferredQuery), [deferredQuery])
    const operationIndex =
        selection.tabId === tab?.id && selection.index < parsed.operations.length
            ? selection.index
            : 0

    return {
        title: tab?.title,
        operations: parsed.operations,
        operation: parsed.operations[operationIndex],
        operationIndex,
        selectOperation: (index) => setSelection({ tabId: tab?.id, index }),
        invalid: parsed.invalid,
        message,
        insert: async (input) => {
            if (!schema) return
            const store = useAppStore.getState()
            const content =
                tab && store.tabs.some((item) => item.id === tab.id)
                    ? store.contents[tab.id]
                    : undefined
            const source = content?.query ?? ''
            if (input.target && source !== deferredQuery) {
                setMessage(t('The request changed. Choose the field again.'))

                return
            }

            try {
                const current = source === deferredQuery ? parsed : readOperations(source)
                const operation = current.operations[operationIndex]
                const rootField = input.path?.[0] ?? input.field
                const needsDraft =
                    source.trim() &&
                    !input.target &&
                    (operation?.operation !== input.kind ||
                        (input.kind === 'subscription' &&
                            !schemaSelectionBranch(operation.selectionSet, rootField)))
                const useTab = tab && content && !needsDraft
                const previous = parseVariables(useTab ? content.variables : '')
                const result = addSchemaSelection(schema, {
                    ...input,
                    query: useTab ? source : '',
                    operationIndex: useTab ? operationIndex : 0,
                    reservedVariables: previous instanceof Error ? [] : Object.keys(previous),
                })
                const additional = Object.keys(result.variables).length > 0
                if (additional && previous instanceof Error) {
                    setMessage(t('Fix the variables JSON to add fields with required arguments'))

                    return
                }

                if (useTab) {
                    if (result.query !== source) store.updateQuery(tab.id, result.query)
                    if (additional) {
                        store.updateVariables(
                            tab.id,
                            JSON.stringify({ ...previous, ...result.variables }, null, 2),
                        )
                    }
                    store.activateTab(tab.id)
                    useAppStore.setState({
                        schemaCompletion: result.completion && { tabId: tab.id, ...result.completion },
                    })
                } else {
                    await store.openTab({
                        title: rootField,
                        query: result.query,
                        variables: result.variables,
                        dirty: true,
                        schemaCompletion: result.completion,
                    })
                }
                setMessage(undefined)
            } catch {
                setMessage(t('Cannot add this field to the selected operation'))
            }
        },
    }
}

function readOperations(query: string): { operations: OperationDefinitionNode[]; invalid: boolean } {
    try {
        const operations = schemaOperations(query)

        return { operations, invalid: query.trim().length > 0 && operations.length === 0 }
    } catch {
        return { operations: [], invalid: true }
    }
}
