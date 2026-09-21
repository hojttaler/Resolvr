import { useCallback, useEffect, useRef, useState } from 'react'
import { Group, Panel, Separator, type GroupImperativeHandle } from 'react-resizable-panels'

import { useAppStore, parseVariables } from '../state/store.js'
import { CodeEditor } from './editor/CodeEditor.js'
import { buildVariablesSkeleton } from './editor/variables-completion.js'
import { ContextMenu, type IContextMenuState } from './ContextMenu.js'
import { KeyValueEditor } from './KeyValueEditor.js'

/* Высота строки редактора и шапки панели — для подгонки под содержимое. */
const LINE_HEIGHT = 19
const HEADER_HEIGHT = 48
const MIN_FIT_HEIGHT = 200
const MIN_QUERY_SHARE = 28
const MAX_QUERY_SHARE = 78

/** Редактор запроса и нижняя панель с переменными и заголовками. */
export function RequestPane(): React.JSX.Element {
    const activeTabId = useAppStore((state) => state.activeTabId)
    const tab = useAppStore((state) => state.tabs.find((item) => item.id === state.activeTabId))
    const content = useAppStore((state) =>
        state.activeTabId ? state.contents[state.activeTabId] : undefined,
    )
    const schema = useAppStore((state) => state.schema)
    const runs = useAppStore((state) => state.runs)
    const updateQuery = useAppStore((state) => state.updateQuery)
    const updateVariables = useAppStore((state) => state.updateVariables)
    const updateHeaders = useAppStore((state) => state.updateHeaders)
    const setBottomTab = useAppStore((state) => state.setBottomTab)
    const runActiveTab = useAppStore((state) => state.runActiveTab)
    const stopActiveTab = useAppStore((state) => state.stopActiveTab)
    const setLayoutSizes = useAppStore((state) => state.setLayoutSizes)
    const layoutSizes = useAppStore((state) => state.layoutSizes)
    const setDialog = useAppStore((state) => state.setDialog)
    const tree = useAppStore((state) => state.tree)
    const flows = useAppStore((state) => state.flows)
    const setPrerequisiteFlow = useAppStore((state) => state.setPrerequisiteFlow)
    const saveActiveTabInPlace = useAppStore((state) => state.saveActiveTabInPlace)
    const activeTabAsCurl = useAppStore((state) => state.activeTabAsCurl)
    const linkTo = useAppStore((state) => state.linkTo)
    const [menu, setMenu] = useState<IContextMenuState | undefined>()

    const groupHandle = useRef<GroupImperativeHandle | null>(null)
    const groupElement = useRef<HTMLDivElement | null>(null)
    const savedLayout = layoutSizes['request-pane']
    const query = content?.query ?? ''

    /**
     * Подгоняет высоту редактора под длину запроса.
     *
     * Фиксированное соотношение оставляло под коротким запросом полэкрана
     * пустоты, а переменные при этом ютились в узкой полосе внизу.
     */
    const fitToContent = useCallback(() => {
        const total = groupElement.current?.clientHeight ?? 0
        if (total < MIN_FIT_HEIGHT) return

        const lines = query.split('\n').length + 1
        const wanted = HEADER_HEIGHT + lines * LINE_HEIGHT
        const percent = Math.min(
            MAX_QUERY_SHARE,
            Math.max(MIN_QUERY_SHARE, Math.round((wanted / total) * 100)),
        )

        groupHandle.current?.setLayout({ query: percent, params: 100 - percent })
    }, [query])

    // Вручную выставленный размер важнее подгонки: пользователь настроил его
    // осознанно, и переопределять этот выбор при каждом переключении нельзя.
    useEffect(() => {
        // Зависимость намеренно одна: подгонка нужна при смене вкладки, а не
        // на каждый набранный символ запроса.
        if (!savedLayout) fitToContent()
    }, [activeTabId])

    if (!activeTabId || !tab || !content) {
        return <div className="empty">Откройте вкладку — ⌘T</div>
    }

    const run = runs[activeTabId]
    const isBusy = run?.status === 'running' || run?.status === 'streaming'

    return (
        <Group
            orientation="vertical"
            className="layout-group"
            elementRef={groupElement}
            groupRef={groupHandle}
            defaultLayout={savedLayout ?? { query: 65, params: 35 }}
            onLayoutChanged={(layout, meta) => {
                if (meta.isUserInteraction) setLayoutSizes('request-pane', layout)
            }}
        >
            <Panel id="query" minSize="25">
                <div className="panel">
                    <div className="panel__header">
                        <span className="panel__title">Запрос</span>
                        <span className="panel__spacer" />

                        {tab.operationRef && flows.length > 0 && (
                            <span className="panel__label">Сначала</span>
                        )}

                        {tab.operationRef && flows.length > 0 && (
                            <select
                                className="select select--compact"
                                value={
                                    tree
                                        .flatMap((node) => node.operations)
                                        .find(
                                            (operation) =>
                                                `${operation.collectionId}/${operation.name}` ===
                                                tab.operationRef,
                                        )?.prerequisiteFlow ?? ''
                                }
                                title="Цепочка, выполняемая перед этим запросом"
                                onChange={(event) => {
                                    if (tab.operationRef) {
                                        void setPrerequisiteFlow(
                                            tab.operationRef,
                                            event.target.value || undefined,
                                        )
                                    }
                                }}
                            >
                                <option value="">— ничего —</option>
                                {flows.map((flow) => (
                                    <option key={flow.id} value={flow.id}>
                                        {flow.name}
                                    </option>
                                ))}
                            </select>
                        )}

                        <button
                            type="button"
                            className="btn btn--quiet"
                            onClick={() => useAppStore.getState().formatActiveQuery()}
                            title="Отформатировать запрос (⌘⇧F)"
                        >
                            Формат
                        </button>

                        <button
                            type="button"
                            className="btn"
                            onClick={() =>
                                void saveActiveTabInPlace().then((saved) => {
                                    if (!saved) setDialog('save')
                                })
                            }
                            title={
                                tab.operationRef
                                    ? `Сохранить в ${tab.operationRef} (⌘S)`
                                    : 'Сохранить в коллекцию (⌘S)'
                            }
                        >
                            {tab.dirty ? 'Сохранить •' : 'Сохранить'}
                        </button>

                        <button
                            type="button"
                            className="btn btn--quiet btn--icon"
                            aria-label="Ещё действия"
                            title="Ещё: curl, сохранить как…"
                            onClick={(event) => {
                                const rect = event.currentTarget.getBoundingClientRect()
                                setMenu({
                                    x: rect.left,
                                    y: rect.bottom + 4,
                                    items: [
                                        {
                                            label: 'Копировать как curl',
                                            hint: 'с токеном',
                                            run: async () =>
                                                navigator.clipboard.writeText(
                                                    await activeTabAsCurl({ maskSecrets: false }),
                                                ),
                                        },
                                        {
                                            label: 'Копировать как curl без секретов',
                                            hint: 'для баг-репорта',
                                            run: async () =>
                                                navigator.clipboard.writeText(
                                                    await activeTabAsCurl({ maskSecrets: true }),
                                                ),
                                        },
                                        ...(tab.operationRef
                                            ? [
                                                  {
                                                      label: 'Копировать ссылку',
                                                      hint: 'resolvr://',
                                                      separated: true,
                                                      run: () =>
                                                          navigator.clipboard.writeText(
                                                              linkTo({
                                                                  operationRef: tab.operationRef,
                                                              }) ?? '',
                                                          ),
                                                  },
                                              ]
                                            : []),
                                        {
                                            label: 'Сохранить как…',
                                            separated: !tab.operationRef,
                                            hint: 'другая коллекция или имя',
                                            run: () => setDialog('save'),
                                        },
                                    ],
                                })
                            }}
                        >
                            ⋯
                        </button>

                        {isBusy ? (
                            <button
                                type="button"
                                className="btn"
                                onClick={() => stopActiveTab()}
                                title="Остановить (⌘.)"
                            >
                                Остановить
                            </button>
                        ) : (
                            <button
                                type="button"
                                className="btn btn--primary"
                                onClick={() => void runActiveTab()}
                                title="Выполнить (⌘↩)"
                            >
                                Выполнить
                                <kbd className="btn__key">⌘↩</kbd>
                            </button>
                        )}
                    </div>

                    <ContextMenu menu={menu} onClose={() => setMenu(undefined)} />

                    <div className="panel__content">
                        <CodeEditor
                            key={`${activeTabId}-query`}
                            value={content.query}
                            language="graphql"
                            schema={schema}
                            onChange={(value) => updateQuery(activeTabId, value)}
                            onRun={() => void runActiveTab()}
                            onVariablesAdded={(added) => {
                                // Переменные, объявленные автоподстановкой аргументов,
                                // сразу получают значения-заготовки: иначе запрос
                                // отправился бы с отсутствующими обязательными полями.
                                const parsed = parseVariables(content.variables)
                                const merged = {
                                    ...(parsed instanceof Error ? {} : parsed),
                                    ...added,
                                }

                                updateVariables(
                                    activeTabId,
                                    `${JSON.stringify(merged, null, 2)}\n`,
                                )
                                setBottomTab(activeTabId, 'variables')
                            }}
                        />
                    </div>
                </div>
            </Panel>

            <Separator
                className="resize-handle"
                title="Потяните, чтобы изменить высоту. Двойной клик — подогнать под запрос"
                onDoubleClick={fitToContent}
            />

            <Panel id="params" minSize="12">
                <div className="panel">
                    <div className="panel__header">
                        <div className="segmented">
                            <button
                                type="button"
                                className={`segmented__item${
                                    tab.bottomTab === 'variables' ? ' segmented__item--active' : ''
                                }`}
                                onClick={() => setBottomTab(activeTabId, 'variables')}
                            >
                                Переменные
                            </button>
                            <button
                                type="button"
                                className={`segmented__item${
                                    tab.bottomTab === 'headers' ? ' segmented__item--active' : ''
                                }`}
                                onClick={() => setBottomTab(activeTabId, 'headers')}
                            >
                                Заголовки
                                {Object.keys(content.headers).length > 0
                                    ? ` (${Object.keys(content.headers).length})`
                                    : ''}
                            </button>
                        </div>

                        <span className="panel__spacer" />

                        {tab.bottomTab === 'variables' && (
                            <button
                                type="button"
                                className="btn btn--quiet"
                                title="Подставить переменные запроса со значениями по типу из схемы"
                                onClick={() => {
                                    const parsed = parseVariables(content.variables)
                                    const skeleton = buildVariablesSkeleton(
                                        content.query,
                                        schema,
                                        parsed instanceof Error ? {} : parsed,
                                    )

                                    updateVariables(
                                        activeTabId,
                                        `${JSON.stringify(skeleton, null, 2)}\n`,
                                    )
                                }}
                            >
                                Заполнить из запроса
                            </button>
                        )}
                    </div>

                    <div className="panel__content">
                        {tab.bottomTab === 'variables' ? (
                            <CodeEditor
                                key={`${activeTabId}-vars`}
                                value={content.variables}
                                language="json"
                                schema={schema}
                                completionQuery={content.query}
                                onChange={(value) => updateVariables(activeTabId, value)}
                                onRun={() => void runActiveTab()}
                            />
                        ) : (
                            <div style={{ padding: 'var(--pad-sm) var(--pad-md)' }}>
                                <InheritedHeaders />

                                <KeyValueEditor
                                    value={content.headers}
                                    onChange={(headers) => updateHeaders(activeTabId, headers)}
                                    keyPlaceholder="header-name"
                                    valuePlaceholder="значение или {{переменная}}"
                                    addLabel="+ Заголовок"
                                />
                            </div>
                        )}
                    </div>
                </div>
            </Panel>
        </Group>
    )
}

