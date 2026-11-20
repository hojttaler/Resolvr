import { parse } from 'graphql'

import { ErrorCodeEnum, ResolvrError } from '../model/errors.js'
import {
    CollectionSchema,
    FlowSchema,
    LocalThemeSchema,
    OperationMetaSchema,
    RequestScriptsSchema,
    SettingsSchema,
    SlugSchema,
    WorkspaceSchema,
    type ICollection,
    type IEnvironmentCapture,
    type IFlow,
    type ILocalTheme,
    type IOperation,
    type IOperationKind,
    type IOperationMeta,
    type IRequestScripts,
    type ISettings,
    type IWorkspace,
} from '../model/schemas.js'
import type { IFileSystem } from '../ports/file-system.js'
import { parseJson, readJsonFile, readRequiredJsonFile, writeJsonFile } from './json.js'
import { toSlug, type LibraryPaths } from './paths.js'
import { ensureVersion, versionOf, versionOfFiles } from './version.js'

const OPERATION_QUERY_SUFFIX = '.graphql'
const FLOW_SUFFIX = '.flow.json'

/** Ссылка на операцию в форме `collection/operation`. */
export interface IOperationRef {
    collectionId: string
    name: string
}

export type IRequestScriptTarget =
    | { kind: 'operation'; ref: IOperationRef }
    | { kind: 'environment'; environmentId: string }

export type IRequestScriptsPatch = { [Phase in keyof IRequestScripts]: IRequestScripts[Phase] | null }

interface IRequestScriptsSnapshot {
    scripts: IRequestScripts
    version: string
}

interface IRequestScriptsFile extends IRequestScriptsSnapshot {
    write(scripts: IRequestScripts | undefined): Promise<string>
}

export interface ICreateWorkspaceInput {
    name: string
    id?: string
    description?: string
    endpointUrl?: string
    endpointName?: string
}

export interface ISaveOperationInput {
    collectionId: string
    name: string
    query: string
    description?: string
    variables?: Record<string, unknown>
    headers?: Record<string, string>
    endpointId?: string
    environmentId?: string
    /** Цепочка, выполняемая перед запросом. */
    prerequisiteFlow?: string
    /** Значения ответа, сохраняемые в окружение после успешного запуска. */
    saveToEnvironment?: IEnvironmentCapture[]
    scripts?: IRequestScripts
    /**
     * Версия, прочитанная перед правкой: запись отменяется, если файл успели
     * изменить. Нужна, когда над одной коллекцией работают несколько агентов.
     */
    expectedVersion?: string
}

export interface IMoveOperationOptions {
    /**
     * Позиция в целевой коллекции. Без неё переименованная операция остаётся
     * на прежнем месте, а перенесённая в другую коллекцию встаёт в конец.
     */
    index?: number
}

export interface ILocalThemeCatalog {
    themes: ILocalTheme[]
    invalidFiles: string[]
}

/**
 * Единственная точка доступа к дереву `~/Resolvr`.
 *
 * Используется и приложением, и MCP-сервером: оба читают и пишут одни и те же
 * файлы, поэтому изменения, сделанные агентом, видны в открытом GUI.
 */
/** Что из библиотеки не должно попадать в общий репозиторий. */
const LIBRARY_GITIGNORE = `# Resolvr: личное и секретное — не для общего репозитория
.secrets/
.state/
.activity/
settings.json
workspaces/*/.history/
workspaces/*/.cache/
`

export class WorkspaceStore {
    private readonly _fs: IFileSystem
    private readonly _paths: LibraryPaths
    private readonly _scriptWrites = new Map<string, Promise<unknown>>()

    constructor(fs: IFileSystem, paths: LibraryPaths) {
        this._fs = fs
        this._paths = paths
    }

    public get paths(): LibraryPaths {
        return this._paths
    }

