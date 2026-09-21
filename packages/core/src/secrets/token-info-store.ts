import type { IWorkspace } from '../model/schemas.js'
import type { IFileSystem } from '../ports/file-system.js'
import type { LibraryPaths } from '../storage/paths.js'

export interface ITokenInfo {
    expiresAt?: string
    subject?: string
}

interface ITokensFile {
    version: 1
    tokens: Record<string, ITokenInfo>
}

/**
 * Срок жизни и владелец токена каждого окружения.
 *
 * Хранится в `.state/tokens.json`, а не в `workspace.json`: это сведения о
 * конкретном человеке и его сессии. В общем файле workspace они утекали бы
 * в репозиторий команды вместе с e-mail владельца и давали бы конфликт при
 * каждом обновлении токена.
 */
export class TokenInfoStore {
    private readonly _fs: IFileSystem
    private readonly _paths: LibraryPaths
    private _cache: ITokensFile | undefined

    constructor(fs: IFileSystem, paths: LibraryPaths) {
        this._fs = fs
        this._paths = paths
    }

    public async get(workspaceId: string, environmentId: string): Promise<ITokenInfo | undefined> {
        const file = await this._load()

        return file.tokens[key(workspaceId, environmentId)]
    }

    public async set(workspaceId: string, environmentId: string, info: ITokenInfo): Promise<void> {
        const file = await this._load()
        file.tokens[key(workspaceId, environmentId)] = info

        await this._fs.writeTextAtomic(this._paths.tokensFile(), `${JSON.stringify(file, null, 2)}\n`)
        this._cache = file
    }

    /**
     * Дополняет окружения workspace сведениями о токенах.
     *
     * Возвращает новый объект: в памяти окружение знает срок своего токена,
     * а на диск эти поля не попадают — `saveWorkspace` их отбрасывает.
     */
    public async attach(workspace: IWorkspace): Promise<IWorkspace> {
        const file = await this._load()

        return {
            ...workspace,
            environments: workspace.environments.map((environment) => {
                const info = file.tokens[key(workspace.id, environment.id)]

                return info
                    ? { ...environment, tokenExpiresAt: info.expiresAt, tokenSubject: info.subject }
                    : environment
            }),
        }
    }

    private async _load(): Promise<ITokensFile> {
        if (this._cache) return this._cache

        const raw = await this._fs.readText(this._paths.tokensFile())
        this._cache = raw ? parse(raw) : { version: 1, tokens: {} }

        return this._cache
    }
}

function key(workspaceId: string, environmentId: string): string {
    return `${workspaceId}/${environmentId}`
}

/** Битый файл считается пустым: терять он может только подпись индикатора. */
function parse(raw: string): ITokensFile {
    try {
        const parsed = JSON.parse(raw) as Partial<ITokensFile> | null
        const tokens: Record<string, ITokenInfo> = {}

        for (const [id, info] of Object.entries(parsed?.tokens ?? {})) {
            if (!info || typeof info !== 'object') continue

            tokens[id] = {
                expiresAt: typeof info.expiresAt === 'string' ? info.expiresAt : undefined,
                subject: typeof info.subject === 'string' ? info.subject : undefined,
            }
        }

        return { version: 1, tokens }
    } catch {
        return { version: 1, tokens: {} }
    }
}
