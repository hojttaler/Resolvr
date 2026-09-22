import type { IDirEntry, IFileSystem, IWriteOptions } from '@resolvr/core'
import {
    exists,
    mkdir,
    readDir,
    readTextFile,
    remove,
    rename,
    writeTextFile,
} from '@tauri-apps/plugin-fs'

/**
 * Файловая система приложения поверх Tauri-плагина.
 *
 * Атомарность достигается тем же приёмом, что и в Node-реализации: запись во
 * временный файл рядом с целевым и переименование. Плагин не даёт доступа к
 * `fsync`, поэтому гарантия слабее серверной, но главный сценарий — «процесс
 * убит во время записи» — покрыт: `rename` не оставляет обрезанного файла.
 */
export class TauriFileSystem implements IFileSystem {
    /**
     * Директории, которые уже создавались в этой сессии: черновики и сессия
     * пишутся каждые триста миллисекунд во время набора, и повторный
     * `mkdir` перед каждой записью — лишний вызов в Rust.
     */
    private readonly _knownDirs = new Set<string>()

    public async readText(path: string): Promise<string | undefined> {
        try {
            return await readTextFile(path)
        } catch {
            return undefined
        }
    }

    public async writeTextAtomic(
        path: string,
        content: string,
        options?: IWriteOptions,
    ): Promise<void> {
        await this.ensureDir(parentDir(path))

        // Права задаются при создании временного файла и переезжают вместе с
        // ним: у плагина нет `chmod`, а целевой файл не должен ни на миг
        // оказаться доступным другим пользователям.
        const tempPath = `${path}.${Date.now()}.tmp`
        await writeTextFile(tempPath, content, options?.privateAccess ? { mode: 0o600 } : undefined)
        await rename(tempPath, path)
    }

    public async appendText(path: string, content: string): Promise<void> {
        await this.ensureDir(parentDir(path))

        // Дозапись средствами плагина: чтение и полная перезапись файла
        // истории делали каждый запуск дороже с ростом самого файла.
        await writeTextFile(path, content, { append: true })
    }

    public async exists(path: string): Promise<boolean> {
        try {
            return await exists(path)
        } catch {
            return false
        }
    }

    public async ensureDir(path: string, options?: IWriteOptions): Promise<void> {
        if (path.length === 0 || this._knownDirs.has(path)) return

        try {
            await mkdir(path, {
                recursive: true,
                mode: options?.privateAccess ? 0o700 : undefined,
            })
            this._knownDirs.add(path)
        } catch {
            // Существующая директория не является ошибкой.
            this._knownDirs.add(path)
        }
    }

    public async listDir(path: string): Promise<IDirEntry[]> {
        try {
            const entries = await readDir(path)

            return entries.map((entry) => ({
                name: entry.name,
                isDirectory: entry.isDirectory,
            }))
        } catch {
            return []
        }
    }

    public async remove(path: string): Promise<void> {
        try {
            await remove(path)
        } catch {
            // Удаление идемпотентно.
        }
    }

    public async removeDir(path: string): Promise<void> {
        for (const known of [...this._knownDirs]) {
            if (known === path || known.startsWith(`${path}/`)) this._knownDirs.delete(known)
        }

        try {
            await remove(path, { recursive: true })
        } catch {
            // Удаление идемпотентно.
        }
    }

    public async rename(from: string, to: string): Promise<void> {
        await rename(from, to)
    }
}

function parentDir(path: string): string {
    const index = path.lastIndexOf('/')

    return index > 0 ? path.slice(0, index) : ''
}
