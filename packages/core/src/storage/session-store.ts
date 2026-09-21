import {
    DraftDataSchema,
    FlowSchema,
    SessionSchema,
    type IDraftData,
    type IFlow,
    type ISession,
    type ITabState,
} from '../model/schemas.js'
import type { IFlowReport } from '../flow/report.js'
import type { IFileSystem } from '../ports/file-system.js'
import { readJsonFile, writeJsonFile } from './json.js'
import type { LibraryPaths } from './paths.js'

/**
 * Состояние рабочей сессии: открытые вкладки и их несохранённое содержимое.
 *
 * Главное обещание приложения — не терять состояние. Поэтому текст запроса
 * каждой вкладки лежит в отдельном файле `.graphql` (его можно открыть и
 * прочитать снаружи), метаданные вкладок — в `session.json`, а все записи
 * атомарны. Прерывание процесса в любой момент оставляет консистентную сессию.
 */
export class SessionStore {
    private readonly _fs: IFileSystem
    private readonly _paths: LibraryPaths

    constructor(fs: IFileSystem, paths: LibraryPaths) {
        this._fs = fs
        this._paths = paths
    }

    public async load(): Promise<ISession> {
        const session = await readJsonFile(this._fs, this._paths.sessionFile(), SessionSchema)

        return session ?? SessionSchema.parse({})
    }

    public async save(session: ISession): Promise<void> {
        await writeJsonFile(this._fs, this._paths.sessionFile(), {
            ...session,
            updatedAt: new Date().toISOString(),
        })
    }

    /** Текст запроса вкладки; пустая строка, если черновик ещё не создавался. */
    public async readDraftQuery(tabId: string): Promise<string> {
        return (await this._fs.readText(this._paths.draftQueryFile(tabId))) ?? ''
    }

    public async writeDraftQuery(tabId: string, query: string): Promise<void> {
        await this._fs.ensureDir(this._paths.draftsDir())
        await this._fs.writeTextAtomic(this._paths.draftQueryFile(tabId), query)
    }

    public async readDraftData(tabId: string): Promise<IDraftData> {
        const data = await readJsonFile(this._fs, this._paths.draftDataFile(tabId), DraftDataSchema)

        return data ?? DraftDataSchema.parse({})
    }

    public async writeDraftData(tabId: string, data: IDraftData): Promise<void> {
        await writeJsonFile(this._fs, this._paths.draftDataFile(tabId), data)
    }

    /** Черновик цепочки во вкладке-редакторе; `undefined`, если не сохранялся. */
    public async readFlowDraft(tabId: string): Promise<IFlow | undefined> {
        const raw = await this._fs.readText(this._paths.draftFlowFile(tabId))
        if (!raw) return undefined

        // Черновик может быть без идентификатора — цепочка ещё не сохранена;
        // строгая схема здесь неуместна, проверка выполняется при сохранении.
        try {
            const parsed = JSON.parse(raw) as Partial<IFlow>

            return {
                id: typeof parsed.id === 'string' ? parsed.id : '',
                name: typeof parsed.name === 'string' ? parsed.name : '',
                description: typeof parsed.description === 'string' ? parsed.description : '',
                steps: FlowSchema.shape.steps.parse(parsed.steps ?? []),
                endpointId: parsed.endpointId,
                environmentId: parsed.environmentId,
            }
        } catch {
            return undefined
        }
    }

    public async writeFlowDraft(tabId: string, flow: IFlow): Promise<void> {
        await this._fs.ensureDir(this._paths.draftsDir())
        await this._fs.writeTextAtomic(
            this._paths.draftFlowFile(tabId),
            `${JSON.stringify(flow, null, 2)}\n`,
        )
    }

    /** Отчёт о прогоне цепочек во вкладке-отчёте. */
    public async readReport(tabId: string): Promise<IFlowReport | undefined> {
        const raw = await this._fs.readText(this._paths.draftReportFile(tabId))
        if (!raw) return undefined

        try {
            const parsed = JSON.parse(raw) as IFlowReport

            return Array.isArray(parsed.entries) && typeof parsed.startedAt === 'string'
                ? parsed
                : undefined
        } catch {
            return undefined
        }
    }

    public async writeReport(tabId: string, report: IFlowReport): Promise<void> {
        await this._fs.ensureDir(this._paths.draftsDir())
        await this._fs.writeTextAtomic(
            this._paths.draftReportFile(tabId),
            `${JSON.stringify(report, null, 2)}\n`,
        )
    }

    public async deleteDraft(tabId: string): Promise<void> {
        await this._fs.remove(this._paths.draftQueryFile(tabId))
        await this._fs.remove(this._paths.draftDataFile(tabId))
        await this._fs.remove(this._paths.draftFlowFile(tabId))
        await this._fs.remove(this._paths.draftReportFile(tabId))
    }

    /**
     * Удаляет файлы черновиков, не относящиеся ни к одной открытой вкладке.
     * Вызывается при старте: закрытая до краша вкладка не должна оставлять мусор.
     */
    public async pruneOrphanDrafts(tabs: readonly ITabState[]): Promise<number> {
        const known = new Set(tabs.map((tab) => tab.id))
        const entries = await this._fs.listDir(this._paths.draftsDir())
        let removed = 0

        for (const entry of entries) {
            if (entry.isDirectory) continue

            const tabId = entry.name.replace(/\.(graphql|flow\.json|report\.json|json)$/, '')
            if (known.has(tabId)) continue

            await this._fs.remove(`${this._paths.draftsDir()}/${entry.name}`)
            removed += 1
        }

        return removed
    }
}

/**
 * Откладывает запись состояния, объединяя частые изменения в одну операцию.
 *
 * Ввод текста порождает событие на каждое нажатие клавиши; писать файл так часто
 * не нужно и вредно. При этом `flush()` обязан быть доступен синхронному
 * сценарию закрытия окна — иначе последние секунды работы пропадут.
 */
export class Debouncer {
    private readonly _delayMs: number
    private _timer: ReturnType<typeof setTimeout> | undefined
    private _pending: (() => Promise<void>) | undefined
    private _inFlight: Promise<void> | undefined

    constructor(delayMs: number) {
        this._delayMs = delayMs
    }

    /** Планирует выполнение; предыдущая незапущенная задача отбрасывается. */
    public schedule(task: () => Promise<void>): void {
        this._pending = task

        if (this._timer !== undefined) clearTimeout(this._timer)
        this._timer = setTimeout(() => {
            void this._run()
        }, this._delayMs)
    }

    /** Немедленно выполняет отложенную задачу и дожидается завершения текущей. */
    public async flush(): Promise<void> {
        if (this._timer !== undefined) {
            clearTimeout(this._timer)
            this._timer = undefined
        }

        await this._run()
        await this._inFlight
    }

    public cancel(): void {
        if (this._timer !== undefined) clearTimeout(this._timer)
        this._timer = undefined
        this._pending = undefined
    }

    private async _run(): Promise<void> {
        const task = this._pending
        this._pending = undefined
        this._timer = undefined
        if (!task) return

        this._inFlight = task()
        await this._inFlight
        this._inFlight = undefined
    }
}
