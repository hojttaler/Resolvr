import type { IFlowRunResult } from './flow-runner.js'

/** Итог прогона всех цепочек workspace — smoke-тест одной кнопкой. */
export interface IFlowReport {
    startedAt: string
    finishedAt?: string
    environmentId?: string
    environmentName?: string
    /** Цепочки в порядке запуска; результат появляется по мере выполнения. */
    entries: IFlowReportEntry[]
}

export interface IFlowReportEntry {
    flowId: string
    flowName: string
    run?: IFlowRunResult
}

export interface IFlowReportSummary {
    total: number
    passed: number
    failed: number
    pending: number
    durationMs: number
}

export function summarizeReport(report: IFlowReport): IFlowReportSummary {
    let passed = 0
    let failed = 0
    let pending = 0
    let durationMs = 0

    for (const entry of report.entries) {
        if (!entry.run) {
            pending += 1
            continue
        }
        durationMs += entry.run.durationMs
        if (entry.run.ok) passed += 1
        else failed += 1
    }

    return { total: report.entries.length, passed, failed, pending, durationMs }
}

/**
 * Отчёт в Markdown — чтобы вставить в задачу или чат.
 *
 * Ответы шагов не включаются: в них могут быть персональные данные, а для
 * разбора падения достаточно имени шага, статуса и текста ошибки.
 */
export function formatReportMarkdown(report: IFlowReport): string {
    const summary = summarizeReport(report)
    const lines = [
        `## Прогон цепочек — ${new Date(report.startedAt).toLocaleString()}`,
        '',
        `Окружение: ${report.environmentName ?? report.environmentId ?? '—'}. ` +
            `Всего ${summary.total}, пройдено ${summary.passed}, упало ${summary.failed}` +
            (summary.pending > 0 ? `, не запущено ${summary.pending}` : '') +
            `, ${Math.round(summary.durationMs)} мс.`,
        '',
    ]

    for (const entry of report.entries) {
        const mark = !entry.run ? '⏳' : entry.run.ok ? '✅' : '❌'
        lines.push(`### ${mark} ${entry.flowName}`)

        if (!entry.run) {
            lines.push('', 'не запускалась', '')
            continue
        }

        lines.push('')
        for (const step of entry.run.steps) {
            const stepMark = step.skipped ? '—' : step.ok ? '✓' : '✕'
            const status = step.status !== undefined ? ` HTTP ${step.status}` : ''
            lines.push(`- ${stepMark} ${step.name}${status}, ${Math.round(step.durationMs)} мс`)

            if (step.error) lines.push(`  - ошибка: ${step.error}`)
            for (const assert of step.asserts.filter((item) => !item.passed)) {
                lines.push(`  - проверка не прошла: ${assert.message}`)
            }
        }
        lines.push('')
    }

    return lines.join('\n')
}
