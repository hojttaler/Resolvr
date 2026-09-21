import { memo, useCallback, useState } from 'react'

import { plural, t as translate, useT } from '../i18n/index.js'
import { ContextMenu, type IContextMenuState } from './ContextMenu.js'
import { highlightParts, subtreeMatches } from './json-search.js'

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
 * Просмотрщик JSON-ответа.
 *
 * Узлы разворачиваются лениво: свёрнутая ветка не создаёт DOM-элементов вовсе.
 * Благодаря этому ответ на десятки тысяч узлов открывается мгновенно — в
 * отличие от подсветки всего тела как одного текстового блока.
 */
export const JsonViewer = memo(function JsonViewer(props: IJsonViewerProps): React.JSX.Element {
    const [menu, setMenu] = useState<IContextMenuState | undefined>()
    const needle = (props.search ?? '').trim().toLowerCase()
    const onSaveValue = props.onSaveValue
    const t = useT()

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

    return (
        <div className="json-viewer mono selectable">
            <JsonNode
                label={undefined}
                value={props.value}
                depth={0}
                expandDepth={props.defaultExpandDepth ?? 2}
                path={props.rootPath ?? ''}
                onPickPath={props.onPickPath}
                onMenu={openMenu}
                needle={needle}
                root
            />

            <ContextMenu menu={menu} onClose={() => setMenu(undefined)} />
        </div>
    )
})

/**
 * Подпись узла.
 *
 * Элементы массива подписываются порядковым номером, а не ключом: индекс — это
 * позиция, а не имя поля, и рисовать его как `0:` значит выдавать массив за
 * объект. Номер показывается приглушённо и без двоеточия.
 */
interface IJsonLabel {
    text: string
    kind: 'key' | 'index'
}

interface IJsonNodeProps {
    label: IJsonLabel | undefined
    value: unknown
    depth: number
    expandDepth: number
    path: string
    onPickPath?: (path: string, modifiers: { alt: boolean }) => void
    onMenu: (request: INodeMenuRequest) => void
    needle: string
    /** Корень рисуется всегда: пустой результат поиска показывает панель выше. */
    root?: boolean
}

