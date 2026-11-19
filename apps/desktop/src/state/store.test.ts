import { TabStateSchema, WorkspaceSchema } from '@resolvr/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getAppContext } from '../platform/context.js'
import { useAppStore } from './store.js'

vi.mock('../platform/context.js', () => ({ getAppContext: vi.fn() }))

const workspace = WorkspaceSchema.parse({
    id: 'test',
    name: 'Test',
    protection: 'confirm',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    endpoints: [{ id: 'main', name: 'Main', url: 'https://example.invalid/graphql' }],
})
const mutation = TabStateSchema.parse({
    id: 'mutation-tab',
    kind: 'operation',
    title: 'Mutation',
    workspaceId: workspace.id,
    operationRef: 'writes/change',
    dirty: true,
})
const content = { query: 'mutation Change { change }', variables: '{}', headers: {} }

beforeEach(() => {
    useAppStore.setState(useAppStore.getInitialState(), true)
    vi.mocked(getAppContext).mockReset()
    useAppStore.setState({
        workspace,
        tabs: [mutation],
        activeTabId: mutation.id,
        contents: { [mutation.id]: content },
    })
})

describe('операции рабочего пространства', () => {
    it('подтверждение мутации относится к тексту, который был показан при запросе подтверждения', async () => {
        await useAppStore.getState().runActiveTab()

        const confirm = useAppStore.getState().confirm
        expect(confirm).toBeDefined()
        useAppStore.getState().updateQuery(mutation.id, 'mutation Other { other }')
        await confirm?.run()

        expect(getAppContext).not.toHaveBeenCalled()
    })

    it('сохранение операции с невалидными переменными не затрагивает файл', async () => {
        useAppStore.getState().updateVariables(mutation.id, '{')
        await expect(useAppStore.getState().saveActiveTab('writes', 'change')).rejects.toThrow()

        expect(getAppContext).not.toHaveBeenCalled()
        expect(useAppStore.getState().tabs[0]?.dirty).toBe(true)
        expect(useAppStore.getState().contents[mutation.id]?.variables).toBe('{')
    })

    it('запоздавшая загрузка коллекций не применяет данные другого workspace', async () => {
        type Context = Awaited<ReturnType<typeof getAppContext>>
        type Collections = Awaited<ReturnType<Context['workspaces']['listCollections']>>
        let release!: (collections: Collections) => void
        const OldCollections = new Promise<Collections>((resolve) => {
            release = resolve
        })
        const listCollections = vi.fn(() => OldCollections)
        const listOperations = vi.fn(async () => [])
        vi.mocked(getAppContext).mockResolvedValue({
            workspaces: { listCollections, listOperations, listFlows: async () => [] },
            flowState: { read: async () => ({}) },
        } as unknown as Context)

        const pending = useAppStore.getState().reloadTree()
        await Promise.resolve()
        expect(listCollections).toHaveBeenCalledWith(workspace.id)
        useAppStore.setState({ workspace: { ...workspace, id: 'second' } })
        release([{ id: 'old', name: 'Old', description: '', order: [], headers: {} }])
        await pending

        expect(useAppStore.getState().tree).toEqual([])
    })
})

describe('схема закрытого эндпоинта', () => {
    it('повторяет интроспекцию после успешного получения токена', async () => {
        type Context = Awaited<ReturnType<typeof getAppContext>>
        const secured = WorkspaceSchema.parse({
            ...workspace,
            defaultEnvironmentId: 'secured',
            environments: [
                {
                    id: 'secured',
                    name: 'Secured',
                    recovery: { flowId: 'sign-in' },
                },
            ],
        })
        vi.mocked(getAppContext).mockResolvedValue({
            workspaces: { getWorkspace: async () => secured },
            tokens: { attach: async () => secured },
        } as unknown as Context)
        const refreshSchema = vi.fn(async () => {})
        const runFlow = vi.fn(async () => {
            useAppStore.setState({
                flowRun: { flowId: 'sign-in', ok: true, durationMs: 10, steps: [], context: {} },
            })
        })
        useAppStore.setState({
            workspace: secured,
            runFlow,
            refreshSchema,
            schemaError: 'Unauthorized',
        })

        await useAppStore.getState().refreshToken()

        expect(runFlow).toHaveBeenCalledWith('sign-in', { confirmed: true })
        expect(refreshSchema).toHaveBeenCalledOnce()
        expect(useAppStore.getState().tokenRefreshing).toBe(false)
    })
})
