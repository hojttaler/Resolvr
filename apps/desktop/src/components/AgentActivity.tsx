import type {
    IActivityCallRecord,
    IActivityNoteRecord,
    IActivitySession,
} from '@resolvr/core'
import { useEffect, useMemo, useState } from 'react'

import { useAppStore } from '../state/store.js'
import { JsonViewer } from './JsonViewer.js'
import { currentLanguage, t as translate, tn, useT } from '../i18n/index.js'

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
    const t = useT()
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
                    <div className="dialog__title">{t('Agent activity')}</div>

                    <select
                        className="select"
                        style={{ maxWidth: 230 }}
                        value={session?.sessionId ?? ''}
                        onChange={(event) => {
                            setSessionId(event.target.value)
                            setSelectedSeq(undefined)
                        }}
                    >
                        {sessions.length === 0 && <option value="">{t('No records')}</option>}
                        {sessions.map((item) => (
                            <option key={item.sessionId} value={item.sessionId}>
                                {formatSessionLabel(item)}
                            </option>
                        ))}
                    </select>

                    <div className="segmented">
                        {(
                            [
                                ['all', t('All')],
                                ['failed', t('Errors')],
                                ['notes', t('Notes')],
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
                        {t('Refresh')}
                    </button>
                    <button type="button" className="btn" onClick={props.onClose}>
                        {t('Close')}
                    </button>
                </div>

                {!session ? (
                    <div className="empty">
                        {t('The agent has not contacted the app yet.')}
                        <br />
                        {t('The log appears after the first call via MCP.')}
                    </div>
                ) : (
                    <div className="activity__body">
                        <div className="activity__timeline">
                            {session.plan && (
                                <div className="activity__plan">
                                    <div className="settings__caption">{t('Plan')}</div>
                                    <div className="activity__goal">{session.plan.goal}</div>
                                    <ol className="activity__steps">
                                        {session.plan.steps.map((step, index) => (
                                            <li key={`${index}-${step}`}>{step}</li>
                                        ))}
                                    </ol>
                                </div>
                            )}

                            {entries.length === 0 && <div className="empty">{t('Nothing found')}</div>}

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
                                <div className="empty">{t('Pick a step on the left')}</div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

function SessionStats({ session }: { session: IActivitySession }): React.JSX.Element {
    const t = useT()
    return (
        <span className="row">
            <span className="badge">{tn(session.stats.totalCalls, 'call|calls')}</span>
            {session.stats.failedCalls > 0 ? (
                <span className="badge badge--fail">{t('{n} failed', { n: session.stats.failedCalls })}</span>
            ) : (
                <span className="badge badge--ok">{t('no errors')}</span>
            )}
            <span className="badge">{t('{n} ms', { n: Math.round(session.stats.durationMs) })}</span>
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
    const t = useT()
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
                <span className="badge">{t('note')}</span>
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
                <div className="activity__intent">{entry.intent || t('— no description —')}</div>
                <div className="activity__meta">
                    <span className="mono">{entry.tool}</span>
                    <span>{entry.summary}</span>
                </div>
                {props.stepLabel && <div className="activity__step">{props.stepLabel}</div>}
            </div>

            <span className={`badge ${entry.ok ? 'badge--ok' : 'badge--fail'}`}>
                {entry.ok ? '✓' : '✕'}
            </span>
            <span className="badge">{t('{n} ms', { n: Math.round(entry.durationMs) })}</span>
        </div>
    )
}

interface IEntryDetailsProps {
    entry: IActivityCallRecord | IActivityNoteRecord
    expandDepth: number
}

function EntryDetails({ entry, expandDepth }: IEntryDetailsProps): React.JSX.Element {
    const t = useT()
    if (entry.kind === 'note') {
        return (
            <div className="activity__detail">
                <div className="settings__caption">{t('Agent note')}</div>
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
                <div className="inspector__hint selectable">{t('Expected: {text}', { text: entry.expectation })}</div>
            )}

            <div className="row" style={{ flexWrap: 'wrap' }}>
                <span className={`badge ${entry.ok ? 'badge--ok' : 'badge--fail'}`}>
                    {entry.ok ? t('success') : t('error')}
                </span>
                <span className="badge">{t('{n} ms', { n: Math.round(entry.durationMs) })}</span>
                <span className="badge">{new Date(entry.ts).toLocaleTimeString()}</span>
                {entry.workspaceId && <span className="badge">{entry.workspaceId}</span>}
            </div>

            {entry.error && <div className="flow__error selectable">{entry.error}</div>}

            <div className="settings__caption">{t('Arguments')}</div>
            <JsonViewer value={entry.args} defaultExpandDepth={expandDepth} />

            {entry.result !== undefined && (
                <>
                    <div className="settings__caption">
                        {t('Result')}
                        {entry.truncated && <span className="badge">{t('truncated')}</span>}
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
    const calls = tn(session.stats.totalCalls, 'call|calls')
    if (!session.startedAt) return `${translate('session')} · ${calls}`

    const locale = currentLanguage() === 'ru' ? 'ru-RU' : 'en-US'
    const started = new Date(session.startedAt)
    const date = started.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })
    const time = started.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })

    return `${date} ${time} · ${calls}`
}
