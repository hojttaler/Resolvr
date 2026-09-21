/**
 * Абстракция файловой системы.
 *
 * Реализуется дважды: через `node:fs/promises` для MCP-сервера и CLI, и через
 * Tauri `plugin-fs` для GUI. Доменный код зависит только от этого интерфейса,
 * поэтому один и тот же storage-слой работает в обеих средах.
 */
export interface IFileSystem {
    /** Возвращает `undefined`, если файла не существует. */
    readText(path: string): Promise<string | undefined>

    /**
     * Атомарная запись: содержимое пишется во временный файл рядом с целевым,
     * сбрасывается на диск и переименовывается. Прерывание процесса в любой
     * момент оставляет либо старую, либо новую версию файла, но не обрезанную.
     */
    writeTextAtomic(path: string, content: string, options?: IWriteOptions): Promise<void>

    /** Дописывает строку в конец файла, создавая его при необходимости. */
    appendText(path: string, content: string): Promise<void>

    exists(path: string): Promise<boolean>

    /** Создаёт директорию рекурсивно; существующая директория не является ошибкой. */
    ensureDir(path: string, options?: IWriteOptions): Promise<void>

    /** Имена записей внутри директории без пути. Несуществующая директория — пустой список. */
    listDir(path: string): Promise<IDirEntry[]>

    remove(path: string): Promise<void>

    /** Рекурсивно удаляет директорию со всем содержимым. */
    removeDir(path: string): Promise<void>

    rename(from: string, to: string): Promise<void>
}

export interface IWriteOptions {
    /**
     * Доступ только владельцу (`0600` для файла, `0700` для директории).
     * Используется для файлов с секретами; на Windows игнорируется.
     */
    privateAccess?: boolean
}

export interface IDirEntry {
    name: string
    isDirectory: boolean
}
