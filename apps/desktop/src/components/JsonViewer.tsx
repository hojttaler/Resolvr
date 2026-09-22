import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { plural, t as translate, useT } from '../i18n/index.js'
import { ContextMenu, type IContextMenuState } from './ContextMenu.js'
import { flattenJson, type IJsonRow } from './json-rows.js'
import { highlightParts } from './json-search.js'

export interface IJsonViewerProps {
    value: unknown
    /** Уровни, раскрытые изначально. */
    defaultExpandDepth?: number
    /**
     * Включает выбор пути к узлу: рядом со строкой появляется кнопка, которая
     * отдаёт путь вида `data.login.accessToken`. Так путь для извлечения или
     * проверки берут из реального ответа, а не набирают по памяти.
     */
    onPickPath?: (path: string, modifiers: { alt: boolean }) => void
    /** Префикс пути — например, `data` для корня ответа. */
    rootPath?: string
    /**
     * Сохранение значения наружу — например, в переменную окружения.
     * Пункт появляется в меню правой кнопки только когда действие передано.
     */
    onSaveValue?: (input: { path: string; value: string }) => void
    /**
     * Подстрока поиска. Показываются только ветки, содержащие совпадение;
     * сами совпадения подсвечиваются, а ветки на пути к ним раскрываются.
     */
    search?: string
}

/** Действие правой кнопки над узлом дерева. */
export interface INodeMenuRequest {
    x: number
    y: number
    path: string
    value: unknown
}

const AUTO_COLLAPSE_SIZE = 100
const INDENT_PX = 14

/**
 * Длина строкового значения, после которой оно сворачивается.
 *
 * Токены и подписи занимают сотни символов: развёрнутыми они вытесняют с экрана
 * все остальные поля ответа, поэтому по умолчанию показывается только начало.
 */
const STRING_CLAMP = 180

/**
 * С этого числа строк дерево рисуется через виртуализацию. Маленькие ответы
 * (и дерево внутри диалогов) остаются обычным потоком: абсолютное
 * позиционирование там ничего не даёт, а высоту контейнера усложняет.
 */
const VIRTUAL_THRESHOLD = 200
const ESTIMATED_ROW_HEIGHT = 22

/**
 * Просмотрщик JSON-ответа.
 *
 * Дерево сплющивается в список видимых строк, и при большом объёме
 * отрисовываются только строки в окне прокрутки. Свёрнутые ветки в список
 * не попадают вовсе, так что ответ на десятки тысяч узлов открывается
 * мгновенно, а прокрутка не зависит от его размера.
 */
