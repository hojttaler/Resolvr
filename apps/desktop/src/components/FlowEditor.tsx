import {
    formatOperationRef,
    toSlug,
    type IFlow,
    type IFlowAssert,
    type IFlowStep,
    type IFlowStepExpect,
    type IFlowStepResult,
} from '@resolvr/core'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { copyText } from '../lib/clipboard.js'
import { useT } from '../i18n/index.js'
import { isModKey, kbd } from '../lib/keys.js'
import { findOperation, parseVariables, useAppStore } from '../state/store.js'
import { CodeEditor } from './editor/CodeEditor.js'
import { JsonViewer } from './JsonViewer.js'
import { KeyValueEditor } from './KeyValueEditor.js'

export interface IFlowPageProps {
    /** Вкладка-редактор; черновик цепочки лежит в состоянии под её идентификатором. */
    tabId: string
}

/** Какой ответ шаг считает успешным; `error` — для негативных тестов. */
const EXPECT_OPTIONS: Array<{ value: IFlowStepExpect; label: string; hint: string }> = [
    { value: 'success', label: 'Success', hint: 'a response without errors, and the checks pass' },
    {
        value: 'error',
        label: 'Error',
        hint: 'the server returns an error (HTTP not 2xx or GraphQL errors), and the checks pass — for negative tests',
    },
    { value: 'any', label: 'Any response', hint: 'only the checks decide' },
]

const ASSERT_OPS: Array<{ value: IFlowAssert['op']; label: string; needsValue: boolean }> = [
    { value: 'exists', label: 'exists', needsValue: false },
    { value: 'notExists', label: 'does not exist', needsValue: false },
    { value: 'eq', label: 'equals', needsValue: true },
    { value: 'ne', label: 'not equals', needsValue: true },
    { value: 'contains', label: 'contains', needsValue: true },
    { value: 'gt', label: 'greater than', needsValue: true },
    { value: 'lt', label: 'less than', needsValue: true },
    // Числовое сравнение отделено от `eq`: денежные поля приходят строкой
    // («10.000000»), и строгое равенство с 10 на них не срабатывало.
    { value: 'eqNum', label: 'equals (number)', needsValue: true },
    { value: 'len', label: 'array length', needsValue: true },
]

/**
 * Редактор цепочки запросов — страница во вкладке.
 *
 * Шаги выполняются по порядку; значения, извлечённые из ответа (`extract`),
 * попадают в общий контекст и подставляются в переменные следующих шагов как
 * `{{имя}}`. После запуска ответ каждого шага показывается прямо здесь: путь
 * для извлечения или проверки берётся кликом по нужному полю ответа, а не
 * набирается по памяти.
 *
 * Вкладка, а не модальное окно: цепочку правят и запускают много раз подряд,
 * сверяясь с коллекциями и схемой, — окно поверх всего этому мешало. Черновик
 * живёт в состоянии приложения и переживает переключение вкладок и перезапуск.
 */
