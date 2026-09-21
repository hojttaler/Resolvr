import {
    Debouncer,
    detectOperationKind,
    formatAppLink,
    formatCurl,
    formatOperationRef,
    maskCurlSecrets,
    parseOperationRef,
    ActivityStore,
    diffSchemas,
    SessionSchema,
    SettingsSchema,
    TabStateSchema,
    findJwt,
    readJwtInfo,
    TokenKeeper,
    validateVariables,
    toErrorMessage,
    type ICollection,
    FlowSchema,
    toSlug,
    type IAppLink,
    type IFlow,
    type IFlowReport,
    type IFlowRunResult,
    type IHistoryEntry,
    type ILayoutPreset,
    type ILayoutState,
    type IOperation,
    type IOperationKind,
    type IActivitySession,
    type IRunResult,
    type ISchemaChange,
    type IVariableProblem,
    type ISession,
    type ISettings,
    type ITabState,
    type IWorkspace,
} from '@resolvr/core'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { parse, print, type GraphQLSchema } from 'graphql'
import { create } from 'zustand'

import { getAppContext } from '../platform/context.js'
import { checkForUpdate, type IAvailableUpdate } from '../platform/updates.js'

/** Вызов нативной команды; вне Tauri (витрина, тесты) — тихо ничего не делает. */
async function invokeSafely(command: string, args: Record<string, unknown>): Promise<void> {
    if (!isTauri()) return

    await invoke(command, args)
}

/** Содержимое вкладки — то, что видно в редакторах прямо сейчас. */
export interface ITabContent {
    query: string
    /** Переменные хранятся текстом: пользователь имеет право на невалидный JSON. */
    variables: string
    headers: Record<string, string>
}

export interface ISubscriptionEvent {
    at: number
    payload: unknown
}

/** Состояние выполнения для одной вкладки. */
export interface ITabRun {
    status: 'idle' | 'running' | 'done' | 'error' | 'streaming' | 'invalid'
    result?: IRunResult
    error?: string
    /** Проблемы переменных, из-за которых запрос не отправлен. */
    problems?: IVariableProblem[]
    events: ISubscriptionEvent[]
    startedAt?: number
}

export interface ICollectionNode {
    collection: ICollection
    operations: IOperation[]
}

/** Модальные окна приложения. */
export type IDialogKind =
    | 'none'
    | 'save'
    | 'workspace'
    | 'settings'
    | 'activity'
    | 'workspaceSettings'

/** Действие, ожидающее подтверждения: prod-guard, удаление коллекции и т. п. */
export interface IConfirmRequest {
    title: string
    description: React.ReactNode
    actionLabel: string
    /** Красная кнопка и рамка — для разрушающих действий. */
    danger: boolean
    /** Метка PROD в заголовке. */
    production?: boolean
    run: () => Promise<void> | void
}

const AUTOSAVE_DELAY_MS = 300
const MAX_SUBSCRIPTION_EVENTS = 500

const sessionSaver = new Debouncer(AUTOSAVE_DELAY_MS)
const draftSavers = new Map<string, Debouncer>()
const flowDraftSavers = new Map<string, Debouncer>()

export interface IAppState {
    ready: boolean
    initError?: string
    settings: ISettings

    workspaces: IWorkspace[]
    workspace?: IWorkspace
    tree: ICollectionNode[]
    flows: IFlow[]
    history: IHistoryEntry[]

    /** Вкладки текущего workspace; вкладки остальных ждут в `tabsByWorkspace`. */
    tabs: ITabState[]
    activeTabId?: string
    /**
     * Вкладки неактивных workspace. При переключении наборы меняются местами:
     * коллеги открывают несколько проектов, и вкладки одного не должны
     * висеть в другом.
     */
    tabsByWorkspace: Record<string, { tabs: ITabState[]; activeTabId?: string }>
    contents: Record<string, ITabContent>
    runs: Record<string, ITabRun>
    /** Черновики цепочек по вкладкам-редакторам. */
    flowDrafts: Record<string, IFlow>
    /** Отчёты о прогоне всех цепочек по вкладкам-отчётам. */
    reports: Record<string, IFlowReport>
    /** Идёт прогон всех цепочек; повторный запуск заблокирован. */
    reportRunning: boolean

    schema?: GraphQLSchema
    schemaFetchedAt?: string
    schemaError?: string
    /** Результат последнего сравнения снимков схемы; показывается в инспекторе. */
    schemaDiff?: ISchemaChange[]
    schemaDiffNote?: string

    /** Проблемы переменных активной вкладки, найденные до отправки. */
    variableProblems: IVariableProblem[]

    /** Идёт обновление токена по кнопке индикатора. */
    tokenRefreshing: boolean
    /** Запрос подтверждения перед необратимым или боевым действием. */
    confirm?: IConfirmRequest

    /** Найденное обновление; `null` — проверяли, обновлений нет. */
    update?: IAvailableUpdate | null
    updateChecking: boolean
    /** Доля скачанного при установке обновления. */
    updateProgress?: number
    updateError?: string

    layoutPreset: ILayoutPreset
    /** Раскладка панелей по группам: имя группы → размеры её панелей. */
    layoutSizes: Record<string, Record<string, number>>
    /** Раскладки остальных workspace — личное, живёт в сессии. */
    layouts: Record<string, ILayoutState>
    sidebarCollapsed: boolean
    sidebarTab: 'collections' | 'schema' | 'history' | 'flows'

    paletteOpen: boolean
    /** Открытое модальное окно; хранится в состоянии, чтобы его могли открывать
     *  и меню, и палитра команд, и кнопки интерфейса. */
    dialog: IDialogKind
    flowRun?: IFlowRunResult

    /** Журнал действий агента, сгруппированный по сессиям MCP. */
    activitySessions: IActivitySession[]

    /** Активные отписки от GraphQL-подписок по вкладкам. */
    subscriptions: Record<string, () => void>
}

export interface IAppActions {
    initialize(): Promise<void>
    reloadTree(): Promise<void>
    selectWorkspace(workspaceId: string): Promise<void>
    createWorkspace(name: string, endpointUrl: string): Promise<void>

    openTab(input?: { operationRef?: string; title?: string; query?: string }): Promise<void>
    /** Открывает редактор цепочки вкладкой; без `flowId` — новую цепочку. */
    openFlowTab(flowId?: string): Promise<void>
    /** Открывает то, на что указывает ссылка `resolvr://`, переключая workspace. */
    openLink(link: IAppLink): Promise<void>
    /** Ссылка на операцию или цепочку текущего workspace для отправки коллеге. */
    linkTo(target: { operationRef?: string; flowId?: string }): string | undefined
    updateFlowDraft(tabId: string, flow: IFlow): void
    /** Сохраняет черновик цепочки из вкладки; возвращает ошибку валидации. */
    saveFlowTab(tabId: string): Promise<string | undefined>
    closeTab(tabId: string): Promise<void>
    closeTabs(tabIds: string[]): Promise<void>
    closeOtherTabs(tabId: string): Promise<void>
    closeTabsToLeft(tabId: string): Promise<void>
    closeTabsToRight(tabId: string): Promise<void>
    closeAllTabs(): Promise<void>
    activateTab(tabId: string): void
    updateQuery(tabId: string, query: string): void
    updateVariables(tabId: string, variables: string): void
    updateHeaders(tabId: string, headers: Record<string, string>): void
    setTabEnvironment(tabId: string, environmentId: string): void
    setTabEndpoint(tabId: string, endpointId: string): void
    setBottomTab(tabId: string, tab: 'variables' | 'headers'): void
    setResponseTab(tabId: string, tab: 'response' | 'raw' | 'headers' | 'trace'): void

