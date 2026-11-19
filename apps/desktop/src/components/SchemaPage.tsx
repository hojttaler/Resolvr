import {
    describeType,
    findTypeUsages,
    schemaSelectionTargets,
    type IFieldInfo,
    type ITypeInfo,
    type ITypeUsage,
} from '@resolvr/core'
import { useEffect, useMemo, useState } from 'react'

import { useSchemaRequest } from '../hooks/use-schema-request.js'
import { copyText } from '../lib/clipboard.js'
import { useT } from '../i18n/index.js'
import { useAppStore } from '../state/store.js'

/**
 * Браузер схемы — вкладка с одним типом.
 *
 * Тип показан как страница документации: описание, поля с аргументами,
 * значения enum, реализующие типы и раздел «используется в». Каждое имя
 * типа кликабельно — переход ведёт историю, как в браузере, чтобы можно было
 * пройти по связям туда и вернуться. Поля добавляются в выбранную ветку
 * открытого запроса, сохраняя исходный документ.
 */
export function SchemaPage({ tabId }: { tabId: string }): React.JSX.Element {
    const schema = useAppStore((state) => state.schema)
    const tab = useAppStore((state) => state.tabs.find((item) => item.id === tabId))
    const nav = useAppStore((state) => state.schemaNav[tabId])
    const navigateSchema = useAppStore((state) => state.navigateSchema)
    const schemaGoBack = useAppStore((state) => state.schemaGoBack)
    const schemaGoForward = useAppStore((state) => state.schemaGoForward)
    const refreshSchema = useAppStore((state) => state.refreshSchema)
    const request = useSchemaRequest(schema)
    const [targetIndex, setTargetIndex] = useState(0)
    const [filter, setFilter] = useState('')
    const [showSdl, setShowSdl] = useState(false)
    const [copied, setCopied] = useState(false)
    const t = useT()

    const typeName = tab?.schemaType ?? ''

    // Фильтр полей относится к конкретному типу: при переходе он сбрасывается,
    // иначе невидимое условие с прошлой страницы прятало бы поля следующей.
    useEffect(() => {
        setFilter('')
        setTargetIndex(0)
    }, [typeName])

    const info = useMemo(
        () => (schema ? describeType(schema, typeName) : undefined),
        [schema, typeName],
    )
    const usages = useMemo(
        () => (schema && info ? findTypeUsages(schema, info.name) : []),
        [schema, info],
    )

    const targets = useMemo(
        () =>
            schema && request.operation
                ? schemaSelectionTargets(schema, request.operation, typeName)
                : [],
        [schema, request.operation, typeName],
    )
    const target = targets[targetIndex] ?? targets[0]

    if (!schema) {
        return (
            <div className="panel">
                <div className="empty">
                    {t('Schema not loaded')}
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
            </div>
        )
    }

    if (!info) {
        return (
            <div className="panel">
                <div className="empty">
                    {t('Type “{name}” is not in the schema', { name: typeName })}
                </div>
            </div>
        )
    }

    const go = (name: string): void => navigateSchema(tabId, name)
    const canBack = (nav?.index ?? 0) > 0
    const canForward = nav !== undefined && nav.index < nav.history.length - 1

    // Поле фильтра есть только у длинных списков; без поля фильтр не действует.
    const filterable = info.fields.length > 8
    const needle = filterable ? filter.trim().toLowerCase() : ''
    const fields = info.fields.filter(
        (field) =>
            needle.length === 0 ||
            field.name.toLowerCase().includes(needle) ||
            field.type.toLowerCase().includes(needle),
    )

    const operationKind = info.root ?? request.operation?.operation
    const output = info.kind === 'object' || info.kind === 'interface'
    const canInsert =
        output &&
        operationKind !== undefined &&
        (info.root !== undefined || (!request.invalid && target !== undefined))

    return (
        <div className="panel schema-page">
            <div className="panel__header">
                <button
                    type="button"
                    className="btn btn--quiet btn--icon"
                    disabled={!canBack}
                    onClick={() => schemaGoBack(tabId)}
                    title={t('Back')}
                    aria-label={t('Back')}
                >
                    ‹
                </button>
                <button
                    type="button"
                    className="btn btn--quiet btn--icon"
                    disabled={!canForward}
                    onClick={() => schemaGoForward(tabId)}
                    title={t('Forward')}
                    aria-label={t('Forward')}
                >
                    ›
                </button>

                <span className="panel__title">{t('Schema')}</span>

                <span className="panel__spacer" />

                <button
                    type="button"
                    className={`btn${showSdl ? ' btn--on' : ''}`}
                    aria-pressed={showSdl}
                    onClick={() => setShowSdl((current) => !current)}
                >
                    SDL
                </button>
                <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={() => {
                        void copyText(info.sdl)
                        setCopied(true)
                        window.setTimeout(() => setCopied(false), 1500)
                    }}
                >
                    {copied ? t('Copied') : t('Copy SDL')}
                </button>
            </div>

            <div className="panel__content schema-page__body">
                <header className="schema-page__lead">
                    <span className={`badge badge--kind-${info.kind}`}>{kindLabel(info, t)}</span>
                    <h1 className="mono">{info.name}</h1>
                    {info.description && (
                        <p className="schema-page__description">{info.description}</p>
                    )}
                </header>

                {output && (request.title || info.root) && (
                    <div className="schema-page__target">
                        {request.title && <strong>{request.title}</strong>}
                        {request.operations.length > 1 && (
                            <select
                                className="select"
                                aria-label={t('Operation to edit')}
                                value={request.operationIndex}
                                onChange={(event) => {
                                    request.selectOperation(Number(event.target.value))
                                    setTargetIndex(0)
                                }}
                            >
                                {request.operations.map((operation, index) => (
                                    <option key={index} value={index}>
                                        {operation.name?.value ?? operation.operation}
                                    </option>
                                ))}
                            </select>
                        )}
                        {targets.length > 1 && (
                            <select
                                className="select"
                                aria-label={t('Selection to edit')}
                                value={target && targets.indexOf(target)}
                                onChange={(event) => setTargetIndex(Number(event.target.value))}
                            >
                                {targets.map((location, index) => (
                                    <option key={location.offset} value={index}>
                                        {location.label}
                                    </option>
                                ))}
                            </select>
                        )}
                        {!info.root && request.invalid ? (
                            <span>{t('Complete the request syntax before adding fields')}</span>
                        ) : !info.root && request.operation && !target ? (
                            <span>
                                {t('Open this type as a branch in Explorer to add its fields')}
                            </span>
                        ) : null}
                        {request.message && <span role="status">{request.message}</span>}
                    </div>
                )}

                {info.interfaces.length > 0 && (
                    <div className="schema-page__meta">
                        {t('Implements')}:{' '}
                        {info.interfaces.map((name) => (
                            <TypeLink key={name} name={name} onOpen={go} />
                        ))}
                    </div>
                )}

                {showSdl && <pre className="raw mono selectable schema-page__sdl">{info.sdl}</pre>}

                {info.fields.length > 0 && (
                    <section className="schema-page__section">
                        <div className="schema-page__section-head">
                            <span className="settings__caption">
                                {info.kind === 'input' ? t('Input fields') : t('Fields')} ·{' '}
                                {info.fields.length}
                            </span>
                            {filterable && (
                                <input
                                    className="input schema-page__filter"
                                    placeholder={t('Filter fields…')}
                                    value={filter}
                                    onChange={(event) => setFilter(event.target.value)}
                                />
                            )}
                        </div>

                        {fields.map((field) => (
                            <FieldRow
                                key={field.name}
                                field={field}
                                onOpen={go}
                                onInsert={
                                    canInsert && operationKind
                                        ? () =>
                                              void request.insert({
                                                  kind: operationKind,
                                                  field: field.name,
                                                  target: info.root ? undefined : target,
                                              })
                                        : undefined
                                }
                            />
                        ))}
                        {fields.length === 0 && (
                            <div className="inspector__hint">{t('Nothing found')}</div>
                        )}
                    </section>
                )}

                {info.enumValues.length > 0 && (
                    <section className="schema-page__section">
                        <span className="settings__caption">
                            {t('Values')} · {info.enumValues.length}
                        </span>
                        {info.enumValues.map((value) => (
                            <div key={value.name} className="schema-field">
                                <span className="mono schema-field__name">{value.name}</span>
                                {value.deprecationReason && (
                                    <span
                                        className="badge badge--fail"
                                        title={value.deprecationReason}
                                    >
                                        {t('deprecated')}
                                    </span>
                                )}
                                {value.description && (
                                    <span className="schema-field__doc">{value.description}</span>
                                )}
                            </div>
                        ))}
                    </section>
                )}

                {info.possibleTypes.length > 0 && (
                    <section className="schema-page__section">
                        <span className="settings__caption">
                            {info.kind === 'union' ? t('Possible types') : t('Implemented by')} ·{' '}
                            {info.possibleTypes.length}
                        </span>
                        <div className="schema-page__chips">
                            {info.possibleTypes.map((name) => (
                                <TypeLink key={name} name={name} onOpen={go} />
                            ))}
                        </div>
                    </section>
                )}

                {usages.length > 0 && (
                    <section className="schema-page__section">
                        <span className="settings__caption">
                            {t('Used in')} · {usages.length}
                        </span>
                        {usages.map((usage) => (
                            <UsageRow key={usageKey(usage)} usage={usage} onOpen={go} />
                        ))}
                    </section>
                )}
            </div>
        </div>
    )
}