export function FlowPage(props: IFlowPageProps): React.JSX.Element {
    const tree = useAppStore((state) => state.tree)
    const workspace = useAppStore((state) => state.workspace)
    const draft = useAppStore((state) => state.flowDrafts[props.tabId])
    const tab = useAppStore((state) => state.tabs.find((item) => item.id === props.tabId))
    const updateFlowDraft = useAppStore((state) => state.updateFlowDraft)
    const saveFlowTab = useAppStore((state) => state.saveFlowTab)
    const deleteFlow = useAppStore((state) => state.deleteFlow)
    const runFlow = useAppStore((state) => state.runFlow)
    const flowRun = useAppStore((state) => state.flowRun)
    const linkTo = useAppStore((state) => state.linkTo)

    const [error, setError] = useState<string | undefined>()
    const [busy, setBusy] = useState(false)
    const running = useRef(false)
    const [stepId, setStepId] = useState<string>()
    const [tagsText, setTagsText] = useState<string>()
    const [jsonDrafts, setJsonDrafts] = useState<Record<string, { text: string; valid: boolean }>>(
        {},
    )
    const t = useT()

    // ⌘↩ запускает цепочку так же, как запрос в обычной вкладке.
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (!event.defaultPrevented && event.key === 'Enter' && isModKey(event)) {
                event.preventDefault()
                void saveAndRun()
            }
        }

        window.addEventListener('keydown', onKeyDown)

        return () => window.removeEventListener('keydown', onKeyDown)
    })

    if (!draft) return <div className="empty">{t('Flow draft not found')}</div>

    function setDraft(updater: (current: IFlow) => IFlow): void {
        const current = useAppStore.getState().flowDrafts[props.tabId]
        if (current) updateFlowDraft(props.tabId, updater(current))
    }

    function patchStep(index: number, patch: Partial<IFlowStep>): void {
        setDraft((current) => ({
            ...current,
            steps: current.steps.map((step, position) =>
                position === index ? { ...step, ...patch } : step,
            ),
        }))
    }

    function addStep(): void {
        const id = `step-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
        setDraft((current) => ({
            ...current,
            steps: [
                ...current.steps,
                {
                    id,
                    name: t('Step {n}', { n: current.steps.length + 1 }),
                    variables: {},
                    extract: {},
                    assert: [],
                    expect: 'success',
                    continueOnFailure: false,
                },
            ],
        }))
        setStepId(id)
    }

    function updateJson(
        id: string,
        text: string,
        onValid: (value: Record<string, unknown>) => void,
    ): void {
        const value = parseVariables(text)
        setJsonDrafts((current) => ({
            ...current,
            [id]: { text, valid: !(value instanceof Error) },
        }))
        setError(undefined)
        if (!(value instanceof Error)) onValid(value)
    }

    function moveStep(index: number, direction: -1 | 1): void {
        setDraft((current) => {
            const target = index + direction
            if (target < 0 || target >= current.steps.length) return current

            const steps = [...current.steps]
            const [moved] = steps.splice(index, 1)
            if (moved) steps.splice(target, 0, moved)

            return { ...current, steps }
        })
    }

    async function persist(): Promise<boolean> {
        if (draft && draft.steps.length === 0) {
            setError(t('Add at least one step'))

            return false
        }

        if (jsonDrafts['']?.valid === false) {
            setError(t('Constants are not valid JSON'))

            return false
        }
        const invalidStep = draft?.steps.find((step) => jsonDrafts[step.id]?.valid === false)
        if (invalidStep) {
            setStepId(invalidStep.id)
            setError(t('Step “{name}”: variables are not valid JSON', { name: invalidStep.name }))

            return false
        }

        const problem = await saveFlowTab(props.tabId)
        setError(problem)

        return problem === undefined
    }

    async function saveAndRun(): Promise<void> {
        if (running.current) return
        running.current = true
        setBusy(true)
        try {
            if (!(await persist())) return
            const saved = useAppStore.getState().flowDrafts[props.tabId]
            if (saved?.id) await runFlow(saved.id)
        } finally {
            running.current = false
            setBusy(false)
        }
    }

    const run = flowRun?.flowId === draft.id ? flowRun : undefined
    const fileName = (draft.id.length > 0 ? draft.id : toSlug(draft.name)) || 'flow'
    const selected = draft.steps.find((step) => step.id === stepId) ?? draft.steps[0]
    const index = draft.steps.findIndex((step) => step.id === selected?.id)
    const stepResult = run?.steps.find((item) => item.stepId === selected?.id)

    return (
        <div className="panel flow-page">
            <div className="panel__header flow-page__header">
                <input
                    className="input flow-page__title"
                    value={draft.name}
                    placeholder={t('Flow name')}
                    aria-label={t('Flow name')}
                    title={
                        workspace
                            ? `workspaces/${workspace.id}/flows/${fileName}.flow.json`
                            : undefined
                    }
                    onChange={(event) =>
                        setDraft((current) => ({ ...current, name: event.target.value }))
                    }
                />
                {run && (
                    <span className={`badge ${run.ok ? 'badge--ok' : 'badge--fail'}`}>
                        {run.ok ? t('passed') : t('failed')} · {t('{n} ms', { n: run.durationMs })}
                    </span>
                )}
                {tab?.dirty && <span className="badge">{t('not saved')}</span>}

                <span className="panel__spacer" />

                {draft.id.length > 0 && (
                    <button
                        type="button"
                        className="btn btn--quiet"
                        onClick={() => void copyText(linkTo({ flowId: draft.id }) ?? '')}
                        title={t('Copy resolvr:// link to this flow')}
                    >
                        {t('Link')}
                    </button>
                )}

                {draft.id.length > 0 && (
                    <button
                        type="button"
                        className="btn btn--quiet"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => void deleteFlow(draft.id)}
                        title={t('Delete flow and close the tab')}
                    >
                        {t('Delete')}
                    </button>
                )}

                <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void persist()}
                >
                    {t('Save')}
                </button>
                <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() => void saveAndRun()}
                    title={t('Save and run ({keys})', { keys: kbd('Enter') })}
                >
                    {!busy && <span aria-hidden="true">▶</span>}
                    {busy ? t('Running…') : t('Run')}
                    {!busy && <kbd className="btn__key">{kbd('Enter')}</kbd>}
                </button>
            </div>

            {error && (
                <div className="flow__error" role="alert">
                    {error}
                </div>
            )}
            <div className="flow-page__body">
                <div className="flow-page__steps">
                    <div className="flow__grid flow__metadata">
                        <label className="field__label" htmlFor="flow-tags">
                            {t('Tags')}
                        </label>
                        <input
                            id="flow-tags"
                            className="input"
                            value={tagsText ?? draft.tags.join(', ')}
                            placeholder="smoke, billing"
                            onBlur={() => setTagsText(undefined)}
                            onChange={(event) => {
                                const text = event.target.value
                                setTagsText(text)
                                setDraft((current) => ({ ...current, tags: parseTags(text) }))
                            }}
                        />
                        <label className="field__label" htmlFor="flow-preconditions">
                            {t('Preconditions')}
                        </label>
                        <input
                            id="flow-preconditions"
                            className="input"
                            value={draft.preconditions}
                            placeholder={t('a client with an active contract')}
                            onChange={(event) =>
                                setDraft((current) => ({
                                    ...current,
                                    preconditions: event.target.value,
                                }))
                            }
                        />
                    </div>

                    <ConstantsEditor
                        value={jsonDrafts['']?.text ?? JSON.stringify(draft.variables, null, 2)}
                        invalid={jsonDrafts['']?.valid === false}
                        onChange={(text) =>
                            updateJson('', text, (variables) =>
                                setDraft((current) => ({ ...current, variables })),
                            )
                        }
                    />

                    <h2 className="flow-page__heading">{t('Steps')}</h2>
                    <ol className="flow-page__step-list">
                        {draft.steps.map((step, position) => (
                            <li key={step.id}>
                                <span className="flow-page__step-index" aria-hidden="true">
                                    {position + 1}
                                </span>
                                <button
                                    type="button"
                                    className="flow-page__step"
                                    aria-pressed={step.id === selected?.id}
                                    onClick={() => setStepId(step.id)}
                                >
                                    <strong>
                                        {step.name || t('Step {n}', { n: position + 1 })}
                                    </strong>
                                    <span className="inspector__hint">
                                        {step.operationRef ?? t('Custom query')}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ol>

                    <button type="button" className="btn btn--quiet" onClick={addStep}>
                        {t('+ Add step')}
                    </button>

                    {run && Object.keys(run.context).length > 0 && (
                        <div className="flow__summary">
                            <div className="settings__caption">{t('Flow result')}</div>
                            <div className="inspector__hint">
                                {t(
                                    'Values extracted by steps — they were substituted further as {{name}}',
                                )}
                            </div>
                            <JsonViewer value={run.context} defaultExpandDepth={3} />
                            <button
                                type="button"
                                className="btn btn--quiet"
                                onClick={() => void copyText(JSON.stringify(run.context, null, 2))}
                            >
                                {t('Copy result')}
                            </button>
                        </div>
                    )}
                </div>
                <div className="flow-page__detail">
                    {selected ? (
                        <StepEditor
                            key={selected.id}
                            step={selected}
                            index={index}
                            total={draft.steps.length}
                            result={stepResult}
                            collections={tree}
                            variablesText={
                                jsonDrafts[selected.id]?.text ??
                                JSON.stringify(selected.variables, null, 2)
                            }
                            invalidVariables={jsonDrafts[selected.id]?.valid === false}
                            onVariablesChange={(text) =>
                                updateJson(selected.id, text, (variables) =>
                                    patchStep(index, { variables }),
                                )
                            }
                            onPatch={(patch) => patchStep(index, patch)}
                            onMove={(direction) => moveStep(index, direction)}
                            onRemove={() => {
                                setStepId(draft.steps[index + 1]?.id ?? draft.steps[index - 1]?.id)
                                setDraft((current) => ({
                                    ...current,
                                    steps: current.steps.filter((step) => step.id !== selected.id),
                                }))
                            }}
                        />
                    ) : (
                        <p className="empty">{t('Add at least one step')}</p>
                    )}
                </div>
            </div>
        </div>
    )
}

/** Метки из строки через запятую: пустые отбрасываются, повторы убираются. */
function parseTags(value: string): string[] {
    return [
        ...new Set(
            value
                .split(',')
                .map((tag) => tag.trim())
                .filter((tag) => tag.length > 0),
        ),
    ]
}

interface IConstantsEditorProps {
    value: string
    invalid: boolean
    onChange: (value: string) => void
}

/** Начальный контекст прогона, доступный всем шагам. */
function ConstantsEditor(props: IConstantsEditorProps): React.JSX.Element {
    const t = useT()

    return (
        <details className="flow__constants">
            <summary>{t('Constants')}</summary>
            <div className="inspector__hint">
                {t('the starting context of the run — available to steps as {{name}}')}
            </div>
            <div className="flow__editor">
                <CodeEditor value={props.value} language="json" onChange={props.onChange} />
            </div>
            {props.invalid && (
                <div className="flow__error">{t('Constants are not valid JSON')}</div>
            )}
        </details>
    )
}

interface IStepEditorProps {
    step: IFlowStep
    index: number
    total: number
    result: IFlowStepResult | undefined
    collections: Parameters<typeof findOperation>[0]
    variablesText: string
    invalidVariables: boolean
    onVariablesChange: (text: string) => void
    onPatch: (patch: Partial<IFlowStep>) => void
    onMove: (direction: -1 | 1) => void
    onRemove: () => void
}

function StepEditor(props: IStepEditorProps): React.JSX.Element {
    const t = useT()
    const { step, result } = props
    const schema = useAppStore((state) => state.schema)
    const [showResponse, setShowResponse] = useState(true)

    const stepQuery = step.query ?? findOperation(props.collections, step.operationRef)?.query ?? ''
    const payload = useMemo(
        () =>
            result?.result
                ? {
                      status: result.result.status,
                      ok: result.result.ok,
                      data: result.result.data,
                      errors: result.result.errors ?? null,
                  }
                : undefined,
        [result],
    )
    const suggestions = useMemo(() => (payload ? collectPaths(payload) : undefined), [payload])

    function addExtract(path: string): void {
        const name = suggestName(path)
        props.onPatch({ extract: { ...step.extract, [name]: path } })
    }

    function addAssert(path: string): void {
        props.onPatch({ assert: [...step.assert, { path, op: 'exists' }] })
    }

    return (
        <div className="flow__step">
            <div className="flow__step-head">
                <span className="flow__step-number">{props.index + 1}</span>
                <input
                    className="input flow-page__step-title"
                    aria-label={t('Step name')}
                    value={step.name}
                    onChange={(event) => props.onPatch({ name: event.target.value })}
                />

                {result && (
                    <span
                        className={`badge ${
                            result.skipped ? '' : result.ok ? 'badge--ok' : 'badge--fail'
                        }`}
                        title={result.error ?? t('Step done')}
                    >
                        {result.skipped ? '—' : result.ok ? '✓' : '✕'}
                        {result.status ? ` ${result.status}` : ''}
                    </span>
                )}

                <button
                    type="button"
                    className="btn btn--quiet btn--icon"
                    onClick={() => props.onMove(-1)}
                    disabled={props.index === 0}
                    title={t('Up')}
                >
                    ↑
                </button>
                <button
                    type="button"
                    className="btn btn--quiet btn--icon"
                    onClick={() => props.onMove(1)}
                    disabled={props.index === props.total - 1}
                    title={t('Down')}
                >
                    ↓
                </button>
                <button
                    type="button"
                    className="btn btn--quiet btn--icon"
                    onClick={props.onRemove}
                    title={t('Remove step')}
                >
                    ×
                </button>
            </div>

            <div className="flow__grid">
                <label className="field__label">{t('Operation')}</label>
                <select
                    className="select"
                    style={{ maxWidth: 'none' }}
                    value={step.operationRef ?? ''}
                    onChange={(event) =>
                        props.onPatch({ operationRef: event.target.value || undefined })
                    }
                >
                    <option value="">— {t('Custom query')} —</option>
                    {props.collections.map((node) =>
                        node.operations.map((operation) => {
                            const ref = formatOperationRef({
                                collectionId: node.collection.id,
                                name: operation.name,
                            })

                            return (
                                <option key={ref} value={ref}>
                                    {node.collection.name} / {operation.name}
                                </option>
                            )
                        }),
                    )}
                </select>

                {!step.operationRef && (
                    <>
                        <label className="field__label">{t('Query')}</label>
                        <div className="flow__editor flow__editor--query">
                            <CodeEditor
                                value={step.query ?? ''}
                                language="graphql"
                                schema={schema}
                                variablesSource={props.variablesText}
                                onChange={(value) => props.onPatch({ query: value })}
                                onVariablesAdded={(added) => {
                                    const previous = parseVariables(props.variablesText)
                                    if (previous instanceof Error) return
                                    props.onVariablesChange(JSON.stringify({ ...previous, ...added }, null, 2))
                                }}
                            />
                        </div>
                    </>
                )}

                <label className="field__label">{t('Variables')}</label>
                <div className="flow__editor">
                    <CodeEditor
                        value={props.variablesText}
                        language="json"
                        schema={schema}
                        completionQuery={stepQuery}
                        onChange={props.onVariablesChange}
                    />
                </div>

                {props.invalidVariables && (
                    <div className="flow__error">
                        {t('Step “{name}”: variables are not valid JSON', { name: step.name })}
                    </div>
                )}

                <label className="field__label">
                    {t('Extract')}
                    <div className="inspector__hint">{t('available further as {{name}}')}</div>
                </label>
                <KeyValueEditor
                    value={step.extract}
                    onChange={(extract) => props.onPatch({ extract })}
                    keyPlaceholder="token"
                    valuePlaceholder="data.login.accessToken"
                    separator="←"
                    addLabel={t('+ Extraction')}
                    valueSuggestions={suggestions}
                />

                <label className="field__label">{t('Expected result')}</label>
                <div className="flow__expect">
                    <select
                        className="select"
                        value={step.expect}
                        onChange={(event) =>
                            props.onPatch({ expect: event.target.value as IFlowStepExpect })
                        }
                    >
                        {EXPECT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {t(option.label)}
                            </option>
                        ))}
                    </select>
                    <span className="inspector__hint">
                        {t(
                            EXPECT_OPTIONS.find((option) => option.value === step.expect)?.hint ??
                                '',
                        )}
                    </span>
                </div>

                <label className="field__label">{t('Checks')}</label>
                <AssertEditor
                    asserts={step.assert}
                    results={result?.asserts}
                    suggestions={suggestions}
                    onChange={(next) => props.onPatch({ assert: next })}
                />
            </div>

            {result?.error && <div className="flow__error">{result.error}</div>}

            {payload && (
                <div className="flow__response">
                    <button
                        type="button"
                        className="btn btn--quiet"
                        onClick={() => setShowResponse((current) => !current)}
                    >
                        {showResponse ? '▾' : '▸'} {t('Step response')}
                    </button>

                    {showResponse && (
                        <>
                            <div className="inspector__hint">
                                {t(
                                    'The ↧ button next to a field adds its path to “Extract”, Alt-click — to “Checks”',
                                )}
                            </div>
                            <div className="flow__response-body">
                                <JsonViewer
                                    value={payload}
                                    defaultExpandDepth={4}
                                    onPickPath={(path, modifiers) => {
                                        if (modifiers.alt) addAssert(path)
                                        else addExtract(path)
                                    }}
                                />
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}

interface IAssertEditorProps {
    asserts: IFlowAssert[]
    results?: Array<{ passed: boolean; message: string }>
    suggestions?: string[]
    onChange: (asserts: IFlowAssert[]) => void
}

function AssertEditor(props: IAssertEditorProps): React.JSX.Element {
    const t = useT()
    function patch(index: number, patchValue: Partial<IFlowAssert>): void {
        props.onChange(
            props.asserts.map((item, position) =>
                position === index ? { ...item, ...patchValue } : item,
            ),
        )
    }

    const listId = useId()

    return (
        <div className="flow__rows">
            {props.suggestions && props.suggestions.length > 0 && (
                <datalist id={listId}>
                    {props.suggestions.map((path) => (
                        <option key={path} value={path} />
                    ))}
                </datalist>
            )}

            {props.asserts.map((assertion, index) => {
                const operator = ASSERT_OPS.find((item) => item.value === assertion.op)
                const outcome = props.results?.[index]

                return (
                    <div key={index}>
                        <div className="row">
                            <input
                                className="input mono"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                placeholder="data.me.id"
                                list={props.suggestions ? listId : undefined}
                                value={assertion.path}
                                onChange={(event) => patch(index, { path: event.target.value })}
                            />
                            <select
                                className="select"
                                value={assertion.op}
                                onChange={(event) =>
                                    patch(index, { op: event.target.value as IFlowAssert['op'] })
                                }
                            >
                                {ASSERT_OPS.map((item) => (
                                    <option key={item.value} value={item.value}>
                                        {t(item.label)}
                                    </option>
                                ))}
                            </select>

                            {operator?.needsValue && (
                                <input
                                    className="input mono"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                    placeholder={t('"u1" or 200')}
                                    defaultValue={
                                        assertion.value === undefined
                                            ? ''
                                            : JSON.stringify(assertion.value)
                                    }
                                    onChange={(event) => {
                                        const raw = event.target.value
                                        let parsed: unknown = raw
                                        try {
                                            parsed = JSON.parse(raw)
                                        } catch {
                                            // Незакавыченный текст трактуется как строка —
                                            // печатать кавычки вручную неудобно.
                                        }
                                        patch(index, { value: parsed })
                                    }}
                                />
                            )}

                            <button
                                type="button"
                                className="btn btn--quiet btn--icon"
                                onClick={() =>
                                    props.onChange(
                                        props.asserts.filter((_, position) => position !== index),
                                    )
                                }
                            >
                                ×
                            </button>
                        </div>

                        {outcome && (
                            <div
                                className="inspector__hint"
                                style={{
                                    color: outcome.passed ? 'var(--success)' : 'var(--danger)',
                                }}
                            >
                                {outcome.message}
                            </div>
                        )}
                    </div>
                )
            })}

            <button
                type="button"
                className="btn btn--quiet"
                onClick={() => props.onChange([...props.asserts, { path: 'data.', op: 'exists' }])}
            >
                {t('+ Check')}
            </button>
        </div>
    )
}

const MAX_SUGGESTIONS = 200

/** Все пути внутри ответа — подсказки для полей извлечения и проверок. */
export function collectPaths(value: unknown, prefix = '', depth = 6): string[] {
    const result: string[] = []

    function visit(node: unknown, parent: string, remaining: number): void {
        if (node === null || typeof node !== 'object' || remaining <= 0) return
        const object = node as Record<string, unknown>

        // Прерываем обход на общем лимите, в том числе внутри больших массивов.
        for (const key in object) {
            if (result.length >= MAX_SUGGESTIONS) break
            if (!Object.hasOwn(object, key)) continue
            const path = parent ? `${parent}.${key}` : key
            result.push(path)
            visit(object[key], path, remaining - 1)
        }
    }

    visit(value, prefix, depth)

    return result
}

/** Имя переменной по пути: последний осмысленный сегмент. */
function suggestName(path: string): string {
    const segments = path.split('.').filter((segment) => !/^\d+$/.test(segment))

    return segments.at(-1) ?? 'value'
}
