import type { IFileSystem } from '../ports/file-system.js'
import { maskSecretsInJson } from '../secrets/secret-resolver.js'
import { historyDayKey, type LibraryPaths } from '../storage/paths.js'
import {
    ActivityRecordSchema,
    type IActivityCallRecord,
    type IActivityNoteRecord,
    type IActivityRecord,
    type IActivitySession,
} from './activity-model.js'

/** Предел размера результата в записи: длинные ответы усекаются. */
const RESULT_LIMIT = 20_000
const DEFAULT_SESSION_LIMIT = 30

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
     * Сессии от новых к старым, собранные из записей журнала.
     *
     * Собирается сразу целиком: сессия без заголовка (журнал начали читать с
     * середины дня) всё равно должна попасть в список, иначе часть действий
     * агента просто исчезнет из вида.
     */
    public async listSessions(limit = DEFAULT_SESSION_LIMIT): Promise<IActivitySession[]> {
        const files = (await this._fs.listDir(this._paths.activityDir()))
            .filter((entry) => !entry.isDirectory && entry.name.endsWith('.jsonl'))
            .map((entry) => entry.name)
            .sort()
            .reverse()

        const sessions = new Map<string, IActivitySession>()

        for (const fileName of files) {
            const raw = await this._fs.readText(`${this._paths.activityDir()}/${fileName}`)
            if (raw === undefined) continue

            for (const line of raw.split('\n')) {
                if (line.trim().length === 0) continue

                const record = this._parseLine(line)
                if (!record) continue

                const session = this._ensureSession(sessions, record.sessionId)

                if (record.kind === 'session') {
                    session.startedAt = record.startedAt
                    session.client = record.client
                    continue
                }

                if (record.kind === 'plan') {
                    session.plan = record
                    continue
                }

                session.entries.push(record)

                if (record.kind === 'call') {
                    session.stats.totalCalls += 1
                    session.stats.durationMs += record.durationMs
                    if (!record.ok) session.stats.failedCalls += 1
                }

                if (record.ts > session.stats.lastActivityAt) {
                    session.stats.lastActivityAt = record.ts
                }
            }

            if (sessions.size >= limit) break
        }

        for (const session of sessions.values()) {
            session.entries.sort((left, right) => left.seq - right.seq)
            if (session.startedAt.length === 0) {
                session.startedAt = session.entries[0]?.ts ?? session.stats.lastActivityAt
            }
        }

        return [...sessions.values()]
            .sort((left, right) => right.stats.lastActivityAt.localeCompare(left.stats.lastActivityAt))
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

    private _ensureSession(
        sessions: Map<string, IActivitySession>,
        sessionId: string,
    ): IActivitySession {
        const existing = sessions.get(sessionId)
        if (existing) return existing

        const created: IActivitySession = {
            sessionId,
            startedAt: '',
            client: { name: 'unknown', version: '' },
            entries: [],
            stats: { totalCalls: 0, failedCalls: 0, durationMs: 0, lastActivityAt: '' },
        }
        sessions.set(sessionId, created)

        return created
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
    const serialized = input.result === undefined ? '' : JSON.stringify(input.result)
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
            : maskSecretsInJson(input.result, secrets),
        truncated,
        error: input.error,
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
