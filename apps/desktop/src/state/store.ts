import {
    Debouncer,
    detectOperationKind,
    formatAppLink,
    formatCurl,
    historyTitle,
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
    EnvironmentWriter,
    validateVariables,
    toErrorMessage,
    type ICollection,
    FlowSchema,
    toSlug,
    createDemoWorkspace,
    DEMO_WORKSPACE_ID,
    importBundle,
    type IAppLink,
    type IFlow,
    type IImportBundle,
    type IImportResult,
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
    type IEndpoint,
    type IEnvironment,
    type IEnvironmentCapture,
    type IWorkspace,
    type IWorkspaceSelection,
} from '@resolvr/core'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { parse, print, type GraphQLSchema } from 'graphql'
import { create } from 'zustand'

import { resolveLanguage, setLanguage, t } from '../i18n/index.js'
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
    | 'import'

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
    /** Третья кнопка между «Отмена» и основным действием — например, «Не сохранять». */
    secondaryLabel?: string
    secondaryRun?: () => Promise<void> | void
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

    /**
     * Выбранные окружение и эндпоинт по workspace. Выбор общий для всех вкладок:
     * переключение в одной вкладке меняет его везде.
     */
    selections: Record<string, IWorkspaceSelection>

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
    /** История переходов браузера схемы по вкладкам. */
    schemaNav: Record<string, { history: string[]; index: number }>
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
    /** Вкладка-черновик, которую закрыть сразу после сохранения через диалог. */
    closeAfterSaveTabId?: string

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
    /** Создаёт демо-workspace на публичном API и открывает первую операцию. */
    openDemoWorkspace(): Promise<void>

    openTab(input?: { operationRef?: string; title?: string; query?: string }): Promise<void>
    /**
     * Открывает запуск из истории: запрос, переменные и — если тело
     * сохранилось — сам ответ, как будто запрос только что выполнен.
     */
    openHistoryEntry(entry: IHistoryEntry): Promise<void>
    /** Открывает редактор цепочки вкладкой; без `flowId` — новую цепочку. */
    openFlowTab(flowId?: string): Promise<void>
    /**
     * Открывает тип в браузере схемы. Вкладка одна и переиспользуется:
     * переходы между типами ведут историю назад/вперёд внутри неё.
     */
    openSchemaTab(typeName?: string): void
    navigateSchema(tabId: string, typeName: string): void
    schemaGoBack(tabId: string): void
    schemaGoForward(tabId: string): void
    /** Открывает то, на что указывает ссылка `resolvr://`, переключая workspace. */
    openLink(link: IAppLink): Promise<void>
    /** Ссылка на операцию или цепочку текущего workspace для отправки коллеге. */
    linkTo(target: { operationRef?: string; flowId?: string }): string | undefined
    updateFlowDraft(tabId: string, flow: IFlow): void
    /** Сохраняет черновик цепочки из вкладки; возвращает ошибку валидации. */
    saveFlowTab(tabId: string): Promise<string | undefined>
    /** Закрывает вкладку; несохранённые изменения — только после вопроса. */
    closeTab(tabId: string): Promise<void>
    /** Закрывает вкладки без вопросов; черновики удаляются. */
    closeTabs(tabIds: string[]): Promise<void>
    /**
     * Закрывает вкладки, предлагая сохранить изменённые: «Сохранить»,
     * «Не сохранять» или «Отмена».
     */
    requestCloseTabs(tabIds: string[]): Promise<void>
    closeOtherTabs(tabId: string): Promise<void>
    closeTabsToLeft(tabId: string): Promise<void>
    closeTabsToRight(tabId: string): Promise<void>
    closeAllTabs(): Promise<void>
    activateTab(tabId: string): void
    updateQuery(tabId: string, query: string): void
    updateVariables(tabId: string, variables: string): void
    updateHeaders(tabId: string, headers: Record<string, string>): void
    /** Выбирает окружение для всего workspace. */
    setActiveEnvironment(environmentId: string): void
    /** Выбирает эндпоинт для всего workspace и подгружает его схему из кэша. */
    setActiveEndpoint(endpointId: string): Promise<void>
    setBottomTab(tabId: string, tab: ITabState['bottomTab']): void
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
    /** Записывает распознанный экспорт Postman/Insomnia в текущий workspace. */
    importFromBundle(bundle: IImportBundle): Promise<IImportResult>
    renameCollection(collectionId: string, name: string): Promise<void>
    deleteCollection(collectionId: string): Promise<void>
    /**
     * Перенос или переименование операции; открытые вкладки и черновики
     * цепочек следуют за ней. `index` — позиция в целевой коллекции.
     */
    moveOperation(
        from: string,
        to: { collectionId: string; name: string },
        options?: { index?: number },
    ): Promise<void>
    /** Переставляет операцию внутри коллекции перед или после другой. */
    reorderOperation(ref: string, targetRef: string, position: 'before' | 'after'): Promise<void>
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
    /** Задаёт правила сохранения ответа операции в окружение после каждого запуска. */
    setEnvironmentCaptures(operationRef: string, captures: IEnvironmentCapture[]): Promise<void>
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
    selections: {},
    contents: {},
    runs: {},
    flowDrafts: {},
    reports: {},
    reportRunning: false,
    schemaNav: {},
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
            await Promise.all(
                allTabs.map(async (tab) => {
                    if (tab.kind === 'report') {
                        const report = await context.sessions.readReport(tab.id)
                        if (report) reports[tab.id] = report

                        return
                    }
                    if (tab.kind === 'flow') {
                        const draft =
                            (await context.sessions.readFlowDraft(tab.id)) ??
                            (tab.flowId && tab.workspaceId
                                ? await context.workspaces
                                      .getFlow(tab.workspaceId, tab.flowId)
                                      .catch(() => undefined)
                                : undefined)
                        if (draft) flowDrafts[tab.id] = draft

                        return
                    }

                    const [query, data] = await Promise.all([
                        context.sessions.readDraftQuery(tab.id),
                        context.sessions.readDraftData(tab.id),
                    ])
                    contents[tab.id] = { query, variables: data.variables, headers: data.headers }
                }),
            )

            await context.sessions.pruneOrphanDrafts(allTabs)

            const split = splitTabs(allTabs, workspace?.id, session.activeTabs, session.activeTabId)

            // Раскладка старых версий лежала в workspace.json — берётся оттуда,
            // если в сессии её ещё нет.
            const layouts = { ...session.layouts }
            if (workspace && !layouts[workspace.id] && workspace.layout) {
                layouts[workspace.id] = workspace.layout
            }
            const layout = workspace ? layouts[workspace.id] : undefined
            const selections = migrateSelections(session.selections, allTabs, split.activeTabId)

            set({
                ready: true,
                settings,
                workspaces,
                workspace,
                selections,
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
                await loadCachedSchema(workspace, activeEndpointOf(workspace, selections), set)

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

        const [tree, flows] = await Promise.all([
            Promise.all(
                collections.map(async (collection) => ({
                    collection,
                    operations: await context.workspaces.listOperations(workspace.id, collection.id),
                })),
            ),
            context.workspaces.listFlows(workspace.id),
        ])

        set({ tree, flows })
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
        await loadCachedSchema(workspace, activeEndpointOf(workspace, get().selections), set)
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

    async openDemoWorkspace() {
        const context = await getAppContext()
        const exists = get().workspaces.some((item) => item.id === DEMO_WORKSPACE_ID)
        if (!exists) {
            await createDemoWorkspace(context.workspaces)
            set({ workspaces: await context.workspaces.listWorkspaces() })
        }

        await get().selectWorkspace(DEMO_WORKSPACE_ID)
        await get().refreshSchema()
        await get().openTab({ operationRef: 'countries/Continents' })
    },

    async openTab(input = {}) {
        const context = await getAppContext()
        const { workspace } = get()

        // Сохранённая операция открыта не больше одного раза: повторный клик
        // в коллекции возвращает к её вкладке, а не плодит копии.
        if (input.operationRef) {
            const existing = get().tabs.find((tab) => tab.operationRef === input.operationRef)
            if (existing) {
                get().activateTab(existing.id)

                return
            }
        }

        const tabId = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        let query = input.query ?? ''
        let variables = '{}'
        let headers: Record<string, string> = {}
        let title = input.title ?? t('New request')

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
        await get().requestCloseTabs([tabId])
    },

    async requestCloseTabs(tabIds) {
        const dirty = get().tabs.filter(
            (tab) => tabIds.includes(tab.id) && tab.dirty && (tab.kind === 'operation' || tab.kind === 'flow'),
        )
        if (dirty.length === 0) {
            await get().closeTabs(tabIds)

            return
        }

        const [single] = dirty
        get().requestConfirm({
            title: t('Unsaved changes'),
            description:
                dirty.length === 1 && single
                    ? t('“{name}” has unsaved changes. Save them before closing?', { name: single.title })
                    : t('{n} tabs have unsaved changes. Save them before closing?', { n: dirty.length }),
            actionLabel: t('Save'),
            danger: false,
            secondaryLabel: t('Don’t save'),
            secondaryRun: () => get().closeTabs(tabIds),
            run: async () => {
                const keep = new Set<string>()
                for (const tab of dirty) {
                    if (!(await saveTab(tab.id, set, get))) keep.add(tab.id)
                }
                await get().closeTabs(tabIds.filter((tabId) => !keep.has(tabId)))

                // Черновик без места хранения сохраняется через диалог; вкладка
                // закроется, когда диалог сохранит её.
                const draft = get().tabs.find((tab) => keep.has(tab.id) && tab.kind === 'operation')
                if (draft) {
                    get().activateTab(draft.id)
                    set({ closeAfterSaveTabId: draft.id, dialog: 'save' })
                }
            },
        })
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
            const schemaNav = { ...state.schemaNav }
            for (const tabId of closing) {
                delete contents[tabId]
                delete runs[tabId]
                delete subscriptions[tabId]
                delete flowDrafts[tabId]
                delete reports[tabId]
                delete schemaNav[tabId]
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
                schemaNav,
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
        await get().requestCloseTabs(get().tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id))
    },

    async closeTabsToLeft(tabId) {
        const { tabs } = get()
        const index = tabs.findIndex((tab) => tab.id === tabId)
        await get().requestCloseTabs(tabs.slice(0, Math.max(index, 0)).map((tab) => tab.id))
    },

    async closeTabsToRight(tabId) {
        const { tabs } = get()
        const index = tabs.findIndex((tab) => tab.id === tabId)
        await get().requestCloseTabs(tabs.slice(index + 1).map((tab) => tab.id))
    },

    async closeAllTabs() {
        await get().requestCloseTabs(get().tabs.map((tab) => tab.id))
    },

    async openHistoryEntry(entry) {
        const title = historyTitle(entry) ?? t('From history')
        await get().openTab({ query: entry.query, title })

        const tabId = get().activeTabId
        if (!tabId) return

        get().updateVariables(tabId, `${JSON.stringify(entry.variables, null, 2)}\n`)
        // Вкладка из истории — не черновик: текст и переменные взяты как есть.
        set((state) => ({
            tabs: state.tabs.map((tab) =>
                tab.id === tabId ? { ...tab, dirty: false } : tab,
            ),
        }))

        if (entry.responseBody === undefined) return

        let data: unknown
        let errors: unknown[] | undefined
        try {
            const parsed = JSON.parse(entry.responseBody) as { data?: unknown; errors?: unknown[] }
            data = parsed.data
            errors = parsed.errors
        } catch {
            // Не JSON — покажется как сырое тело.
        }

        setRun(set, tabId, {
            status: 'done',
            events: [],
            result: {
                ok: entry.ok,
                status: entry.status,
                statusText: entry.statusText ?? '',
                headers: entry.responseHeaders,
                body: entry.responseBody,
                data,
                errors,
                kind: entry.kind,
                durationMs: entry.durationMs,
                responseBytes: entry.responseBytes,
                requestHeaders: entry.requestHeaders,
                endpointId: entry.endpointId,
                environmentId: entry.environmentId,
            },
        })
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
            name: t('New flow'),
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

    openSchemaTab(typeName) {
        const { workspace, tabs, schema } = get()
        if (!workspace) return

        const target = typeName ?? schema?.getQueryType()?.name ?? 'Query'
        const existing = tabs.find((tab) => tab.kind === 'schema')
        if (existing) {
            get().activateTab(existing.id)
            if (existing.schemaType !== target) get().navigateSchema(existing.id, target)

            return
        }

        const tabId = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
        const tab = TabStateSchema.parse({
            id: tabId,
            kind: 'schema',
            workspaceId: workspace.id,
            schemaType: target,
            title: target,
        })

        set((state) => ({
            tabs: [...state.tabs, tab],
            activeTabId: tabId,
            schemaNav: { ...state.schemaNav, [tabId]: { history: [target], index: 0 } },
        }))
        scheduleSessionSave(get)
    },

    navigateSchema(tabId, typeName) {
        set((state) => {
            const current = state.schemaNav[tabId] ?? {
                history: [state.tabs.find((tab) => tab.id === tabId)?.schemaType ?? typeName],
                index: 0,
            }
            // Переход обрезает «вперёд», как в браузере.
            const history = [...current.history.slice(0, current.index + 1), typeName]

            return {
                schemaNav: { ...state.schemaNav, [tabId]: { history, index: history.length - 1 } },
                tabs: state.tabs.map((tab) =>
                    tab.id === tabId ? { ...tab, schemaType: typeName, title: typeName } : tab,
                ),
            }
        })
        scheduleSessionSave(get)
    },

    schemaGoBack(tabId) {
        moveSchemaHistory(set, tabId, -1)
        scheduleSessionSave(get)
    },

    schemaGoForward(tabId) {
        moveSchemaHistory(set, tabId, 1)
        scheduleSessionSave(get)
    },

    async openLink(link) {
        const { workspace, workspaces } = get()
        if (!workspaces.some((item) => item.id === link.workspaceId)) return

        if (workspace?.id !== link.workspaceId) await get().selectWorkspace(link.workspaceId)

        if (link.operationRef) {
            await get().openTab({ operationRef: link.operationRef })
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
        if (!draft) return t('Flow draft not found')
        if (draft.name.trim().length === 0) return t('Enter a flow name')

        const invalid = draft.steps.find((step) => !step.operationRef && !step.query?.trim())
        if (invalid) return t('Step “{name}”: pick an operation or type a query', { name: invalid.name })

        const parsed = FlowSchema.safeParse({
            ...draft,
            id: draft.id.length > 0 ? draft.id : toSlug(draft.name),
        })
        if (!parsed.success) return parsed.error.issues[0]?.message ?? t('The flow is filled in incorrectly')

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
            // Новый массив вкладок — перерисовка всего, что на него подписано
            // (шапка, сайдбар, полоса вкладок); на каждое нажатие он нужен
            // только пока вкладка ещё не помечена изменённой.
            tabs: markDirty(state.tabs, tabId),
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
            tabs: markDirty(state.tabs, tabId),
        }))

        scheduleDraftSave(tabId, get)
    },

    updateHeaders(tabId, headers) {
        set((state) => ({
            contents: {
                ...state.contents,
                [tabId]: { ...requireContent(state.contents, tabId), headers },
            },
            tabs: markDirty(state.tabs, tabId),
        }))

        scheduleDraftSave(tabId, get)
    },

    setActiveEnvironment(environmentId) {
        const { workspace } = get()
        if (!workspace) return

        set((state) => ({
            selections: {
                ...state.selections,
                [workspace.id]: { ...state.selections[workspace.id], environmentId },
            },
        }))
        scheduleSessionSave(get)
    },

    async setActiveEndpoint(endpointId) {
        const { workspace } = get()
        if (!workspace) return

        set((state) => ({
            selections: {
                ...state.selections,
                [workspace.id]: { ...state.selections[workspace.id], endpointId },
            },
        }))
        scheduleSessionSave(get)

        // Автокомплит должен соответствовать схеме выбранного эндпоинта.
        const endpoint = activeEndpointOf(workspace, get().selections)
        if (endpoint) {
            const context = await getAppContext()
            const schema = await context.schemas.getSchema(workspace.id, endpoint.id)
            set({ schema: schema ?? undefined, schemaFetchedAt: undefined })
        }
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
        const environment = selectActiveEnvironment(state)
        if (kind === 'mutation' && environment?.production && !options.confirmed) {
            get().requestConfirm(
                productionConfirm(
                    environment.name,
                    t('mutation {name}', { name: extractOperationName(content.query) ?? t('unnamed') }),
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
                endpointId: selectActiveEndpoint(state)?.id,
                environmentId: environment?.id,
                operationName: extractOperationName(content.query),
                timeoutMs: state.settings.request.timeoutMs,
                saveToEnvironment: findOperation(state.tree, tab.operationRef)?.saveToEnvironment ?? [],
            })

            setRun(set, tab.id, { status: 'done', result, events: [] })
            if (result.savedVariables) {
                set({
                    workspace: await context.tokens.attach(
                        await context.workspaces.getWorkspace(workspace.id),
                    ),
                })
            }
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
        const { activeTabId } = get()
        if (!activeTabId) return

        await saveOperationTab(activeTabId, collectionId, name, set, get)

        if (get().closeAfterSaveTabId === activeTabId) {
            set({ closeAfterSaveTabId: undefined })
            await get().closeTabs([activeTabId])
        }
    },

    async refreshSchema() {
        const { workspace } = get()
        if (!workspace) return

        const endpoint = selectActiveEndpoint(get())

        if (!endpoint) {
            set({ schemaError: t('The workspace has no endpoints') })

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
        const { workspace } = get()
        if (!workspace) return

        const endpointId = selectActiveEndpoint(get())?.id
        if (!endpointId) return

        const context = await getAppContext()
        const previous = await context.schemas.getPreviousSdl(workspace.id, endpointId)
        const current = await context.schemas.getSdl(workspace.id, endpointId)

        if (!previous || !current) {
            set({
                schemaDiff: [],
                schemaDiffNote:
                    t('No previous snapshot — refresh the schema again after the server changes'),
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

        const environment = selectActiveEnvironment(get())
        const environmentId = environment?.id

        // Цепочка почти всегда содержит мутации — на боевом окружении она
        // требует того же подтверждения, что и одиночная мутация.
        if (environment?.production && !options.confirmed) {
            const flow = get().flows.find((item) => item.id === flowId)
            get().requestConfirm(
                productionConfirm(environment.name, t('flow “{name}”', { name: flow?.name ?? flowId }), () =>
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
        const { workspace, flows } = get()
        if (!workspace || flows.length === 0 || get().reportRunning) return

        const environment = selectActiveEnvironment(get())
        const environmentId = environment?.id

        if (environment?.production && !options.confirmed) {
            get().requestConfirm(
                productionConfirm(environment.name, t('run of all flows ({n})', { n: flows.length }), () =>
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
                          title: t('Flows run'),
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

    async importFromBundle(bundle) {
        const context = await getAppContext()
        let workspace = get().workspace

        // Импорт до первого workspace: создаём его сразу, эндпоинт человек
        // впишет в настройках — форма с URL здесь только мешала бы.
        if (!workspace) {
            workspace = await context.workspaces.createWorkspace({ name: 'Imported' })
            set({ workspaces: await context.workspaces.listWorkspaces() })
            await get().selectWorkspace(workspace.id)
        }

        const result = await importBundle(context.workspaces, workspace.id, bundle)

        set({ workspace: await context.tokens.attach(await context.workspaces.getWorkspace(workspace.id)) })
        await get().reloadTree()

        return result
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

    async moveOperation(from, to, options = {}) {
        const { workspace } = get()
        if (!workspace) return

        const context = await getAppContext()
        await context.workspaces.moveOperation(workspace.id, parseOperationRef(from), to, options)

        // Файлы цепочек ядро уже переписало; открытые черновики цепочек
        // переписываются здесь, иначе сохранение черновика вернуло бы старую ссылку.
        const nextRef = formatOperationRef(to)
        const changedDrafts: string[] = []
        set((state) => {
            const flowDrafts = { ...state.flowDrafts }
            for (const [tabId, draft] of Object.entries(flowDrafts)) {
                if (!draft.steps.some((step) => step.operationRef === from)) continue

                flowDrafts[tabId] = {
                    ...draft,
                    steps: draft.steps.map((step) =>
                        step.operationRef === from ? { ...step, operationRef: nextRef } : step,
                    ),
                }
                changedDrafts.push(tabId)
            }

            return {
                flowDrafts,
                tabs: state.tabs.map((tab) =>
                    tab.operationRef === from ? { ...tab, operationRef: nextRef, title: to.name } : tab,
                ),
            }
        })
        for (const tabId of changedDrafts) scheduleFlowDraftSave(tabId, get)
        scheduleSessionSave(get)

        set({ workspace: await context.tokens.attach(await context.workspaces.getWorkspace(workspace.id)) })
        await get().reloadTree()
    },

    async reorderOperation(ref, targetRef, position) {
        const { workspace, tree } = get()
        if (!workspace || ref === targetRef) return

        const source = parseOperationRef(ref)
        const target = parseOperationRef(targetRef)
        const node = tree.find((item) => item.collection.id === target.collectionId)
        if (!node) return

        if (source.collectionId !== target.collectionId) {
            const names = node.operations.map((operation) => operation.name)
            const index = names.indexOf(target.name) + (position === 'after' ? 1 : 0)
            await get().moveOperation(ref, { collectionId: target.collectionId, name: source.name }, { index })

            return
        }

        const rest = node.operations.filter((operation) => operation.name !== source.name)
        const moving = node.operations.find((operation) => operation.name === source.name)
        if (!moving) return

        const index = rest.findIndex((operation) => operation.name === target.name) + (position === 'after' ? 1 : 0)
        const operations = [...rest.slice(0, index), moving, ...rest.slice(index)]

        // Дерево обновляется сразу: иначе строка «прыгала» бы обратно до конца записи.
        set((state) => ({
            tree: state.tree.map((item) =>
                item.collection.id === target.collectionId ? { ...item, operations } : item,
            ),
        }))

        const context = await getAppContext()
        try {
            await context.workspaces.reorderOperations(
                workspace.id,
                target.collectionId,
                operations.map((operation) => operation.name),
            )
        } finally {
            await get().reloadTree()
        }
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
            saveToEnvironment: operation.saveToEnvironment,
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
            endpointId: selectActiveEndpoint(state)?.id,
            environmentId: selectActiveEnvironment(state)?.id,
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
        const { workspace } = get()
        if (!workspace) return

        const environment = selectActiveEnvironment(get())
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
            saveToEnvironment: operation.saveToEnvironment,
        })

        await get().reloadTree()
    },

    async setEnvironmentCaptures(operationRef, captures) {
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
            prerequisiteFlow: operation.prerequisiteFlow,
            saveToEnvironment: captures,
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
        const { workspace } = get()
        if (!workspace) return

        const environment = selectActiveEnvironment(get()) ?? workspace.environments[0]
        if (!environment) return

        const context = await getAppContext()

        // Секрет уходит в хранилище секретов, в файле остаётся только ссылка на него.
        await new EnvironmentWriter(context.workspaces, context.resolver, context.tokens).save(
            workspace.id,
            environment.id,
            [{ name: input.name, value: input.value, secret: input.secret }],
            { authHeaderFor: input.asAuthHeader ? input.name : undefined },
        )

        set({
            workspace: await context.tokens.attach(await context.workspaces.getWorkspace(workspace.id)),
            workspaces: await context.workspaces.listWorkspaces(),
        })
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
        // Отменённое сохранение черновика отменяет и его закрытие.
        set(dialog === 'save' ? { dialog } : { dialog, closeAfterSaveTabId: undefined })
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

    // Язык интерфейса и нативного меню: меню пересобирается в Rust.
    const language = resolveLanguage(settings.language)
    setLanguage(language)
    void invokeSafely('set_menu_language', { language }).catch(() => undefined)

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
    endpoint: IEndpoint | undefined,
    set: (partial: Partial<IAppState>) => void,
): Promise<void> {
    if (!endpoint) return

    const context = await getAppContext()
    const schema = await context.schemas.getSchema(workspace.id, endpoint.id)
    if (schema) set({ schema })
}

/**
 * Окружение, выбранное в workspace.
 *
 * Выбор, указывающий на удалённое окружение, игнорируется — действует
 * окружение по умолчанию.
 */
function activeEnvironmentOf(
    workspace: IWorkspace,
    selections: Record<string, IWorkspaceSelection>,
): IEnvironment | undefined {
    const selected = selections[workspace.id]?.environmentId

    return (
        workspace.environments.find((item) => item.id === selected) ??
        workspace.environments.find((item) => item.id === workspace.defaultEnvironmentId)
    )
}

/** Эндпоинт, выбранный в workspace; иначе — по умолчанию или первый. */
function activeEndpointOf(
    workspace: IWorkspace,
    selections: Record<string, IWorkspaceSelection>,
): IEndpoint | undefined {
    const selected = selections[workspace.id]?.endpointId

    return (
        workspace.endpoints.find((item) => item.id === selected) ??
        workspace.endpoints.find((item) => item.id === workspace.defaultEndpointId) ??
        workspace.endpoints[0]
    )
}

/** Окружение, общее для всех вкладок текущего workspace. */
export function selectActiveEnvironment(
    state: Pick<IAppState, 'workspace' | 'selections'>,
): IEnvironment | undefined {
    return state.workspace ? activeEnvironmentOf(state.workspace, state.selections) : undefined
}

/** Эндпоинт, общий для всех вкладок текущего workspace. */
export function selectActiveEndpoint(
    state: Pick<IAppState, 'workspace' | 'selections'>,
): IEndpoint | undefined {
    return state.workspace ? activeEndpointOf(state.workspace, state.selections) : undefined
}

/**
 * Выбор окружения из сессий старых версий.
 *
 * Раньше окружение выбиралось во вкладке: для workspace без общего выбора
 * берётся выбор его активной (или первой) вкладки, чтобы после обновления
 * запросы не ушли в другое окружение.
 */
function migrateSelections(
    saved: Record<string, IWorkspaceSelection>,
    tabs: ITabState[],
    activeTabId: string | undefined,
): Record<string, IWorkspaceSelection> {
    const selections = { ...saved }
    const ordered = [...tabs].sort((left, right) =>
        left.id === activeTabId ? -1 : right.id === activeTabId ? 1 : 0,
    )

    for (const tab of ordered) {
        if (!tab.workspaceId || selections[tab.workspaceId]) continue
        if (!tab.environmentId && !tab.endpointId) continue

        selections[tab.workspaceId] = {
            environmentId: tab.environmentId,
            endpointId: tab.endpointId,
        }
    }

    return selections
}

/** Операция дерева коллекций по ссылке `collection/operation`. */
export function findOperation(tree: ICollectionNode[], operationRef: string | undefined): IOperation | undefined {
    if (!operationRef) return undefined

    const ref = parseOperationRef(operationRef)

    return tree
        .find((node) => node.collection.id === ref.collectionId)
        ?.operations.find((operation) => operation.name === ref.name)
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
        // Вне Tauri (витрина, тесты) диска нет: отложенная запись стреляла бы
        // после завершения теста и падала на несуществующем `invoke`.
        if (!content || !isTauri()) return

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
        if (!isTauri()) return

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
            selections: state.selections,
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
        title: t('Production'),
        description: t('This will run {what} in environment “{env}”. It changes production data.', {
            what: description,
            env: environmentName,
        }),
        actionLabel: t('Run on PROD'),
        danger: true,
        production: true,
        run,
    }
}

/** Сдвиг по истории браузера схемы; за границы не выходит. */
function moveSchemaHistory(
    set: (updater: (state: IAppState) => Partial<IAppState>) => void,
    tabId: string,
    delta: -1 | 1,
): void {
    set((state) => {
        const nav = state.schemaNav[tabId]
        if (!nav) return {}

        const index = nav.index + delta
        const typeName = nav.history[index]
        if (typeName === undefined) return {}

        return {
            schemaNav: { ...state.schemaNav, [tabId]: { ...nav, index } },
            tabs: state.tabs.map((tab) =>
                tab.id === tabId ? { ...tab, schemaType: typeName, title: typeName } : tab,
            ),
        }
    })
}

/** Помечает вкладку изменённой; возвращает тот же массив, если она уже помечена. */
function markDirty(tabs: ITabState[], tabId: string): ITabState[] {
    const tab = tabs.find((item) => item.id === tabId)
    if (!tab || tab.dirty) return tabs

    return tabs.map((item) => (item.id === tabId ? { ...item, dirty: true } : item))
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
                endpointId: selectActiveEndpoint(get())?.id,
                environmentId: selectActiveEnvironment(get())?.id,
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

/**
 * Сохраняет вкладку-операцию под указанным именем.
 *
 * Перезапись существующей операции сохраняет то, чего нет во вкладке:
 * описание, цепочку подготовки и правила сохранения в окружение.
 */
async function saveOperationTab(
    tabId: string,
    collectionId: string,
    name: string,
    set: (updater: (state: IAppState) => Partial<IAppState>) => void,
    get: () => IAppStore,
): Promise<void> {
    const state = get()
    const tab = state.tabs.find((item) => item.id === tabId)
    const workspace = state.workspace
    if (!tab || !workspace) return

    const content = state.contents[tab.id]
    if (!content) return

    const context = await getAppContext()
    const variables = parseVariables(content.variables)

    // Перезапись существующей операции сохраняет то, чего нет во вкладке:
    // описание, цепочку подготовки и правила сохранения в окружение.
    const existing = await context.workspaces
        .getOperation(workspace.id, { collectionId, name })
        .catch(() => undefined)

    await context.workspaces.saveOperation(workspace.id, {
        collectionId,
        name,
        query: content.query,
        description: existing?.description,
        variables: variables instanceof Error ? {} : variables,
        headers: content.headers,
        endpointId: selectActiveEndpoint(state)?.id,
        environmentId: selectActiveEnvironment(state)?.id,
        prerequisiteFlow: existing?.prerequisiteFlow,
        saveToEnvironment: existing?.saveToEnvironment,
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
}

/**
 * Сохраняет вкладку туда, откуда она открыта.
 *
 * Возвращает `false`, если сохранить некуда (новый черновик) или цепочка
 * заполнена с ошибкой: такую вкладку закрывать нельзя.
 */
async function saveTab(
    tabId: string,
    set: (updater: (state: IAppState) => Partial<IAppState>) => void,
    get: () => IAppStore,
): Promise<boolean> {
    const tab = get().tabs.find((item) => item.id === tabId)
    if (!tab) return true

    if (tab.kind === 'flow') {
        const error = await get().saveFlowTab(tabId)
        if (error) get().activateTab(tabId)

        return error === undefined
    }

    if (!tab.operationRef) return false

    const ref = parseOperationRef(tab.operationRef)
    await saveOperationTab(tabId, ref.collectionId, ref.name, set, get)

    return true
}

/** Разбирает текст переменных; ошибка возвращается значением, а не исключением. */
export function parseVariables(raw: string): Record<string, unknown> | Error {
    const trimmed = raw.trim()
    if (trimmed.length === 0) return {}

    try {
        const parsed: unknown = JSON.parse(trimmed)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return new Error(t('Variables must be a JSON object'))
        }

        return parsed as Record<string, unknown>
    } catch (error) {
        return new Error(t('Variables: invalid JSON — {error}', { error: toErrorMessage(error) }))
    }
}

/** Имя операции из текста запроса — нужно серверу при нескольких определениях. */
export function extractOperationName(query: string): string | undefined {
    const match = /\b(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(query)

    return match?.[1]
}