    runActiveTab(options?: { force?: boolean; confirmed?: boolean }): Promise<void>
    /** Проверяет обновления; `silent` — без индикации, при старте. */
    checkUpdates(options?: { silent?: boolean }): Promise<void>
    installUpdate(): Promise<void>
    dismissUpdate(): void

    requestConfirm(request: IConfirmRequest): void
    /** Снимает запрос подтверждения без выполнения. */
    dismissConfirm(): void

    createCollection(name: string): Promise<void>
    renameCollection(collectionId: string, name: string): Promise<void>
    deleteCollection(collectionId: string): Promise<void>
    /** Перенос или переименование операции; открытые вкладки следуют за ней. */
    moveOperation(from: string, to: { collectionId: string; name: string }): Promise<void>
    deleteOperation(operationRef: string): Promise<void>
    duplicateOperation(operationRef: string): Promise<void>
    /**
     * Команда `curl` для активной вкладки — как запрос ушёл бы на сервер.
     * С `maskSecrets` токены заменяются заглушкой: такой вариант безопасно
     * прикладывать к баг-репорту.
     */
    activeTabAsCurl(options: { maskSecrets: boolean }): Promise<string>
    /** Сохраняет активную вкладку туда же, откуда она открыта; иначе — диалог. */
    saveActiveTabInPlace(): Promise<boolean>
    refreshToken(): Promise<void>
    stopActiveTab(): void
    saveActiveTab(collectionId: string, name: string): Promise<void>

    refreshSchema(): Promise<void>
    compareSchema(): Promise<void>
    formatActiveQuery(): void
    toggleResponseExpanded(): void
    insertIntoActiveTab(text: string): void
    replaceActiveQuery(query: string, variables?: Record<string, unknown>): void

    loadHistory(): Promise<void>
    runFlow(flowId: string, options?: { confirmed?: boolean }): Promise<void>
    /**
     * Запускает все цепочки workspace по очереди и показывает отчёт вкладкой.
     * Это smoke-тест окружения одной кнопкой.
     */
    runAllFlows(options?: { confirmed?: boolean }): Promise<void>
    saveFlow(flow: IFlow): Promise<void>
    deleteFlow(flowId: string): Promise<void>
    clearFlowRun(): void

    loadActivity(): Promise<void>
    syncTokenInfo(): Promise<void>
    saveWorkspaceSettings(workspace: IWorkspace): Promise<void>
    setPrerequisiteFlow(operationRef: string, flowId: string | undefined): Promise<void>
    saveValueToEnvironment(input: {
        name: string
        value: string
        secret: boolean
        /** Добавить `Authorization: Bearer {{name}}` в заголовки окружения. */
        asAuthHeader: boolean
    }): Promise<void>

    updateSettings(patch: Partial<ISettings>): Promise<void>

    setLayoutPreset(preset: ILayoutPreset): void
    setLayoutSizes(key: string, sizes: Record<string, number>): void
    toggleSidebar(): void
    setSidebarTab(tab: 'collections' | 'schema' | 'history' | 'flows'): void
    setPaletteOpen(open: boolean): void
    setDialog(dialog: IDialogKind): void

    /** Синхронный сброс всех отложенных записей — вызывается перед закрытием окна. */
    flushAll(): Promise<void>
}

export type IAppStore = IAppState & IAppActions