/**
 * Заголовки, унаследованные от эндпоинта, окружения и коллекции.
 *
 * Показаны отдельно и только для чтения: без этого списка непонятно, почему
 * запрос уходит с `Authorization`, которого нет во вкладке, — и заголовок
 * копировали в каждую вкладку заново.
 */
function InheritedHeaders(): React.JSX.Element | null {
    const workspace = useAppStore((state) => state.workspace)
    const tree = useAppStore((state) => state.tree)
    const tab = useAppStore((state) => state.tabs.find((item) => item.id === state.activeTabId))
    const setDialog = useAppStore((state) => state.setDialog)

    if (!workspace || !tab) return null

    const endpoint = workspace.endpoints.find(
        (item) => item.id === (tab.endpointId ?? workspace.defaultEndpointId),
    )
    const environment = workspace.environments.find(
        (item) => item.id === (tab.environmentId ?? workspace.defaultEnvironmentId),
    )
    const collection = tab.operationRef
        ? tree.find((node) => node.collection.id === tab.operationRef?.split('/')[0])?.collection
        : undefined

    const rows: Array<{ source: string; name: string; value: string }> = [
        ...Object.entries(endpoint?.headers ?? {}).map(([name, value]) => ({
            source: 'эндпоинт',
            name,
            value,
        })),
        ...Object.entries(environment?.headers ?? {}).map(([name, value]) => ({
            source: 'окружение',
            name,
            value,
        })),
        ...Object.entries(collection?.headers ?? {}).map(([name, value]) => ({
            source: 'коллекция',
            name,
            value,
        })),
    ]

    return (
        <div className="inherited">
            <div className="row">
                <span className="settings__caption">Наследуются</span>
                <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={() => setDialog('workspaceSettings')}
                >
                    Настроить
                </button>
            </div>

            {rows.length === 0 ? (
                <div className="inspector__hint">
                    Общих заголовков нет. Задайте их на окружении, чтобы не копировать в каждый
                    запрос.
                </div>
            ) : (
                rows.map((row) => (
                    <div key={`${row.source}-${row.name}`} className="inherited__row">
                        <span className="badge">{row.source}</span>
                        <span className="mono inherited__name">{row.name}</span>
                        <span className="mono inherited__value">{row.value}</span>
                    </div>
                ))
            )}
        </div>
    )
}
