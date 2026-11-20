import type { IActivityEntry, IActivityTask } from '@resolvr/core'
import { useEffect, useMemo, useRef, useState } from 'react'

import { t as translate, tn, useT } from '../i18n/index.js'
import { useAppStore } from '../state/store.js'
import { DialogSurface } from './DialogSurface.js'
import { JsonViewer } from './JsonViewer.js'

export interface IAgentActivityProps {
    onClose: () => void
}

const FILTERS = [
    ['all', 'All'],
    ['failed', 'Errors'],
    ['notes', 'Notes'],
] as const

type IEntryFilter = typeof FILTERS[number][0]

const TOOL_LABELS: Readonly<Record<string, string | undefined>> = {
    workspace_list: 'List workspaces',
    workspace_create: 'Create workspace',
    collection_list: 'List collections',
    collection_create: 'Create collection',
    operation_get: 'Read saved request',
    operation_save: 'Save request',
    operation_delete: 'Delete request',
    run: 'Run GraphQL request',
    history_list: 'Read run history',
    introspect: 'Fetch GraphQL schema',
    schema_get: 'Explore GraphQL schema',
    schema_diff: 'Compare schemas',
    flow_list: 'List flows',
    flow_get: 'Read flow',
    flow_save: 'Save flow',
    flow_delete: 'Delete flow',
    flow_run: 'Run flow',
    flow_run_many: 'Run a set of flows',
    env_list: 'List environments',
    env_set: 'Set environment variable',
    scripts_get: 'Read request scripts',
    scripts_set: 'Configure request scripts',
}

const ENTRY_STATUS = {
    call_started: { tone: 'pending', label: 'Call started', icon: '…' },
    success: { tone: 'ok', label: 'Succeeded', icon: '✓' },
    failure: { tone: 'fail', label: 'Failed', icon: '!' },
    note: { tone: 'note', label: 'Agent note', icon: '–' },
} as const

const CALL_TIME = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' })

