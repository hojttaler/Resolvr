import {
    formatOperationRef,
    historyTitle,
    listTypes,
    parseOperationRef,
    searchFields,
    toErrorMessage,
    type ICollection,
    type IOperationKind,
    type ITypeKind,
    type ITypeListEntry,
} from '@resolvr/core'
import { isObjectType, type GraphQLField, type GraphQLSchema } from 'graphql'
import { useDeferredValue, useMemo, useState } from 'react'

import { useSchemaRequest } from '../hooks/use-schema-request.js'
import { copyText } from '../lib/clipboard.js'
import { useT } from '../i18n/index.js'
import { kbd } from '../lib/keys.js'
import { useAppStore } from '../state/store.js'
import { ContextMenu, type IContextMenuState } from './ContextMenu.js'
import { SchemaExplorer } from './SchemaExplorer.js'

type ISidebarTab = 'collections' | 'schema' | 'history' | 'flows'

const TABS: Array<{ id: ISidebarTab; label: string; hint: string }> = [
    { id: 'collections', label: 'Collections', hint: 'Saved requests' },
    { id: 'schema', label: 'Schema', hint: 'Types and fields of the endpoint' },
    { id: 'flows', label: 'Flows', hint: 'Scenarios and smoke tests' },
    { id: 'history', label: 'History', hint: 'Recent runs list' },
]

/**
 * Вертикальная полоса разделов слева.
 *
 * Клик по активному разделу сворачивает панель, по любому другому —
 * открывает его.
 */
export function ActivityRail(): React.JSX.Element {
    const sidebarTab = useAppStore((state) => state.sidebarTab)
    const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed)
    const setSidebarTab = useAppStore((state) => state.setSidebarTab)
    const toggleSidebar = useAppStore((state) => state.toggleSidebar)
    const setDialog = useAppStore((state) => state.setDialog)
    const expanded = useAppStore((state) => Boolean(state.layoutSizes[`${state.layoutPreset}-root-restore`]))
    const t = useT()

    return (
        <nav className="rail" aria-label={t('Sections')}>
            {TABS.map((tab) => {
                const active = sidebarTab === tab.id && !sidebarCollapsed && !expanded
                const label = tab.id === 'collections' ? 'Requests' : tab.label

                return (
                    <button
                        key={tab.id}
                        type="button"
                        className={`rail__item${active ? ' rail__item--active' : ''}`}
                        title={`${t(label)} — ${t(tab.hint)}`}
                        aria-label={t(label)}
                        aria-pressed={active}
                        onClick={() => {
                            if (expanded) useAppStore.getState().toggleResponseExpanded()
                            if (active) {
                                toggleSidebar()

                                return
                            }
                            setSidebarTab(tab.id)
                            if (sidebarCollapsed) toggleSidebar()
                        }}
                    >
                        <RailIcon tab={tab.id} />
                        <span className="rail__label">{t(label)}</span>
                    </button>
                )
            })}
            <button
                type="button"
                className="rail__item"
                title={t('Agent activity')}
                aria-label={t('Agent activity')}
                onClick={() => setDialog('activity')}
            >
                <RailIcon tab="activity" />
                <span className="rail__label">{t('Activity')}</span>
            </button>
        </nav>
    )
}

function RailIcon({ tab }: { tab: ISidebarTab | 'activity' }): React.JSX.Element {
    const common = { width: 17, height: 17, viewBox: '0 0 16 16', fill: 'none' as const }
    const stroke = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

    switch (tab) {
        case 'collections':
            return <svg {...common} aria-hidden="true"><path d="M4 2.5l9 5.5-9 5.5z" {...stroke} /></svg>
        case 'schema':
            return (
                <svg {...common} aria-hidden="true">
                    <circle cx="4" cy="8" r="1.6" {...stroke} />
                    <circle cx="12" cy="4" r="1.6" {...stroke} />
                    <circle cx="12" cy="12" r="1.6" {...stroke} />
                    <path d="M5.5 7.2l5-2.4M5.5 8.8l5 2.4" {...stroke} />
                </svg>
            )
        case 'history':
            return (
                <svg {...common} aria-hidden="true">
                    <circle cx="8" cy="8" r="5.5" {...stroke} />
                    <path d="M8 5v3.2l2.2 1.3" {...stroke} />
                </svg>
            )
        case 'activity':
            return <svg {...common} aria-hidden="true"><path d="M1.5 8h2.8l2-4.8 2.8 9.5L11 8h3.5" {...stroke} /></svg>
        case 'flows':
            return (
                <svg {...common} aria-hidden="true">
                    <circle cx="4" cy="4" r="1.6" {...stroke} />
                    <circle cx="12" cy="4" r="1.6" {...stroke} />
                    <circle cx="4" cy="12" r="1.6" {...stroke} />
                    <path d="M5.7 4h4.6M4 5.7v4.6" {...stroke} />
                </svg>
            )
    }
}