    /** Создаёт корневую структуру библиотеки, если её ещё нет. */
    public async init(): Promise<void> {
        await this._fs.ensureDir(this._paths.workspacesDir())
        await this._fs.ensureDir(this._paths.draftsDir())

        if (!(await this._fs.exists(this._paths.settings()))) {
            await this.saveSettings(SettingsSchema.parse({}))
        }

        // Библиотеку кладут в git, чтобы делиться коллекциями с командой.
        // Личное и секретное исключается заранее — до первого коммита.
        const gitignore = `${this._paths.root}/.gitignore`
        if (!(await this._fs.exists(gitignore))) {
            await this._fs.writeTextAtomic(gitignore, LIBRARY_GITIGNORE)
        }
    }

    // ── Настройки ───────────────────────────────────────────────────────────

    public async getSettings(): Promise<ISettings> {
        const settings = await readJsonFile(this._fs, this._paths.settings(), SettingsSchema)

        return settings ?? SettingsSchema.parse({})
    }

    public async saveSettings(settings: ISettings): Promise<void> {
        await writeJsonFile(this._fs, this._paths.settings(), settings)
    }

    /** Читает JSON-темы библиотеки, пропуская записи с ошибками и ссылки. */
    public async listLocalThemes(): Promise<ILocalThemeCatalog> {
        const dir = this._paths.themesDir()
        const themes: ILocalTheme[] = []
        const invalidFiles: string[] = []

        for (const entry of await this._fs.listDir(dir)) {
            if (!entry.isFile || !entry.name.endsWith('.json')) continue
            const slug = SlugSchema.safeParse(entry.name.slice(0, -'.json'.length))
            try {
                const theme = slug.success
                    ? await readJsonFile(this._fs, `${dir}/${entry.name}`, LocalThemeSchema)
                    : undefined
                if (theme && slug.success) {
                    themes.push({ ...theme, id: `local:${slug.data}` })
                } else {
                    invalidFiles.push(entry.name)
                }
            } catch {
                invalidFiles.push(entry.name)
            }
        }

        return {
            themes: themes.sort((left, right) => left.name.localeCompare(right.name)),
            invalidFiles: invalidFiles.sort(),
        }
    }

    // ── Workspaces ──────────────────────────────────────────────────────────

    public async listWorkspaces(): Promise<IWorkspace[]> {
        const entries = await this._fs.listDir(this._paths.workspacesDir())
        const workspaces: IWorkspace[] = []

        for (const entry of entries) {
            if (!entry.isDirectory) continue

            const workspace = await readJsonFile(
                this._fs,
                this._paths.workspaceFile(entry.name),
                WorkspaceSchema,
            )
            if (workspace) workspaces.push(workspace)
        }

        return workspaces.sort((left, right) => left.name.localeCompare(right.name))
    }

    public async getWorkspace(workspaceId: string): Promise<IWorkspace> {
        return readRequiredJsonFile(
            this._fs,
            this._paths.workspaceFile(workspaceId),
            WorkspaceSchema,
            ErrorCodeEnum.WORKSPACE_NOT_FOUND,
        )
    }

    public async workspaceExists(workspaceId: string): Promise<boolean> {
        return this._fs.exists(this._paths.workspaceFile(workspaceId))
    }

    public async createWorkspace(input: ICreateWorkspaceInput): Promise<IWorkspace> {
        const id = input.id ?? toSlug(input.name)
        if (await this.workspaceExists(id)) {
            throw new ResolvrError(
                ErrorCodeEnum.WORKSPACE_ALREADY_EXISTS,
                `Workspace "${id}" уже существует`,
                { workspaceId: id },
            )
        }

        const now = new Date().toISOString()
        const workspace = WorkspaceSchema.parse({
            id,
            name: input.name,
            description: input.description ?? '',
            endpoints: input.endpointUrl
                ? [
                      {
                          id: 'default',
                          name: input.endpointName ?? 'Default',
                          url: input.endpointUrl,
                          headers: {},
                          acceptInvalidCerts: false,
                      },
                  ]
                : [],
            environments: [
                { id: 'default', name: 'Default', variables: {}, auth: { type: 'none' } },
            ],
            defaultEndpointId: input.endpointUrl ? 'default' : undefined,
            defaultEnvironmentId: 'default',
            createdAt: now,
            updatedAt: now,
        })

        await this._fs.ensureDir(this._paths.collectionsDir(id))
        await this._fs.ensureDir(this._paths.flowsDir(id))
        await this.saveWorkspace(workspace)

        return workspace
    }