/** Хронология агента с выбранной задачей и подробностями вызова. */
export function AgentActivity(props: IAgentActivityProps): React.JSX.Element {
    const t = useT()
    const tasks = useAppStore((state) => state.activityTasks)
    const loadActivity = useAppStore((state) => state.loadActivity)
    const expandDepth = useAppStore((state) => state.settings.response.expandDepth)

    const [pickedTask, setPickedTask] = useState<IActivityTask>()
    const [selectedSeq, setSelectedSeq] = useState<number>()
    const [filter, setFilter] = useState<IEntryFilter>('all')
    const timeline = useRef<HTMLDivElement>(null)

    useEffect(() => {
        void loadActivity()
    }, [loadActivity])

    const task = pickedTask ? tasks.find((item) => item.id === pickedTask.id) ?? pickedTask : tasks[0]
    const options = pickedTask && !tasks.some((item) => item.id === pickedTask.id)
        ? [...tasks, pickedTask]
        : tasks

    const entries = useMemo(() => {
        if (!task) return []
        if (filter === 'failed') return task.entries.filter((entry) => entry.kind === 'call' && !entry.ok)
        if (filter === 'notes') return task.entries.filter((entry) => entry.kind === 'note')

        return task.entries
    }, [task, filter])

    const selected = entries.find((entry) => entry.seq === selectedSeq) ?? entries.at(-1)
    const activeSeq = selected?.seq

    useEffect(() => {
        if (selectedSeq !== undefined || activeSeq === undefined) return
        timeline.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({ block: 'nearest' })
    }, [activeSeq, selectedSeq, task?.id])

    function toggleFollow(): void {
        if (pickedTask) {
            setPickedTask(undefined)
            setSelectedSeq(undefined)
        } else if (task) {
            setPickedTask(task)
            setSelectedSeq(activeSeq)
        }
    }

    return (
        <DialogSurface label={t('Agent activity')} className="activity" onClose={props.onClose}>
            <header className="activity__header">
                <h2 className="dialog__title">{t('Agent activity')}</h2>
                <div className="activity__toolbar">
                    <label className="activity__task">
                        <span>{t('Task')}</span>
                        <select
                            className="select"
                            value={task?.id ?? ''}
                            title={task && formatTaskLabel(task)}
                            disabled={options.length === 0}
                            onChange={(event) => {
                                setPickedTask(options.find((item) => item.id === event.target.value))
                                setSelectedSeq(undefined)
                            }}
                        >
                            {options.length === 0 && <option value="">{t('No records')}</option>}
                            {options.map((item) => (
                                <option key={item.id} value={item.id}>{formatTaskLabel(item)}</option>
                            ))}
                        </select>
                    </label>
                    <div className="activity__actions">
                        <button
                            type="button"
                            className="btn activity__follow"
                            aria-pressed={!pickedTask}
                            disabled={!task}
                            onClick={toggleFollow}
                        >
                            <span aria-hidden="true" />
                            {t('Follow latest')}
                        </button>
                        <button type="button" className="btn btn--quiet" onClick={() => void loadActivity()}>
                            {t('Refresh')}
                        </button>
                        <button type="button" className="btn" onClick={props.onClose}>{t('Close')}</button>
                    </div>
                </div>
            </header>

            {!task ? (
                <div className="empty activity__empty">
                    {t('The agent has not contacted the app yet.')}
                    <br />
                    {t('The log appears after the first call via MCP.')}
                </div>
            ) : (
                <div className="activity__body">
                    <section className="activity__list" aria-label={t('Activity timeline')}>
                        <div className="activity__list-header">
                            <div className="activity__stats">
                                <span>{tn(task.stats.totalCalls, 'call|calls')}</span>
                                {task.stats.failedCalls > 0 &&
                                    <span className="activity__fail">{t('{n} failed', { n: task.stats.failedCalls })}</span>}
                                {task.client.name !== 'unknown' && <span title={task.client.name}>{task.client.name}</span>}
                            </div>
                            <div className="segmented" role="group" aria-label={t('Filter activity')}>
                                {FILTERS.map(([value, label]) => (
                                    <button
                                        key={value}
                                        type="button"
                                        className={`segmented__item${filter === value ? ' segmented__item--active' : ''}`}
                                        aria-pressed={filter === value}
                                        onClick={() => {
                                            setFilter(value)
                                            setSelectedSeq(undefined)
                                        }}
                                    >
                                        {t(label)}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="activity__timeline" ref={timeline}>
                            {task.plan && (
                                <details className="activity__plan" key={task.id} open>
                                    <summary>{t('Plan')}</summary>
                                    <p>{task.plan.goal}</p>
                                    {task.plan.steps.length > 0 && (
                                        <ol>
                                            {task.plan.steps.map((step, index) => (
                                                <li key={index}>{step}</li>
                                            ))}
                                        </ol>
                                    )}
                                </details>
                            )}
                            {entries.length === 0 && (
                                <div className="empty">{t(filter === 'all' ? 'Waiting for the first call' : 'Nothing found')}</div>
                            )}
                            <ol className="activity__entries">
                                {entries.map((entry) => (
                                    <li key={entry.seq}>
                                        <TimelineRow
                                            entry={entry}
                                            active={entry.seq === activeSeq}
                                            onSelect={() => {
                                                if (entry.seq === activeSeq) return
                                                setPickedTask(task)
                                                setSelectedSeq(entry.seq)
                                            }}
                                        />
                                    </li>
                                ))}
                            </ol>
                        </div>
                    </section>

                    <section className="activity__details" key={`${task.id}:${activeSeq ?? ''}`} aria-label={t('Activity details')}>
                        {selected ? (
                            <EntryDetails
                                entry={selected}
                                step={selected.step === undefined ? undefined : task.plan?.steps[selected.step]}
                                expandDepth={expandDepth}
                            />
                        ) : (
                            <div className="empty activity__empty">{t('Pick a step on the left')}</div>
                        )}
                    </section>
                </div>
            )}
        </DialogSurface>
    )
}

interface ITimelineRowProps {
    entry: IActivityEntry
    active: boolean
    onSelect: () => void
}

function TimelineRow({ entry, active, onSelect }: ITimelineRowProps): React.JSX.Element {
    const t = useT()
    const status = statusOf(entry)
    const intent = entry.kind === 'note' ? entry.text : entry.intent
    const summary = entry.kind === 'call' ? entry.error || entry.summary : undefined

    return (
        <button
            type="button"
            className="activity__row"
            aria-pressed={active}
            data-status={status.tone}
            onClick={onSelect}
        >
            <span className="activity__mark" role="img" aria-label={t(status.label)} title={t(status.label)}>{status.icon}</span>
            <span className="activity__row-body">
                <span className="activity__row-head">
                    <span className="activity__action-title">{actionOf(entry)}</span>
                    <EntryTime timestamp={entry.ts} />
                </span>
                {intent && <span className="activity__intent">{intent}</span>}
                {summary && <span className="activity__summary">{summary}</span>}
            </span>
        </button>
    )
}

interface IEntryDetailsProps {
    entry: IActivityEntry
    step?: string
    expandDepth: number
}

function EntryDetails({ entry, step, expandDepth }: IEntryDetailsProps): React.JSX.Element {
    const t = useT()
    const workspaceId = entry.kind === 'note' ? undefined : entry.workspaceId
    const workspace = useAppStore((state) => state.workspaces.find((item) => item.id === workspaceId)?.name)
    const [argumentsOpen, setArgumentsOpen] = useState(false)
    const status = statusOf(entry)
    const intent = entry.kind === 'note' ? entry.text : entry.intent

    return (
        <div className="activity__entry" data-status={status.tone}>
            <header className="activity__entry-header">
                {step && <p className="activity__step">{step}</p>}
                <div className="activity__entry-heading">
                    <h3>{actionOf(entry)}</h3>
                    {entry.kind !== 'note' &&
                        <span className="activity__status">{t(status.label)}</span>}
                </div>
                {intent && <p className="activity__description selectable">{intent}</p>}
                <div className="activity__metadata">
                    <EntryTime timestamp={entry.ts} />
                    {entry.kind === 'call' && <span>{t('{n} ms', { n: Math.round(entry.durationMs) })}</span>}
                    {workspaceId && <span title={workspaceId}>{workspace ?? workspaceId}</span>}
                </div>
            </header>

            {entry.kind === 'call_started' && (
                <div className="activity__pending">{t('Waiting for a result from MCP')}</div>
            )}

            {entry.kind === 'call' && (entry.summary || entry.error || entry.result !== undefined) && (
                <section className="activity__result">
                    <div className="activity__result-header">
                        <h4>{t('Result')}</h4>
                        {entry.truncated && <span className="badge">{t('truncated')}</span>}
                    </div>
                    {entry.summary && <p className="activity__outcome selectable">{entry.summary}</p>}
                    {entry.error && <p className="activity__error selectable">{entry.error}</p>}
                    {entry.result !== undefined && (
                        <JsonViewer value={entry.result} defaultExpandDepth={expandDepth} />
                    )}
                </section>
            )}

            {entry.kind !== 'note' && entry.expectation && (
                <p className="activity__expectation selectable">{t('Expected: {text}', { text: entry.expectation })}</p>
            )}

            {entry.kind === 'call' && (
                <details
                    className="activity__arguments"
                    onToggle={(event) => setArgumentsOpen(event.currentTarget.open)}
                >
                    <summary>
                        <span>{t('Arguments')}</span>
                        <code title={entry.tool}>{entry.tool}</code>
                    </summary>
                    {argumentsOpen && <JsonViewer value={entry.args} defaultExpandDepth={expandDepth} />}
                </details>
            )}
        </div>
    )
}

function EntryTime({ timestamp }: { timestamp: string }): React.JSX.Element {
    const date = new Date(timestamp)
    const time = Number.isFinite(date.getTime()) ? CALL_TIME.format(date) : '—'

    return <time dateTime={timestamp} title={date.toLocaleString()}>{time}</time>
}

function statusOf(entry: IActivityEntry): typeof ENTRY_STATUS[keyof typeof ENTRY_STATUS] {
    if (entry.kind !== 'call') return ENTRY_STATUS[entry.kind]

    return entry.ok ? ENTRY_STATUS.success : ENTRY_STATUS.failure
}

function actionOf(entry: IActivityEntry): string {
    if (entry.kind === 'note') return translate('Agent note')

    return translate(TOOL_LABELS[entry.tool] ?? 'MCP call')
}

/** Использует цель старых планов и описание первого действия в журналах без плана. */
function formatTaskLabel(task: IActivityTask): string {
    const first = task.entries[0]
    return task.plan?.title?.trim() || task.plan?.goal.trim() ||
        (first?.kind === 'note' ? first.text.trim() : first?.intent.trim()) ||
        translate('Untitled task')
}