function JsonNode(props: IJsonNodeProps): React.JSX.Element | null {
    const { label, value, depth, expandDepth, path, onPickPath, onMenu, needle } = props

    function handleContextMenu(event: React.MouseEvent): void {
        event.preventDefault()
        event.stopPropagation()
        onMenu({ x: event.clientX, y: event.clientY, path, value })
    }
    const isContainer = value !== null && typeof value === 'object'
    const isArray = Array.isArray(value)

    const entries: Array<readonly [IJsonLabel, unknown]> = isContainer
        ? isArray
            ? (value as unknown[]).map(
                  (item, index) => [{ text: String(index), kind: 'index' }, item] as const,
              )
            : Object.entries(value as Record<string, unknown>).map(
                  ([key, item]) => [{ text: key, kind: 'key' }, item] as const,
              )
        : []

    // Крупные узлы сворачиваются независимо от глубины: разворачивать список из
    // тысячи элементов по умолчанию бессмысленно и дорого.
    const [expanded, setExpanded] = useState(
        depth < expandDepth && entries.length <= AUTO_COLLAPSE_SIZE,
    )

    const searching = needle.length > 0

    if (searching && !props.root && !subtreeMatches(label?.text, value, needle)) return null

    // При поиске ветки раскрыты принудительно: иначе совпадение остаётся
    // спрятанным внутри свёрнутого узла и результат выглядит пустым.
    const open = searching || expanded
    const visible = searching
        ? entries.filter(([itemLabel, item]) => subtreeMatches(itemLabel.text, item, needle))
        : entries

    if (!isContainer) {
        return (
            <div
                className="json-row"
                style={{ paddingLeft: depth * INDENT_PX }}
                onContextMenu={handleContextMenu}
            >
                <span className="json-gutter" />
                <JsonLabel label={label} needle={needle} />
                <JsonScalar value={value} needle={needle} />
                <PickPathButton path={path} onPick={onPickPath} />
            </div>
        )
    }

    const openBrace = isArray ? '[' : '{'
    const closeBrace = isArray ? ']' : '}'

    // Пустой контейнер печатается одной строкой: раскрывать в нём нечего, а
    // отдельная строка под закрывающую скобку заметно растягивает ответ.
    if (entries.length === 0) {
        return (
            <div
                className="json-row"
                style={{ paddingLeft: depth * INDENT_PX }}
                onContextMenu={handleContextMenu}
            >
                <span className="json-gutter" />
                <JsonLabel label={label} needle={needle} />
                <span className="json-brace">
                    {openBrace}
                    {closeBrace}
                </span>
                <PickPathButton path={path} onPick={onPickPath} />
            </div>
        )
    }

    return (
        <div>
            <div
                className="json-row json-row--clickable"
                style={{ paddingLeft: depth * INDENT_PX }}
                onClick={() => setExpanded((current) => !current)}
                onContextMenu={handleContextMenu}
            >
                <span className="json-gutter">
                    <span className={`json-chevron${open ? ' json-chevron--open' : ''}`}>
                        ▶
                    </span>
                </span>
                <JsonLabel label={label} needle={needle} />
                <span className="json-brace">{open ? openBrace : `${openBrace} … ${closeBrace}`}</span>
                {!open && (
                    <span className="json-hint">
                        {entries.length} {plural(entries.length, isArray ? 'item|items' : 'field|fields')}
                    </span>
                )}
                {searching && visible.length < entries.length && (
                    <span className="json-hint">
                        {translate('{shown} of {total}', { shown: visible.length, total: entries.length })}
                    </span>
                )}
                <PickPathButton path={path} onPick={onPickPath} />
            </div>

            {open && (
                <>
                    {visible.map(([itemLabel, item]) => (
                        <JsonNode
                            key={itemLabel.text}
                            label={itemLabel}
                            value={item}
                            depth={depth + 1}
                            expandDepth={expandDepth}
                            path={path.length > 0 ? `${path}.${itemLabel.text}` : itemLabel.text}
                            onPickPath={onPickPath}
                            onMenu={onMenu}
                            needle={needle}
                        />
                    ))}
                    {/* Колонка под шеврон есть и здесь: без неё закрывающая
                        скобка вставала не под открывающую, а левее. */}
                    <div className="json-row" style={{ paddingLeft: depth * INDENT_PX }}>
                        <span className="json-gutter" />
                        <span className="json-brace">{closeBrace}</span>
                    </div>
                </>
            )}
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

function JsonLabel({
    label,
    needle,
}: {
    label: IJsonLabel | undefined
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

function JsonScalar({ value, needle }: { value: unknown; needle: string }): React.JSX.Element {
    if (value === null) return <span className="json-null">null</span>
    if (typeof value === 'string') return <JsonString value={value} needle={needle} />
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
 * занимают десятки строк и прячут остальной ответ.
 */
function JsonString({ value, needle }: { value: string; needle: string }): React.JSX.Element {
    const [expanded, setExpanded] = useState(false)

    // Совпадение может лежать за границей обрезки: показать начало строки и
    // сообщить «найдено» было бы враньём, поэтому такая строка разворачивается.
    const matchBeyondClamp =
        needle.length > 0 && value.toLowerCase().indexOf(needle) >= STRING_CLAMP
    const long = value.length > STRING_CLAMP && !matchBeyondClamp

    if (!long || expanded) {
        return (
            <span
                className="json-string json-value"
                onClick={long ? () => setExpanded(false) : undefined}
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
                    setExpanded(true)
                }}
                title={translate('Show whole value')}
            >
                {translate('…{n} more', { n: value.length - STRING_CLAMP })}
            </button>
            &quot;
        </span>
    )
}
