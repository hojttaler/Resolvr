/**
 * Раскладка библиотеки на диске.
 *
 * Единственное место, где знают структуру `~/Resolvr`. Пути собираются
 * вручную через `/`, чтобы не тянуть `node:path` в webview-сборку.
 */
export class LibraryPaths {
    public readonly root: string

    constructor(root: string) {
        this.root = root.replace(/\/+$/, '')
    }

    public settings(): string {
        return `${this.root}/settings.json`
    }

    /** Секреты в файловом режиме: отдельная директория, доступная только владельцу. */
    public secretsDir(): string {
        return `${this.root}/.secrets`
    }

    public secretsFile(workspaceId: string): string {
        return `${this.secretsDir()}/${workspaceId}.json`
    }

    public workspacesDir(): string {
        return `${this.root}/workspaces`
    }

    public workspaceDir(workspaceId: string): string {
        return `${this.workspacesDir()}/${workspaceId}`
    }

    public workspaceFile(workspaceId: string): string {
        return `${this.workspaceDir(workspaceId)}/workspace.json`
    }

    public collectionsDir(workspaceId: string): string {
        return `${this.workspaceDir(workspaceId)}/collections`
    }

    public collectionDir(workspaceId: string, collectionId: string): string {
        return `${this.collectionsDir(workspaceId)}/${collectionId}`
    }

    public collectionFile(workspaceId: string, collectionId: string): string {
        return `${this.collectionDir(workspaceId, collectionId)}/collection.json`
    }

    public operationQueryFile(workspaceId: string, collectionId: string, name: string): string {
        return `${this.collectionDir(workspaceId, collectionId)}/${name}.graphql`
    }

    public operationMetaFile(workspaceId: string, collectionId: string, name: string): string {
        return `${this.collectionDir(workspaceId, collectionId)}/${name}.meta.json`
    }

    public flowsDir(workspaceId: string): string {
        return `${this.workspaceDir(workspaceId)}/flows`
    }

    public flowFile(workspaceId: string, flowId: string): string {
        return `${this.flowsDir(workspaceId)}/${flowId}.flow.json`
    }

    public cacheDir(workspaceId: string): string {
        return `${this.workspaceDir(workspaceId)}/.cache`
    }

    public schemaCacheFile(workspaceId: string, endpointId: string): string {
        return `${this.cacheDir(workspaceId)}/schema.${endpointId}.json`
    }

    /** Предыдущий снимок схемы — основа для diff после деплоя. */
    public schemaPreviousFile(workspaceId: string, endpointId: string): string {
        return `${this.cacheDir(workspaceId)}/schema.${endpointId}.previous.json`
    }

    public historyDir(workspaceId: string): string {
        return `${this.workspaceDir(workspaceId)}/.history`
    }

    public historyFile(workspaceId: string, day: string): string {
        return `${this.historyDir(workspaceId)}/${day}.jsonl`
    }

    /** Журнал действий агента: отдельная папка, чтобы не смешиваться с историей. */
    public activityDir(): string {
        return `${this.root}/.activity`
    }

    public activityFile(day: string): string {
        return `${this.activityDir()}/${day}.jsonl`
    }

    public stateDir(): string {
        return `${this.root}/.state`
    }

    /** Сроки и владельцы токенов — личное, рядом с сессией. */
    public tokensFile(): string {
        return `${this.stateDir()}/tokens.json`
    }

    public sessionFile(): string {
        return `${this.stateDir()}/session.json`
    }

    public draftsDir(): string {
        return `${this.stateDir()}/drafts`
    }

    public draftQueryFile(tabId: string): string {
        return `${this.draftsDir()}/${tabId}.graphql`
    }

    public draftFlowFile(tabId: string): string {
        return `${this.draftsDir()}/${tabId}.flow.json`
    }

    public draftReportFile(tabId: string): string {
        return `${this.draftsDir()}/${tabId}.report.json`
    }

    public draftDataFile(tabId: string): string {
        return `${this.draftsDir()}/${tabId}.json`
    }
}

/** Имя файла истории за конкретный день в формате `YYYY-MM-DD`. */
export function historyDayKey(date: Date): string {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')

    return `${year}-${month}-${day}`
}

const CYRILLIC_MAP: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
    и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
    с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'ts', ч: 'ch', ш: 'sh',
    щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

/**
 * Приводит произвольную строку к безопасному для файловой системы slug.
 *
 * Кириллица транслитерируется, а не выбрасывается: иначе коллекция «Пользователи»
 * и флоу «Логин» получили бы одинаковый идентификатор `untitled` и затирали бы
 * друг друга.
 */
export function toSlug(value: string): string {
    const transliterated = [...value.trim().toLowerCase()]
        .map((character) => CYRILLIC_MAP[character] ?? character)
        .join('')

    const slug = transliterated
        .replace(/[^a-z0-9-_ ]+/g, '')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')

    return slug.length > 0 ? slug.slice(0, 64) : 'untitled'
}

/** Имя библиотеки до переименования приложения. */
export const LEGACY_LIBRARY_NAME = 'GraphQLAI'
export const LIBRARY_NAME = 'Resolvr'

/**
 * Переносит библиотеку со старым именем на новое место.
 *
 * Приложение называлось GraphQLAI, и библиотека лежала в `~/GraphQLAI`.
 * Переименование каталога — единственный шаг миграции: содержимое не
 * менялось. Выполняется только если новой библиотеки ещё нет, чтобы не
 * затереть данные, если пользователь уже начал работать в новой.
 */
export async function migrateLegacyLibrary(
    fs: { exists(path: string): Promise<boolean>; rename(from: string, to: string): Promise<void> },
    home: string,
): Promise<boolean> {
    const base = home.replace(/\/+$/, '')
    const legacy = `${base}/${LEGACY_LIBRARY_NAME}`
    const current = `${base}/${LIBRARY_NAME}`

    if (await fs.exists(current)) return false
    if (!(await fs.exists(legacy))) return false

    await fs.rename(legacy, current)

    return true
}
