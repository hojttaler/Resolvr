import { FlowSchema, TabStateSchema, WorkspaceSchema } from '@resolvr/core'
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
    it('при удалении закрывает вкладки workspace и открывает следующий, а после последнего очищает экран', async () => {
        type Context = Awaited<ReturnType<typeof getAppContext>>
        const next = { ...workspace, id: 'next', endpoints: [] }
        const parked = { ...mutation, id: 'next-tab', workspaceId: next.id }
        const deleteWorkspace = vi.fn(async () => undefined)
        const deleteDraft = vi.fn(async () => undefined)
        vi.mocked(getAppContext).mockResolvedValue({
            workspaces: {
                deleteWorkspace,
                getWorkspace: async () => next,
                listCollections: async () => [],
                listFlows: async () => [],
            },
            tokens: { attach: async () => next },
            sessions: { deleteDraft },
            history: { list: async () => [] },
            flowState: { read: async () => ({}) },
        } as unknown as Context)
        useAppStore.setState({
            workspaces: [workspace, next],
            tabsByWorkspace: { [next.id]: { tabs: [parked], activeTabId: parked.id } },
            contents: { [mutation.id]: content, [parked.id]: content },
            selections: { [workspace.id]: { endpointId: 'main' } },
        })

        await useAppStore.getState().deleteWorkspace(workspace.id)

        expect(deleteWorkspace).toHaveBeenCalledWith(workspace.id)
        expect(deleteDraft).toHaveBeenCalledWith(mutation.id)
        expect(deleteDraft).not.toHaveBeenCalledWith(parked.id)
        expect(useAppStore.getState()).toMatchObject({
            workspaces: [next],
            workspace: next,
            tabs: [parked],
            activeTabId: parked.id,
        })
        expect(useAppStore.getState().contents[mutation.id]).toBeUndefined()
        expect(useAppStore.getState().tabsByWorkspace[workspace.id]).toBeUndefined()
        expect(useAppStore.getState().layouts[workspace.id]).toBeUndefined()
        expect(useAppStore.getState().selections[workspace.id]).toBeUndefined()

        await useAppStore.getState().deleteWorkspace(next.id)

        expect(useAppStore.getState()).toMatchObject({
            workspaces: [], workspace: undefined, tabs: [], activeTabId: undefined,
            tree: [], flows: [], history: [], contents: {},
        })
    })

    it('обновляет workspace и схему из файлов после смены эндпоинта по умолчанию', async () => {
        type Context = Awaited<ReturnType<typeof getAppContext>>
        const updated = WorkspaceSchema.parse({
            ...workspace,
            name: 'Updated workspace',
            defaultEndpointId: 'stage',
            endpoints: [
                ...workspace.endpoints,
                { id: 'stage', name: 'Stage API', url: 'https://stage.example.invalid/graphql' },
            ],
        })
        const getSchema = vi.fn(async () => undefined)
        vi.mocked(getAppContext).mockResolvedValue({
            workspaces: { listWorkspaces: async () => [updated] },
            tokens: { attach: async () => updated },
            schemas: { getSchema },
        } as unknown as Context)

        await useAppStore.getState().applyLibraryChanges(['workspaces\\test\\workspace.json'])

        expect(useAppStore.getState().workspace?.name).toBe('Updated workspace')
        expect(useAppStore.getState().workspaces).toEqual([updated])
        expect(getSchema).toHaveBeenCalledWith(workspace.id, 'stage')
    })

    it('сбрасывает кэши секретов и сведений о токене перед обновлением окружения', async () => {
        type Context = Awaited<ReturnType<typeof getAppContext>>
        const invalidateSecrets = vi.fn()
        const invalidateTokens = vi.fn()
        const attach = vi.fn(async () => workspace)
        vi.mocked(getAppContext).mockResolvedValue({
            workspaces: { getWorkspace: async () => workspace },
            secrets: { invalidate: invalidateSecrets },
            tokens: { attach, invalidate: invalidateTokens },
        } as unknown as Context)

        await useAppStore.getState().applyLibraryChanges(['.secrets/test.json', '.state/tokens.json'])

        expect(invalidateSecrets).toHaveBeenCalledOnce()
        expect(invalidateTokens).toHaveBeenCalledBefore(attach)
    })

    it('подхватывает сохранённый запрос и цепочку, сохраняя несохранённый запрос', async () => {
        type Context = Awaited<ReturnType<typeof getAppContext>>
        const saved = { ...mutation, id: 'saved', operationRef: 'writes/read', dirty: false }
        const flowTab = TabStateSchema.parse({ id: 'flow-tab', kind: 'flow', flowId: 'smoke', workspaceId: workspace.id })
        const flow = FlowSchema.parse({
            id: 'smoke', name: 'Updated flow', steps: [{ id: 'first', name: 'First', query: '{ ok }' }],
        })
        const operation = {
            name: 'read', collectionId: 'writes', query: 'query Updated { ok }',
            variables: { name: 'file' }, headers: {}, scripts: { preRequest: 'request.variables.id = 3' },
        }
        vi.mocked(getAppContext).mockResolvedValue({
            workspaces: {
                listCollections: async () => [{ id: 'writes', name: 'Writes', order: [], headers: {}, description: '' }],
                listOperations: async () => [operation, { ...operation, name: 'change' }],
                listFlows: async () => [flow],
            },
            flowState: { read: async () => ({}) },
        } as unknown as Context)
        useAppStore.setState({
            tabs: [mutation, saved, flowTab],
            contents: { [mutation.id]: content, [saved.id]: content },
        })

        await useAppStore.getState().applyLibraryChanges(['workspaces/test/collections/writes/read.graphql'])

        const state = useAppStore.getState()
        expect(state.contents[mutation.id]).toBe(content)
        expect(state.contents[saved.id]).toMatchObject({ query: operation.query, scripts: operation.scripts })
        expect(state.flowDrafts[flowTab.id]).toEqual(flow)
        expect(state.tabs.find((tab) => tab.id === flowTab.id)?.title).toBe('Updated flow')
    })

    it('передаёт выбранный в шапке эндпоинт при запуске цепочки', async () => {
        type Context = Awaited<ReturnType<typeof getAppContext>>
        const run = vi.fn(async () => ({
            flowId: 'smoke', ok: false, durationMs: 0, context: {}, steps: [],
        }))
        vi.mocked(getAppContext).mockResolvedValue({
            flows: { run },
            flowState: { read: async () => ({}) },
        } as unknown as Context)
        useAppStore.setState({
            workspace: {
                ...workspace,
                endpoints: [
                    ...workspace.endpoints,
                    { id: 'stage', name: 'Stage', url: 'https://stage.example.invalid/graphql', headers: {}, acceptInvalidCerts: false },
                ],
            },
            selections: { [workspace.id]: { endpointId: 'stage' } },
            loadHistory: async () => undefined,
        })

        await useAppStore.getState().runFlow('smoke', { confirmed: true })

        expect(run).toHaveBeenCalledWith(workspace.id, 'smoke', expect.objectContaining({
            endpointId: 'stage',
        }))
    })

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
