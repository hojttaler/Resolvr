import type {
    IActivityCallRecord,
    IActivityNoteRecord,
    IActivitySession,
} from '@resolvr/core'
import { useEffect, useMemo, useState } from 'react'

import { useAppStore } from '../state/store.js'
import { JsonViewer } from './JsonViewer.js'
import { CALLS, pluralize } from '../lib/plural.js'

export interface IAgentActivityProps {
    onClose: () => void
}

type IEntryFilter = 'all' | 'failed' | 'notes'

/**
 * Наблюдение за работой агента.
 *
 * Показывает цепочку целиком: план, каждый вызов с намерением и результатом,
 * заметки и ошибки — в порядке выполнения. Слева хронология, справа полные
 * данные выбранного шага, поэтому за агентом можно следить в реальном времени,
 * а не разбирать итог постфактум.
 */
export function AgentActivity(props: IAgentActivityProps): React.JSX.Element {
    const sessions = useAppStore((state) => state.activitySessions)
    const loadActivity = useAppStore((state) => state.loadActivity)
    const expandDepth = useAppStore((state) => state.settings.response.expandDepth)

    const [sessionId, setSessionId] = useState<string | undefined>()
    const [selectedSeq, setSelectedSeq] = useState<number | undefined>()
    const [filter, setFilter] = useState<IEntryFilter>('all')

    useEffect(() => {
        void loadActivity()
    }, [loadActivity])

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (event.key === 'Escape') props.onClose()
        }

        window.addEventListener('keydown', onKeyDown)

        return () => window.removeEventListener('keydown', onKeyDown)
    }, [props])

    const session: IActivitySession | undefined =
        sessions.find((item) => item.sessionId === sessionId) ?? sessions[0]

    const entries = useMemo(() => {
        if (!session) return []
        if (filter === 'failed') {
            return session.entries.filter((entry) => entry.kind === 'call' && !entry.ok)
        }
        if (filter === 'notes') return session.entries.filter((entry) => entry.kind === 'note')

        return session.entries
    }, [session, filter])

    const selected =
        session?.entries.find((entry) => entry.seq === selectedSeq) ??
        [...(session?.entries ?? [])].reverse().find((entry) => entry.kind === 'call')

    return (
        <div className="overlay" onMouseDown={props.onClose}>
            <div className="dialog dialog--full" onMouseDown={(event) => event.stopPropagation()}>
                <div className="activity__head">
                    <div className="dialog__title">Действия агента</div>

                    <select
                        className="select"
                        style={{ maxWidth: 230 }}
                        value={session?.sessionId ?? ''}
                        onChange={(event) => {
                            setSessionId(event.target.value)
                            setSelectedSeq(undefined)
                        }}
                    >
                        {sessions.length === 0 && <option value="">Нет записей</option>}
                        {sessions.map((item) => (
                            <option key={item.sessionId} value={item.sessionId}>
                                {formatSessionLabel(item)}
                            </option>
                        ))}
                    </select>

                    <div className="segmented">
                        {(
                            [
                                ['all', 'Всё'],
                                ['failed', 'Ошибки'],
                                ['notes', 'Выводы'],
                            ] as const
                        ).map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                className={`segmented__item${
                                    filter === value ? ' segmented__item--active' : ''
                                }`}
                                onClick={() => setFilter(value)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>

                    <span className="panel__spacer" />

                    {session && <SessionStats session={session} />}

                    <button type="button" className="btn btn--quiet" onClick={() => void loadActivity()}>
                        Обновить
                    </button>
                    <button type="button" className="btn" onClick={props.onClose}>
                        Закрыть
                    </button>
                </div>

                {!session ? (
                    <div className="empty">
                        Агент ещё не обращался к приложению.
                        <br />
                        Журнал появится после первого вызова через MCP.
                    </div>
                ) : (
                    <div className="activity__body">
                        <div className="activity__timeline">
                            {session.plan && (
                                <div className="activity__plan">
                                    <div className="settings__caption">План</div>
                                    <div className="activity__goal">{session.plan.goal}</div>
                                    <ol className="activity__steps">
                                        {session.plan.steps.map((step, index) => (
                                            <li key={`${index}-${step}`}>{step}</li>
                                        ))}
                                    </ol>
                                </div>
                            )}

                            {entries.length === 0 && <div className="empty">Ничего не найдено</div>}

                            {entries.map((entry) => (
                                <TimelineRow
                                    key={entry.seq}
                                    entry={entry}
                                    active={entry.seq === selected?.seq}
                                    stepLabel={
                                        entry.step !== undefined
                                            ? session.plan?.steps[entry.step]
                                            : undefined
                                    }
                                    onSelect={() => setSelectedSeq(entry.seq)}
                                />
                            ))}
                        </div>

                        <div className="activity__details">
                            {selected ? (
                                <EntryDetails entry={selected} expandDepth={expandDepth} />
                            ) : (
                                <div className="empty">Выберите шаг слева</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

function SessionStats({ session }: { session: IActivitySession }): React.JSX.Element {
    return (
        <span className="row">
            <span className="badge">{pluralize(session.stats.totalCalls, CALLS)}</span>
            {session.stats.failedCalls > 0 ? (
                <span className="badge badge--fail">{session.stats.failedCalls} с ошибкой</span>
            ) : (
                <span className="badge badge--ok">без ошибок</span>
            )}
            <span className="badge">{Math.round(session.stats.durationMs)} мс</span>
        </span>
    )
}

interface ITimelineRowProps {
    entry: IActivityCallRecord | IActivityNoteRecord
    active: boolean
    stepLabel: string | undefined
    onSelect: () => void
}

function TimelineRow(props: ITimelineRowProps): React.JSX.Element {
    const { entry } = props

    if (entry.kind === 'note') {
        return (
            <div
                className={`activity__row activity__row--note${
                    props.active ? ' activity__row--active' : ''
                }`}
                onClick={props.onSelect}
            >
                <span className="activity__seq">{entry.seq}</span>
                <div className="activity__main">
                    <div className="activity__intent">{entry.text}</div>
                    {props.stepLabel && <div className="activity__step">{props.stepLabel}</div>}
                </div>
                <span className="badge">вывод</span>
            </div>
        )
    }

    return (
        <div
            className={`activity__row${props.active ? ' activity__row--active' : ''}${
                entry.ok ? '' : ' activity__row--failed'
            }`}
            onClick={props.onSelect}
        >
            <span className="activity__seq">{entry.seq}</span>

            <div className="activity__main">
                <div className="activity__intent">{entry.intent || '— без описания —'}</div>
                <div className="activity__meta">
                    <span className="mono">{entry.tool}</span>
                    <span>{entry.summary}</span>
                </div>
                {props.stepLabel && <div className="activity__step">{props.stepLabel}</div>}
            </div>

            <span className={`badge ${entry.ok ? 'badge--ok' : 'badge--fail'}`}>
                {entry.ok ? '✓' : '✕'}
            </span>
            <span className="badge">{Math.round(entry.durationMs)} мс</span>
        </div>
    )
}

interface IEntryDetailsProps {
    entry: IActivityCallRecord | IActivityNoteRecord
    expandDepth: number
}

function EntryDetails({ entry, expandDepth }: IEntryDetailsProps): React.JSX.Element {
    if (entry.kind === 'note') {
        return (
            <div className="activity__detail">
                <div className="settings__caption">Вывод агента</div>
                <div className="activity__note selectable">{entry.text}</div>
                <div className="inspector__hint">{new Date(entry.ts).toLocaleString()}</div>
            </div>
        )
    }

    return (
        <div className="activity__detail">
            <div className="settings__caption">
                #{entry.seq} · {entry.tool}
            </div>
            <div className="activity__intent selectable">{entry.intent}</div>

            {entry.expectation && (
                <div className="inspector__hint selectable">Ожидалось: {entry.expectation}</div>
            )}

            <div className="row" style={{ flexWrap: 'wrap' }}>
                <span className={`badge ${entry.ok ? 'badge--ok' : 'badge--fail'}`}>
                    {entry.ok ? 'успех' : 'ошибка'}
                </span>
                <span className="badge">{Math.round(entry.durationMs)} мс</span>
                <span className="badge">{new Date(entry.ts).toLocaleTimeString()}</span>
                {entry.workspaceId && <span className="badge">{entry.workspaceId}</span>}
            </div>

            {entry.error && <div className="flow__error selectable">{entry.error}</div>}

            <div className="settings__caption">Аргументы</div>
            <JsonViewer value={entry.args} defaultExpandDepth={expandDepth} />

            {entry.result !== undefined && (
                <>
                    <div className="settings__caption">
                        Результат
                        {entry.truncated && <span className="badge">усечён</span>}
                    </div>
                    <JsonViewer value={entry.result} defaultExpandDepth={expandDepth} />
                </>
            )}
        </div>
    )
}

/**
 * Подпись сессии для выпадающего списка.
 *
 * Полная дата с секундами и версией клиента не помещалась и обрывалась
 * многоточием, поэтому остаются только день, время и число вызовов.
 */
function formatSessionLabel(session: IActivitySession): string {
    if (!session.startedAt) return `сессия · ${pluralize(session.stats.totalCalls, CALLS)}`

    const started = new Date(session.startedAt)
    const date = started.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
    const time = started.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

    return `${date} ${time} · ${pluralize(session.stats.totalCalls, CALLS)}`
}