    /**
     * Записывает workspace без личных полей.
     *
     * Раскладка панелей, срок токена и его владелец относятся к конкретному
     * человеку и машине; в файле, который команда держит в git, они давали бы
     * конфликты и утечку e-mail. Всё это живёт в `.state/`.
     */
    public async saveWorkspace(workspace: IWorkspace): Promise<void> {
        const { layout: _layout, ...shared } = workspace
        const next: IWorkspace = {
            ...shared,
            environments: shared.environments.map(
                ({ tokenExpiresAt: _expiresAt, tokenSubject: _subject, ...environment }) =>
                    environment,
            ),
            updatedAt: new Date().toISOString(),
        }

        await writeJsonFile(this._fs, this._paths.workspaceFile(workspace.id), next)
    }

    public async deleteWorkspace(workspaceId: string): Promise<void> {
        const id = WorkspaceSchema.shape.id.parse(workspaceId)
        await this._fs.removeDir(this._paths.workspaceDir(id))
    }

    // ── Коллекции ───────────────────────────────────────────────────────────

    public async listCollections(workspaceId: string): Promise<ICollection[]> {
        const entries = await this._fs.listDir(this._paths.collectionsDir(workspaceId))
        const collections = await Promise.all(
            entries
                .filter((entry) => entry.isDirectory)
                .map(async (entry) => {
                    const collection = await readJsonFile(
                        this._fs,
                        this._paths.collectionFile(workspaceId, entry.name),
                        CollectionSchema,
                    )

                    return collection ?? CollectionSchema.parse({ id: entry.name, name: entry.name })
                }),
        )

        return collections.sort((left, right) => left.name.localeCompare(right.name))
    }

    public async getCollection(workspaceId: string, collectionId: string): Promise<ICollection> {
        return readRequiredJsonFile(
            this._fs,
            this._paths.collectionFile(workspaceId, collectionId),
            CollectionSchema,
            ErrorCodeEnum.COLLECTION_NOT_FOUND,
        )
    }

    public async createCollection(
        workspaceId: string,
        name: string,
        collectionId?: string,
    ): Promise<ICollection> {
        const id = collectionId ?? toSlug(name)
        const file = this._paths.collectionFile(workspaceId, id)

        if (await this._fs.exists(file)) {
            throw new ResolvrError(
                ErrorCodeEnum.COLLECTION_ALREADY_EXISTS,
                `Коллекция "${id}" уже существует`,
                { workspaceId, collectionId: id },
            )
        }

        const collection = CollectionSchema.parse({ id, name })
        await this._fs.ensureDir(this._paths.collectionDir(workspaceId, id))
        await writeJsonFile(this._fs, file, collection)

        return collection
    }

    public async saveCollection(workspaceId: string, collection: ICollection): Promise<void> {
        await writeJsonFile(
            this._fs,
            this._paths.collectionFile(workspaceId, collection.id),
            collection,
        )
    }

    public async deleteCollection(workspaceId: string, collectionId: string): Promise<void> {
        await this._fs.removeDir(this._paths.collectionDir(workspaceId, collectionId))
    }

    // ── Операции ────────────────────────────────────────────────────────────

