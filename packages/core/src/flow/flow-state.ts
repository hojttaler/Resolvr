import { FlowRunStateFileSchema, type IFlowRunState } from '../model/schemas.js'
import type { IFileSystem } from '../ports/file-system.js'
import { readJsonFile, writeJsonFile } from '../storage/json.js'
import type { LibraryPaths } from '../storage/paths.js'

/**
 * Итоги прогонов цепочек: когда цепочка запускалась и когда была зелёной.
 *
 * Хранится в `.state` рядом с сессией, а не в файлах цепочек: дата прогона
 * меняется при каждом запуске и в общем репозитории давала бы конфликт на
 * каждый коммит. Благодаря этому реестр smoke-тестов («что проверено и
 * когда») живёт в самом Resolvr и виден агенту через `flow_list`.
 */
export class FlowStateStore {
    private readonly _fs: IFileSystem
    private readonly _paths: LibraryPaths
    /**
     * Очередь записей: параллельный прогон набора заканчивает цепочки почти
     * одновременно, и одновременное «прочитать карту — дописать свою строку —
     * записать» теряло чужие строки.
     */
    private _queue: Promise<void> = Promise.resolve()

    constructor(fs: IFileSystem, paths: LibraryPaths) {
        this._fs = fs
        this._paths = paths
    }

    /** Итоги по всем цепочкам workspace; пустая карта, если прогонов не было. */
    public async read(workspaceId: string): Promise<Record<string, IFlowRunState>> {
        const file = await readJsonFile(
            this._fs,
            this._paths.flowRunsFile(workspaceId),
            FlowRunStateFileSchema,
        )

        return file?.flows ?? {}
    }

    public async get(workspaceId: string, flowId: string): Promise<IFlowRunState | undefined> {
        return (await this.read(workspaceId))[flowId]
    }

    /**
     * Записывает итог прогона. Дата зелёного прогона сохраняется от прошлого
     * запуска: упавший прогон не должен стирать сведения о том, когда цепочка
     * в последний раз проходила целиком.
     */
    public async record(
        workspaceId: string,
        flowId: string,
        run: { ok: boolean; durationMs: number; failedStep?: string },
        now: Date = new Date(),
    ): Promise<void> {
        const next = this._queue.then(() => this._record(workspaceId, flowId, run, now))
        // Очередь не должна рваться на ошибке одной записи: следующий прогон
        // запишется, а ошибку получает тот, кто её вызвал.
        this._queue = next.catch(() => undefined)

        return next
    }

    private async _record(
        workspaceId: string,
        flowId: string,
        run: { ok: boolean; durationMs: number; failedStep?: string },
        now: Date,
    ): Promise<void> {
        const flows = await this.read(workspaceId)
        const previous = flows[flowId]
        const at = now.toISOString()

        flows[flowId] = {
            lastRunAt: at,
            ok: run.ok,
            durationMs: run.durationMs,
            lastGreenAt: run.ok ? at : previous?.lastGreenAt,
            failedStep: run.ok ? undefined : run.failedStep,
        }

        await this._fs.ensureDir(this._paths.stateDir())
        await writeJsonFile(this._fs, this._paths.flowRunsFile(workspaceId), { flows })
    }
}