export const useAppStore = create<IAppStore>((set, get) => ({
    ready: false,
    settings: SettingsSchema.parse({}),
    workspaces: [],
    tree: [],
    flows: [],
    history: [],
    tabs: [],
    tabsByWorkspace: {},
    contents: {},
    runs: {},
    flowDrafts: {},
    reports: {},
    reportRunning: false,
    layoutPreset: 'classic',
    layoutSizes: {},
    layouts: {},
    variableProblems: [],
    tokenRefreshing: false,
    updateChecking: false,
    sidebarCollapsed: false,
    sidebarTab: 'collections',
    paletteOpen: false,
    dialog: 'none',
    activitySessions: [],
    subscriptions: {},

    async initialize() {
        try {
            const context = await getAppContext()
            const settings = await context.workspaces.getSettings()
            applySettings(settings)

            const workspaces = await context.workspaces.listWorkspaces()
            const session = await context.sessions.load()

            const workspaceId = session.workspaceId ?? workspaces[0]?.id
            const listed = workspaces.find((item) => item.id === workspaceId)
            const workspace = listed ? await context.tokens.attach(listed) : undefined

            // Вкладки старых сессий не знают своего workspace — они принадлежат
            // тому, что был активен при сохранении.
            const allTabs = session.tabs.map((tab) => ({
                ...tab,
                workspaceId: tab.workspaceId ?? session.workspaceId,
            }))

            // Черновики читаются до первой отрисовки: вкладки должны появиться
            // сразу с текстом, а не мигнуть пустыми.
            const contents: Record<string, ITabContent> = {}
            const flowDrafts: Record<string, IFlow> = {}
            const reports: Record<string, IFlowReport> = {}
            for (const tab of allTabs) {
                if (tab.kind === 'report') {
                    const report = await context.sessions.readReport(tab.id)
                    if (report) reports[tab.id] = report
                    continue
                }
                if (tab.kind === 'flow') {
                    const draft =
                        (await context.sessions.readFlowDraft(tab.id)) ??
                        (tab.flowId && tab.workspaceId
                            ? await context.workspaces.getFlow(tab.workspaceId, tab.flowId).catch(() => undefined)
                            : undefined)
                    if (draft) flowDrafts[tab.id] = draft
                    continue
                }

                const query = await context.sessions.readDraftQuery(tab.id)
                const data = await context.sessions.readDraftData(tab.id)
                contents[tab.id] = { query, variables: data.variables, headers: data.headers }
            }

            await context.sessions.pruneOrphanDrafts(allTabs)

            const split = splitTabs(allTabs, workspace?.id, session.activeTabs, session.activeTabId)

            // Раскладка старых версий лежала в workspace.json — берётся оттуда,
            // если в сессии её ещё нет.
            const layouts = { ...session.layouts }
            if (workspace && !layouts[workspace.id] && workspace.layout) {
                layouts[workspace.id] = workspace.layout
            }
            const layout = workspace ? layouts[workspace.id] : undefined

            set({
                ready: true,
                settings,
                workspaces,
                workspace,
                tabs: split.tabs,
                activeTabId: split.activeTabId,
                tabsByWorkspace: split.rest,
                contents,
                flowDrafts,
                reports,
                layouts,
                layoutPreset: layout?.preset ?? 'classic',
                layoutSizes: layout?.sizes ?? {},
                sidebarCollapsed: layout?.sidebarCollapsed ?? false,
                sidebarTab: layout?.sidebarTab ?? 'collections',
            })

            window.setTimeout(() => void get().checkUpdates({ silent: true }), 8_000)

            if (workspace) {
                await get().reloadTree()
                await get().loadHistory()
                await loadCachedSchema(workspace, set)

                // Старые файлы истории удаляются при старте: чистка на каждой
                // записи била бы по скорости выполнения запросов.
                await context.history.prune(workspace.id, settings.history.retentionDays)
                await get().syncTokenInfo()
            }
        } catch (error) {
            set({ ready: true, initError: toErrorMessage(error) })
        }
    },

    async reloadTree() {
        const { workspace } = get()
        if (!workspace) return

        const context = await getAppContext()
        const collections = await context.workspaces.listCollections(workspace.id)

        const tree: ICollectionNode[] = []
        for (const collection of collections) {
            tree.push({
                collection,
                operations: await context.workspaces.listOperations(workspace.id, collection.id),
            })
        }

        set({ tree, flows: await context.workspaces.listFlows(workspace.id) })
    },

    async selectWorkspace(workspaceId) {
        const context = await getAppContext()
        const workspace = await context.tokens.attach(
            await context.workspaces.getWorkspace(workspaceId),
        )

        set((state) => {
            // Текущие вкладки и раскладка убираются в запас, набор нового
            // workspace достаётся оттуда же.
            const tabsByWorkspace = { ...state.tabsByWorkspace }
            if (state.workspace) {
                tabsByWorkspace[state.workspace.id] = {
                    tabs: state.tabs,
                    activeTabId: state.activeTabId,
                }
            }
            const incoming = tabsByWorkspace[workspaceId] ?? { tabs: [] }
            delete tabsByWorkspace[workspaceId]

            const layouts = { ...state.layouts }
            if (state.workspace) layouts[state.workspace.id] = currentLayout(state)
            const layout = layouts[workspaceId] ?? workspace.layout

            return {
                workspace,
                tabs: incoming.tabs,
                activeTabId: incoming.activeTabId ?? incoming.tabs.at(-1)?.id,
                tabsByWorkspace,
                layouts,
                layoutPreset: layout?.preset ?? 'classic',
                layoutSizes: layout?.sizes ?? {},
                sidebarCollapsed: layout?.sidebarCollapsed ?? false,
                sidebarTab: layout?.sidebarTab ?? 'collections',
                schema: undefined,
                schemaFetchedAt: undefined,
                flowRun: undefined,
            }
        })

        await get().reloadTree()
        await get().loadHistory()
        await loadCachedSchema(workspace, set)
        await get().syncTokenInfo()
        scheduleSessionSave(get)
    },

    async createWorkspace(name, endpointUrl) {
        const context = await getAppContext()
        const workspace = await context.workspaces.createWorkspace({ name, endpointUrl })

        set({ workspaces: await context.workspaces.listWorkspaces() })
        await get().selectWorkspace(workspace.id)
        await get().refreshSchema()
    },

    async openTab(input = {}) {
        const context = await getAppContext()
        const { workspace } = get()

        const tabId = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        let query = input.query ?? ''
        let variables = '{}'
        let headers: Record<string, string> = {}
        let title = input.title ?? 'Новый запрос'

        if (input.operationRef && workspace) {
            const operation = await context.workspaces.getOperation(
                workspace.id,
                parseOperationRef(input.operationRef),
            )
            query = operation.query
            variables = JSON.stringify(operation.variables, null, 2)
            headers = operation.headers
            title = operation.name
        }

        const tab = TabStateSchema.parse({
            id: tabId,
            workspaceId: workspace?.id,
            title,
            operationRef: input.operationRef,
            environmentId: workspace?.defaultEnvironmentId,
            endpointId: workspace?.defaultEndpointId,
            dirty: false,
        })

        set((state) => ({
            tabs: [...state.tabs, tab],
            activeTabId: tabId,
            contents: { ...state.contents, [tabId]: { query, variables, headers } },
        }))

        scheduleDraftSave(tabId, get)
        scheduleSessionSave(get)
    },

    async closeTab(tabId) {
        await get().closeTabs([tabId])
    },

    async closeTabs(tabIds) {
        if (tabIds.length === 0) return

        const context = await getAppContext()
        const closing = new Set(tabIds)
        for (const tabId of closing) get().subscriptions[tabId]?.()

        set((state) => {
            const tabs = state.tabs.filter((tab) => !closing.has(tab.id))
            const contents = { ...state.contents }
            const runs = { ...state.runs }
            const subscriptions = { ...state.subscriptions }
            const flowDrafts = { ...state.flowDrafts }
            const reports = { ...state.reports }
            for (const tabId of closing) {
                delete contents[tabId]
                delete runs[tabId]
                delete subscriptions[tabId]
                delete flowDrafts[tabId]
                delete reports[tabId]
            }

            // Активной становится ближайшая справа от закрытой, как в браузере:
            // при закрытии нескольких — последняя из оставшихся.
            const activeClosed = state.activeTabId !== undefined && closing.has(state.activeTabId)
            const oldIndex = state.tabs.findIndex((tab) => tab.id === state.activeTabId)
            const next =
                state.tabs.slice(oldIndex + 1).find((tab) => !closing.has(tab.id)) ??
                tabs[tabs.length - 1]

            return {
                tabs,
                contents,
                runs,
                subscriptions,
                flowDrafts,
                reports,
                activeTabId: activeClosed ? next?.id : state.activeTabId,
            }
        })

        for (const tabId of closing) {
            draftSavers.get(tabId)?.cancel()
            draftSavers.delete(tabId)
            await context.sessions.deleteDraft(tabId)
        }
        scheduleSessionSave(get)
    },

    async closeOtherTabs(tabId) {
        await get().closeTabs(get().tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id))
    },

    async closeTabsToLeft(tabId) {
        const { tabs } = get()
        const index = tabs.findIndex((tab) => tab.id === tabId)
        await get().closeTabs(tabs.slice(0, Math.max(index, 0)).map((tab) => tab.id))
    },

    async closeTabsToRight(tabId) {
        const { tabs } = get()
        const index = tabs.findIndex((tab) => tab.id === tabId)
        await get().closeTabs(tabs.slice(index + 1).map((tab) => tab.id))
    },

    async closeAllTabs() {
        await get().closeTabs(get().tabs.map((tab) => tab.id))
    },

    async openFlowTab(flowId) {
        const { workspace, tabs, flows } = get()
        if (!workspace) return

        // Цепочка уже открыта — вторая вкладка дала бы два расходящихся черновика.
        const existing = flowId ? tabs.find((tab) => tab.kind === 'flow' && tab.flowId === flowId) : undefined
        if (existing) {
            get().activateTab(existing.id)

            return
        }

        const flow: IFlow = (flowId ? flows.find((item) => item.id === flowId) : undefined) ?? {
            id: '',
            name: 'Новая цепочка',
            description: '',
            steps: [],
        }

        const tabId = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        const tab = TabStateSchema.parse({
            id: tabId,
            kind: 'flow',
            workspaceId: workspace.id,
            flowId: flowId,
            title: flow.name,
            dirty: false,
        })

        set((state) => ({
            tabs: [...state.tabs, tab],
            activeTabId: tabId,
            flowDrafts: { ...state.flowDrafts, [tabId]: flow },
        }))

        scheduleFlowDraftSave(tabId, get)
        scheduleSessionSave(get)
    },

    async openLink(link) {
        const { workspace, workspaces } = get()
        if (!workspaces.some((item) => item.id === link.workspaceId)) return

        if (workspace?.id !== link.workspaceId) await get().selectWorkspace(link.workspaceId)

        if (link.operationRef) {
            // Уже открытая операция активируется, а не дублируется.
            const existing = get().tabs.find((tab) => tab.operationRef === link.operationRef)
            if (existing) get().activateTab(existing.id)
            else await get().openTab({ operationRef: link.operationRef })
        } else if (link.flowId) {
            await get().openFlowTab(link.flowId)
        }
    },

    linkTo(target) {
        const { workspace } = get()
        if (!workspace) return undefined

        return formatAppLink({ workspaceId: workspace.id, ...target })
    },

    updateFlowDraft(tabId, flow) {
        set((state) => ({
            flowDrafts: { ...state.flowDrafts, [tabId]: flow },
            tabs: state.tabs.map((tab) =>
                tab.id === tabId ? { ...tab, dirty: true, title: flow.name || tab.title } : tab,
            ),
        }))

        scheduleFlowDraftSave(tabId, get)
        scheduleSessionSave(get)
    },

    async saveFlowTab(tabId) {
        const draft = get().flowDrafts[tabId]
        if (!draft) return 'Черновик цепочки не найден'
        if (draft.name.trim().length === 0) return 'Укажите название цепочки'

        const invalid = draft.steps.find((step) => !step.operationRef && !step.query?.trim())
        if (invalid) return `Шаг «${invalid.name}»: выберите операцию или впишите запрос`

        const parsed = FlowSchema.safeParse({
            ...draft,
            id: draft.id.length > 0 ? draft.id : toSlug(draft.name),
        })
        if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Цепочка заполнена неверно'

        await get().saveFlow(parsed.data)

        set((state) => ({
            flowDrafts: { ...state.flowDrafts, [tabId]: parsed.data },
            tabs: state.tabs.map((tab) =>
                tab.id === tabId
                    ? { ...tab, dirty: false, flowId: parsed.data.id, title: parsed.data.name }
                    : tab,
            ),
        }))

        scheduleFlowDraftSave(tabId, get)
        scheduleSessionSave(get)

        return undefined
    },

    activateTab(tabId) {
        set({ activeTabId: tabId })
        scheduleSessionSave(get)
    },

    updateQuery(tabId, query) {
        set((state) => ({
            contents: {
                ...state.contents,
                [tabId]: { ...requireContent(state.contents, tabId), query },
            },
            tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, dirty: true } : tab)),
        }))

        scheduleDraftSave(tabId, get)
        scheduleSessionSave(get)
    },

    updateVariables(tabId, variables) {
        set((state) => ({
            contents: {
                ...state.contents,
                [tabId]: { ...requireContent(state.contents, tabId), variables },
            },
            tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, dirty: true } : tab)),
        }))

        scheduleDraftSave(tabId, get)
    },

    updateHeaders(tabId, headers) {
        set((state) => ({
            contents: {
                ...state.contents,
                [tabId]: { ...requireContent(state.contents, tabId), headers },
            },
            tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, dirty: true } : tab)),
        }))

        scheduleDraftSave(tabId, get)
    },

    setTabEnvironment(tabId, environmentId) {
        set((state) => ({
            tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, environmentId } : tab)),
        }))
        scheduleSessionSave(get)
    },

    setTabEndpoint(tabId, endpointId) {
        set((state) => ({
            tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, endpointId } : tab)),
        }))
        scheduleSessionSave(get)
    },

    setBottomTab(tabId, bottomTab) {
        set((state) => ({
            tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, bottomTab } : tab)),
        }))
        scheduleSessionSave(get)
    },

    setResponseTab(tabId, responseTab) {
        set((state) => ({
            tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, responseTab } : tab)),
        }))
        scheduleSessionSave(get)
    },

    async runActiveTab(options = {}) {
        const state = get()
        const tab = state.tabs.find((item) => item.id === state.activeTabId)
        const workspace = state.workspace
        if (!tab || !workspace) return

        const content = state.contents[tab.id]
        if (!content) return

        const kind: IOperationKind = detectOperationKind(content.query)
        const variables = parseVariables(content.variables)

        if (variables instanceof Error) {
            setRun(set, tab.id, { status: 'error', error: variables.message, events: [] })

            return
        }

        // Проверка до отправки: незаполненная обязательная переменная или
        // значение не того типа иначе выяснились бы только по ответу сервера.
        const problems = validateVariables(content.query, variables, state.schema)
        const blocking = problems.filter((problem) => problem.severity === 'error')

        set({ variableProblems: problems })

        if (blocking.length > 0 && !options.force) {
            setRun(set, tab.id, {
                status: 'invalid',
                events: [],
                problems: blocking,
            })

            return
        }

        // Мутация на боевом окружении выполняется только после подтверждения.
        const environment = workspace.environments.find(
            (item) => item.id === (tab.environmentId ?? workspace.defaultEnvironmentId),
        )
        if (kind === 'mutation' && environment?.production && !options.confirmed) {
            get().requestConfirm(
                productionConfirm(
                    environment.name,
                    `мутация ${extractOperationName(content.query) ?? 'без имени'}`,
                    () => get().runActiveTab({ ...options, confirmed: true }),
                ),
            )

            return
        }

        const context = await getAppContext()

        if (kind === 'subscription') {
            await startSubscription(tab, workspace.id, content, variables, set, get)

            return
        }

        setRun(set, tab.id, { status: 'running', events: [], startedAt: Date.now() })

        try {
            const result = await context.runner.run({
                workspaceId: workspace.id,
                query: content.query,
                variables,
                headers: content.headers,
                endpointId: tab.endpointId,
                environmentId: tab.environmentId,
                operationName: extractOperationName(content.query),
                timeoutMs: state.settings.request.timeoutMs,
            })

            setRun(set, tab.id, { status: 'done', result, events: [] })
            await get().loadHistory()
        } catch (error) {
            setRun(set, tab.id, { status: 'error', error: toErrorMessage(error), events: [] })
        }
    },

    stopActiveTab() {
        const { activeTabId, subscriptions } = get()
        if (!activeTabId) return

        subscriptions[activeTabId]?.()

        set((state) => {
            const next = { ...state.subscriptions }
            delete next[activeTabId]

            return {
                subscriptions: next,
                runs: {
                    ...state.runs,
                    [activeTabId]: {
                        ...(state.runs[activeTabId] ?? { events: [], status: 'idle' }),
                        status: 'done',
                    },
                },
            }
        })
    },

    async saveActiveTab(collectionId, name) {
        const state = get()
        const tab = state.tabs.find((item) => item.id === state.activeTabId)
        const workspace = state.workspace
        if (!tab || !workspace) return

        const content = state.contents[tab.id]
        if (!content) return

        const context = await getAppContext()
        const variables = parseVariables(content.variables)

        await context.workspaces.saveOperation(workspace.id, {
            collectionId,
            name,
            query: content.query,
            variables: variables instanceof Error ? {} : variables,
            headers: content.headers,
            endpointId: tab.endpointId,
            environmentId: tab.environmentId,
        })

        set((state) => ({
            tabs: state.tabs.map((item) =>
                item.id === tab.id
                    ? {
                          ...item,
                          dirty: false,
                          title: name,
                          operationRef: formatOperationRef({ collectionId, name }),
                      }
                    : item,
            ),
        }))

        await get().reloadTree()
        scheduleSessionSave(get)
    },

    async refreshSchema() {
        const { workspace, tabs, activeTabId } = get()
        if (!workspace) return

        const activeTab = tabs.find((tab) => tab.id === activeTabId)
        const endpointId = activeTab?.endpointId ?? workspace.defaultEndpointId
        const endpoint =
            workspace.endpoints.find((item) => item.id === endpointId) ?? workspace.endpoints[0]

        if (!endpoint) {
            set({ schemaError: 'В workspace не задан ни один эндпоинт' })

            return
        }

        try {
            const context = await getAppContext()
            const cache = await context.schemas.introspect(workspace.id, endpoint)
            const schema = await context.schemas.getSchema(workspace.id, endpoint.id)

            set({ schema, schemaFetchedAt: cache.fetchedAt, schemaError: undefined })
        } catch (error) {
            set({ schemaError: toErrorMessage(error) })
        }
    },

    /**
     * Сравнивает текущий снимок схемы с предыдущим.
     *
     * Живёт в store, а не в панели: сравнение вызывается и из меню, и кнопкой
     * инспектора, а результат должен переживать переключение лейаута.
     */
    async compareSchema() {
        const { workspace, tabs, activeTabId } = get()
        if (!workspace) return

        const activeTab = tabs.find((tab) => tab.id === activeTabId)
        const endpointId =
            activeTab?.endpointId ?? workspace.defaultEndpointId ?? workspace.endpoints[0]?.id
        if (!endpointId) return

        const context = await getAppContext()
        const previous = await context.schemas.getPreviousSdl(workspace.id, endpointId)
        const current = await context.schemas.getSdl(workspace.id, endpointId)

        if (!previous || !current) {
            set({
                schemaDiff: [],
                schemaDiffNote:
                    'Нет предыдущего снимка — обновите схему ещё раз после изменения на сервере',
            })

            return
        }

        set({ schemaDiff: diffSchemas(previous, current).changes, schemaDiffNote: undefined })
    },

    /** Приводит запрос активной вкладки к каноническому виду. */
    formatActiveQuery() {
        const { activeTabId, contents } = get()
        if (!activeTabId) return

        const content = contents[activeTabId]
        if (!content) return

        try {
            get().updateQuery(activeTabId, `${print(parse(content.query))}\n`)
        } catch {
            // Незавершённый запрос форматировать нечем — оставляем как есть.
        }
    },

    /**
     * Разворачивает панель ответа почти на всю ширину и возвращает обратно.
     * Прежние пропорции запоминаются, чтобы возврат был точным.
     */
    toggleResponseExpanded() {
        const state = get()
        const key = `${state.layoutPreset}-root`
        const saved = state.layoutSizes[`${key}-restore`]

        if (saved) {
            set((current) => {
                const sizes = { ...current.layoutSizes, [key]: saved }
                delete sizes[`${key}-restore`]

                return { layoutSizes: sizes }
            })
            scheduleSessionSave(get)

            return
        }

        const currentSizes = state.layoutSizes[key] ?? {}
        const expanded: Record<string, number> = { ...currentSizes, request: 20, response: 80 }
        if ('sidebar' in expanded) {
            expanded.sidebar = 0
            expanded.request = 20
            expanded.response = 80
        }

        set((current) => ({
            layoutSizes: {
                ...current.layoutSizes,
                [key]: expanded,
                [`${key}-restore`]: currentSizes,
            },
        }))
        scheduleSessionSave(get)
    },

    insertIntoActiveTab(text) {
        const { activeTabId, contents } = get()
        if (!activeTabId) return

        const content = contents[activeTabId]
        if (!content) return

        get().updateQuery(activeTabId, `${content.query.replace(/\s*$/, '')}\n${text}\n`)
    },

    replaceActiveQuery(query, variables) {
        const { activeTabId } = get()
        if (!activeTabId) return

        get().updateQuery(activeTabId, query)
        if (variables) get().updateVariables(activeTabId, JSON.stringify(variables, null, 2))
    },

    async loadHistory() {
        const { workspace } = get()
        if (!workspace) return

        const context = await getAppContext()
        set({ history: await context.history.list(workspace.id, { limit: 100 }) })
    },

    async runFlow(flowId, options = {}) {
        const { workspace } = get()
        if (!workspace) return

        const activeTab = get().tabs.find((tab) => tab.id === get().activeTabId)
        const environmentId = activeTab?.environmentId ?? workspace.defaultEnvironmentId
        const environment = workspace.environments.find((item) => item.id === environmentId)

        // Цепочка почти всегда содержит мутации — на боевом окружении она
        // требует того же подтверждения, что и одиночная мутация.
        if (environment?.production && !options.confirmed) {
            const flow = get().flows.find((item) => item.id === flowId)
            get().requestConfirm(
                productionConfirm(environment.name, `цепочка «${flow?.name ?? flowId}»`, () =>
                    get().runFlow(flowId, { confirmed: true }),
                ),
            )

            return
        }

        const context = await getAppContext()
        try {

            const run = await context.flows.run(workspace.id, flowId, { environmentId })
            set({ flowRun: run })

            // Токен, добытый цепочкой, сохраняется в окружение: иначе он жил бы
            // только внутри одного запроса и логин повторялся бы каждый раз.
            if (run.ok) {
                const keeper = new TokenKeeper(context.workspaces, context.resolver, context.tokens)
                const remembered = await keeper.remember(workspace.id, environmentId, run.context)

                if (remembered) {
                    set({
                        workspace: await context.tokens.attach(
                            await context.workspaces.getWorkspace(workspace.id),
                        ),
                    })
                }
            }
        } catch (error) {
            set({
                flowRun: {
                    flowId,
                    ok: false,
                    durationMs: 0,
                    steps: [],
                    context: { error: toErrorMessage(error) },
                },
            })
        }

        await get().loadHistory()
    },

    async runAllFlows(options = {}) {
        const { workspace, flows, tabs, activeTabId } = get()
        if (!workspace || flows.length === 0 || get().reportRunning) return

        const activeTab = tabs.find((tab) => tab.id === activeTabId)
        const environmentId = activeTab?.environmentId ?? workspace.defaultEnvironmentId
        const environment = workspace.environments.find((item) => item.id === environmentId)

        if (environment?.production && !options.confirmed) {
            get().requestConfirm(
                productionConfirm(environment.name, `прогон всех цепочек (${flows.length})`, () =>
                    get().runAllFlows({ confirmed: true }),
                ),
            )

            return
        }

        // Отчёт — отдельная вкладка; повторный прогон переиспользует её.
        const existing = get().tabs.find((tab) => tab.kind === 'report')
        const tabId =
            existing?.id ??
            `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

        const report: IFlowReport = {
            startedAt: new Date().toISOString(),
            environmentId,
            environmentName: environment?.name,
            entries: flows.map((flow) => ({ flowId: flow.id, flowName: flow.name })),
        }

        set((state) => ({
            reportRunning: true,
            reports: { ...state.reports, [tabId]: report },
            tabs: existing
                ? state.tabs
                : [
                      ...state.tabs,
                      TabStateSchema.parse({
                          id: tabId,
                          kind: 'report',
                          workspaceId: workspace.id,
                          title: 'Прогон цепочек',
                      }),
                  ],
            activeTabId: tabId,
        }))
        scheduleSessionSave(get)

        const context = await getAppContext()
        try {
            for (const [index, flow] of flows.entries()) {
                let run: IFlowRunResult
                try {
                    run = await context.flows.run(workspace.id, flow.id, { environmentId })
                } catch (error) {
                    run = {
                        flowId: flow.id,
                        ok: false,
                        durationMs: 0,
                        steps: [],
                        context: { error: toErrorMessage(error) },
                    }
                }

                // Отчёт обновляется после каждой цепочки: длинный прогон
                // виден в процессе, а не только по завершении.
                set((state) => {
                    const current = state.reports[tabId]
                    if (!current) return {}

                    const entries = current.entries.map((entry, position) =>
                        position === index ? { ...entry, run } : entry,
                    )

                    return { reports: { ...state.reports, [tabId]: { ...current, entries } } }
                })
            }
        } finally {
            set((state) => {
                const current = state.reports[tabId]
                const finished = current
                    ? { ...current, finishedAt: new Date().toISOString() }
                    : undefined

                return {
                    reportRunning: false,
                    reports: finished ? { ...state.reports, [tabId]: finished } : state.reports,
                }
            })

            const finalReport = get().reports[tabId]
            if (finalReport && isTauri()) await context.sessions.writeReport(tabId, finalReport)
            await get().loadHistory()
        }
    },

    async saveFlow(flow) {
        const { workspace } = get()
        if (!workspace) return

        const context = await getAppContext()
        await context.workspaces.saveFlow(workspace.id, flow)
        await get().reloadTree()
    },

    async deleteFlow(flowId) {
        const { workspace } = get()
        if (!workspace) return

        const context = await getAppContext()
        await context.workspaces.deleteFlow(workspace.id, flowId)

        set((state) => ({ flowRun: state.flowRun?.flowId === flowId ? undefined : state.flowRun }))
        await get().closeTabs(
            get()
                .tabs.filter((tab) => tab.kind === 'flow' && tab.flowId === flowId)
                .map((tab) => tab.id),
        )
        await get().reloadTree()
    },

    clearFlowRun() {
        set({ flowRun: undefined })
    },

    async checkUpdates(options = {}) {
        if (get().updateChecking) return

        set({ updateChecking: !options.silent, updateError: undefined })
        try {
            const update = await checkForUpdate()
            set({ update: update ?? null })
        } finally {
            set({ updateChecking: false })
        }
    },

    async installUpdate() {
        const { update } = get()
        if (!update) return

        set({ updateProgress: 0, updateError: undefined })
        try {
            // Черновики сбрасываются до перезапуска: иначе последние секунды
            // ввода пропали бы вместе со старым процессом.
            await get().flushAll()
            await update.install((fraction) => set({ updateProgress: fraction }))
        } catch (error) {
            set({ updateProgress: undefined, updateError: toErrorMessage(error) })
        }
    },

    dismissUpdate() {
        set({ update: null })
    },

    requestConfirm(request) {
        set({ confirm: request })
    },

    dismissConfirm() {
        set({ confirm: undefined })
    },

    async createCollection(name) {
        const { workspace } = get()
        if (!workspace) return

        const context = await getAppContext()
        await context.workspaces.createCollection(workspace.id, name)
        await get().reloadTree()
    },

    async renameCollection(collectionId, name) {
        const { workspace, tree } = get()
        const node = tree.find((item) => item.collection.id === collectionId)
        if (!workspace || !node || name.trim().length === 0) return

        const context = await getAppContext()
        await context.workspaces.saveCollection(workspace.id, {
            ...node.collection,
            name: name.trim(),
        })
        await get().reloadTree()
    },

    async deleteCollection(collectionId) {
        const { workspace } = get()
        if (!workspace) return

        const context = await getAppContext()
        await context.workspaces.deleteCollection(workspace.id, collectionId)

        // Вкладки удалённых операций остаются черновиками: текст не пропадает.
        set((state) => ({
            tabs: state.tabs.map((tab) =>
                tab.operationRef?.startsWith(`${collectionId}/`)
                    ? { ...tab, operationRef: undefined, dirty: true }
                    : tab,
            ),
        }))
        scheduleSessionSave(get)
        await get().reloadTree()
    },

    async moveOperation(from, to) {
        const { workspace } = get()
        if (!workspace) return

        const context = await getAppContext()
        await context.workspaces.moveOperation(workspace.id, parseOperationRef(from), to)

        const nextRef = formatOperationRef(to)
        set((state) => ({
            tabs: state.tabs.map((tab) =>
                tab.operationRef === from ? { ...tab, operationRef: nextRef, title: to.name } : tab,
            ),
        }))
        scheduleSessionSave(get)
        await get().reloadTree()
    },

    async deleteOperation(operationRef) {
        const { workspace } = get()
        if (!workspace) return

        const context = await getAppContext()
        await context.workspaces.deleteOperation(workspace.id, parseOperationRef(operationRef))

        set((state) => ({
            tabs: state.tabs.map((tab) =>
                tab.operationRef === operationRef
                    ? { ...tab, operationRef: undefined, dirty: true }
                    : tab,
            ),
        }))
        scheduleSessionSave(get)
        await get().reloadTree()
    },

    async duplicateOperation(operationRef) {
        const { workspace, tree } = get()
        if (!workspace) return

        const ref = parseOperationRef(operationRef)
        const context = await getAppContext()
        const operation = await context.workspaces.getOperation(workspace.id, ref)

        // Имя копии — первое свободное «Имя 2», «Имя 3»…
        const taken = new Set(
            tree
                .find((node) => node.collection.id === ref.collectionId)
                ?.operations.map((item) => item.name) ?? [],
        )
        let name = `${ref.name} copy`
        for (let index = 2; taken.has(name); index += 1) name = `${ref.name} copy ${index}`

        await context.workspaces.saveOperation(workspace.id, {
            collectionId: ref.collectionId,
            name,
            query: operation.query,
            description: operation.description,
            variables: operation.variables,
            headers: operation.headers,
            endpointId: operation.endpointId,
            environmentId: operation.environmentId,
            prerequisiteFlow: operation.prerequisiteFlow,
        })
        await get().reloadTree()
    },

    async activeTabAsCurl(options) {
        const state = get()
        const tab = state.tabs.find((item) => item.id === state.activeTabId)
        const workspace = state.workspace
        const content = tab ? state.contents[tab.id] : undefined
        if (!tab || !workspace || !content) return ''

        const variables = parseVariables(content.variables)
        const context = await getAppContext()
        const described = await context.runner.describeRequest({
            workspaceId: workspace.id,
            query: content.query,
            variables: variables instanceof Error ? {} : variables,
            headers: content.headers,
            endpointId: tab.endpointId,
            environmentId: tab.environmentId,
            operationName: extractOperationName(content.query),
            skipFlows: true,
        })

        return formatCurl({
            url: described.url,
            headers: options.maskSecrets
                ? maskCurlSecrets(described.headers, described.secretValues)
                : described.headers,
            body: described.body,
        })
    },

    async saveActiveTabInPlace() {
        const state = get()
        const tab = state.tabs.find((item) => item.id === state.activeTabId)
        if (!tab?.operationRef) return false

        const ref = parseOperationRef(tab.operationRef)
        await get().saveActiveTab(ref.collectionId, ref.name)

        return true
    },

    /**
     * Обновляет токен окружения вручную.
     *
     * Запускает цепочку восстановления, не дожидаясь ошибки или истечения —
     * нужно, когда токен уже протух, а следующий запрос делать не хочется
     * вслепую.
     */
    /**
     * Определяет срок жизни уже сохранённого токена.
     *
     * Без этого индикатор оставался пустым до первого логина в новой версии,
     * хотя действующий токен уже лежал в Keychain и его `exp` можно прочитать.
     */
    async syncTokenInfo() {
        const { workspace } = get()
        if (!workspace) return

        const context = await getAppContext()
        let changed = false

        for (const environment of workspace.environments) {
            if (environment.tokenExpiresAt) continue

            try {
                const resolved = await context.resolver.resolveEnvironment(workspace, environment)
                const found = findJwt(resolved.variables)
                const info = found ? readJwtInfo(found.token) : undefined
                if (!info) continue

                await context.tokens.set(workspace.id, environment.id, {
                    expiresAt: info.expiresAt.toISOString(),
                    subject: info.subject,
                })
                changed = true
            } catch {
                // Недоступный секрет — не повод падать: индикатор просто
                // покажет, что токен не получен.
            }
        }

        if (changed) set({ workspace: await context.tokens.attach(workspace) })
    },

    async refreshToken() {
        const { workspace, tabs, activeTabId } = get()
        if (!workspace) return

        const activeTab = tabs.find((tab) => tab.id === activeTabId)
        const environment = workspace.environments.find(
            (item) => item.id === (activeTab?.environmentId ?? workspace.defaultEnvironmentId),
        )
        if (!environment?.recovery?.flowId) return

        set({ tokenRefreshing: true })

        try {
            await get().runFlow(environment.recovery.flowId, { confirmed: true })

            // Упавшая цепочка требует разбора: показываем её шаги, иначе
            // пользователь видит только «токен не получен» без причины.
            if (get().flowRun?.ok === false) {
                set({ sidebarTab: 'flows' })
            }

            const context = await getAppContext()
            set({
                workspace: await context.tokens.attach(
                    await context.workspaces.getWorkspace(workspace.id),
                ),
            })
        } finally {
            set({ tokenRefreshing: false })
        }
    },

    /** Сохраняет эндпоинты, окружения и их заголовки. */
    async saveWorkspaceSettings(workspace) {
        const context = await getAppContext()
        await context.workspaces.saveWorkspace(workspace)

        set({
            workspace: await context.tokens.attach(workspace),
            workspaces: await context.workspaces.listWorkspaces(),
        })
    },

    /**
     * Привязывает цепочку подготовки к сохранённой операции.
     *
     * Хранится в метаданных операции, а не во вкладке: подготовка нужна самому
     * запросу и должна работать одинаково из GUI, из цепочки и через MCP.
     */
    async setPrerequisiteFlow(operationRef, flowId) {
        const { workspace } = get()
        if (!workspace) return

        const context = await getAppContext()
        const ref = parseOperationRef(operationRef)
        const operation = await context.workspaces.getOperation(workspace.id, ref)

        await context.workspaces.saveOperation(workspace.id, {
            collectionId: ref.collectionId,
            name: operation.name,
            query: operation.query,
            description: operation.description,
            variables: operation.variables,
            headers: operation.headers,
            endpointId: operation.endpointId,
            environmentId: operation.environmentId,
            prerequisiteFlow: flowId,
        })

        await get().reloadTree()
    },

    /**
     * Сохраняет значение из ответа в переменную текущего окружения.
     *
     * Закрывает разрыв между «получил токен в ответе» и «запросы уходят с этим
     * токеном»: значение попадает в окружение, а по желанию сразу заводится и
     * заголовок авторизации, который его использует.
     */
    async saveValueToEnvironment(input) {
        const { workspace, tabs, activeTabId } = get()
        if (!workspace) return

        const activeTab = tabs.find((tab) => tab.id === activeTabId)
        const environmentId = activeTab?.environmentId ?? workspace.defaultEnvironmentId
        const environment =
            workspace.environments.find((item) => item.id === environmentId) ??
            workspace.environments[0]
        if (!environment) return

        const context = await getAppContext()

        // Секрет уходит в Keychain, в файле остаётся только ссылка на него.
        environment.variables[input.name] = input.secret
            ? await context.resolver.storeSecret(
                  workspace.id,
                  environment.id,
                  input.name,
                  input.value,
              )
            : input.value

        if (input.asAuthHeader) {
            environment.headers = {
                ...environment.headers,
                authorization: `Bearer {{${input.name}}}`,
            }
        }

        // Срок жизни из `exp` позволяет обновить токен заранее и показать
        // остаток времени в шапке.
        const info = readJwtInfo(input.value)
        if (info) {
            await context.tokens.set(workspace.id, environment.id, {
                expiresAt: info.expiresAt.toISOString(),
                subject: info.subject,
            })
        }

        await get().saveWorkspaceSettings({ ...workspace })
    },

    /** Перечитывает журнал действий агента с диска. */
    async loadActivity() {
        const context = await getAppContext()
        const store = new ActivityStore(context.fs, context.paths)

        set({ activitySessions: await store.listSessions() })
    },

    async updateSettings(patch) {
        const next = SettingsSchema.parse({ ...get().settings, ...patch })

        applySettings(next)
        set({ settings: next })

        const context = await getAppContext()
        context.secrets.use(next.secrets.storage)
        await context.workspaces.saveSettings(next)
    },

    setLayoutPreset(preset) {
        set({ layoutPreset: preset })
        scheduleSessionSave(get)
    },

    setLayoutSizes(key, sizes) {
        set((state) => ({ layoutSizes: { ...state.layoutSizes, [key]: sizes } }))
        scheduleSessionSave(get)
    },

    toggleSidebar() {
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }))
        scheduleSessionSave(get)
    },

    setSidebarTab(tab) {
        set({ sidebarTab: tab })
        scheduleSessionSave(get)
    },

    setPaletteOpen(open) {
        set({ paletteOpen: open })
    },

    setDialog(dialog) {
        set({ dialog })
    },

    async flushAll() {
        await Promise.all([...draftSavers.values()].map((saver) => saver.flush()))
        await Promise.all([...flowDraftSavers.values()].map((saver) => saver.flush()))
        await sessionSaver.flush()
    },
}))

/**
 * Применяет настройки к документу.
 *
 * Тема и размер шрифта редактора живут в CSS-переменных, поэтому меняются без
 * пересоздания редакторов и без перерисовки дерева компонентов.
 */
function applySettings(settings: ISettings): void {
    const root = document.documentElement

    if (settings.theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', settings.theme)

    root.style.setProperty('--code-size', `${settings.editor.fontSize}px`)
    root.style.setProperty('--window-opacity', String(settings.appearance.opacity))

    // Материал задаётся нативно: степень размытия — свойство окна, а не CSS.
    void invokeSafely('set_window_material', { material: settings.appearance.material }).catch(() => {
        // Вне macOS команда ничего не делает — приложение работает без эффекта.
    })
}

/** Читает схему из кэша, чтобы автокомплит работал сразу после запуска. */
async function loadCachedSchema(
    workspace: IWorkspace,
    set: (partial: Partial<IAppState>) => void,
): Promise<void> {
    const endpointId = workspace.defaultEndpointId ?? workspace.endpoints[0]?.id
    if (!endpointId) return

    const context = await getAppContext()
    const schema = await context.schemas.getSchema(workspace.id, endpointId)
    if (schema) set({ schema })
}

function requireContent(
    contents: Record<string, ITabContent>,
    tabId: string,
): ITabContent {
    return contents[tabId] ?? { query: '', variables: '{}', headers: {} }
}

function setRun(
    set: (updater: (state: IAppState) => Partial<IAppState>) => void,
    tabId: string,
    run: ITabRun,
): void {
    set((state) => ({ runs: { ...state.runs, [tabId]: run } }))
}

/**
 * Планирует запись черновика вкладки.
 *
 * Отдельный дебаунсер на вкладку: набор текста в одной вкладке не должен
 * откладывать запись соседней.
 */
function scheduleDraftSave(tabId: string, get: () => IAppStore): void {
    let saver = draftSavers.get(tabId)
    if (!saver) {
        saver = new Debouncer(AUTOSAVE_DELAY_MS)
        draftSavers.set(tabId, saver)
    }

    saver.schedule(async () => {
        const content = get().contents[tabId]
        if (!content) return

        const context = await getAppContext()
        await context.sessions.writeDraftQuery(tabId, content.query)
        await context.sessions.writeDraftData(tabId, {
            variables: content.variables,
            headers: content.headers,
        })
    })
}

function scheduleSessionSave(get: () => IAppStore): void {
    sessionSaver.schedule(async () => {
        const state = get()
        const context = await getAppContext()

        // В файл уходят вкладки всех workspace: текущие плюс отложенные.
        const others = Object.entries(state.tabsByWorkspace)
        const activeTabs: Record<string, string> = {}
        for (const [workspaceId, group] of others) {
            if (group.activeTabId) activeTabs[workspaceId] = group.activeTabId
        }
        if (state.workspace && state.activeTabId) activeTabs[state.workspace.id] = state.activeTabId

        const layouts = { ...state.layouts }
        if (state.workspace) layouts[state.workspace.id] = currentLayout(state)

        const session: ISession = SessionSchema.parse({
            version: 1,
            workspaceId: state.workspace?.id,
            activeTabId: state.activeTabId,
            tabs: [...state.tabs, ...others.flatMap(([, group]) => group.tabs)],
            activeTabs,
            layouts,
        })

        await context.sessions.save(session)
    })
}

/** Запрос подтверждения для действия на боевом окружении. */
function productionConfirm(
    environmentName: string,
    description: string,
    run: () => Promise<void>,
): IConfirmRequest {
    return {
        title: 'Боевое окружение',
        description: `Сейчас выполнится ${description} в окружении «${environmentName}». Это изменит боевые данные.`,
        actionLabel: 'Выполнить на PROD',
        danger: true,
        production: true,
        run,
    }
}

/** Раскладка активного workspace в форме, пригодной для сессии. */
function currentLayout(state: IAppState): ILayoutState {
    return {
        preset: state.layoutPreset,
        sizes: state.layoutSizes,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarTab: state.sidebarTab,
    }
}

/**
 * Делит вкладки сессии на набор текущего workspace и запас остальных.
 *
 * Активная вкладка каждого workspace восстанавливается из `activeTabs`;
 * для сессий старых версий берётся общий `activeTabId`.
 */
function splitTabs(
    all: ITabState[],
    workspaceId: string | undefined,
    activeTabs: Record<string, string>,
    legacyActive: string | undefined,
): { tabs: ITabState[]; activeTabId?: string; rest: IAppState['tabsByWorkspace'] } {
    const rest: IAppState['tabsByWorkspace'] = {}
    const tabs: ITabState[] = []

    for (const tab of all) {
        if (tab.workspaceId === workspaceId) {
            tabs.push(tab)
            continue
        }

        const owner = tab.workspaceId ?? ''
        const group = (rest[owner] ??= { tabs: [], activeTabId: activeTabs[owner] })
        group.tabs.push(tab)
    }

    const wanted = workspaceId ? (activeTabs[workspaceId] ?? legacyActive) : legacyActive
    const activeTabId = tabs.some((tab) => tab.id === wanted) ? wanted : tabs[0]?.id

    return { tabs, activeTabId, rest }
}

function scheduleFlowDraftSave(tabId: string, get: () => IAppStore): void {
    let saver = flowDraftSavers.get(tabId)
    if (!saver) {
        saver = new Debouncer(AUTOSAVE_DELAY_MS)
        flowDraftSavers.set(tabId, saver)
    }

    saver.schedule(async () => {
        const draft = get().flowDrafts[tabId]
        if (!draft || !isTauri()) return

        const context = await getAppContext()
        await context.sessions.writeFlowDraft(tabId, draft)
    })
}

/** Открывает подписку и складывает события в состояние вкладки. */
async function startSubscription(
    tab: ITabState,
    workspaceId: string,
    content: ITabContent,
    variables: Record<string, unknown>,
    set: (updater: (state: IAppState) => Partial<IAppState>) => void,
    get: () => IAppStore,
): Promise<void> {
    get().subscriptions[tab.id]?.()

    const context = await getAppContext()
    set((state) => ({
        runs: { ...state.runs, [tab.id]: { status: 'streaming', events: [], startedAt: Date.now() } },
    }))

    try {
        const unsubscribe = await context.runner.subscribe(
            {
                workspaceId,
                query: content.query,
                variables,
                headers: content.headers,
                endpointId: tab.endpointId,
                environmentId: tab.environmentId,
                operationName: extractOperationName(content.query),
            },
            {
                onNext: (payload) => {
                    set((state) => {
                        const previous = state.runs[tab.id] ?? { status: 'streaming', events: [] }
                        // Лог ограничен по длине: бесконечный поток событий
                        // иначе съел бы память за несколько минут.
                        const events = [
                            ...previous.events,
                            { at: Date.now(), payload },
                        ].slice(-MAX_SUBSCRIPTION_EVENTS)

                        return { runs: { ...state.runs, [tab.id]: { ...previous, events } } }
                    })
                },
                onError: (error) => {
                    set((state) => ({
                        runs: {
                            ...state.runs,
                            [tab.id]: {
                                ...(state.runs[tab.id] ?? { events: [] }),
                                status: 'error',
                                error: error.message,
                                events: state.runs[tab.id]?.events ?? [],
                            },
                        },
                    }))
                },
                onComplete: () => {
                    set((state) => ({
                        runs: {
                            ...state.runs,
                            [tab.id]: {
                                ...(state.runs[tab.id] ?? { events: [] }),
                                status: 'done',
                                events: state.runs[tab.id]?.events ?? [],
                            },
                        },
                    }))
                },
            },
        )

        set((state) => ({ subscriptions: { ...state.subscriptions, [tab.id]: unsubscribe } }))
    } catch (error) {
        set((state) => ({
            runs: {
                ...state.runs,
                [tab.id]: { status: 'error', error: toErrorMessage(error), events: [] },
            },
        }))
    }
}

/** Разбирает текст переменных; ошибка возвращается значением, а не исключением. */
export function parseVariables(raw: string): Record<string, unknown> | Error {
    const trimmed = raw.trim()
    if (trimmed.length === 0) return {}

    try {
        const parsed: unknown = JSON.parse(trimmed)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return new Error('Переменные должны быть JSON-объектом')
        }

        return parsed as Record<string, unknown>
    } catch (error) {
        return new Error(`Переменные: некорректный JSON — ${toErrorMessage(error)}`)
    }
}

/** Имя операции из текста запроса — нужно серверу при нескольких определениях. */
export function extractOperationName(query: string): string | undefined {
    const match = /\b(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query)

    return match?.[1]
}