export const JsonViewer = memo(function JsonViewer(props: IJsonViewerProps): React.JSX.Element {
    const [menu, setMenu] = useState<IContextMenuState | undefined>()
    const [expanded, setExpanded] = useState<Map<string, boolean>>(() => new Map())
    const [openStrings, setOpenStrings] = useState<Set<string>>(() => new Set())
    const needle = (props.search ?? '').trim().toLowerCase()
    const onSaveValue = props.onSaveValue
    const t = useT()

    const rows = useMemo(
        () =>
            flattenJson(props.value, expanded, {
                expandDepth: props.defaultExpandDepth ?? 2,
                autoCollapseSize: AUTO_COLLAPSE_SIZE,
                needle,
                rootPath: props.rootPath ?? '',
            }),
        [props.value, expanded, needle, props.defaultExpandDepth, props.rootPath],
    )

    const toggle = useCallback((row: IJsonRow) => {
        setExpanded((current) => {
            const next = new Map(current)
            next.set(row.path || '$', !row.expanded)

            return next
        })
    }, [])

    const toggleString = useCallback((path: string) => {
        setOpenStrings((current) => {
            const next = new Set(current)
            if (next.has(path)) next.delete(path)
            else next.add(path)

            return next
        })
    }, [])

    /**
     * Меню правой кнопки для узла.
     *
     * Копируется всегда полное значение, даже если на экране оно свёрнуто:
     * иначе в буфер попадал бы обрезанный токен.
     */
    const openMenu = useCallback((request: INodeMenuRequest) => {
        const raw =
            typeof request.value === 'string'
                ? request.value
                : JSON.stringify(request.value, null, 2)

        const items = [
            ...(onSaveValue && typeof request.value === 'string'
                ? [
                      {
                          label: t('Save to environment variable…'),
                          hint: t('for {{substitution}}'),
                          run: () => onSaveValue({ path: request.path, value: request.value as string }),
                      },
                  ]
                : []),
            {
                label: t('Copy value'),
                separated: onSaveValue !== undefined,
                run: () => navigator.clipboard.writeText(raw ?? ''),
            },
        ]

        setMenu({
            x: request.x,
            y: request.y,
            items: [
                ...items,
                {
                    label: t('Copy as JSON'),
                    run: () =>
                        navigator.clipboard.writeText(JSON.stringify(request.value, null, 2) ?? ''),
                },
                {
                    label: t('Copy path'),
                    hint: request.path || t('root'),
                    run: () => navigator.clipboard.writeText(request.path),
                },
                {
                    label: t('Copy “path: value”'),
                    separated: true,
                    run: () => navigator.clipboard.writeText(`${request.path}: ${raw ?? ''}`),
                },
            ],
        })
    }, [onSaveValue, t])

    const rowProps = {
        needle,
        onPickPath: props.onPickPath,
        onMenu: openMenu,
        onToggle: toggle,
        openStrings,
        onToggleString: toggleString,
    }

    return (
        <div className="json-viewer mono selectable">
            {rows.length > VIRTUAL_THRESHOLD ? (
                <VirtualRows rows={rows} rowProps={rowProps} />
            ) : (
                rows.map((row) => <JsonRow key={row.key} row={row} {...rowProps} />)
            )}

            <ContextMenu menu={menu} onClose={() => setMenu(undefined)} />
        </div>
    )
})

interface IRowProps {
    needle: string
    onPickPath?: (path: string, modifiers: { alt: boolean }) => void
    onMenu: (request: INodeMenuRequest) => void
    onToggle: (row: IJsonRow) => void
    openStrings: ReadonlySet<string>
    onToggleString: (path: string) => void
}

/**
 * Виртуальный список строк.
 *
 * Прокручивает ближайший предок с `overflow: auto` — панель ответа, а не
 * само дерево: так у дерева нет собственной высоты, и оно ведёт себя как
 * обычный блок в потоке вместе с плашками выше.
 */
function VirtualRows({ rows, rowProps }: { rows: IJsonRow[]; rowProps: IRowProps }): React.JSX.Element {
    const containerRef = useRef<HTMLDivElement>(null)
    const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null)
    const [scrollMargin, setScrollMargin] = useState(0)

    // Смещение дерева внутри прокручиваемой панели: над ним лежат плашки и
    // блок ошибок переменной высоты. `offsetTop` считал бы от positioned-предка,
    // а не от панели, и окно строк уезжало бы на высоту плашек.
    useLayoutEffect(() => {
        const container = containerRef.current
        const parent = findScrollParent(container)
        setScrollElement(parent)
        if (!container || !parent) return

        function measure(): void {
            if (!container || !parent) return
            const offset =
                container.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop
            setScrollMargin(Math.max(0, Math.round(offset)))
        }

        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(parent)
        for (const sibling of Array.from(parent.querySelectorAll(':scope > * > *'))) {
            if (sibling !== container && sibling instanceof HTMLElement) observer.observe(sibling)
        }

        return () => observer.disconnect()
    }, [])

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollElement,
        estimateSize: () => ESTIMATED_ROW_HEIGHT,
        overscan: 20,
        scrollMargin,
        getItemKey: (index) => rows[index]?.key ?? index,
    })

    const items = virtualizer.getVirtualItems()

    // Без прокручиваемого предка (дерево в диалоге без overflow) виртуализация
    // невозможна — рисуем обычным потоком, чтобы ничего не пропало.
    if (!scrollElement) {
        return (
            <div ref={containerRef}>
                {rows.map((row) => (
                    <JsonRow key={row.key} row={row} {...rowProps} />
                ))}
            </div>
        )
    }

    return (
        <div ref={containerRef} style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {items.map((item) => {
                const row = rows[item.index]
                if (!row) return null

                return (
                    <div
                        key={item.key}
                        data-index={item.index}
                        ref={virtualizer.measureElement}
                        style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
                        }}
                    >
                        <JsonRow row={row} {...rowProps} />
                    </div>
                )
            })}
        </div>
    )
}

