import type { IDirEntry, IFileSystem } from '../ports/file-system.js'

/**
 * Файловая система в памяти для тестов.
 *
 * Помимо скорости даёт то, чего нельзя добиться на реальной ФС: счётчик записей
 * и возможность заставить операцию упасть в нужный момент, чтобы проверить, что
 * атомарная запись не оставляет обрезанных файлов.
 */
export class MemoryFileSystem implements IFileSystem {
    private readonly _files = new Map<string, string>()
    private readonly _dirs = new Set<string>()

    /** Сколько раз выполнялась атомарная запись — используется в тестах автосохранения. */
    public writeCount = 0

    /** Если задано, следующая запись по этому пути бросит ошибку. */
    public failNextWriteAt: string | undefined

    public async readText(path: string): Promise<string | undefined> {
        return this._files.get(normalize(path))
    }

    public async writeTextAtomic(path: string, content: string): Promise<void> {
        const key = normalize(path)

        if (this.failNextWriteAt === key) {
            this.failNextWriteAt = undefined
            throw new Error(`Симулированный сбой записи: ${key}`)
        }

        this._ensureParents(key)
        this._files.set(key, content)
        this.writeCount += 1
    }

    public async appendText(path: string, content: string): Promise<void> {
        const key = normalize(path)
        this._ensureParents(key)
        this._files.set(key, (this._files.get(key) ?? '') + content)
    }

    public async exists(path: string): Promise<boolean> {
        const key = normalize(path)

        return this._files.has(key) || this._dirs.has(key)
    }

    public async ensureDir(path: string): Promise<void> {
        const key = normalize(path)
        this._dirs.add(key)
        this._ensureParents(key)
    }

    public async listDir(path: string): Promise<IDirEntry[]> {
        const prefix = `${normalize(path)}/`
        const names = new Map<string, boolean>()

        for (const file of this._files.keys()) {
            if (!file.startsWith(prefix)) continue
            const rest = file.slice(prefix.length)
            const slash = rest.indexOf('/')
            if (slash < 0) names.set(rest, false)
            else names.set(rest.slice(0, slash), true)
        }

        for (const dir of this._dirs) {
            if (!dir.startsWith(prefix)) continue
            const rest = dir.slice(prefix.length)
            const slash = rest.indexOf('/')
            names.set(slash < 0 ? rest : rest.slice(0, slash), true)
        }

        return [...names].map(([name, isDirectory]) => ({ name, isDirectory }))
    }

    public async remove(path: string): Promise<void> {
        this._files.delete(normalize(path))
    }

    public async removeDir(path: string): Promise<void> {
        const prefix = `${normalize(path)}/`
        for (const file of [...this._files.keys()]) {
            if (file === normalize(path) || file.startsWith(prefix)) this._files.delete(file)
        }
        for (const dir of [...this._dirs]) {
            if (dir === normalize(path) || dir.startsWith(prefix)) this._dirs.delete(dir)
        }
    }

    public async rename(from: string, to: string): Promise<void> {
        const source = normalize(from)
        const target = normalize(to)

        const content = this._files.get(source)
        if (content !== undefined) {
            this._files.delete(source)
            this._files.set(target, content)

            return
        }

        // Директория переносится вместе со всем содержимым — как в реальной ФС.
        if (!this._dirs.has(source)) return

        const prefix = `${source}/`
        for (const [key, value] of [...this._files.entries()]) {
            if (key.startsWith(prefix)) {
                this._files.delete(key)
                this._files.set(`${target}/${key.slice(prefix.length)}`, value)
            }
        }
        for (const key of [...this._dirs]) {
            if (key === source || key.startsWith(prefix)) {
                this._dirs.delete(key)
                this._dirs.add(key === source ? target : `${target}/${key.slice(prefix.length)}`)
            }
        }
        this._ensureParents(target)
    }

    /** Все пути файлов — для наглядных проверок раскладки хранилища. */
    public snapshot(): string[] {
        return [...this._files.keys()].sort()
    }

    private _ensureParents(path: string): void {
        const segments = path.split('/')
        segments.pop()

        // Абсолютный путь начинается с пустого сегмента: ведущий слэш должен
        // сохраниться, иначе `exists('/home/x')` не находил бы `home/x`.
        let current = ''
        for (const [index, segment] of segments.entries()) {
            current = index === 0 ? segment : `${current}/${segment}`
            if (current.length > 0) this._dirs.add(current)
        }
    }
}

function normalize(path: string): string {
    return path.replace(/\/+$/, '')
}
