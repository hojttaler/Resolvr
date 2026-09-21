import {
    formatReportMarkdown,
    summarizeReport,
    type IFlowReportEntry,
    type IFlowStepResult,
} from '@resolvr/core'
import { useState } from 'react'

import { CHAINS, plural, pluralize, STEPS } from '../lib/plural.js'
import { useAppStore } from '../state/store.js'
import { JsonViewer } from './JsonViewer.js'

/**
 * Отчёт о прогоне всех цепочек.
 *
 * Сводка сверху, ниже — каждая цепочка с шагами. Упавшие раскрыты сразу:
 * ради них отчёт и открывают, а прошедшие — свёрнуты в одну строку.
 */
export function ReportPage(props: { tabId: string }): React.JSX.Element {
    const report = useAppStore((state) => state.reports[props.tabId])
    const running = useAppStore((state) => state.reportRunning)
    const runAllFlows = useAppStore((state) => state.runAllFlows)
    const openFlowTab = useAppStore((state) => state.openFlowTab)
    const [copied, setCopied] = useState(false)

    if (!report) return <div className="empty">Отчёт не найден</div>

    const summary = summarizeReport(report)
    const state = running ? 'running' : summary.failed > 0 ? 'fail' : 'ok'

    return (
        <div className="panel">
            <div className="panel__header">
                <span className="panel__title">Прогон цепочек</span>
                <span
                    className={`badge ${
                        state === 'running' ? '' : state === 'ok' ? 'badge--ok' : 'badge--fail'
                    }`}
                >
                    {state === 'running'
                        ? `выполняется · ${summary.total - summary.pending} из ${summary.total}`
                        : state === 'ok'
                          ? 'все пройдены'
                          : `упало: ${summary.failed}`}
                </span>

                <span className="panel__spacer" />

                <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={() => {
                        void navigator.clipboard.writeText(formatReportMarkdown(report))
                        setCopied(true)
                        window.setTimeout(() => setCopied(false), 1500)
                    }}
                    title="Отчёт в Markdown — для задачи или чата"
                >
                    {copied ? 'Скопировано' : 'Скопировать отчёт'}
                </button>
                <button
                    type="button"
                    className="btn btn--primary"
                    disabled={running}
                    onClick={() => void runAllFlows()}
                >
                    {running ? 'Выполняется…' : 'Запустить снова'}
                </button>
            </div>

            <div className="panel__content report">
                <div className="report__summary">
                    <Stat label={plural(summary.total, CHAINS)} value={summary.total} />
                    <Stat label="пройдено" value={summary.passed} tone="ok" />
                    <Stat label="упало" value={summary.failed} tone={summary.failed > 0 ? 'fail' : undefined} />
                    <Stat label="мс" value={Math.round(summary.durationMs)} />
                    <span className="inspector__hint">
                        {new Date(report.startedAt).toLocaleString()}
                        {report.environmentName ? ` · ${report.environmentName}` : ''}
                    </span>
                </div>

                {report.entries.map((entry) => (
                    <ReportEntry
                        key={entry.flowId}
                        entry={entry}
                        onOpen={() => void openFlowTab(entry.flowId)}
                    />
                ))}
            </div>
        </div>
    )
}

function Stat(props: { label: string; value: number; tone?: 'ok' | 'fail' }): React.JSX.Element {
    return (
        <span className={`report__stat${props.tone ? ` report__stat--${props.tone}` : ''}`}>
            <b>{props.value}</b> {props.label}
        </span>
    )
}

function ReportEntry(props: { entry: IFlowReportEntry; onOpen: () => void }): React.JSX.Element {
    const { entry } = props
    const [open, setOpen] = useState<boolean | undefined>()
    const expanded = open ?? (entry.run ? !entry.run.ok : false)

    return (
        <div className={`report__entry${entry.run && !entry.run.ok ? ' report__entry--fail' : ''}`}>
            <div className="report__head" onClick={() => setOpen(!expanded)}>
                <span className={`json-chevron${expanded ? ' json-chevron--open' : ''}`}>▶</span>
                <span
                    className={`badge ${
                        !entry.run ? '' : entry.run.ok ? 'badge--ok' : 'badge--fail'
                    }`}
                >
                    {!entry.run ? '⏳' : entry.run.ok ? '✓' : '✕'}
                </span>
                <span className="report__name">{entry.flowName}</span>
                {entry.run && (
                    <span className="inspector__hint">
                        {pluralize(entry.run.steps.length, STEPS)} · {Math.round(entry.run.durationMs)} мс
                    </span>
                )}
                <span className="panel__spacer" />
                <button
                    type="button"
                    className="btn btn--quiet"
                    onClick={(event) => {
                        event.stopPropagation()
                        props.onOpen()
                    }}
                >
                    Открыть
                </button>
            </div>

            {expanded && entry.run && (
                <div className="report__steps">
                    {entry.run.steps.map((step) => (
                        <ReportStep key={step.stepId} step={step} />
                    ))}
                    {'error' in entry.run.context && entry.run.steps.length === 0 && (
                        <div className="problem">
                            <span>{String(entry.run.context.error)}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

function ReportStep({ step }: { step: IFlowStepResult }): React.JSX.Element {
    const [showResponse, setShowResponse] = useState(false)
    const failedAsserts = step.asserts.filter((item) => !item.passed)

    return (
        <div className="report__step">
            <div className="row">
                <span className={`badge ${step.skipped ? '' : step.ok ? 'badge--ok' : 'badge--fail'}`}>
                    {step.skipped ? '—' : step.ok ? '✓' : '✕'}
                </span>
                <span>{step.name}</span>
                {step.status !== undefined && <span className="badge">HTTP {step.status}</span>}
                <span className="inspector__hint">{Math.round(step.durationMs)} мс</span>
                <span className="panel__spacer" />
                {step.result && (
                    <button
                        type="button"
                        className="btn btn--quiet"
                        onClick={() => setShowResponse((current) => !current)}
                    >
                        {showResponse ? 'Скрыть ответ' : 'Ответ'}
                    </button>
                )}
            </div>

            {step.error && <div className="problem"><span>{step.error}</span></div>}
            {failedAsserts.map((assert, index) => (
                <div key={index} className="problem">
                    <span className="mono problem__path">{assert.assert.path}</span>
                    <span>{assert.message}</span>
                </div>
            ))}

            {showResponse && step.result && (
                <JsonViewer
                    value={{ data: step.result.data, errors: step.result.errors }}
                    defaultExpandDepth={3}
                />
            )}
        </div>
    )
}
