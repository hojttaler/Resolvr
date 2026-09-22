import {
    buildOperation,
    formatOperationRef,
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
import { useMemo, useState } from 'react'

import { useT } from '../i18n/index.js'
import { kbd } from '../lib/keys.js'
import { useAppStore } from '../state/store.js'
import { ContextMenu, type IContextMenuState } from './ContextMenu.js'

type ISidebarTab = 'collections' | 'schema' | 'history' | 'flows'

const TABS: Array<{ id: ISidebarTab; label: string; hint: string }> = [
    { id: 'collections', label: 'Collections', hint: 'Saved requests' },
    { id: 'schema', label: 'Schema', hint: 'Types and fields of the endpoint' },
    { id: 'history', label: 'History', hint: 'Recent runs list' },
    { id: 'flows', label: 'Flows', hint: 'Scenarios and smoke tests' },
]

/**
 * Вертикальная полоса разделов слева.
 *
 * Иконки вместо вкладок в шапке панели: при узком сайдбаре подписи
 * перекрывались, а полоса занимает 40 px и не зависит от ширины панели.
 * Клик по активному разделу сворачивает панель, по любому другому —
 * открывает его.
 */
export function ActivityRail(): React.JSX.Element {
    const sidebarTab = useAppStore((state) => state.sidebarTab)
    const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed)
    const setSidebarTab = useAppStore((state) => state.setSidebarTab)
    const toggleSidebar = useAppStore((state) => state.toggleSidebar)
    const t = useT()

    return (
        <nav className="rail" aria-label={t('Sections')}>
            {TABS.map((tab) => {
                const active = sidebarTab === tab.id && !sidebarCollapsed

                return (
                    <button
                        key={tab.id}
                        type="button"
                        className={`rail__item${active ? ' rail__item--active' : ''}`}
                        title={`${t(tab.label)} — ${t(tab.hint)}`}
                        aria-label={t(tab.label)}
                        aria-pressed={active}
                        onClick={() => {
                            if (sidebarTab === tab.id) {
                                toggleSidebar()

                                return
                            }
                            setSidebarTab(tab.id)
                            if (sidebarCollapsed) toggleSidebar()
                        }}
                    >
                        <RailIcon tab={tab.id} />
                    </button>
                )
            })}
        </nav>
    )
}

function RailIcon({ tab }: { tab: ISidebarTab }): React.JSX.Element {
    const common = { width: 17, height: 17, viewBox: '0 0 16 16', fill: 'none' as const }
    const stroke = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }

    switch (tab) {
        case 'collections':
            return (
                <svg {...common} aria-hidden="true">
                    <path d="M2.5 4.5a1 1 0 011-1h3l1.2 1.5h4.8a1 1 0 011 1v6a1 1 0 01-1 1h-9a1 1 0 01-1-1v-7.5z" {...stroke} />
                </svg>
            )
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
        case 'flows':
            return (
                <svg {...common} aria-hidden="true">
                    <path d="M3 4.5h2.5M3 8h2.5M3 11.5h2.5" {...stroke} />
                    <path d="M8 4.5h5M8 8h5M8 11.5h5" {...stroke} />
                </svg>
            )
    }
}

