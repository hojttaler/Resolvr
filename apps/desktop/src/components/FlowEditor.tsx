import {
    formatOperationRef,
    toSlug,
    type IFlow,
    type IFlowAssert,
    type IFlowStep,
    type IFlowStepResult,
} from '@resolvr/core'
import { useEffect, useState } from 'react'

import { copyText } from '../lib/clipboard.js'
import { useT } from '../i18n/index.js'
import { isModKey, kbd } from '../lib/keys.js'
import { useAppStore } from '../state/store.js'
import { CodeEditor } from './editor/CodeEditor.js'
import { JsonViewer } from './JsonViewer.js'
import { KeyValueEditor } from './KeyValueEditor.js'

export interface IFlowPageProps {
    /** Вкладка-редактор; черновик цепочки лежит в состоянии под её идентификатором. */
    tabId: string
}

const ASSERT_OPS: Array<{ value: IFlowAssert['op']; label: string; needsValue: boolean }> = [
    { value: 'exists', label: 'exists', needsValue: false },
    { value: 'notExists', label: 'does not exist', needsValue: false },
    { value: 'eq', label: 'equals', needsValue: true },
    { value: 'ne', label: 'not equals', needsValue: true },
    { value: 'contains', label: 'contains', needsValue: true },
    { value: 'gt', label: 'greater than', needsValue: true },
    { value: 'lt', label: 'less than', needsValue: true },
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
    const t = useT()

    // ⌘↩ запускает цепочку так же, как запрос в обычной вкладке.
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (event.key === 'Enter' && isModKey(event)) {
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
        setDraft((current) => ({
            ...current,
            steps: [
                ...current.steps,
                {
                    id: `step-${current.steps.length + 1}-${Math.random().toString(36).slice(2, 6)}`,
                    name: t('Step {n}', { n: current.steps.length + 1 }),
                    variables: {},
                    extract: {},
                    assert: [],
                    continueOnFailure: false,
                },
            ],
        }))
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

        const problem = await saveFlowTab(props.tabId)
        setError(problem)

        return problem === undefined
    }

    async function saveAndRun(): Promise<void> {
        if (!(await persist())) return

        const saved = useAppStore.getState().flowDrafts[props.tabId]
        if (!saved || saved.id.length === 0) return

        setBusy(true)
        try {
            await runFlow(saved.id)
        } finally {
            setBusy(false)
        }
    }

    const run = flowRun?.flowId === draft.id ? flowRun : undefined
    const fileName = (draft.id.length > 0 ? draft.id : toSlug(draft.name)) || 'flow'

    return (
        <div className="panel flow-page">
            <div className="panel__header">
                <span className="panel__title">{t('Flow')}</span>
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
                        onClick={() =>
                            void copyText(linkTo({ flowId: draft.id }) ?? '')
                        }
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

                <button type="button" className="btn" onClick={() => void persist()}>
                    {t('Save')}
                </button>
                <button
                    type="button"
                    className="btn btn--primary"
                    disabled={busy}
                    onClick={() => void saveAndRun()}
                    title={t('Save and run ({keys})', { keys: kbd('Enter') })}
                >
                    {busy ? t('Running…') : t('Run')}
                    {!busy && <kbd className="btn__key">{kbd('Enter')}</kbd>}
                </button>
            </div>

            <div className="panel__content flow-page__body">
                <div className="flow-page__name">
                    <input
                        className="input flow-page__title"
                        value={draft.name}
                        placeholder={t('Flow name')}
                        onChange={(event) =>
                            setDraft((current) => ({ ...current, name: event.target.value }))
                        }
                    />
                    {workspace && (
                        <span className="inspector__hint mono">
                            workspaces/{workspace.id}/flows/{fileName}.flow.json
                        </span>
                    )}
                </div>

                <div className="flow__steps">
                    {/* Пустой редактор ничего не объяснял: кнопка «+ Шаг»
                        не говорит, зачем цепочке шаги и что они дают. */}
                    {draft.steps.length === 0 && (
                        <div className="inspector__hint">
                            {t(
                                'Steps run in order. A value from a step response — for example, a token from login — is extracted by path and substituted into the next steps as {{name}}. Such a flow can be assigned in the environment “Authorization”: the token will then refresh itself.',
                            )}
                        </div>
                    )}

                    {draft.steps.map((step, index) => (
                        <StepEditor
                            key={step.id}
                            step={step}
                            index={index}
                            total={draft.steps.length}
                            result={run?.steps.find((item) => item.stepId === step.id)}
                            collections={tree}
                            onPatch={(patch) => patchStep(index, patch)}
                            onMove={(direction) => moveStep(index, direction)}
                            onRemove={() =>
                                setDraft((current) => ({
                                    ...current,
                                    steps: current.steps.filter(
                                        (_, position) => position !== index,
                                    ),
                                }))
                            }
                            onError={setError}
                        />
                    ))}
                </div>

                <button type="button" className="btn" onClick={addStep}>
                    {t('+ Step')}
                </button>

                {run && Object.keys(run.context).length > 0 && (
                    <div className="flow__summary">
                        <div className="settings__caption">{t('Flow result')}</div>
                        <div className="inspector__hint">
                            {t('Values extracted by steps — they were substituted further as {{name}}')}
                        </div>
                        <JsonViewer value={run.context} defaultExpandDepth={3} />
                        <button
                            type="button"
                            className="btn btn--quiet"
                            onClick={() =>
                                void copyText(
                                    JSON.stringify(run.context, null, 2),
                                )
                            }
                        >
                            {t('Copy result')}
                        </button>
                    </div>
                )}

                {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
            </div>
        </div>
    )
}

interface IStepEditorProps {
    step: IFlowStep
    index: number
    total: number
    result: IFlowStepResult | undefined
    collections: Array<{
        collection: { id: string; name: string }
        operations: Array<{ name: string }>
    }>
    onPatch: (patch: Partial<IFlowStep>) => void
    onMove: (direction: -1 | 1) => void
    onRemove: () => void
    onError: (message: string | undefined) => void
}

function StepEditor(props: IStepEditorProps): React.JSX.Element {
    const t = useT()
    const { step, result } = props
    const schema = useAppStore((state) => state.schema)
    const [showResponse, setShowResponse] = useState(true)

    // Текст переменных живёт отдельно от разобранного объекта: иначе каждый
    // незавершённый символ ломал бы разбор и стирал набранное.
    const [variablesText, setVariablesText] = useState(() =>
        JSON.stringify(step.variables, null, 2),
    )

    // Для подсказок по переменным нужен текст операции: у шага со ссылкой он
    // берётся из сохранённой операции, иначе — из встроенного запроса.
    const operations = useAppStore((state) => state.tree)
    const stepQuery =
        step.query ??
        (step.operationRef
            ? operations
                  .flatMap((node) =>
                      node.operations.map((operation) => ({
                          ref: `${node.collection.id}/${operation.name}`,
                          query: operation.query,
                      })),
                  )
                  .find((item) => item.ref === step.operationRef)?.query
            : undefined) ??
        ''

    /** Ответ шага в том же виде, в каком к нему обращаются пути извлечения. */
    const payload = result?.result
        ? {
              status: result.result.status,
              ok: result.result.ok,
              data: result.result.data,
              errors: result.result.errors ?? null,
          }
        : undefined

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
                    className="input"
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
                                onChange={(value) => props.onPatch({ query: value })}
                            />
                        </div>
                    </>
                )}

                <label className="field__label">{t('Variables')}</label>
                <div className="flow__editor">
                    <CodeEditor
                        value={variablesText}
                        language="json"
                        schema={schema}
                        completionQuery={stepQuery}
                        onChange={(value) => {
                            setVariablesText(value)

                            try {
                                props.onPatch({
                                    variables: JSON.parse(value || '{}') as Record<string, unknown>,
                                })
                                props.onError(undefined)
                            } catch {
                                // Незавершённый JSON — обычное состояние во время
                                // набора: текст сохраняем, ошибку показываем мягко.
                                props.onError(t('Step “{name}”: variables are not valid JSON', { name: step.name }))
                            }
                        }}
                    />
                </div>

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
                    valueSuggestions={payload ? collectPaths(payload) : undefined}
                />

                <label className="field__label">{t('Checks')}</label>
                <AssertEditor
                    asserts={step.assert}
                    results={result?.asserts}
                    suggestions={payload ? collectPaths(payload) : undefined}
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
                                {t('The ↧ button next to a field adds its path to “Extract”, Alt-click — to “Checks”')}
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

    const listId = 'assert-paths'

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
    if (depth <= 0 || value === null || typeof value !== 'object') return []

    const result: string[] = []
    const entries: Array<[string, unknown]> = Array.isArray(value)
        ? value.map((item, index) => [String(index), item])
        : Object.entries(value as Record<string, unknown>)

    for (const [key, item] of entries) {
        const path = prefix.length > 0 ? `${prefix}.${key}` : key
        result.push(path)

        if (result.length >= MAX_SUGGESTIONS) break
        result.push(...collectPaths(item, path, depth - 1))
    }

    return result.slice(0, MAX_SUGGESTIONS)
}

/** Имя переменной по пути: последний осмысленный сегмент. */
function suggestName(path: string): string {
    const segments = path.split('.').filter((segment) => !/^\d+$/.test(segment))

    return segments.at(-1) ?? 'value'
}