    public async listOperations(workspaceId: string, collectionId: string): Promise<IOperation[]> {
        const dir = this._paths.collectionDir(workspaceId, collectionId)
        const entries = await this._fs.listDir(dir)
        const names = entries
            .filter((entry) => !entry.isDirectory && entry.name.endsWith(OPERATION_QUERY_SUFFIX))
            .map((entry) => entry.name.slice(0, -OPERATION_QUERY_SUFFIX.length))

        // Файлы читаются параллельно: каждое чтение — отдельный вызов в
        // Tauri, и последовательный обход коллекции на сто операций занимал
        // заметную долю секунды при каждом обновлении дерева.
        const read = await Promise.all(
            names.map((name) => this._readOperation(workspaceId, collectionId, name)),
        )
        const operations = read.filter((operation): operation is IOperation => operation !== undefined)

        return this._applyCollectionOrder(workspaceId, collectionId, operations)
    }

    public async getOperation(workspaceId: string, ref: IOperationRef): Promise<IOperation> {
        const operation = await this._readOperation(workspaceId, ref.collectionId, ref.name)
        if (!operation) {
            throw new ResolvrError(
                ErrorCodeEnum.OPERATION_NOT_FOUND,
                `Операция "${ref.collectionId}/${ref.name}" не найдена`,
                { workspaceId, ...ref },
            )
        }

        return operation
    }

    /**
     * Версия операции — отпечаток обоих её файлов: текст запроса и метаданные
     * меняются по отдельности, а операция для вызывающего одна.
     */
    public async operationVersion(workspaceId: string, ref: IOperationRef): Promise<string> {
        return versionOfFiles(this._fs, [
            this._paths.operationQueryFile(workspaceId, ref.collectionId, ref.name),
            this._paths.operationMetaFile(workspaceId, ref.collectionId, ref.name),
        ])
    }

    public async flowVersion(workspaceId: string, flowId: string): Promise<string> {
        return versionOfFiles(this._fs, [this._paths.flowFile(workspaceId, flowId)])
    }

    /** Возвращает скрипты и версию из одного снимка файлов. */
    public async getRequestScripts(workspaceId: string, target: IRequestScriptTarget): Promise<IRequestScriptsSnapshot> {
        const { scripts, version } = await this._requestScriptsFile(workspaceId, target)

        return { scripts, version }
    }

    /** Меняет указанные фазы. `null` удаляет фазу, пропущенное поле сохраняет её. */
    public async patchRequestScripts(
        workspaceId: string,
        target: IRequestScriptTarget,
        patch: IRequestScriptsPatch,
        expectedVersion?: string,
    ): Promise<IRequestScriptsSnapshot & { changed: boolean }> {
        const previous = this._scriptWrites.get(workspaceId) ?? Promise.resolve()
        const pending = previous.catch(() => undefined).then(
            () => this._patchRequestScripts(workspaceId, target, patch, expectedVersion),
        )
        this._scriptWrites.set(workspaceId, pending)
        try {
            return await pending
        } finally {
            if (this._scriptWrites.get(workspaceId) === pending) this._scriptWrites.delete(workspaceId)
        }
    }

    private async _patchRequestScripts(
        workspaceId: string,
        target: IRequestScriptTarget,
        patch: IRequestScriptsPatch,
        expectedVersion?: string,
    ): Promise<IRequestScriptsSnapshot & { changed: boolean }> {
        const file = await this._requestScriptsFile(workspaceId, target)
        ensureVersion(expectedVersion, file.version, { workspaceId, target })
        const scripts = RequestScriptsSchema.parse({
            preRequest: patch.preRequest === undefined ? file.scripts.preRequest : patch.preRequest ?? undefined,
            postRequest: patch.postRequest === undefined ? file.scripts.postRequest : patch.postRequest ?? undefined,
        })
        if (scripts.preRequest === file.scripts.preRequest && scripts.postRequest === file.scripts.postRequest) {
            return { scripts: file.scripts, version: file.version, changed: false }
        }

        const version = await file.write(scripts.preRequest !== undefined || scripts.postRequest !== undefined
            ? scripts : undefined)

        return { scripts, version, changed: true }
    }