function kindLabel(info: ITypeInfo, t: ReturnType<typeof useT>): string {
    if (info.root === 'query') return 'QUERY'
    if (info.root === 'mutation') return 'MUTATION'
    if (info.root === 'subscription') return 'SUBSCRIPTION'

    switch (info.kind) {
        case 'object':
            return t('type')
        case 'input':
            return 'input'
        case 'enum':
            return 'enum'
        case 'interface':
            return 'interface'
        case 'union':
            return 'union'
        case 'scalar':
            return 'scalar'
    }
}

/** Имя типа как ссылка; обёртки `[]` и `!` остаются текстом. */
function TypeRef({
    type,
    named,
    onOpen,
}: {
    type: string
    named: string
    onOpen: (name: string) => void
}): React.JSX.Element {
    const [prefix, suffix] = type.split(named) as [string, string?]

    return (
        <span className="mono schema-field__type">
            {prefix}
            <TypeLink name={named} onOpen={onOpen} />
            {suffix ?? ''}
        </span>
    )
}

function TypeLink({
    name,
    onOpen,
}: {
    name: string
    onOpen: (name: string) => void
}): React.JSX.Element {
    return (
        <button type="button" className="schema-link mono" onClick={() => onOpen(name)}>
            {name}
        </button>
    )
}

