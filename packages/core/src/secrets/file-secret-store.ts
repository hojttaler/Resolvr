import type { IFileSystem } from '../ports/file-system.js'
import type { ISecretRef, ISecretStore } from '../ports/secret-store.js'
import type { LibraryPaths } from '../storage/paths.js'

/** Содержимое файла секретов одного workspace. */
interface ISecretsFile {
    version: 1
    environments: Record<string, Record<string, string>>
}

/**
 * Секреты в файлах библиотеки: `.secrets/<workspace>.json`.
 *
 * Замена Keychain для личного инструмента: системное хранилище у приложения
 * с ad-hoc подписью просит пароль после каждой пересборки, и это перевешивало
 * его защиту. Файлы и директория создаются с доступом только для владельца;
 * значения не шифруются — уровень защиты тот же, что у ключей SSH.
 *
 * Один файл на workspace: секреты разных проектов не смешиваются, а удаление
 * workspace сводится к удалению одного файла.
 */
export class FileSecretStore implements ISecretStore {
    private readonly _fs: IFileSystem
    private readonly _paths: LibraryPaths
    private readonly _cache = new Map<string, ISecretsFile>()

    constructor(fs: IFileSystem, paths: LibraryPaths) {
        this._fs = fs
        this._paths = paths
    }

    public async get(ref: ISecretRef): Promise<string | undefined> {
        const file = await this._load(ref.workspace)

        return file.environments[ref.environment]?.[ref.key]
    }

    public async set(ref: ISecretRef, value: string): Promise<void> {
        const file = await this._load(ref.workspace)
        const environment = (file.environments[ref.environment] ??= {})
        environment[ref.key] = value

        await this._save(ref.workspace, file)
    }

    public async delete(ref: ISecretRef): Promise<void> {
        const file = await this._load(ref.workspace)
        const environment = file.environments[ref.environment]
        if (!environment || !(ref.key in environment)) return

        delete environment[ref.key]
        if (Object.keys(environment).length === 0) delete file.environments[ref.environment]

        await this._save(ref.workspace, file)
    }

    /** Сбрасывает кэш — после правки файла снаружи. */
    public invalidate(): void {
        this._cache.clear()
    }

    private async _load(workspaceId: string): Promise<ISecretsFile> {
        const cached = this._cache.get(workspaceId)
        if (cached) return cached

        const raw = await this._fs.readText(this._paths.secretsFile(workspaceId))
        const file = raw ? parseSecretsFile(raw) : emptyFile()
        this._cache.set(workspaceId, file)

        return file
    }

    private async _save(workspaceId: string, file: ISecretsFile): Promise<void> {
        await this._fs.ensureDir(this._paths.secretsDir(), { privateAccess: true })
        await this._fs.writeTextAtomic(
            this._paths.secretsFile(workspaceId),
            `${JSON.stringify(file, null, 2)}\n`,
            { privateAccess: true },
        )
        this._cache.set(workspaceId, file)
    }
}

function emptyFile(): ISecretsFile {
    return { version: 1, environments: {} }
}

/**
 * Разбор без zod: файл пишет только это хранилище, а битый файл секретов
 * не должен ронять приложение — он просто считается пустым.
 */
function parseSecretsFile(raw: string): ISecretsFile {
    try {
        const parsed = JSON.parse(raw) as Partial<ISecretsFile> | null
        if (!parsed || typeof parsed !== 'object' || typeof parsed.environments !== 'object') {
            return emptyFile()
        }

        const environments: Record<string, Record<string, string>> = {}
        for (const [environment, values] of Object.entries(parsed.environments ?? {})) {
            if (!values || typeof values !== 'object') continue

            environments[environment] = Object.fromEntries(
                Object.entries(values).filter(
                    (entry): entry is [string, string] => typeof entry[1] === 'string',
                ),
            )
        }

        return { version: 1, environments }
    } catch {
        return emptyFile()
    }
}