    private async _requestScriptsFile(workspaceId: string, target: IRequestScriptTarget): Promise<IRequestScriptsFile> {
        SlugSchema.parse(workspaceId)
        if (target.kind === 'environment') {
            const file = this._paths.workspaceFile(workspaceId)
            const raw = await this._fs.readText(file)
            if (raw === undefined) {
                throw new ResolvrError(ErrorCodeEnum.WORKSPACE_NOT_FOUND, `Workspace "${workspaceId}" не найден`, { workspaceId })
            }
            const workspace = parseJson(raw, WorkspaceSchema, file)
            if (workspace.id !== workspaceId) {
                throw new ResolvrError(ErrorCodeEnum.INVALID_FILE_FORMAT, 'Идентификатор workspace не совпадает с именем его каталога', { workspaceId })
            }
            const environmentId = SlugSchema.parse(target.environmentId)
            const environment = workspace.environments.find((item) => item.id === environmentId)
            if (!environment) {
                throw new ResolvrError(ErrorCodeEnum.ENVIRONMENT_NOT_FOUND, `Окружение "${environmentId}" не найдено`, { workspaceId, environmentId })
            }
            const version = versionOf(raw)
            return {
                scripts: environment.scripts ?? {},
                version,
                write: async (scripts) => {
                    ensureVersion(version, await versionOfFiles(this._fs, [file]), { workspaceId, environmentId })
                    environment.scripts = scripts
                    await this.saveWorkspace(workspace)

                    return versionOfFiles(this._fs, [file])
                },
            }
        }

        const { collectionId, name } = target.ref
        SlugSchema.parse(collectionId)
        if (!name || /[/\\]/.test(name) || name.includes('\0')) {
            throw new ResolvrError(ErrorCodeEnum.INVALID_REFERENCE, 'Недопустимое имя операции', { workspaceId, collectionId })
        }
        const file = this._paths.operationMetaFile(workspaceId, collectionId, name)
        const [query, raw] = await Promise.all([
            this._fs.readText(this._paths.operationQueryFile(workspaceId, collectionId, name)),
            this._fs.readText(file),
        ])
        if (query === undefined) {
            throw new ResolvrError(ErrorCodeEnum.OPERATION_NOT_FOUND, `Операция "${collectionId}/${name}" не найдена`, { workspaceId, ...target.ref })
        }
        const meta = raw === undefined
            ? OperationMetaSchema.parse({ name, updatedAt: new Date(0).toISOString() })
            : parseJson(raw, OperationMetaSchema, file)
        const version = versionOf(query, raw)

        return {
            scripts: meta.scripts ?? {},
            version,
            write: async (scripts) => {
                ensureVersion(version, await this.operationVersion(workspaceId, target.ref), { workspaceId, ...target.ref })
                await writeJsonFile(this._fs, file, { ...meta, scripts, updatedAt: new Date().toISOString() })

                return this.operationVersion(workspaceId, target.ref)
            },
        }
    }

    public async saveOperation(
        workspaceId: string,
        input: ISaveOperationInput,
    ): Promise<IOperation> {
        const { collectionId, name } = input

        ensureVersion(
            input.expectedVersion,
            await this.operationVersion(workspaceId, { collectionId, name }),
            { workspaceId, collectionId, name },
        )

        if (!(await this._fs.exists(this._paths.collectionFile(workspaceId, collectionId)))) {
            throw new ResolvrError(
                ErrorCodeEnum.COLLECTION_NOT_FOUND,
                `Коллекция "${collectionId}" не найдена`,
                { workspaceId, collectionId },
            )
        }

        const meta: IOperationMeta = OperationMetaSchema.parse({
            name,
            description: input.description ?? '',
            variables: input.variables ?? {},
            headers: input.headers ?? {},
            endpointId: input.endpointId,
            environmentId: input.environmentId,
            prerequisiteFlow: input.prerequisiteFlow,
            saveToEnvironment: input.saveToEnvironment ?? [],
            scripts: input.scripts,
            updatedAt: new Date().toISOString(),
        })

        await this._fs.writeTextAtomic(
            this._paths.operationQueryFile(workspaceId, collectionId, name),
            input.query.endsWith('\n') ? input.query : `${input.query}\n`,
        )
        await writeJsonFile(
            this._fs,
            this._paths.operationMetaFile(workspaceId, collectionId, name),
            meta,
        )
        await this._appendToCollectionOrder(workspaceId, collectionId, name)

        return { ...meta, collectionId, query: input.query, kind: detectOperationKind(input.query) }
    }