/** Панель содержимого выбранного раздела. */
export function Sidebar(): React.JSX.Element {
    const sidebarTab = useAppStore((state) => state.sidebarTab)
    const setDialog = useAppStore((state) => state.setDialog)
    const toggleSidebar = useAppStore((state) => state.toggleSidebar)
    const openFlowTab = useAppStore((state) => state.openFlowTab)
    const createCollection = useAppStore((state) => state.createCollection)
    const tree = useAppStore((state) => state.tree)
    const [menu, setMenu] = useState<IContextMenuState | undefined>()
    const t = useT()

    /** Имя новой коллекции — первое свободное из «Новая коллекция», «… 2»… */
    function freshCollectionName(): string {
        const taken = new Set(tree.map((node) => node.collection.name))
        const base = t('New collection')
        let name = base
        for (let index = 2; taken.has(name); index += 1) name = `${base} ${index}`

        return name
    }

    const current = TABS.find((tab) => tab.id === sidebarTab) ?? TABS[0]

    return (
        <div className="panel sidebar">
            <div className="panel__header sidebar__header">
                <span className="panel__title">{t(current?.label ?? '')}</span>

                <span className="panel__spacer" />

                {/* Создание операции жило только в палитре команд и в ⌘S:
                    в самом дереве коллекций точки входа не было вовсе. */}
                {sidebarTab === 'collections' && (
                    <button
                        type="button"
                        className="btn btn--quiet btn--icon"
                        onClick={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect()
                            setMenu({
                                x: rect.left,
                                y: rect.bottom + 4,
                                items: [
                                    {
                                        label: t('Save current query…'),
                                        hint: kbd('S'),
                                        run: () => setDialog('save'),
                                    },
                                    {
                                        label: t('New collection'),
                                        hint: t('rename with right-click'),
                                        run: () => createCollection(freshCollectionName()),
                                    },
                                    {
                                        label: t('Import from Postman or Insomnia…'),
                                        separated: true,
                                        run: () => setDialog('import'),
                                    },
                                ],
                            })
                        }}
                        title={t('Add an operation or a collection')}
                        aria-label={t('Add')}
                    >
                        +
                    </button>
                )}

                {sidebarTab === 'flows' && (
                    <button
                        type="button"
                        className="btn btn--icon"
                        onClick={() => void openFlowTab()}
                        aria-label={t('Create flow')}
                        title={t('Create flow')}
                    >+</button>
                )}

                <button
                    type="button"
                    className="btn btn--quiet btn--icon"
                    onClick={toggleSidebar}
                    title={t('Collapse panel ({keys})', { keys: kbd('B') })}
                    aria-label={t('Collapse panel')}
                >
                    ‹
                </button>

                <ContextMenu menu={menu} onClose={() => setMenu(undefined)} />
            </div>

            <div className="panel__content">
                {sidebarTab === 'collections' && <CollectionsPanel />}
                {sidebarTab === 'schema' && <SchemaPanel />}
                {sidebarTab === 'history' && <HistoryPanel />}
                {sidebarTab === 'flows' && <FlowsPanel />}
            </div>
        </div>
    )
}

/** Что сейчас переименовывается в дереве коллекций. */
interface IRenaming {
    kind: 'collection' | 'operation'
    id: string
    value: string
}

const OPERATION_DRAG_TYPE = 'application/x-resolvr-operation'

/**
 * Дерево коллекций.
 *
 * Управление — правой кнопкой и перетаскиванием: операцию можно перенести в
 * другую коллекцию или на другое место в своей, переименовать, продублировать
 * и удалить, коллекцию — переименовать и удалить. Переименование идёт прямо
 * в строке дерева.
 */
