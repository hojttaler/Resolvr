import type { z } from 'zod'

import { ErrorCodeEnum, ResolvrError } from '../model/errors.js'
import type { IFileSystem } from '../ports/file-system.js'

/**
 * Чтение и запись JSON-файлов хранилища с валидацией по zod-схеме.
 *
 * Любой битый файл превращается в `INVALID_FILE_FORMAT` с указанием пути и
 * конкретного поля — пользователь видит, что именно чинить, вместо белого экрана.
 */
export async function readJsonFile<TSchema extends z.ZodType>(
    fs: IFileSystem,
    path: string,
    schema: TSchema,
): Promise<z.infer<TSchema> | undefined> {
    const raw = await fs.readText(path)
    if (raw === undefined) return undefined

    return parseJson(raw, schema, path)
}

/** Как `readJsonFile`, но отсутствие файла — доменная ошибка. */
export async function readRequiredJsonFile<TSchema extends z.ZodType>(
    fs: IFileSystem,
    path: string,
    schema: TSchema,
    code: ErrorCodeEnum,
): Promise<z.infer<TSchema>> {
    const value = await readJsonFile(fs, path, schema)
    if (value === undefined) {
        throw new ResolvrError(code, `Файл не найден: ${path}`, { path })
    }

    return value
}

export function parseJson<TSchema extends z.ZodType>(
    raw: string,
    schema: TSchema,
    path: string,
): z.infer<TSchema> {
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch (error) {
        throw new ResolvrError(
            ErrorCodeEnum.INVALID_FILE_FORMAT,
            `Некорректный JSON в ${path}: ${error instanceof Error ? error.message : 'ошибка разбора'}`,
            { path },
        )
    }

    const result = schema.safeParse(parsed)
    if (!result.success) {
        const issue = result.error.issues[0]
        const field = issue?.path.join('.') ?? '<корень>'
        throw new ResolvrError(
            ErrorCodeEnum.INVALID_FILE_FORMAT,
            `Неверный формат ${path}: поле "${field}" — ${issue?.message ?? 'не прошло валидацию'}`,
            { path, field, issues: result.error.issues },
        )
    }

    return result.data
}

/** Запись отформатированного JSON атомарно; директория создаётся при необходимости. */
export async function writeJsonFile(
    fs: IFileSystem,
    path: string,
    value: unknown,
): Promise<void> {
    const dir = path.slice(0, path.lastIndexOf('/'))
    if (dir.length > 0) await fs.ensureDir(dir)

    await fs.writeTextAtomic(path, `${JSON.stringify(value, null, 4)}\n`)
}