function FieldRow(props: {
    field: IFieldInfo
    onOpen: (name: string) => void
    onInsert?: () => void
}): React.JSX.Element {
    const { field } = props
    const [open, setOpen] = useState(false)
    const t = useT()
    const hasArgs = field.args.length > 0

    return (
        <div
            className={`schema-field${field.deprecationReason ? ' schema-field--deprecated' : ''}`}
        >
            <div className="schema-field__row">
                <button
                    type="button"
                    className={`json-chevron schema-field__chevron${open ? ' json-chevron--open' : ''}${hasArgs ? '' : ' schema-field__chevron--hidden'}`}
                    onClick={() => setOpen((current) => !current)}
                    aria-label={t('Arguments')}
                    tabIndex={hasArgs ? 0 : -1}
                >
                    ▶
                </button>
                {props.onInsert ? (
                    <button
                        type="button"
                        className="mono schema-field__name schema-field__name--insert"
                        onClick={props.onInsert}
                    >
                        {field.name}
                    </button>
                ) : (
                    <span className="mono schema-field__name">{field.name}</span>
                )}
                {hasArgs && (
                    <span
                        className="mono schema-field__args"
                        onClick={() => setOpen((current) => !current)}
                    >
                        ({field.args.map((arg) => arg.name).join(', ')})
                    </span>
                )}
                <span className="schema-field__colon">:</span>
                <TypeRef type={field.type} named={field.namedType} onOpen={props.onOpen} />
                {field.deprecationReason && (
                    <span className="badge badge--fail" title={field.deprecationReason}>
                        {t('deprecated')}
                    </span>
                )}
            </div>

            {field.description && <div className="schema-field__doc">{field.description}</div>}

            {open && hasArgs && (
                <div className="schema-field__arglist">
                    {field.args.map((arg) => (
                        <div key={arg.name} className="schema-field__arg">
                            <span className="mono">{arg.name}</span>
                            <span className="schema-field__colon">:</span>
                            <TypeRef type={arg.type} named={arg.namedType} onOpen={props.onOpen} />
                            {arg.defaultValue !== undefined && (
                                <span className="mono inspector__hint">= {arg.defaultValue}</span>
                            )}
                            {arg.required && <span className="badge">{t('required')}</span>}
                            {arg.description && (
                                <span className="schema-field__doc">{arg.description}</span>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

function UsageRow({
    usage,
    onOpen,
}: {
    usage: ITypeUsage
    onOpen: (name: string) => void
}): React.JSX.Element {
    const t = useT()

    return (
        <div className="schema-field__row">
            <TypeLink name={usage.typeName} onOpen={onOpen} />
            <span className="mono">.{usage.fieldName}</span>
            {usage.argumentName && (
                <span className="mono inspector__hint">({usage.argumentName})</span>
            )}
            <span className="badge">
                {usage.role === 'field'
                    ? t('field')
                    : usage.role === 'argument'
                      ? t('argument')
                      : t('input field')}
            </span>
        </div>
    )
}

function usageKey(usage: ITypeUsage): string {
    return `${usage.typeName}.${usage.fieldName}.${usage.argumentName ?? ''}`
}