/** Панель содержимого выбранного раздела. */
export function Sidebar(): React.JSX.Element {
    const sidebarTab = useAppStore((state) => state.sidebarTab)
    const setDialog = useAppStore((state) => state.setDialog)
    const toggleSidebar = useAppStore((state) => state.toggleSidebar)
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
            <div className="panel__header">
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
 * другую коллекцию, переименовать, продублировать и удалить, коллекцию —
 * переименовать и удалить. Переименование идёт прямо в строке дерева.
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
    const deleteOperation = useAppStore((state) => state.deleteOperation)
    const duplicateOperation = useAppStore((state) => state.duplicateOperation)
    const linkTo = useAppStore((state) => state.linkTo)
    const setDialog = useAppStore((state) => state.setDialog)
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
    const [search, setSearch] = useState('')
    const [menu, setMenu] = useState<IContextMenuState | undefined>()
    const [renaming, setRenaming] = useState<IRenaming | undefined>()
    const [dropTarget, setDropTarget] = useState<string | undefined>()
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
                    run: () => navigator.clipboard.writeText(linkTo({ operationRef: ref }) ?? ''),
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
                                className={`tree__row${
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
                                            }`}
                                            draggable={!isRenamingOperation}
                                            onDragStart={(event) => {
                                                event.dataTransfer.setData(OPERATION_DRAG_TYPE, ref)
                                                event.dataTransfer.effectAllowed = 'move'
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
    const replaceActiveQuery = useAppStore((state) => state.replaceActiveQuery)
    const openTab = useAppStore((state) => state.openTab)
    const openSchemaTab = useAppStore((state) => state.openSchemaTab)
    const tabs = useAppStore((state) => state.tabs)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const autofillDepth = useAppStore((state) => state.settings.editor.autofillDepth)
    const [search, setSearch] = useState('')
    const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
    const t = useT()

    const needle = search.trim().toLowerCase()
    const rootFields = useMemo(() => collectRootFields(schema, search), [schema, search])
    const types = useMemo(() => (schema ? listTypes(schema, search) : []), [schema, search])
    const fieldHits = useMemo(
        () => (schema && needle.length > 1 ? searchFields(schema, needle, 30) : []),
        [schema, needle],
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

    async function insertOperation(kind: IOperationKind, fieldName: string): Promise<void> {
        if (!schema) return
        if (!activeTabId) await openTab()

        const built = buildOperation(schema, { kind, fieldName, depth: autofillDepth })
        replaceActiveQuery(built.query, built.variables)
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
    const rootNames = new Set(rootFields.map((group) => group.typeName))
    for (const entry of types) {
        if (rootNames.has(entry.name)) continue
        groups.find((group) => group.kind === entry.kind)?.entries.push(entry)
    }

    return (
        <div>
            <div style={{ padding: '8px 12px' }}>
                <input
                    className="input"
                    placeholder={t('Search type or field…')}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
            </div>

            <div className="tree">
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
                                <div
                                    key={`${group.kind}.${field.name}`}
                                    className="tree__row tree__row--nested"
                                    onClick={() => void insertOperation(group.kind, field.name)}
                                    title={`${field.name}: ${field.type.toString()}${
                                        field.description ? `\n\n${field.description}` : ''
                                    }\n${t('Click — insert query; right-click — open in schema browser')}`}
                                    onContextMenu={(event) => {
                                        event.preventDefault()
                                        openSchemaTab(group.typeName)
                                    }}
                                >
                                    <span className="tree__label mono">{field.name}</span>
                                    <span className="badge">{field.type.toString()}</span>
                                </div>
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
            </div>
        </div>
    )
}

function HistoryPanel(): React.JSX.Element {
    const history = useAppStore((state) => state.history)
    const openTab = useAppStore((state) => state.openTab)
    const t = useT()

    if (history.length === 0) {
        return <div className="empty">{t('No history yet')}</div>
    }

    return (
        <div className="tree">
            {history.map((entry) => (
                <div
                    key={entry.id}
                    className="tree__row"
                    onClick={() =>
                        void openTab({
                            query: entry.query,
                            title: entry.operationName ?? t('From history'),
                        })
                    }
                    title={entry.responsePreview}
                >
                    <span className={`badge ${entry.ok ? 'badge--ok' : 'badge--fail'}`}>
                        {entry.status}
                    </span>
                    <span className="tree__label">{entry.operationName ?? t('unnamed')}</span>
                    <span className="badge">{t('{n} ms', { n: Math.round(entry.durationMs) })}</span>
                </div>
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
    const runFlow = useAppStore((state) => state.runFlow)
    const flowRun = useAppStore((state) => state.flowRun)
    const openFlowTab = useAppStore((state) => state.openFlowTab)
    const runAllFlows = useAppStore((state) => state.runAllFlows)
    const reportRunning = useAppStore((state) => state.reportRunning)
    const tabs = useAppStore((state) => state.tabs)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const t = useT()

    const activeFlowId = tabs.find((tab) => tab.id === activeTabId && tab.kind === 'flow')?.flowId

    return (
        <div>
            <div className="tree">
                {flows.length === 0 && (
                    <div className="empty">
                        {t('No flows yet.')}
                        <br />
                        {t(
                            'A flow runs several operations in sequence and passes values from a response to the next step — for example, login, then a mutation with the obtained token.',
                        )}
                    </div>
                )}

                {flows.map((flow) => (
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
                <button type="button" className="btn" onClick={() => void openFlowTab()}>
                    {t('+ Create flow')}
                </button>
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
