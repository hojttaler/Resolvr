/**
 * Поиск по дереву ответа.
 *
 * Ответы шлюза — это тысячи строк, в которых нужное поле глазами не найти,
 * а браузерный поиск бесполезен: свёрнутые ветки в DOM не существуют.
 * Поэтому совпадения ищутся по самим данным, а не по отрисованному тексту.
 */

/** Текстовое представление скаляра — то, что видит пользователь в строке. */
export function scalarText(value: unknown): string {
    if (typeof value === 'string') return value
    if (value === null) return 'null'
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)

    return ''
}

/** Совпадение в самой строке узла: в имени поля или в его значении. */
export function nodeMatches(label: string | undefined, value: unknown, needle: string): boolean {
    if (needle.length === 0) return false
    if (label !== undefined && label.toLowerCase().includes(needle)) return true
    if (value !== null && typeof value === 'object') return false

    return scalarText(value).toLowerCase().includes(needle)
}

/**
 * Есть ли совпадение в узле или где-то внутри него.
 *
 * Обход прерывается на первом совпадении: для показа ветки достаточно знать
 * факт, а не число вхождений.
 */
export function subtreeMatches(label: string | undefined, value: unknown, needle: string): boolean {
    if (needle.length === 0) return false
    if (nodeMatches(label, value, needle)) return true
    if (value === null || typeof value !== 'object') return false

    if (Array.isArray(value)) {
        return value.some((item, index) => subtreeMatches(String(index), item, needle))
    }

    return Object.entries(value as Record<string, unknown>).some(([key, item]) =>
        subtreeMatches(key, item, needle),
    )
}

/** Число совпавших строк — для счётчика в панели поиска. */
export function countMatches(value: unknown, needle: string, label?: string): number {
    if (needle.length === 0) return 0

    let total = nodeMatches(label, value, needle) ? 1 : 0

    if (value !== null && typeof value === 'object') {
        const entries = Array.isArray(value)
            ? value.map((item, index) => [String(index), item] as const)
            : Object.entries(value as Record<string, unknown>)

        for (const [key, item] of entries) total += countMatches(item, needle, key)
    }

    return total
}

export interface ITextPart {
    text: string
    match: boolean
}

/** Разбивает текст на части для подсветки вхождений. */
export function highlightParts(text: string, needle: string): ITextPart[] {
    if (needle.length === 0) return [{ text, match: false }]

    const parts: ITextPart[] = []
    const haystack = text.toLowerCase()
    let from = 0

    for (;;) {
        const at = haystack.indexOf(needle, from)
        if (at === -1) break

        if (at > from) parts.push({ text: text.slice(from, at), match: false })
        parts.push({ text: text.slice(at, at + needle.length), match: true })
        from = at + needle.length
    }

    if (parts.length === 0) return [{ text, match: false }]
    if (from < text.length) parts.push({ text: text.slice(from), match: false })

    return parts
}
