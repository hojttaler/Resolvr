import { subtreeMatches } from './json-search.js'

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
        label: IJsonRow['label'],
        node: unknown,
        depth: number,
        path: string,
        root: boolean,
    ): void {
        if (searching && !root && !subtreeMatches(label?.text, node, options.needle)) return

        const isContainer = node !== null && typeof node === 'object'
        const isArray = Array.isArray(node)

        if (!isContainer) {
            rows.push({
                key: path || '$',
                path,
                depth,
                label,
                kind: 'scalar',
                value: node,
                isArray: false,
                childCount: 0,
                expanded: false,
                visibleCount: 0,
            })

            return
        }

        const entries: Array<[IJsonRow['label'], unknown]> = isArray
            ? (node as unknown[]).map((item, index) => [{ text: String(index), kind: 'index' as const }, item])
            : Object.entries(node as Record<string, unknown>).map(([key, item]) => [
                  { text: key, kind: 'key' as const },
                  item,
              ])

        if (entries.length === 0) {
            rows.push({
                key: path || '$',
                path,
                depth,
                label,
                kind: 'empty',
                value: node,
                isArray,
                childCount: 0,
                expanded: false,
                visibleCount: 0,
            })

            return
        }

        const visible = searching
            ? entries.filter(([itemLabel, item]) =>
                  subtreeMatches(itemLabel?.text, item, options.needle),
              )
            : entries
        const byDefault = depth < options.expandDepth && entries.length <= options.autoCollapseSize
        const isOpen = searching || (expanded.get(path || '$') ?? byDefault)

        rows.push({
            key: path || '$',
            path,
            depth,
            label,
            kind: 'open',
            value: node,
            isArray,
            childCount: entries.length,
            expanded: isOpen,
            visibleCount: visible.length,
        })

        if (!isOpen) return

        for (const [itemLabel, item] of visible) {
            const childPath = path.length > 0 ? `${path}.${itemLabel?.text ?? ''}` : (itemLabel?.text ?? '')
            visit(itemLabel, item, depth + 1, childPath, false)
        }

        rows.push({
            key: `${path || '$'}/close`,
            path,
            depth,
            label: undefined,
            kind: 'close',
            value: node,
            isArray,
            childCount: entries.length,
            expanded: true,
            visibleCount: visible.length,
        })
    }

    visit(undefined, value, 0, options.rootPath, true)

    return rows
}