    /**
     * Переносит операцию в другую коллекцию и/или под другое имя.
     *
     * Файлы копируются, затем исходные удаляются: прерывание оставит либо
     * обе копии, либо только старую — но не потеряет операцию. Ссылки на
     * операцию из цепочек и из профилей логина окружений переписываются на
     * новое имя: иначе переименование молча ломало бы цепочки.
     *
     * @throws ResolvrError OPERATION_ALREADY_EXISTS — целевое имя занято.
     * @throws ResolvrError OPERATION_NOT_FOUND — исходной операции нет.
     */
    public async moveOperation(
        workspaceId: string,
        from: IOperationRef,
        to: IOperationRef,
        options: IMoveOperationOptions = {},
    ): Promise<IOperation> {
        if (from.collectionId === to.collectionId && from.name === to.name) {
            return this.getOperation(workspaceId, from)
        }

        const targetQuery = this._paths.operationQueryFile(workspaceId, to.collectionId, to.name)
        if (await this._fs.exists(targetQuery)) {
            throw new ResolvrError(
                ErrorCodeEnum.OPERATION_ALREADY_EXISTS,
                `Операция "${to.collectionId}/${to.name}" уже существует`,
                { workspaceId, ...to },
            )
        }

        const operation = await this.getOperation(workspaceId, from)

        // Порядок снимается до переноса: после него исходного имени в списке
        // уже не будет, и позицию восстановить не из чего.
        const sameCollection = from.collectionId === to.collectionId
        const targetOrder = await this._displayedOrder(workspaceId, to.collectionId)
        let index = options.index
        if (index === undefined && sameCollection) index = targetOrder.indexOf(from.name)
        const order = targetOrder.filter((name) => name !== from.name)
        order.splice(index === undefined || index < 0 ? order.length : Math.min(index, order.length), 0, to.name)

        const moved = await this.saveOperation(workspaceId, {
            collectionId: to.collectionId,
            name: to.name,
            query: operation.query,
            description: operation.description,
            variables: operation.variables,
            headers: operation.headers,
            endpointId: operation.endpointId,
            environmentId: operation.environmentId,
            prerequisiteFlow: operation.prerequisiteFlow,
            saveToEnvironment: operation.saveToEnvironment,
            scripts: operation.scripts,
        })
        await this.deleteOperation(workspaceId, from)
        await this._writeCollectionOrder(workspaceId, to.collectionId, order)
        await this._rewriteOperationRefs(
            workspaceId,
            formatOperationRef(from),
            formatOperationRef(to),
        )

        return moved
    }

    /**
     * Задаёт порядок операций коллекции.
     *
     * @throws ResolvrError INVALID_REFERENCE — список не совпадает с набором
     * операций коллекции: порядок, в котором чего-то не хватает, потерял бы
     * позиции остальных.
     */
    public async reorderOperations(
        workspaceId: string,
        collectionId: string,
        names: string[],
    ): Promise<void> {
        const existing = await this._displayedOrder(workspaceId, collectionId)
        const wanted = new Set(names)
        const matches =
            wanted.size === names.length &&
            existing.length === names.length &&
            existing.every((name) => wanted.has(name))

        if (!matches) {
            throw new ResolvrError(
                ErrorCodeEnum.INVALID_REFERENCE,
                `Новый порядок коллекции "${collectionId}" не совпадает с её операциями`,
                { workspaceId, collectionId, expected: existing.length, received: names.length },
            )
        }

        await this._writeCollectionOrder(workspaceId, collectionId, names)
    }