function findScrollParent(element: HTMLElement | null): HTMLElement | null {
    let current = element?.parentElement ?? null
    while (current) {
        const overflow = getComputedStyle(current).overflowY
        if (overflow === 'auto' || overflow === 'scroll') return current
        current = current.parentElement
    }

    return null
}

/** Одна строка дерева: скаляр, открывающая или закрывающая скобка. */
function JsonRow(props: { row: IJsonRow } & IRowProps): React.JSX.Element {
    const { row, needle, onPickPath, onMenu, onToggle } = props
    const indent = { paddingLeft: row.depth * INDENT_PX }

    function handleContextMenu(event: React.MouseEvent): void {
        event.preventDefault()
        event.stopPropagation()
        onMenu({ x: event.clientX, y: event.clientY, path: row.path, value: row.value })
    }

    const openBrace = row.isArray ? '[' : '{'
    const closeBrace = row.isArray ? ']' : '}'

    if (row.kind === 'close') {
        // Колонка под шеврон есть и здесь: без неё закрывающая скобка вставала
        // не под открывающую, а левее.
        return (
            <div className="json-row" style={indent}>
                <span className="json-gutter" />
                <span className="json-brace">{closeBrace}</span>
            </div>
        )
    }

    if (row.kind === 'scalar') {
        return (
            <div className="json-row" style={indent} onContextMenu={handleContextMenu}>
                <span className="json-gutter" />
                <JsonLabel label={row.label} needle={needle} />
                <JsonScalar
                    value={row.value}
                    needle={needle}
                    expanded={props.openStrings.has(row.path)}
                    onToggle={() => props.onToggleString(row.path)}
                />
                <PickPathButton path={row.path} onPick={onPickPath} />
            </div>
        )
    }

    if (row.kind === 'empty') {
        // Пустой контейнер печатается одной строкой: раскрывать в нём нечего.
        return (
            <div className="json-row" style={indent} onContextMenu={handleContextMenu}>
                <span className="json-gutter" />
                <JsonLabel label={row.label} needle={needle} />
                <span className="json-brace">
                    {openBrace}
                    {closeBrace}
                </span>
                <PickPathButton path={row.path} onPick={onPickPath} />
            </div>
        )
    }

    return (
        <div
            className="json-row json-row--clickable"
            style={indent}
            onClick={() => onToggle(row)}
            onContextMenu={handleContextMenu}
        >
            <span className="json-gutter">
                <span className={`json-chevron${row.expanded ? ' json-chevron--open' : ''}`}>▶</span>
            </span>
            <JsonLabel label={row.label} needle={needle} />
            <span className="json-brace">{row.expanded ? openBrace : `${openBrace} … ${closeBrace}`}</span>
            {!row.expanded && (
                <span className="json-hint">
                    {row.childCount} {plural(row.childCount, row.isArray ? 'item|items' : 'field|fields')}
                </span>
            )}
            {needle.length > 0 && row.visibleCount < row.childCount && (
                <span className="json-hint">
                    {translate('{shown} of {total}', { shown: row.visibleCount, total: row.childCount })}
                </span>
            )}
            <PickPathButton path={row.path} onPick={onPickPath} />
        </div>
    )
}