function CollectionsPanel(): React.JSX.Element {
    const tree = useAppStore((state) => state.tree)
    const openTab = useAppStore((state) => state.openTab)
    const tabs = useAppStore((state) => state.tabs)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const requestConfirm = useAppStore((state) => state.requestConfirm)
    const renameCollection = useAppStore((state) => state.renameCollection)
    const deleteCollection = useAppStore((state) => state.deleteCollection)
    const moveOperation = useAppStore((state) => state.moveOperation)
    const reorderOperation = useAppStore((state) => state.reorderOperation)
    const deleteOperation = useAppStore((state) => state.deleteOperation)
    const duplicateOperation = useAppStore((state) => state.duplicateOperation)
    const linkTo = useAppStore((state) => state.linkTo)
    const setDialog = useAppStore((state) => state.setDialog)
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
    const [search, setSearch] = useState('')
    const [menu, setMenu] = useState<IContextMenuState | undefined>()
    const [renaming, setRenaming] = useState<IRenaming | undefined>()
    const [dropTarget, setDropTarget] = useState<string | undefined>()
    const [dropLine, setDropLine] = useState<{ ref: string; position: 'before' | 'after' } | undefined>()
    const [error, setError] = useState<string | undefined>()
    const t = useT()

    const activeRef = tabs.find((tab) => tab.id === activeTabId)?.operationRef

    // Поиск идёт по имени операции и по её описанию: с ростом числа коллекций
    // прокручивать дерево глазами становится дороже, чем набрать пару букв.
    const needle = search.trim().toLowerCase()
    const filtered = needle
        ? tree
              .map((node) => ({
                  ...node,
                  operations: node.operations.filter(
                      (operation) =>
                          operation.name.toLowerCase().includes(needle) ||
                          operation.description.toLowerCase().includes(needle),
                  ),
              }))
              .filter(
                  (node) =>
                      node.operations.length > 0 ||
                      node.collection.name.toLowerCase().includes(needle),
              )
        : tree

    async function guarded(action: () => Promise<void>): Promise<void> {
        try {
            setError(undefined)
            await action()
        } catch (caught) {
            setError(toErrorMessage(caught))
        }
    }

    function commitRename(): void {
        const current = renaming
        setRenaming(undefined)
        if (!current) return

        const value = current.value.trim()
        if (value.length === 0) return

        if (current.kind === 'collection') {
            void guarded(() => renameCollection(current.id, value))
        } else {
            const ref = parseOperationRef(current.id)
            if (ref.name !== value) {
                void guarded(() => moveOperation(current.id, { collectionId: ref.collectionId, name: value }))
            }
        }
    }

    function openCollectionMenu(event: React.MouseEvent, collection: ICollection): void {
        event.preventDefault()
        setMenu({
            x: event.clientX,
            y: event.clientY,
            items: [
                {
                    label: t('Rename'),
                    run: () => setRenaming({ kind: 'collection', id: collection.id, value: collection.name }),
                },
                {
                    label: t('Delete collection…'),
                    separated: true,
                    run: () =>
                        requestConfirm({
                            title: t('Delete collection'),
                            description: t(
                                'Collection “{name}” and all its operations will be deleted from disk. Open tabs stay as drafts.',
                                { name: collection.name },
                            ),
                            actionLabel: t('Delete'),
                            danger: true,
                            run: () => guarded(() => deleteCollection(collection.id)),
                        }),
                },
            ],
        })
    }

    function openOperationMenu(event: React.MouseEvent, ref: string, name: string): void {
        event.preventDefault()
        const { collectionId } = parseOperationRef(ref)
        const others = tree.filter((node) => node.collection.id !== collectionId)

        setMenu({
            x: event.clientX,
            y: event.clientY,
            items: [
                { label: t('Open'), run: () => openTab({ operationRef: ref }) },
                {
                    label: t('Rename'),
                    run: () => setRenaming({ kind: 'operation', id: ref, value: name }),
                },
                { label: t('Duplicate'), run: () => guarded(() => duplicateOperation(ref)) },
                {
                    label: t('Copy link'),
                    hint: 'resolvr://',
                    run: () => copyText(linkTo({ operationRef: ref }) ?? ''),
                },
                ...others.map((node, index) => ({
                    label: t('Move to “{name}”', { name: node.collection.name }),
                    separated: index === 0,
                    run: () =>
                        guarded(() => moveOperation(ref, { collectionId: node.collection.id, name })),
                })),
                {
                    label: t('Delete…'),
                    separated: true,
                    run: () =>
                        requestConfirm({
                            title: t('Delete operation'),
                            description: t(
                                'Operation “{name}” will be deleted from disk. The open tab stays as a draft.',
                                { name },
                            ),
                            actionLabel: t('Delete'),
                            danger: true,
                            run: () => guarded(() => deleteOperation(ref)),
                        }),
                },
            ],
        })
    }

    if (tree.length === 0) {
        return (
            <div className="empty">
                {t('No collections yet.')}
                <br />
                {t(
                    'Type a query and press {keys} — the collection is created with the first operation.',
                    { keys: kbd('S') },
                )}
                <div style={{ marginTop: 12 }}>
                    <button type="button" className="btn" onClick={() => setDialog('import')}>
                        {t('Import from Postman or Insomnia…')}
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div>
            <div style={{ padding: '8px 12px 4px' }}>
                <input
                    className="input"
                    placeholder={t('Search operation…')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
            </div>

            {error && (
                <div className="inspector__hint" style={{ color: 'var(--danger)', padding: '0 12px' }}>
                    {error}
                </div>
            )}

            <div className="tree">
                {filtered.length === 0 && <div className="empty">{t('Nothing found')}</div>}
                {filtered.map((node) => {
                    // При поиске коллекции раскрыты: иначе результат прячется внутри.
                    const isCollapsed =
                        needle.length > 0 ? false : (collapsed[node.collection.id] ?? false)
                    const isRenaming =
                        renaming?.kind === 'collection' && renaming.id === node.collection.id

                    return (
                        <div key={node.collection.id}>
                            <div
                                className={`tree__row tree__row--collection${
                                    dropTarget === node.collection.id ? ' tree__row--drop' : ''
                                }`}
                                onClick={() =>
                                    !isRenaming &&
                                    setCollapsed((current) => ({
                                        ...current,
                                        [node.collection.id]: !isCollapsed,
                                    }))
                                }
                                onContextMenu={(event) => openCollectionMenu(event, node.collection)}
                                onDragOver={(event) => {
                                    if (!event.dataTransfer.types.includes(OPERATION_DRAG_TYPE)) return
                                    event.preventDefault()
                                    event.dataTransfer.dropEffect = 'move'
                                    setDropTarget(node.collection.id)
                                }}
                                onDragLeave={() => setDropTarget(undefined)}
                                onDrop={(event) => {
                                    event.preventDefault()
                                    setDropTarget(undefined)
                                    const ref = event.dataTransfer.getData(OPERATION_DRAG_TYPE)
                                    if (!ref) return

                                    const source = parseOperationRef(ref)
                                    if (source.collectionId === node.collection.id) return

                                    void guarded(() =>
                                        moveOperation(ref, {
                                            collectionId: node.collection.id,
                                            name: source.name,
                                        }),
                                    )
                                }}
                            >
                                <span
                                    className={`tree__chevron${isCollapsed ? '' : ' tree__chevron--open'}`}
                                >
                                    ▶
                                </span>
                                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                                    <path d="M2.5 6a1.5 1.5 0 0 1 1.5-1.5h4l2 2h6A1.5 1.5 0 0 1 17.5 8v6A1.5 1.5 0 0 1 16 15.5H4A1.5 1.5 0 0 1 2.5 14Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                                </svg>
                                {isRenaming ? (
                                    <RenameInput
                                        value={renaming.value}
                                        onChange={(value) => setRenaming({ ...renaming, value })}
                                        onCommit={commitRename}
                                        onCancel={() => setRenaming(undefined)}
                                    />
                                ) : (
                                    <span className="tree__label">{node.collection.name}</span>
                                )}
                                <span className="badge">{node.operations.length}</span>
                            </div>

                            {!isCollapsed &&
                                node.operations.map((operation) => {
                                    const ref = formatOperationRef({
                                        collectionId: node.collection.id,
                                        name: operation.name,
                                    })
                                    const isRenamingOperation =
                                        renaming?.kind === 'operation' && renaming.id === ref

                                    return (
                                        <div
                                            key={ref}
                                            className={`tree__row tree__row--nested${
                                                activeRef === ref ? ' tree__row--active' : ''
                                            }${
                                                dropLine?.ref === ref
                                                    ? ` tree__row--drop-${dropLine.position}`
                                                    : ''
                                            }`}
                                            draggable={!isRenamingOperation}
                                            onDragStart={(event) => {
                                                event.dataTransfer.setData(OPERATION_DRAG_TYPE, ref)
                                                event.dataTransfer.effectAllowed = 'move'
                                            }}
                                            onDragEnd={() => setDropLine(undefined)}
                                            onDragOver={(event) => {
                                                // При поиске видна лишь часть коллекции:
                                                // позиция среди скрытых операций была бы угадыванием.
                                                if (needle.length > 0) return
                                                if (!event.dataTransfer.types.includes(OPERATION_DRAG_TYPE)) return
                                                event.preventDefault()
                                                event.stopPropagation()
                                                event.dataTransfer.dropEffect = 'move'

                                                const box = event.currentTarget.getBoundingClientRect()
                                                const position =
                                                    event.clientY < box.top + box.height / 2 ? 'before' : 'after'
                                                if (dropLine?.ref !== ref || dropLine.position !== position) {
                                                    setDropLine({ ref, position })
                                                }
                                            }}
                                            onDragLeave={() =>
                                                setDropLine((current) => (current?.ref === ref ? undefined : current))
                                            }
                                            onDrop={(event) => {
                                                const line = dropLine
                                                setDropLine(undefined)
                                                if (!line) return

                                                event.preventDefault()
                                                event.stopPropagation()
                                                const source = event.dataTransfer.getData(OPERATION_DRAG_TYPE)
                                                if (!source || source === ref) return

                                                void guarded(() => reorderOperation(source, ref, line.position))
                                            }}
                                            onClick={() =>
                                                !isRenamingOperation &&
                                                void openTab({ operationRef: ref })
                                            }
                                            onContextMenu={(event) =>
                                                openOperationMenu(event, ref, operation.name)
                                            }
                                            title={operation.description || operation.name}
                                        >
                                            <span className={`badge badge--${operation.kind}`}>
                                                {operation.kind.charAt(0).toUpperCase()}
                                            </span>
                                            {isRenamingOperation ? (
                                                <RenameInput
                                                    value={renaming.value}
                                                    onChange={(value) =>
                                                        setRenaming({ ...renaming, value })
                                                    }
                                                    onCommit={commitRename}
                                                    onCancel={() => setRenaming(undefined)}
                                                />
                                            ) : (
                                                <span className="tree__label">{operation.name}</span>
                                            )}
                                        </div>
                                    )
                                })}
                        </div>
                    )
                })}
            </div>

            <ContextMenu menu={menu} onClose={() => setMenu(undefined)} />
        </div>
    )
}

/** Поле переименования прямо в строке дерева: Enter — применить, Esc — отменить. */
function RenameInput(props: {
    value: string
    onChange: (value: string) => void
    onCommit: () => void
    onCancel: () => void
}): React.JSX.Element {
    return (
        <input
            className="input tree__rename"
            autoFocus
            value={props.value}
            onChange={(event) => props.onChange(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={props.onCommit}
            onKeyDown={(event) => {
                if (event.key === 'Enter') props.onCommit()
                if (event.key === 'Escape') props.onCancel()
            }}
        />
    )
}

/**
 * Панель схемы.
 *
 * Клик по полю корневого типа собирает готовую операцию с раскрытой выборкой и
 * скелетом переменных — ровно та ручная работа, на которую в других клиентах
 * уходит больше всего времени.
 */
function SchemaPanel(): React.JSX.Element {
    const schema = useAppStore((state) => state.schema)
    const schemaError = useAppStore((state) => state.schemaError)
    const refreshSchema = useAppStore((state) => state.refreshSchema)
    const openSchemaTab = useAppStore((state) => state.openSchemaTab)
    const tabs = useAppStore((state) => state.tabs)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const [search, setSearch] = useState('')
    const [mode, setMode] = useState<'explorer' | 'types'>('explorer')
    const [openedField, setOpenedField] = useState<string>()
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
    const request = useSchemaRequest(schema)
    const t = useT()

    const deferredSearch = useDeferredValue(search)
    const needle = deferredSearch.trim().toLowerCase()
    const rootFields = useMemo(() => mode === 'types' ? collectRootFields(schema, deferredSearch) : [], [schema, deferredSearch, mode])
    const rootNames = useMemo(() => new Set(rootFields.map((group) => group.typeName)), [rootFields])
    const allTypes = useMemo(() => schema && mode === 'types' ? listTypes(schema) : [], [schema, mode])
    const types = useMemo(() => needle ? allTypes.filter((type) => type.name.toLowerCase().includes(needle)) : allTypes, [allTypes, needle])
    const fieldHits = useMemo(
        () =>
            schema && mode === 'types' && needle.length > 1
                ? searchFields(schema, needle, 30).filter((hit) => !rootNames.has(hit.typeName))
                : [],
        [schema, needle, mode, rootNames],
    )
    const currentType = tabs.find((tab) => tab.id === activeTabId && tab.kind === 'schema')?.schemaType

    if (!schema) {
        return (
            <div className="empty">
                {schemaError ?? t('Schema not loaded')}
                <br />
                <button
                    type="button"
                    className="btn"
                    style={{ marginTop: 12 }}
                    onClick={() => void refreshSchema()}
                >
                    {t('Load schema')}
                </button>
            </div>
        )
    }

    // Типы сгруппированы по роду: объектов больше всего, и без групп список
    // из тысячи имён не читается.
    const groups: Array<{ kind: ITypeKind; label: string; entries: ITypeListEntry[] }> = [
        { kind: 'object', label: t('Objects'), entries: [] },
        { kind: 'input', label: t('Inputs'), entries: [] },
        { kind: 'enum', label: t('Enums'), entries: [] },
        { kind: 'interface', label: t('Interfaces'), entries: [] },
        { kind: 'union', label: t('Unions'), entries: [] },
        { kind: 'scalar', label: t('Scalars'), entries: [] },
    ]
    for (const entry of types) {
        if (rootNames.has(entry.name)) continue
        groups.find((group) => group.kind === entry.kind)?.entries.push(entry)
    }

    return (
        <div>
            <div className="schema-sidebar__controls">
                <div className="segmented">
                    <button type="button" className={`segmented__item${mode === 'explorer' ? ' segmented__item--active' : ''}`}
                        aria-pressed={mode === 'explorer'} onClick={() => setMode('explorer')}>{t('Explorer')}</button>
                    <button type="button" className={`segmented__item${mode === 'types' ? ' segmented__item--active' : ''}`}
                        aria-pressed={mode === 'types'} onClick={() => setMode('types')}>{t('Types')}</button>
                </div>
                <button type="button" className="btn btn--quiet btn--icon"
                    aria-label={t('Refresh schema')} title={t('Refresh schema')}
                    onClick={() => void refreshSchema()}>↻</button>
            </div>
            {schemaError && <p className="schema-explorer__notice" role="status">{schemaError}</p>}
            <div className="schema-sidebar__controls">
                <input
                    className="input"
                    placeholder={t(mode === 'explorer' ? 'Filter root fields…' : 'Search type or field…')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
            </div>

            {mode === 'explorer' && (
                <SchemaExplorer
                    schema={schema}
                    request={request}
                    search={deferredSearch}
                    openedField={openedField}
                    onOpenType={openSchemaTab}
                />
            )}
            {mode === 'types' && <div className="tree">
                {rootFields.map((group) => (
                    <div key={group.kind}>
                        <div
                            className={`tree__row${currentType === group.typeName ? ' tree__row--active' : ''}`}
                            onClick={() => openSchemaTab(group.typeName)}
                            title={t('Open in schema browser')}
                        >
                            <span className={`badge badge--${group.kind}`}>
                                {group.kind.toUpperCase()}
                            </span>
                            <span className="tree__label">{group.typeName}</span>
                            <span className="badge">{group.fields.length}</span>
                        </div>

                        {(needle.length > 0 || openGroups[group.kind] !== false) &&
                            group.fields.slice(0, needle.length > 0 ? 100 : 40).map((field) => (
                                <button
                                    key={`${group.kind}.${field.name}`}
                                    type="button"
                                    className="tree__row tree__row--nested schema-type-field"
                                    onClick={() => {
                                        void request.insert({ kind: group.kind, field: field.name })
                                        setOpenedField(field.name)
                                        setSearch('')
                                        setMode('explorer')
                                    }}
                                    title={`${field.name}: ${field.type.toString()}${
                                        field.description ? `\n\n${field.description}` : ''
                                    }`}
                                >
                                    <span className="tree__label mono">{field.name}</span>
                                    <span className="badge">{field.type.toString()}</span>
                                </button>
                            ))}
                        {needle.length === 0 && group.fields.length > 40 && (
                            <div
                                className="tree__row tree__row--nested inspector__hint"
                                onClick={() => openSchemaTab(group.typeName)}
                            >
                                {t('+{n} more — open the type', { n: group.fields.length - 40 })}
                            </div>
                        )}
                    </div>
                ))}

                {fieldHits.length > 0 && (
                    <div>
                        <div className="tree__row">
                            <span className="tree__label">{t('Fields')}</span>
                            <span className="badge">{fieldHits.length}</span>
                        </div>
                        {fieldHits.map((hit) => (
                            <div
                                key={`${hit.typeName}.${hit.fieldName}`}
                                className="tree__row tree__row--nested"
                                onClick={() => openSchemaTab(hit.typeName)}
                                title={hit.description}
                            >
                                <span className="tree__label mono">
                                    <span className="inspector__hint">{hit.typeName}.</span>
                                    {hit.fieldName}
                                </span>
                                <span className="badge">{hit.type}</span>
                            </div>
                        ))}
                    </div>
                )}

                {groups
                    .filter((group) => group.entries.length > 0)
                    .map((group) => {
                        const expanded = needle.length > 0 || openGroups[group.kind] === true

                        return (
                            <div key={group.kind}>
                                <div
                                    className="tree__row"
                                    onClick={() =>
                                        setOpenGroups((current) => ({
                                            ...current,
                                            [group.kind]: !expanded,
                                        }))
                                    }
                                >
                                    <span className={`tree__chevron${expanded ? ' tree__chevron--open' : ''}`}>
                                        ▶
                                    </span>
                                    <span className="tree__label">{group.label}</span>
                                    <span className="badge">{group.entries.length}</span>
                                </div>
                                {expanded &&
                                    group.entries.slice(0, 300).map((entry) => (
                                        <div
                                            key={entry.name}
                                            className={`tree__row tree__row--nested${
                                                currentType === entry.name ? ' tree__row--active' : ''
                                            }`}
                                            onClick={() => openSchemaTab(entry.name)}
                                            title={entry.description}
                                        >
                                            <span className="tree__label mono">{entry.name}</span>
                                            {entry.fieldCount > 0 && (
                                                <span className="badge">{entry.fieldCount}</span>
                                            )}
                                        </div>
                                    ))}
                            </div>
                        )
                    })}
            </div>}
        </div>
    )
}

function HistoryPanel(): React.JSX.Element {
    const history = useAppStore((state) => state.history)
    const openHistoryEntry = useAppStore((state) => state.openHistoryEntry)
    const t = useT()

    if (history.length === 0) {
        return <div className="empty">{t('No history yet')}</div>
    }

    return (
        <div className="tree history-list">
            {history.map((entry) => (
                <button
                    key={entry.id}
                    type="button"
                    className="tree__row history-list__entry"
                    onClick={() => void openHistoryEntry(entry)}
                    title={`${new Date(entry.ts).toLocaleString()}\n${entry.responsePreview}${
                        entry.responseBody === undefined ? `\n${t('Response not stored (too large)')}` : ''
                    }`}
                >
                    <span className={`badge ${entry.ok ? 'badge--ok' : 'badge--fail'}`}>
                        {entry.status}
                    </span>
                    <span className="history-list__request">
                        <span className="tree__label">{historyTitle(entry) ?? t('unnamed')}</span>
                        <span className="inspector__hint">{new Date(entry.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </span>
                    <span className="badge">{t('{n} ms', { n: Math.round(entry.durationMs) })}</span>
                </button>
            ))}
        </div>
    )
}

/**
 * Панель цепочек запросов.
 *
 * Отсюда флоу создаётся и правится: клик по названию открывает редактор шагов,
 * кнопка ▶ запускает без открытия. Результат последнего запуска показывается
 * прямо под флоу, чтобы не приходилось лезть в диалог за статусом.
 */
function FlowsPanel(): React.JSX.Element {
    const flows = useAppStore((state) => state.flows)
    const flowRuns = useAppStore((state) => state.flowRuns)
    const runFlow = useAppStore((state) => state.runFlow)
    const flowRun = useAppStore((state) => state.flowRun)
    const openFlowTab = useAppStore((state) => state.openFlowTab)
    const runAllFlows = useAppStore((state) => state.runAllFlows)
    const reportRunning = useAppStore((state) => state.reportRunning)
    const tab = useAppStore((state) => state.tabs.find((item) => item.id === state.activeTabId))
    const draftName = useAppStore((state) =>
        tab?.kind === 'flow' && !tab.flowId ? state.flowDrafts[tab.id]?.name : undefined,
    )
    const [search, setSearch] = useState('')
    const t = useT()

    const activeFlowId = tab?.kind === 'flow' ? tab.flowId : undefined
    const needle = search.trim().toLowerCase()
    const visible = flows.filter((flow) => flow.name.toLowerCase().includes(needle))

    return (
        <div>
            <input
                className="input sidebar__search"
                placeholder={t('Find a flow…')}
                aria-label={t('Find a flow…')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
            />
            <div className="tree">
                {draftName !== undefined && (
                    <div className="tree__row tree__row--active">
                        <span className="tree__label">{draftName || t('New flow')}</span>
                    </div>
                )}
                {flows.length > 0 && visible.length === 0 && <div className="empty">{t('No matching flows')}</div>}
                {flows.length === 0 && draftName === undefined && (
                    <div className="empty">
                        {t('No flows yet.')}
                        <br />
                        {t(
                            'A flow runs several operations in sequence and passes values from a response to the next step — for example, login, then a mutation with the obtained token.',
                        )}
                    </div>
                )}

                {visible.map((flow) => (
                    <div key={flow.id}>
                        <div
                            className={`tree__row${flow.id === activeFlowId ? ' tree__row--active' : ''}`}
                            onClick={() => void openFlowTab(flow.id)}
                        >
                            <button
                                type="button"
                                className="btn btn--quiet btn--icon"
                                onClick={(event) => {
                                    event.stopPropagation()
                                    void runFlow(flow.id)
                                }}
                                title={t('Run')}
                            >
                                ▶
                            </button>
                            <span className="tree__label">{flow.name}</span>
                            {/* Свежесть проверки видна в списке: иначе «когда
                                это последний раз проходило» пришлось бы
                                держать в голове или в отдельном документе. */}
                            {flowRuns[flow.id]?.lastGreenAt && (
                                <span
                                    className="badge badge--ok"
                                    title={t('Last green run: {date}', {
                                        date: new Date(
                                            flowRuns[flow.id]?.lastGreenAt ?? '',
                                        ).toLocaleString(),
                                    })}
                                >
                                    ✓
                                </span>
                            )}
                            <span className="badge">{flow.steps.length}</span>
                        </div>

                        {flowRun?.flowId === flow.id &&
                            flowRun.steps.map((step) => (
                                <div
                                    key={step.stepId}
                                    className="tree__row tree__row--nested"
                                    title={step.error ?? t('Step done')}
                                    onClick={() => void openFlowTab(flow.id)}
                                >
                                    <span
                                        className={`badge ${
                                            step.skipped
                                                ? ''
                                                : step.ok
                                                  ? 'badge--ok'
                                                  : 'badge--fail'
                                        }`}
                                    >
                                        {step.skipped ? '—' : step.ok ? '✓' : '✕'}
                                    </span>
                                    <span className="tree__label">{step.name}</span>
                                </div>
                            ))}
                    </div>
                ))}
            </div>

            <div className="row" style={{ padding: '0 12px 12px' }}>
                {flows.length > 0 && (
                    <button
                        type="button"
                        className="btn btn--primary"
                        disabled={reportRunning}
                        onClick={() => void runAllFlows()}
                        title={t('Smoke test: run all flows in sequence and show a report')}
                    >
                        {reportRunning ? t('Running…') : t('Run all')}
                    </button>
                )}
            </div>
        </div>
    )
}

interface IRootFieldGroup {
    kind: IOperationKind
    typeName: string
    fields: Array<GraphQLField<unknown, unknown>>
}

/** Поля корневых типов схемы, отфильтрованные строкой поиска. */
function collectRootFields(schema: GraphQLSchema | undefined, search: string): IRootFieldGroup[] {
    if (!schema) return []

    const needle = search.trim().toLowerCase()
    const roots: Array<[IOperationKind, ReturnType<GraphQLSchema['getQueryType']>]> = [
        ['query', schema.getQueryType()],
        ['mutation', schema.getMutationType()],
        ['subscription', schema.getSubscriptionType()],
    ]

    const groups: IRootFieldGroup[] = []
    for (const [kind, type] of roots) {
        if (!type || !isObjectType(type)) continue

        const fields = Object.values(type.getFields()).filter(
            (field) => needle.length === 0 || field.name.toLowerCase().includes(needle),
        )
        if (fields.length > 0) groups.push({ kind, typeName: type.name, fields })
    }

    return groups
}