    public async deleteOperation(workspaceId: string, ref: IOperationRef): Promise<void> {
        await this._fs.remove(
            this._paths.operationQueryFile(workspaceId, ref.collectionId, ref.name),
        )
        await this._fs.remove(
            this._paths.operationMetaFile(workspaceId, ref.collectionId, ref.name),
        )

        const collection = await readJsonFile(
            this._fs,
            this._paths.collectionFile(workspaceId, ref.collectionId),
            CollectionSchema,
        )
        if (collection && collection.order.includes(ref.name)) {
            collection.order = collection.order.filter((item) => item !== ref.name)
            await this.saveCollection(workspaceId, collection)
        }
    }

    /** Все операции всех коллекций — для палитры команд и глобального поиска. */
    public async listAllOperations(workspaceId: string): Promise<IOperation[]> {
        const collections = await this.listCollections(workspaceId)
        const result: IOperation[] = []

        for (const collection of collections) {
            result.push(...(await this.listOperations(workspaceId, collection.id)))
        }

        return result
    }

    // ── Флоу ────────────────────────────────────────────────────────────────

    public async listFlows(workspaceId: string): Promise<IFlow[]> {
        const entries = await this._fs.listDir(this._paths.flowsDir(workspaceId))
        const read = await Promise.all(
            entries
                .filter((entry) => !entry.isDirectory && entry.name.endsWith(FLOW_SUFFIX))
                .map((entry) =>
                    readJsonFile(this._fs, `${this._paths.flowsDir(workspaceId)}/${entry.name}`, FlowSchema),
                ),
        )
        const flows = read.filter((flow): flow is IFlow => flow !== undefined)

        return flows.sort((left, right) => left.name.localeCompare(right.name))
    }

    public async getFlow(workspaceId: string, flowId: string): Promise<IFlow> {
        return readRequiredJsonFile(
            this._fs,
            this._paths.flowFile(workspaceId, flowId),
            FlowSchema,
            ErrorCodeEnum.FLOW_NOT_FOUND,
        )
    }

    public async saveFlow(
        workspaceId: string,
        flow: IFlow,
        options: { expectedVersion?: string } = {},
    ): Promise<void> {
        ensureVersion(options.expectedVersion, await this.flowVersion(workspaceId, flow.id), {
            workspaceId,
            flowId: flow.id,
        })

        await this._fs.ensureDir(this._paths.flowsDir(workspaceId))
        await writeJsonFile(this._fs, this._paths.flowFile(workspaceId, flow.id), flow)
    }

    public async deleteFlow(workspaceId: string, flowId: string): Promise<void> {
        await this._fs.remove(this._paths.flowFile(workspaceId, flowId))
    }

    // ── Приватные помощники ─────────────────────────────────────────────────

    /** Имена операций коллекции в том порядке, в каком их видит пользователь. */
    private async _displayedOrder(workspaceId: string, collectionId: string): Promise<string[]> {
        const operations = await this.listOperations(workspaceId, collectionId)

        return operations.map((operation) => operation.name)
    }

    private async _writeCollectionOrder(
        workspaceId: string,
        collectionId: string,
        order: string[],
    ): Promise<void> {
        const collection = await this.getCollection(workspaceId, collectionId)
        await this.saveCollection(workspaceId, { ...collection, order })
    }

