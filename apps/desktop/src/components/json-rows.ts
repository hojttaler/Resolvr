import { nodeMatches } from './json-search.js'

/**
 * Плоский список строк дерева JSON.
 *
 * Дерево превращается в массив видимых строк один раз на изменение данных
 * или состояния раскрытия. Виртуализация рендерит только строки в окне
 * прокрутки, а не рекурсивные компоненты: ответ на сто тысяч узлов
 * перестаёт зависеть от размера DOM.
 */
export interface IJsonRow {
    /** Уникальный ключ строки: путь плюс роль. */
    key: string
    path: string
    depth: number
    label: { text: string; kind: 'key' | 'index' } | undefined
    kind: 'scalar' | 'open' | 'close' | 'empty'
    value: unknown
    isArray: boolean
    /** Для открывающей строки — число дочерних элементов и раскрыта ли она. */
    childCount: number
    expanded: boolean
    /** Сколько детей показано при поиске (меньше childCount, если отфильтровано). */
    visibleCount: number
}

/** Пользовательские переключения: путь → раскрыт ли узел. */
export type IExpandedState = ReadonlyMap<string, boolean>

export interface IFlattenOptions {
    expandDepth: number
    autoCollapseSize: number
    needle: string
    rootPath: string
}

export function flattenJson(
    value: unknown,
    expanded: IExpandedState,
    options: IFlattenOptions,
): IJsonRow[] {
    const rows: IJsonRow[] = []
    const searching = options.needle.length > 0

    function visit(
        key: string | undefined,
        parentIsArray: boolean,
        node: unknown,
        depth: number,
        parentPath: string,
    ): boolean {
        const root = key === undefined
        const isContainer = node !== null && typeof node === 'object'
        const matches = !searching || root || nodeMatches(key, node, options.needle)
        if (!isContainer && !matches) return false

        const path = root ? parentPath : parentPath ? `${parentPath}.${key}` : key
        const isArray = Array.isArray(node)
        const keys = isContainer && !isArray ? Object.keys(node) : []
        const childCount = isArray ? node.length : keys.length

        if (childCount === 0) {
            if (!matches) return false

            rows.push({
                key: path || '$',
                path,
                depth,
                label: key === undefined ? undefined : { text: key, kind: parentIsArray ? 'index' : 'key' },
                kind: isContainer ? 'empty' : 'scalar',
                value: node,
                isArray,
                childCount: 0,
                expanded: false,
                visibleCount: 0,
            })

            return true
        }

        const byDefault = depth < options.expandDepth && childCount <= options.autoCollapseSize
        const isOpen = searching || (expanded.get(path || '$') ?? byDefault)
        const start = rows.length
        // Reserving the opening row lets search visit each subtree once and
        // discard a branch without allocating its row when it had no matches.
        rows.length += 1
        let visibleCount = 0

        if (isOpen) {
            if (isArray) {
                for (let index = 0; index < node.length; index += 1) {
                    if (visit(String(index), true, node[index], depth + 1, path)) visibleCount += 1
                }
            } else {
                const object = node as Record<string, unknown>
                for (const childKey of keys) {
                    if (visit(childKey, false, object[childKey], depth + 1, path)) visibleCount += 1
                }
            }
        }

        if (!matches && visibleCount === 0) {
            rows.length = start

            return false
        }

        rows[start] = {
            key: path || '$',
            path,
            depth,
            label: key === undefined ? undefined : { text: key, kind: parentIsArray ? 'index' : 'key' },
            kind: 'open',
            value: node,
            isArray,
            childCount,
            expanded: isOpen,
            visibleCount: searching ? visibleCount : childCount,
        }

        if (isOpen) {
            rows.push({
                key: `${path || '$'}/close`,
                path,
                depth,
                label: undefined,
                kind: 'close',
                value: node,
                isArray,
                childCount,
                expanded: true,
                visibleCount: searching ? visibleCount : childCount,
            })
        }

        return true
    }

    visit(undefined, false, value, 0, options.rootPath)

    return rows
}
