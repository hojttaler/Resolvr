import { HistoryEntrySchema, type IHistoryEntry } from '../model/schemas.js'
import type { IFileSystem } from '../ports/file-system.js'
import { historyDayKey, type LibraryPaths } from './paths.js'

const PREVIEW_LIMIT = 400

export interface IHistoryFilter {
    /** Подстрока по имени операции или тексту запроса. */
    search?: string
    operationName?: string
    environmentId?: string
    onlyFailed?: boolean
    limit?: number
}

/**
 * Append-only лог запусков, по файлу на день.
 *
 * Формат JSONL выбран сознательно: дописывание одной строки не может испортить
 * ранее записанные, а битая строка (например, после отключения питания)
 * пропускается при чтении и не роняет всю историю.
 */
export class HistoryStore {
    private readonly _fs: IFileSystem
    private readonly _paths: LibraryPaths

    constructor(fs: IFileSystem, paths: LibraryPaths) {
        this._fs = fs
        this._paths = paths
    }

    public async append(workspaceId: string, entry: IHistoryEntry): Promise<void> {
        await this._fs.ensureDir(this._paths.historyDir(workspaceId))
        const file = this._paths.historyFile(workspaceId, historyDayKey(new Date(entry.ts)))

        await this._fs.appendText(file, `${JSON.stringify(entry)}\n`)
    }

    /** Записи от новых к старым; файлы читаются с конца, пока не набран лимит. */
    public async list(workspaceId: string, filter: IHistoryFilter = {}): Promise<IHistoryEntry[]> {
        const limit = filter.limit ?? 100
        const files = (await this._fs.listDir(this._paths.historyDir(workspaceId)))
            .filter((entry) => !entry.isDirectory && entry.name.endsWith('.jsonl'))
            .map((entry) => entry.name)
            .sort()
            .reverse()

        const result: IHistoryEntry[] = []
        for (const fileName of files) {
            const raw = await this._fs.readText(`${this._paths.historyDir(workspaceId)}/${fileName}`)
            if (raw === undefined) continue

            const lines = raw.split('\n').filter((line) => line.trim().length > 0)
            for (let index = lines.length - 1; index >= 0; index -= 1) {
                const entry = this._parseLine(lines[index] as string)
                if (!entry || !this._matches(entry, filter)) continue

                result.push(entry)
                if (result.length >= limit) return result
            }
        }

        return result
    }

    /** Удаляет файлы истории старше указанного количества дней. */
    public async prune(workspaceId: string, retentionDays: number): Promise<number> {
        const threshold = new Date()
        threshold.setDate(threshold.getDate() - retentionDays)
        const thresholdKey = historyDayKey(threshold)

        const entries = await this._fs.listDir(this._paths.historyDir(workspaceId))
        let removed = 0

        for (const entry of entries) {
            if (entry.isDirectory || !entry.name.endsWith('.jsonl')) continue

            const day = entry.name.slice(0, -'.jsonl'.length)
            if (day >= thresholdKey) continue

            await this._fs.remove(`${this._paths.historyDir(workspaceId)}/${entry.name}`)
            removed += 1
        }

        return removed
    }

    /** Битая строка пропускается: один повреждённый запуск не должен ломать историю. */
    private _parseLine(line: string): IHistoryEntry | undefined {
        try {
            const result = HistoryEntrySchema.safeParse(JSON.parse(line))

            return result.success ? result.data : undefined
        } catch {
            return undefined
        }
    }

    private _matches(entry: IHistoryEntry, filter: IHistoryFilter): boolean {
        if (filter.onlyFailed && entry.ok) return false
        if (filter.operationName && entry.operationName !== filter.operationName) return false
        if (filter.environmentId && entry.environmentId !== filter.environmentId) return false

        if (filter.search) {
            const needle = filter.search.toLowerCase()
            const haystack = `${entry.operationName ?? ''} ${entry.query}`.toLowerCase()
            if (!haystack.includes(needle)) return false
        }

        return true
    }
}

/** Обрезает тело ответа до размера превью, пригодного для списка истории. */
export function buildResponsePreview(body: string): string {
    const collapsed = body.replace(/\s+/g, ' ').trim()

    return collapsed.length > PREVIEW_LIMIT ? `${collapsed.slice(0, PREVIEW_LIMIT)}…` : collapsed
}