/** Кнопка «взять этот путь»; появляется при наведении на строку. */
function PickPathButton(props: {
    path: string
    onPick: ((path: string, modifiers: { alt: boolean }) => void) | undefined
}): React.JSX.Element | null {
    if (!props.onPick || props.path.length === 0) return null

    return (
        <button
            type="button"
            className="json-pick"
            title={translate('Take path: {path}', { path: props.path })}
            onClick={(event) => {
                event.stopPropagation()
                props.onPick?.(props.path, { alt: event.altKey })
            }}
        >
            ↧
        </button>
    )
}

/**
 * Подпись узла: элементы массива подписываются порядковым номером, а не
 * ключом — индекс показывается приглушённо и без двоеточия.
 */
function JsonLabel({
    label,
    needle,
}: {
    label: IJsonRow['label']
    needle: string
}): React.JSX.Element | null {
    if (!label) return null

    return label.kind === 'index' ? (
        <span className="json-index">{label.text}</span>
    ) : (
        <span className="json-key">
            <Highlighted text={label.text} needle={needle} />
        </span>
    )
}

/** Текст с подсвеченными вхождениями поисковой подстроки. */
function Highlighted({ text, needle }: { text: string; needle: string }): React.JSX.Element {
    if (needle.length === 0) return <>{text}</>

    return (
        <>
            {highlightParts(text, needle).map((part, index) =>
                part.match ? (
                    <mark key={index} className="json-match">
                        {part.text}
                    </mark>
                ) : (
                    <span key={index}>{part.text}</span>
                ),
            )}
        </>
    )
}

function JsonScalar(props: {
    value: unknown
    needle: string
    expanded: boolean
    onToggle: () => void
}): React.JSX.Element {
    const { value, needle } = props
    if (value === null) return <span className="json-null">null</span>
    if (typeof value === 'string') {
        return (
            <JsonString value={value} needle={needle} expanded={props.expanded} onToggle={props.onToggle} />
        )
    }
    if (typeof value === 'number') {
        return (
            <span className="json-number">
                <Highlighted text={String(value)} needle={needle} />
            </span>
        )
    }
    if (typeof value === 'boolean') return <span className="json-bool">{String(value)}</span>

    // Сюда попадают только нестандартные значения (например, symbol из
    // самодельного парсера) — показываем их через JSON, а не через `[object Object]`.
    return <span className="json-value">{JSON.stringify(value) ?? 'undefined'}</span>
}

/**
 * Строковое значение.
 *
 * Длинные строки показываются началом и разворачиваются по клику: целиком они
 * занимают десятки строк и прячут остальной ответ. Раскрытые строки помнит
 * родитель — при виртуализации строка вне окна размонтируется.
 */
function JsonString(props: {
    value: string
    needle: string
    expanded: boolean
    onToggle: () => void
}): React.JSX.Element {
    const { value, needle } = props

    // Совпадение может лежать за границей обрезки: показать начало строки и
    // сообщить «найдено» было бы враньём, поэтому такая строка разворачивается.
    const matchBeyondClamp =
        needle.length > 0 && value.toLowerCase().indexOf(needle) >= STRING_CLAMP
    const long = value.length > STRING_CLAMP && !matchBeyondClamp

    if (!long || props.expanded) {
        return (
            <span
                className="json-string json-value"
                onClick={long ? props.onToggle : undefined}
                title={long ? translate('Collapse value') : undefined}
            >
                &quot;
                <Highlighted text={value} needle={needle} />
                &quot;
            </span>
        )
    }

    return (
        <span className="json-string json-value">
            &quot;
            <Highlighted text={value.slice(0, STRING_CLAMP)} needle={needle} />
            <button
                type="button"
                className="json-more"
                onClick={(event) => {
                    event.stopPropagation()
                    props.onToggle()
                }}
                title={translate('Show whole value')}
            >
                {translate('…{n} more', { n: value.length - STRING_CLAMP })}
            </button>
            &quot;
        </span>
    )
}