    /**
     * Переписывает ссылки на операцию после переноса.
     *
     * Ссылки — строки `collection/operation`, поэтому без переписывания шаги
     * цепочек и логин окружения указывали бы на несуществующий файл.
     * Перезаписываются только изменившиеся файлы.
     */
    private async _rewriteOperationRefs(
        workspaceId: string,
        fromRef: string,
        toRef: string,
    ): Promise<void> {
        const flows = await this.listFlows(workspaceId)
        for (const flow of flows) {
            if (!flow.steps.some((step) => step.operationRef === fromRef)) continue

            await this.saveFlow(workspaceId, {
                ...flow,
                steps: flow.steps.map((step) =>
                    step.operationRef === fromRef ? { ...step, operationRef: toRef } : step,
                ),
            })
        }

        const workspace = await this.getWorkspace(workspaceId)
        const usesLogin = workspace.environments.some(
            (environment) =>
                environment.auth.type === 'login' && environment.auth.operationRef === fromRef,
        )
        if (!usesLogin) return

        await this.saveWorkspace({
            ...workspace,
            environments: workspace.environments.map((environment) =>
                environment.auth.type === 'login' && environment.auth.operationRef === fromRef
                    ? { ...environment, auth: { ...environment.auth, operationRef: toRef } }
                    : environment,
            ),
        })
    }

    private async _readOperation(
        workspaceId: string,
        collectionId: string,
        name: string,
    ): Promise<IOperation | undefined> {
        const query = await this._fs.readText(
            this._paths.operationQueryFile(workspaceId, collectionId, name),
        )
        if (query === undefined) return undefined

        const meta =
            (await readJsonFile(
                this._fs,
                this._paths.operationMetaFile(workspaceId, collectionId, name),
                OperationMetaSchema,
            )) ?? OperationMetaSchema.parse({ name, updatedAt: new Date(0).toISOString() })

        return { ...meta, collectionId, query, kind: detectOperationKind(query) }
    }

    /**
     * Раскладывает операции в порядке, заданном `collection.json`. Файлы,
     * появившиеся мимо приложения (например, созданные агентом), уходят в конец
     * списка, а не теряются.
     */
    private async _applyCollectionOrder(
        workspaceId: string,
        collectionId: string,
        operations: IOperation[],
    ): Promise<IOperation[]> {
        const collection = await readJsonFile(
            this._fs,
            this._paths.collectionFile(workspaceId, collectionId),
            CollectionSchema,
        )
        if (!collection || collection.order.length === 0) {
            return operations.sort((left, right) => left.name.localeCompare(right.name))
        }

        const rank = new Map(collection.order.map((name, index) => [name, index]))

        return operations.sort((left, right) => {
            const leftRank = rank.get(left.name) ?? Number.MAX_SAFE_INTEGER
            const rightRank = rank.get(right.name) ?? Number.MAX_SAFE_INTEGER
            if (leftRank !== rightRank) return leftRank - rightRank

            return left.name.localeCompare(right.name)
        })
    }

    private async _appendToCollectionOrder(
        workspaceId: string,
        collectionId: string,
        name: string,
    ): Promise<void> {
        const collection = await readJsonFile(
            this._fs,
            this._paths.collectionFile(workspaceId, collectionId),
            CollectionSchema,
        )
        if (!collection || collection.order.includes(name)) return

        collection.order.push(name)
        await this.saveCollection(workspaceId, collection)
    }
}

/** Разбирает `collection/operation`; иные формы — доменная ошибка. */
export function parseOperationRef(ref: string): IOperationRef {
    const parts = ref.split('/')
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new ResolvrError(
            ErrorCodeEnum.INVALID_REFERENCE,
            `Ссылка на операцию должна иметь вид "collection/operation", получено: "${ref}"`,
            { ref },
        )
    }

    return { collectionId: parts[0], name: parts[1] }
}

export function formatOperationRef(ref: IOperationRef): string {
    return `${ref.collectionId}/${ref.name}`
}

/**
 * Определяет тип операции по тексту запроса. Незапарсившийся черновик считается
 * query — редактор всё равно подсветит синтаксическую ошибку отдельно.
 */
export function detectOperationKind(query: string): IOperationKind {
    try {
        const document = parse(query)
        for (const definition of document.definitions) {
            if (definition.kind === 'OperationDefinition') return definition.operation
        }
    } catch {
        return 'query'
    }

    return 'query'
}
