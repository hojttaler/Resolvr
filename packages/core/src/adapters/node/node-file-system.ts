import { constants } from 'node:fs'
import {
    access,
    appendFile,
    chmod,
    mkdir,
    open,
    readdir,
    readFile,
    rename,
    rm,
} from 'node:fs/promises'
import { dirname } from 'node:path'

import type { IDirEntry, IFileSystem, IWriteOptions } from '../../ports/file-system.js'

/**
 * Файловая система для MCP-сервера, CLI и тестов.
 *
 * Атомарность записи обеспечивается связкой «временный файл → fsync → rename»:
 * `rename` в пределах одной ФС атомарен, а `fsync` гарантирует, что данные уже
 * на диске, а не только в кэше страниц.
 */
export class NodeFileSystem implements IFileSystem {
    public async readText(path: string): Promise<string | undefined> {
        try {
            return await readFile(path, 'utf8')
        } catch (error) {
            if (isNotFound(error)) return undefined
            throw error
        }
    }

    public async writeTextAtomic(
        path: string,
        content: string,
        options?: IWriteOptions,
    ): Promise<void> {
        await mkdir(dirname(path), { recursive: true })
        const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`

        // Права выставляются на временном файле: после `rename` целевой файл
        // ни на мгновение не бывает доступен остальным пользователям.
        const handle = await open(tempPath, 'w', options?.privateAccess ? 0o600 : undefined)
        try {
            await handle.writeFile(content, 'utf8')
            await handle.sync()
        } finally {
            await handle.close()
        }

        if (options?.privateAccess) await chmod(tempPath, 0o600)
        await rename(tempPath, path)
    }

    public async appendText(path: string, content: string): Promise<void> {
        await mkdir(dirname(path), { recursive: true })
        await appendFile(path, content, 'utf8')
    }

    public async exists(path: string): Promise<boolean> {
        try {
            await access(path, constants.F_OK)

            return true
        } catch {
            return false
        }
    }

    public async ensureDir(path: string, options?: IWriteOptions): Promise<void> {
        await mkdir(path, { recursive: true, mode: options?.privateAccess ? 0o700 : undefined })
        if (options?.privateAccess) await chmod(path, 0o700)
    }

    public async listDir(path: string): Promise<IDirEntry[]> {
        try {
            const entries = await readdir(path, { withFileTypes: true })

            return entries.map((entry) => ({
                name: entry.name,
                isDirectory: entry.isDirectory(),
            }))
        } catch (error) {
            if (isNotFound(error)) return []
            throw error
        }
    }

    public async remove(path: string): Promise<void> {
        await rm(path, { force: true })
    }

    public async removeDir(path: string): Promise<void> {
        await rm(path, { force: true, recursive: true })
    }

    public async rename(from: string, to: string): Promise<void> {
        await rename(from, to)
    }
}

function isNotFound(error: unknown): boolean {
    return (
        typeof error === 'object' &&
        error !== null &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
}
