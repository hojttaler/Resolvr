import type { IFileSystem } from '../ports/file-system.js'
import { maskSecrets, maskSecretsInJson } from '../secrets/secret-resolver.js'
import { historyDayKey, type LibraryPaths } from '../storage/paths.js'
import {
    ActivityRecordSchema,
    type IActivityCallRecord,
    type IActivityNoteRecord,
    type IActivityRecord,
    type IActivitySessionRecord,
    type IActivityTask,
} from './activity-model.js'

/** Предел размера результата в записи: длинные ответы усекаются. */
const RESULT_LIMIT = 20_000
const DEFAULT_TASK_LIMIT = 30

interface IActivityConnection {
    sessionId: string
    header?: IActivitySessionRecord
    records: Exclude<IActivityRecord, IActivitySessionRecord>[]
}

/**
 * Хранилище журнала действий агента.
 *
 * Файл на день, дописывание строками: параллельно пишущий MCP-сервер и читающее
 * приложение не мешают друг другу, а повреждённая строка пропускается при
 * чтении и не рушит остальной журнал.
 */
export class ActivityStore {
    private readonly _fs: IFileSystem
    private readonly _paths: LibraryPaths

    constructor(fs: IFileSystem, paths: LibraryPaths) {
        this._fs = fs
        this._paths = paths
    }

    public async append(record: IActivityRecord): Promise<void> {
        await this._fs.ensureDir(this._paths.activityDir())

        const day = 'ts' in record ? record.ts : record.startedAt
        const file = this._paths.activityFile(historyDayKey(new Date(day)))

        await this._fs.appendText(file, `${JSON.stringify(record)}\n`)
    }

    /**
     * Задачи от новых действий к старым. Записи без плана остаются видимыми.
     * Вызов относится к последнему плану на момент начала, независимо от того,
     * когда он завершился и попал в файл.
     */
    public async listTasks(limit = DEFAULT_TASK_LIMIT): Promise<IActivityTask[]> {
        const files = (await this._fs.listDir(this._paths.activityDir()))
            .filter((entry) => !entry.isDirectory && entry.name.endsWith('.jsonl'))
            .map((entry) => entry.name)
            .sort()
            .reverse()

        const connections = new Map<string, IActivityConnection>()

        for (const fileName of files) {
            const raw = await this._fs.readText(`${this._paths.activityDir()}/${fileName}`)
            if (raw === undefined) continue

            for (const line of raw.split('\n')) {
                if (line.trim().length === 0) continue

                const record = this._parseLine(line)
                if (!record) continue

                let connection = connections.get(record.sessionId)
                if (!connection) {
                    connection = { sessionId: record.sessionId, records: [] }
                    connections.set(record.sessionId, connection)
                }
                if (record.kind === 'session') connection.header = record
                else connection.records.push(record)
            }

            if (connections.size >= limit) break
        }

        return [...connections.values()].flatMap(toTasks)
            .sort((left, right) =>
                right.stats.lastActivityAt.localeCompare(left.stats.lastActivityAt) ||
                (right.plan?.seq ?? 0) - (left.plan?.seq ?? 0),
            )
            .slice(0, limit)
    }

    /** Удаляет файлы журнала старше указанного числа дней. */
    public async prune(retentionDays: number): Promise<number> {
        const threshold = new Date()
        threshold.setDate(threshold.getDate() - retentionDays)
        const thresholdKey = historyDayKey(threshold)

        const entries = await this._fs.listDir(this._paths.activityDir())
        let removed = 0

        for (const entry of entries) {
            if (entry.isDirectory || !entry.name.endsWith('.jsonl')) continue
            if (entry.name.slice(0, -'.jsonl'.length) >= thresholdKey) continue

            await this._fs.remove(`${this._paths.activityDir()}/${entry.name}`)
            removed += 1
        }

        return removed
    }

    private _parseLine(line: string): IActivityRecord | undefined {
        try {
            const result = ActivityRecordSchema.safeParse(JSON.parse(line))

            return result.success ? result.data : undefined
        } catch {
            return undefined
        }
    }
}

function toTasks(connection: IActivityConnection): IActivityTask[] {
    const tasks: IActivityTask[] = []
    const finished = new Set(connection.records.filter((record) => record.kind === 'call').map((record) => record.seq))
    let task: IActivityTask | undefined

    for (const record of connection.records.sort((left, right) => left.seq - right.seq)) {
        if (record.kind === 'call_started' && finished.has(record.seq)) continue

        if (!task || record.kind === 'plan') {
            const plan = record.kind === 'plan' ? record : undefined
            task = {
                id: `${connection.sessionId}:${plan?.seq ?? 'unplanned'}`,
                sessionId: connection.sessionId,
                startedAt: plan?.ts ?? connection.header?.startedAt ?? record.ts,
                client: connection.header?.client ?? { name: 'unknown', version: '' },
                plan,
                entries: [],
                stats: { totalCalls: 0, failedCalls: 0, durationMs: 0, lastActivityAt: record.ts },
            }
            tasks.push(task)
        }
        if (record.kind === 'plan') continue

        task.entries.push(record)
        if (record.ts > task.stats.lastActivityAt) task.stats.lastActivityAt = record.ts
        if (record.kind === 'call' || record.kind === 'call_started') task.stats.totalCalls += 1
        if (record.kind === 'call') {
            task.stats.durationMs += record.durationMs
            if (!record.ok) task.stats.failedCalls += 1
        }
    }

    return tasks
}

/**
 * Готовит запись о вызове: маскирует секреты и усекает крупные результаты.
 *
 * Журнал читается человеком и хранится на диске, поэтому значения секретов сюда
 * попадать не должны, а ответ на десятки мегабайт сделал бы файл нечитаемым.
 */
export function buildCallRecord(input: {
    sessionId: string
    seq: number
    tool: string
    intent: string
    expectation?: string
    step?: number
    args: Record<string, unknown>
    ok: boolean
    durationMs: number
    summary: string
    result?: unknown
    error?: string
    workspaceId?: string
    secretValues?: readonly string[]
}): IActivityCallRecord {
    const secrets = input.secretValues ?? []
    const result = input.result === undefined ? undefined : maskSecretsInJson(input.result, secrets)
    const serialized = result === undefined ? '' : JSON.stringify(result)
    const truncated = serialized.length > RESULT_LIMIT

    return {
        kind: 'call',
        sessionId: input.sessionId,
        seq: input.seq,
        ts: new Date().toISOString(),
        tool: input.tool,
        intent: input.intent,
        expectation: input.expectation,
        step: input.step,
        args: maskSecretsInJson(input.args, secrets),
        ok: input.ok,
        durationMs: Math.round(input.durationMs),
        summary: input.summary,
        result: truncated
            ? { truncated: `${serialized.slice(0, RESULT_LIMIT)}…` }
            : result,
        truncated,
        error: input.error && maskSecrets(input.error, secrets),
        workspaceId: input.workspaceId,
    }
}

export function buildNoteRecord(input: {
    sessionId: string
    seq: number
    text: string
    step?: number
}): IActivityNoteRecord {
    return {
        kind: 'note',
        sessionId: input.sessionId,
        seq: input.seq,
        ts: new Date().toISOString(),
        text: input.text,
        step: input.step,
    }
}
