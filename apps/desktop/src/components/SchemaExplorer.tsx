import {
    nextSchemaType,
    schemaOperationRoot,
    schemaSelectionBranch,
    type IOperationKind,
} from '@resolvr/core'
import {
    getNamedType,
    isAbstractType,
    isCompositeType,
    isInterfaceType,
    isObjectType,
    Kind,
    type GraphQLCompositeType,
    type GraphQLSchema,
    type SelectionSetNode,
} from 'graphql'
import { useEffect, useRef, useState } from 'react'

import type { ISchemaRequest } from '../hooks/use-schema-request.js'
import { useT } from '../i18n/index.js'

const OPERATION_KINDS = ['query', 'mutation', 'subscription'] as const
const SCHEMA_FIELD_BATCH = 60

/** Дерево полей, которое редактирует открытый запрос. */
export function SchemaExplorer(props: {
    schema: GraphQLSchema
    request: ISchemaRequest
    search: string
    openedField?: string
    onOpenType: (type: string) => void
}): React.JSX.Element {
    const { schema, search, request } = props
    const [browseKind, setBrowseKind] = useState<IOperationKind>()
    const kind = browseKind ?? request.operation?.operation ?? 'query'
    const root = schemaOperationRoot(schema, kind)
    const kinds = OPERATION_KINDS.filter((item) => schemaOperationRoot(schema, item))
    const operations = request.operations
        .map((operation, index) => ({ operation, index }))
        .filter(({ operation }) => operation.operation === kind)
    const t = useT()

    return (
        <div className="schema-explorer">
            <div className="schema-explorer__target">
                {request.title && <span title={request.title}>{request.title}</span>}
                {operations.length > 1 && (
                    <select
                        className="select"
                        aria-label={t('Operation to edit')}
                        value={request.operationIndex}
                        onChange={(event) => request.selectOperation(Number(event.target.value))}
                    >
                        {operations.map(({ operation, index }) => (
                            <option key={index} value={index}>
                                {operation.name?.value ?? operation.operation}
                            </option>
                        ))}
                    </select>
                )}
                {kinds.length > 1 && (
                    <select
                        className="select"
                        aria-label={t('Operation type')}
                        value={kind}
                        onChange={(event) => {
                            const value = OPERATION_KINDS.find(
                                (item) => item === event.target.value,
                            )
                            if (!value) return
                            setBrowseKind(value)
                            const index = request.operations.findIndex(
                                (operation) => operation.operation === value,
                            )
                            if (index >= 0 && request.operation?.operation !== value) {
                                request.selectOperation(index)
                            }
                        }}
                    >
                        {kinds.map((item) => (
                            <option key={item} value={item}>
                                {item}
                            </option>
                        ))}
                    </select>
                )}
            </div>
            {request.message && (
                <p className="schema-explorer__notice" role="status">
                    {request.message}
                </p>
            )}
            {root && (
                <div className="schema-explorer__tree" key={kind}>
                    <button
                        type="button"
                        className="schema-explorer__root schema-link"
                        onClick={() => props.onOpenType(root.name)}
                    >
                        {root.name}
                    </button>
                    <ExplorerFields
                        key={search.trim().toLowerCase()}
                        schema={schema}
                        type={root}
                        path={[]}
                        search={search.trim().toLowerCase()}
                        selection={request.operation?.operation === kind ? request.operation.selectionSet : undefined}
                        openedField={props.openedField}
                        onOpenType={props.onOpenType}
                        onInsert={(path, field) => void request.insert({ kind, path, field })}
                    />
                </div>
            )}
        </div>
    )
}

interface IExplorerFieldsProps {
    schema: GraphQLSchema
    type: GraphQLCompositeType
    path: readonly string[]
    search?: string
    selection: SelectionSetNode | undefined
    openedField?: string
    onOpenType: (type: string) => void
    onInsert: (path: readonly string[], field: string) => void
}

