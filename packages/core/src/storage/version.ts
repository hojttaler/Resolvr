import { ErrorCodeEnum, ResolvrError } from '../model/errors.js'
import type { IFileSystem } from '../ports/file-system.js'

/**
 * Версия файла для проверки при записи.
 *
 * Параллельно работающие агенты пишут в одну коллекцию, и запись «вслепую»
 * молча теряет чужую правку: тот, кто сохранил вторым, затирает первого.
 * Версия — отпечаток содержимого, а не время изменения: он не зависит от
 * часов и файловой системы и совпадает у одинаковых файлов.
 *
 * Отпечаток берётся FNV-1a по 64 битам: для обнаружения чужой правки этого
 * достаточно, а криптостойкость здесь не требуется — версия не защищает от
 * подделки, только от невидимой перезаписи.
 */
export function versionOf(...contents: Array<string | undefined>): string {
    const OFFSET = 0xcbf29ce484222325n
    const PRIME = 0x100000001b3n
    const MASK = 0xffffffffffffffffn

    let hash = OFFSET
    for (const content of contents) {
        // Отсутствующий файл отличается от пустого: иначе удаление
        // метаданных выглядело бы как отсутствие изменений.
        const text = content ?? '\u0000<none>'
        for (let index = 0; index < text.length; index += 1) {
            hash = ((hash ^ BigInt(text.charCodeAt(index))) * PRIME) & MASK
        }
        hash = ((hash ^ 0xffn) * PRIME) & MASK
    }

    return hash.toString(16).padStart(16, '0')
}

/** Версия набора файлов; несуществующие учитываются как отсутствующие. */
export async function versionOfFiles(fs: IFileSystem, paths: string[]): Promise<string> {
    const contents = await Promise.all(paths.map((path) => fs.readText(path)))

    return versionOf(...contents)
}

/**
 * Сверяет ожидаемую версию с фактической.
 *
 * Без ожидаемой версии запись выполняется как прежде: проверка добровольная,
 * и старые вызывающие не ломаются. С ней расхождение — отказ, а не слияние:
 * решать, чья правка верна, может только автор.
 */
export function ensureVersion(
    expected: string | undefined,
    actual: string,
    details: Record<string, unknown>,
): void {
    if (expected === undefined || expected === actual) return

    throw new ResolvrError(
        ErrorCodeEnum.VERSION_CONFLICT,
        'Файл изменился с момента чтения: перечитайте его и повторите запись с новой версией',
        { ...details, expectedVersion: expected, actualVersion: actual },
    )
}
