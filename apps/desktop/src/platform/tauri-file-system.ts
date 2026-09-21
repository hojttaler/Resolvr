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
        const existing = (await this.readText(path)) ?? ''

        await writeTextFile(path, existing + content)
    }

    public async exists(path: string): Promise<boolean> {
        try {
            return await exists(path)
        } catch {
            return false
        }
    }

    public async ensureDir(path: string, options?: IWriteOptions): Promise<void> {
        if (path.length === 0) return

        try {
            await mkdir(path, {
                recursive: true,
                mode: options?.privateAccess ? 0o700 : undefined,
            })
        } catch {
            // Существующая директория не является ошибкой.
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