function ExplorerFields(props: IExplorerFieldsProps): React.JSX.Element {
    const { type, schema } = props
    const t = useT()
    const fields =
        isObjectType(type) || isInterfaceType(type) ? Object.values(type.getFields()) : []
    const matching = props.search
        ? fields.filter((field) => field.name.toLowerCase().includes(props.search ?? ''))
        : fields
    const fragments = isAbstractType(type) ? schema.getPossibleTypes(type) : []
    const [visibleCount, setVisibleCount] = useState(SCHEMA_FIELD_BATCH)
    const loadMore = useRef<HTMLLIElement>(null)
    const hasMore = visibleCount < matching.length

    useEffect(() => {
        const marker = loadMore.current
        if (!hasMore || !marker) return

        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return
                observer.disconnect()
                setVisibleCount((count) => count + SCHEMA_FIELD_BATCH)
            },
            { root: marker.closest('.panel__content'), rootMargin: '0px 0px 120px' },
        )
        observer.observe(marker)
        return () => observer.disconnect()
    }, [hasMore, visibleCount])

    return (
        <ul className="schema-explorer__fields">
            {matching.slice(0, visibleCount).map((field) => {
                const selected = schemaSelectionBranch(props.selection, field.name)
                const child = getNamedType(field.type)

                return (
                    <ExplorerRow
                        key={field.name}
                        label={selected?.alias?.value ?? field.name}
                        detail={String(field.type)}
                        namedType={child.name}
                        description={field.description ?? undefined}
                        added={Boolean(selected)}
                        initiallyExpanded={props.openedField === field.name}
                        onOpenType={props.onOpenType}
                        onAdd={() => props.onInsert(props.path, field.name)}
                        childrenFor={() =>
                            isCompositeType(child) && (
                                <ExplorerFields
                                    {...props}
                                    type={child}
                                    path={[...props.path, field.name]}
                                    selection={selected?.selectionSet}
                                    search={undefined}
                                    openedField={undefined}
                                />
                            )
                        }
                        expandable={isCompositeType(child)}
                    />
                )
            })}
            {hasMore && <li ref={loadMore} className="schema-explorer__sentinel" aria-hidden="true" />}
            {fragments.map((member) => {
                const part = `... on ${member.name}`
                const branch = props.selection?.selections.find(
                    (node) =>
                        node.kind === Kind.INLINE_FRAGMENT &&
                        node.typeCondition?.name.value === member.name,
                )
                const child = nextSchemaType(schema, type, part)
                if (!child) return null

                return (
                    <ExplorerRow
                        key={member.name}
                        label={part}
                        detail=""
                        namedType={member.name}
                        added={Boolean(branch)}
                        expandable
                        onOpenType={props.onOpenType}
                        onAdd={() => props.onInsert(props.path, part)}
                        childrenFor={() => (
                            <ExplorerFields
                                {...props}
                                type={child}
                                path={[...props.path, part]}
                                selection={
                                    branch?.kind === Kind.INLINE_FRAGMENT
                                        ? branch.selectionSet
                                        : undefined
                                }
                                search={undefined}
                                openedField={undefined}
                            />
                        )}
                    />
                )
            })}
            {matching.length === 0 && fragments.length === 0 && (
                <li className="inspector__hint">{t('Nothing found')}</li>
            )}
        </ul>
    )
}

function ExplorerRow(props: {
    label: string
    detail: string
    namedType: string
    description?: string
    expandable: boolean
    added: boolean
    initiallyExpanded?: boolean
    onOpenType: (type: string) => void
    onAdd: () => void
    childrenFor: () => React.ReactNode
}): React.JSX.Element {
    const [expanded, setExpanded] = useState(props.initiallyExpanded ?? false)
    const t = useT()

    return (
        <li>
            <div className={`schema-explorer__field${props.added ? ' schema-explorer__field--selected' : ''}`} title={props.description}>
                {props.expandable ? (
                    <button
                        type="button"
                        className="schema-explorer__disclosure"
                        aria-expanded={expanded}
                        aria-label={t('Fields of {name}', { name: props.label })}
                        onClick={() => setExpanded(!expanded)}
                    >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                            <path d="m6 4 4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </button>
                ) : (
                    <span className="schema-explorer__indent" />
                )}
                <button
                    type="button"
                    className="schema-explorer__name mono"
                    onClick={() => {
                        if (props.expandable) setExpanded(true)
                        props.onAdd()
                    }}
                >
                    {props.added && <span className="schema-explorer__selected" aria-hidden="true">✓</span>}
                    {props.label}
                </button>
                {props.detail && (
                    <button
                        type="button"
                        className="schema-explorer__type mono"
                        onClick={() => props.onOpenType(props.namedType)}
                    >
                        {props.detail}
                    </button>
                )}
            </div>
            {expanded && props.childrenFor()}
        </li>
    )
}
