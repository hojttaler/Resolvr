import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'

import type { IRunResult, IVariableProblem } from '@resolvr/core'

import { copyText } from '../lib/clipboard.js'
import { t as translate, tn, useT } from '../i18n/index.js'
import { isModKey, kbd } from '../lib/keys.js'
import { SELECT_ALL_EVENT } from '../lib/select-all.js'
import { extractOperationName, selectActiveEnvironment, useAppStore, type ITabRun } from '../state/store.js'
import { countMatches } from './json-search.js'
import { JsonViewer } from './JsonViewer.js'
import { SaveValueDialog } from './SaveValueDialog.js'

const RESPONSE_TABS = [
    { id: 'response', label: 'Response' },
    { id: 'raw', label: 'Raw' },
    { id: 'headers', label: 'Headers' },
    { id: 'trace', label: 'Trace' },
] as const

type IResponseView = (typeof RESPONSE_TABS)[number]['id']

/** Панель результата: данные, ошибки, заголовки и тайминги. */
export function ResponsePane(): React.JSX.Element {
    const activeTabId = useAppStore((state) => state.activeTabId)
    const tab = useAppStore((state) => state.tabs.find((item) => item.id === state.activeTabId))
    const run = useAppStore((state) => (state.activeTabId ? state.runs[state.activeTabId] : undefined))
    const setResponseTab = useAppStore((state) => state.setResponseTab)
    const expandDepth = useAppStore((state) => state.settings.response.expandDepth)
    const [saving, setSaving] = useState<{ path: string; value: unknown } | undefined>()
    const [search, setSearch] = useState('')
    const [searchOpen, setSearchOpen] = useState(false)
    const [allSelected, setAllSelected] = useState(false)
    const [copied, setCopied] = useState(false)
    const searchInput = useRef<HTMLInputElement>(null)
    const body = useRef<HTMLDivElement>(null)
    const t = useT()

    const view = tab?.responseTab ?? 'response'
    const canCopy = run !== undefined && (run.status === 'done' ? run.result !== undefined : run.events.length > 0)

    // Поиск по большому ответу обходит всё дерево: ввод не должен ждать
    // этого обхода на каждой букве.
    const deferredSearch = useDeferredValue(search)
    const needle = deferredSearch.trim().toLowerCase()
    const matches = useMemo(
        () =>
            searchOpen
                ? countMatches({ data: run?.result?.data, errors: run?.result?.errors }, needle)
                : 0,
        [searchOpen, run?.result?.data, run?.result?.errors, needle],
    )

    /**
     * «Выделить всё» в ответе.
     *
     * Сырой ответ — обычный текст, и выделяется нативно. Дерево JSON
     * виртуализировано и обрезает длинные строки, поэтому нативное выделение
     * захватило бы только видимый кусок: выделение показывается подсветкой,
     * а ⌘C копирует полный текст ответа.
     */
    function selectAll(): void {
        // Обрезанный сырой ответ выделяется так же, как дерево: нативное
        // выделение захватило бы только показанное начало.
        const pre = body.current?.querySelector('pre')
        const clipped = (run?.result?.body.length ?? 0) > RAW_RENDER_LIMIT
        if (view === 'raw' && pre && !clipped) {
            window.getSelection()?.selectAllChildren(pre)

            return
        }

        window.getSelection()?.removeAllRanges()
        setAllSelected(true)
    }

    // Текст собирается только по запросу: сериализация большого ответа на
    // каждой перерисовке стоила бы сотни мегабайт.
    async function copy(): Promise<void> {
        const text = responseText(view, run)
        if (text === undefined) return

        if (!(await copyText(text))) return
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
    }

    // Выделение относится к конкретному содержимому: при смене вкладки
    // ответа или нового запуска оно снимается.
    useEffect(() => {
        setAllSelected(false)
    }, [activeTabId, view, run])

    useEffect(() => {
        const element = body.current
        if (!element) return undefined

        const onSelectAll = (): void => selectAll()
        element.addEventListener(SELECT_ALL_EVENT, onSelectAll)

        return () => element.removeEventListener(SELECT_ALL_EVENT, onSelectAll)
    })

    // ⌘F ищет по ответу, но только когда фокус не в редакторе: там это
    // сочетание принадлежит поиску по тексту запроса.
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (event.key !== 'f' || !isModKey(event)) return

            // Цель события — не всегда элемент: при отсутствии фокуса им
            // оказывается сам документ, у которого нет `closest`.
            const target = event.target
            if (target instanceof HTMLElement && target.closest('.cm-editor')) return

            event.preventDefault()
            setSearchOpen(true)
            searchInput.current?.focus()
            searchInput.current?.select()
        }

        window.addEventListener('keydown', onKeyDown)

        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    // Поиск относится к конкретному ответу: при переходе на другую вкладку
    // прежний запрос фильтровал бы чужие данные.
    useEffect(() => {
        setSearch('')
    }, [activeTabId])

    if (!activeTabId || !tab) return <div className="empty">{t('No active tab')}</div>

    return (
        <div className="panel">
            <div className="panel__header">
                <div className="segmented">
                    {RESPONSE_TABS.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`segmented__item${
                                tab.responseTab === item.id ? ' segmented__item--active' : ''
                            }`}
                            onClick={() => setResponseTab(activeTabId, item.id)}
                        >
                            {t(item.label)}
                        </button>
                    ))}
                </div>

                <span className="panel__spacer" />

                <button
                    type="button"
                    className="btn btn--quiet"
                    disabled={!canCopy}
                    onClick={() => void copy()}
                    title={t('Copy the whole tab content')}
                >
                    {copied ? t('Copied') : t('Copy')}
                </button>

                <button
                    type="button"
                    className={`btn btn--quiet btn--icon${searchOpen ? ' btn--on' : ''}`}
                    onClick={() => {
                        setSearchOpen((current) => !current)
                        if (!searchOpen) window.setTimeout(() => searchInput.current?.focus(), 0)
                    }}
                    title={t('Search response ({keys})', { keys: kbd('F') })}
                    aria-label={t('Search response')}
                >
                    <SearchIcon />
                </button>

                <ResponseStatus run={run} />
            </div>

            {searchOpen && (
                <SearchBar
                    inputRef={searchInput}
                    value={search}
                    matches={matches}
                    onChange={setSearch}
                    onClose={() => {
                        setSearchOpen(false)
                        setSearch('')
                    }}
                />
            )}

            <SavedVariablesNotice result={run?.result} />

            <div
                ref={body}
                className={`panel__content response-body${allSelected ? ' response-body--all-selected' : ''}`}
                tabIndex={0}
                data-select-all=""
                onMouseDown={() => setAllSelected(false)}
                onKeyDown={(event) => {
                    // Поле поиска и прочие поля ввода внутри панели выделяют
                    // собственный текст.
                    if (event.target instanceof HTMLInputElement) return

                    if (event.key === 'Escape') {
                        setAllSelected(false)

                        return
                    }
                    if (!isModKey(event.nativeEvent)) return

                    if (event.key === 'a') {
                        event.preventDefault()
                        selectAll()
                    } else if (event.key === 'c' && allSelected) {
                        event.preventDefault()
                        void copy()
                    }
                }}
            >
                <ResponseBody
                    run={run}
                    view={tab.responseTab}
                    expandDepth={expandDepth}
                    search={deferredSearch}
                    onSaveValue={setSaving}
                />
            </div>

            {saving && (
                <SaveValueDialog
                    path={saving.path}
                    value={saving.value}
                    onClose={() => setSaving(undefined)}
                />
            )}
        </div>
    )
}

function ResponseStatus({ run }: { run: ITabRun | undefined }): React.JSX.Element | null {
    const t = useT()
    if (!run) return null

    if (run.status === 'running') return <span className="badge">{t('running…')}</span>
    if (run.status === 'streaming') {
        return (
            <span className="row">
                <span className="statusbar__dot statusbar__dot--live" />
                <span className="badge">{tn(run.events.length, 'event|events')}</span>
            </span>
        )
    }
    if (run.status === 'invalid') return <span className="badge badge--fail">{t('not sent')}</span>
    if (run.status === 'error') return <span className="badge badge--fail">{t('error')}</span>
    if (!run.result) return null

    const { result } = run

    return (
        <span className="row">
            <span className={`badge ${result.ok ? 'badge--ok' : 'badge--fail'}`}>
                {result.status}
            </span>
            <span className="badge">{t('{n} ms', { n: Math.round(result.durationMs) })}</span>
            <span className="badge">{formatBytes(result.responseBytes)}</span>
            {result.errors && result.errors.length > 0 && (
                <span className="badge badge--fail">{tn(result.errors.length, 'error|errors')}</span>
            )}
        </span>
    )
}

interface IResponseBodyProps {
    run: ITabRun | undefined
    view: IResponseView
    expandDepth: number
    search: string
    onSaveValue: (input: { path: string; value: unknown }) => void
}

function ResponseBody({
    run,
    view,
    expandDepth,
    search,
    onSaveValue,
}: IResponseBodyProps): React.JSX.Element {
    if (!run || run.status === 'idle') {
        return <IdleResponse />
    }

    if (run.status === 'invalid') {
        return <InvalidVariables problems={run.problems ?? []} />
    }

    if (run.status === 'error') {
        return (
            <div className="empty selectable" style={{ color: 'var(--danger)', textAlign: 'left' }}>
                {run.error}
            </div>
        )
    }

    // Поток подписки показывается как лог событий: последнее сверху, чтобы
    // не приходилось прокручивать за каждым новым сообщением.
    if (run.status === 'streaming' || run.events.length > 0) {
        if (run.events.length === 0) {
            return <div className="empty">{translate('Subscription active, no events yet…')}</div>
        }

        return (
            <div style={{ padding: 'var(--pad-sm) var(--pad-md)' }}>
                {[...run.events].reverse().map((event, index) => (
                    <div key={`${event.at}-${index}`} className="event">
                        <div className="event__time mono">
                            {new Date(event.at).toLocaleTimeString()}
                        </div>
                        <JsonViewer
                            value={event.payload}
                            defaultExpandDepth={expandDepth}
                            onSaveValue={onSaveValue}
                        />
                    </div>
                ))}
            </div>
        )
    }

    if (run.status === 'running' || !run.result) {
        return <div className="empty">{translate('Request is running…')}</div>
    }

    const { result } = run

    if (view === 'raw') return <RawBody body={result.body} />

    if (view === 'headers') {
        return (
            <div style={{ padding: 'var(--pad-sm) var(--pad-md)' }}>
                <JsonViewer value={result.headers} defaultExpandDepth={expandDepth} />
            </div>
        )
    }

    if (view === 'trace') {
        return (
            <div style={{ padding: 'var(--pad-sm) var(--pad-md)' }}>
                <JsonViewer value={traceOf(result)} defaultExpandDepth={expandDepth} />
            </div>
        )
    }

    return (
        <div style={{ padding: 'var(--pad-sm) var(--pad-md)' }}>
            {result.unresolvedHeaders && result.unresolvedHeaders.length > 0 && (
                <UnresolvedHeadersNotice headers={result.unresolvedHeaders} />
            )}

            {result.errors &&
                result.errors.length > 0 &&
                // При активном поиске блок ошибок скрывается, если совпадений
                // в нём нет: иначе он занимает экран целиком и прячет результат.
                (search.trim().length === 0 ||
                    countMatches(result.errors, search.trim().toLowerCase()) > 0) && (
                    <div className="errors">
                        <div className="errors__title">{translate('GraphQL errors')}</div>
                        <JsonViewer
                            value={result.errors}
                            defaultExpandDepth={expandDepth + 1}
                            search={search}
                        />
                    </div>
                )}

            {result.data === undefined ? (
                <RawBody body={result.body} />
            ) : (
                <JsonViewer
                    value={result.data}
                    defaultExpandDepth={expandDepth}
                    rootPath="data"
                    search={search}
                    onSaveValue={onSaveValue}
                />
            )}
        </div>
    )
}

/**
 * Предупреждение о заголовках, ушедших без значения.
 *
 * Причина почти всегда одна — не получен токен, поэтому починка предлагается
 * прямо здесь: возвращаться за ней в шапку окна или в настройки не нужно.
 */
function UnresolvedHeadersNotice({ headers }: { headers: string[] }): React.JSX.Element {
    const refreshToken = useAppStore((state) => state.refreshToken)
    const refreshing = useAppStore((state) => state.tokenRefreshing)
    const setDialog = useAppStore((state) => state.setDialog)
    const t = useT()

    const environment = useAppStore(selectActiveEnvironment)
    const canRefresh = Boolean(environment?.recovery?.flowId)

    return (
        <div className="notice">
            <b>{t('Request sent without headers:')}</b>{' '}
            <span className="mono">{headers.join(', ')}</span>
            <div className="inspector__hint">
                {canRefresh
                    ? t('Their values contain unresolved variables: the token has not been obtained yet or has expired.')
                    : t('Their values contain unresolved variables, and no token flow is selected.')}
            </div>

            <div className="row" style={{ marginTop: 'var(--pad-sm)' }}>
                {canRefresh && (
                    <button
                        type="button"
                        className="btn btn--primary"
                        disabled={refreshing}
                        onClick={() => void refreshToken()}
                    >
                        {refreshing ? t('Getting token…') : t('Get token')}
                    </button>
                )}
                <button
                    type="button"
                    className="btn"
                    onClick={() => setDialog('workspaceSettings')}
                >
                    {t('Configure authorization…')}
                </button>
            </div>
        </div>
    )
}

/**
 * Строка поиска по ответу.
 *
 * Показывает число совпадений: без счётчика пустой экран после ввода
 * неотличим от сломанного фильтра.
 */
function SearchBar(props: {
    inputRef: React.RefObject<HTMLInputElement | null>
    value: string
    matches: number
    onChange: (value: string) => void
    onClose: () => void
}): React.JSX.Element {
    const active = props.value.trim().length > 0
    const t = useT()

    return (
        <div className="searchbar">
            <input
                ref={props.inputRef}
                className="input searchbar__input"
                value={props.value}
                placeholder={t('Search response: field or value')}
                onChange={(event) => props.onChange(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === 'Escape') props.onClose()
                }}
            />

            <span
                className={`searchbar__count${active && props.matches === 0 ? ' searchbar__count--empty' : ''}`}
                title={t('Number of response rows with a match')}
            >
                {active ? tn(props.matches, 'row|rows') : t('whole response')}
            </span>

            <button type="button" className="btn btn--quiet" onClick={props.onClose}>
                {t('Close')}
            </button>
        </div>
    )
}

/** Лупа: значок кнопки поиска в шапке панели. */
function SearchIcon(): React.JSX.Element {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="4.2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M10.2 10.2 13.6 13.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
    )
}

/**
 * Запрос не отправлен: переменные не прошли проверку.
 *
 * Показывается вместо ответа — это дешевле круга до сервера и обратно, а
 * причина видна сразу и с путём до конкретного поля.
 */
function InvalidVariables({ problems }: { problems: IVariableProblem[] }): React.JSX.Element {
    const runActiveTab = useAppStore((state) => state.runActiveTab)
    const setBottomTab = useAppStore((state) => state.setBottomTab)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const t = useT()

    return (
        <div style={{ padding: 'var(--pad-md)' }}>
            <div className="errors">
                <div className="errors__title">{t('Request not sent')}</div>
                {problems.map((problem) => (
                    <div key={problem.path} className="problem">
                        <span className="mono problem__path">{problem.path}</span>
                        <span>{problem.message}</span>
                    </div>
                ))}
            </div>

            <div className="row" style={{ marginTop: 'var(--pad-md)' }}>
                <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => {
                        if (activeTabId) setBottomTab(activeTabId, 'variables')
                    }}
                >
                    {t('To variables')}
                </button>
                <button
                    type="button"
                    className="btn"
                    onClick={() => void runActiveTab({ force: true })}
                    title={t('Send the request despite the warnings')}
                >
                    {t('Run anyway')}
                </button>
            </div>
        </div>
    )
}

/**
 * Пустое состояние панели ответа.
 *
 * Панель занимает треть окна и до первого запуска простаивала. Здесь показаны
 * последние запуски текущей операции: видно, работала ли она раньше, сколько
 * занимала и с каким статусом — по клику запуск открывается отдельной вкладкой.
 */
function IdleResponse(): React.JSX.Element {
    const history = useAppStore((state) => state.history)
    const tabs = useAppStore((state) => state.tabs)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const contents = useAppStore((state) => state.contents)
    const openHistoryEntry = useAppStore((state) => state.openHistoryEntry)
    const t = useT()

    const activeTab = tabs.find((item) => item.id === activeTabId)
    const operationName = activeTab
        ? extractOperationName(contents[activeTab.id]?.query ?? '')
        : undefined

    const related = history
        .filter((entry) => (operationName ? entry.operationName === operationName : true))
        .slice(0, 8)

    return (
        <div className="idle">
            <div className="idle__hint">
                {t('Run — {keys}', { keys: kbd('Enter') })}
            </div>

            {related.length > 0 && (
                <>
                    <div className="settings__caption">
                        {operationName ? t('Recent runs of {name}', { name: operationName }) : t('Recent runs')}
                    </div>

                    <div className="idle__list">
                        {related.map((entry) => (
                            <div
                                key={entry.id}
                                className="idle__row"
                                title={entry.responsePreview}
                                onClick={() => void openHistoryEntry(entry)}
                            >
                                <span className={`badge ${entry.ok ? 'badge--ok' : 'badge--fail'}`}>
                                    {entry.status}
                                </span>
                                <span className="idle__time">
                                    {new Date(entry.ts).toLocaleTimeString()}
                                </span>
                                <span className="badge">{t('{n} ms', { n: Math.round(entry.durationMs) })}</span>
                                {entry.errorCount > 0 && (
                                    <span className="badge badge--fail">
                                        {tn(entry.errorCount, 'error|errors')}
                                    </span>
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}

/**
 * Плашка о переменных, сохранённых в окружение правилами операции.
 *
 * Без неё автосохранение было бы незаметным, а пропущенный путь в ответе
 * обнаруживался бы только по нераскрытой переменной в следующем запросе.
 */
function SavedVariablesNotice({ result }: { result: IRunResult | undefined }): React.JSX.Element | null {
    const t = useT()
    if (!result?.savedVariables && !result?.captureWarnings) return null

    return (
        <div className="notice notice--compact">
            {result.savedVariables && (
                <div>
                    {t('Saved to environment:')}{' '}
                    <span className="mono">
                        {result.savedVariables.map((item) => item.name).join(', ')}
                    </span>
                </div>
            )}
            {result.captureWarnings?.map((warning) => (
                <div key={warning} className="inspector__hint">
                    {warning}
                </div>
            ))}
        </div>
    )
}

/** Сведения о запросе для вкладки Trace. */
function traceOf(result: IRunResult): Record<string, unknown> {
    return {
        endpointId: result.endpointId,
        environmentId: result.environmentId,
        kind: result.kind,
        status: `${result.status} ${result.statusText}`,
        totalMs: Math.round(result.durationMs),
        firstByteMs: result.firstByteMs ? Math.round(result.firstByteMs) : undefined,
        responseBytes: result.responseBytes,
        requestHeaders: result.requestHeaders,
    }
}

/**
 * Полный текст вкладки ответа — для копирования.
 *
 * Берётся из данных, а не из отрисованного дерева: на экране длинные строки
 * обрезаны и свёрнутые ветки отсутствуют.
 */
function responseText(view: IResponseView, run: ITabRun | undefined): string | undefined {
    if (run?.status === 'streaming' || (run && run.events.length > 0)) {
        return JSON.stringify(
            run.events.map((event) => event.payload),
            null,
            2,
        )
    }

    const result = run?.result
    if (!result || run.status !== 'done') return undefined

    switch (view) {
        case 'raw':
            return formatRaw(result.body)
        case 'headers':
            return JSON.stringify(result.headers, null, 2)
        case 'trace':
            return JSON.stringify(traceOf(result), null, 2)
        case 'response':
            if (result.data === undefined) return formatRaw(result.body)

            return JSON.stringify(
                result.errors && result.errors.length > 0
                    ? { data: result.data, errors: result.errors }
                    : result.data,
                null,
                2,
            )
    }
}

/**
 * Сырое тело ответа.
 *
 * Текст в десятки мегабайт одним узлом WebKit раскладывает целиком и может
 * исчерпать память процесса страницы, поэтому показывается начало, а весь
 * текст — по кнопке. Копирование всегда берёт полный текст.
 */
function RawBody({ body }: { body: string }): React.JSX.Element {
    const [full, setFull] = useState(false)
    const t = useT()
    const text = useMemo(() => formatRaw(body), [body])

    useEffect(() => setFull(false), [body])

    const clipped = !full && text.length > RAW_RENDER_LIMIT

    return (
        <>
            <pre className="raw mono selectable">{clipped ? text.slice(0, RAW_RENDER_LIMIT) : text}</pre>
            {clipped && (
                <div className="row" style={{ padding: 'var(--pad-sm) var(--pad-md)' }}>
                    <span className="inspector__hint">
                        {t('Showing the first {shown} of {total}', {
                            shown: formatBytes(RAW_RENDER_LIMIT),
                            total: formatBytes(text.length),
                        })}
                    </span>
                    <button type="button" className="btn btn--quiet" onClick={() => setFull(true)}>
                        {t('Show all')}
                    </button>
                </div>
            )}
        </>
    )
}

/** Сколько символов сырого ответа рисовать без явного запроса. */
const RAW_RENDER_LIMIT = 1024 * 1024

/**
 * С этого размера тело не переформатируется: красивый JSON вдвое длиннее
 * исходного и ради показа удваивал бы память.
 */
const RAW_FORMAT_LIMIT = 5_000_000

/** Форматирует тело ответа, если это JSON; иначе показывает как есть. */
function formatRaw(body: string): string {
    if (body.length > RAW_FORMAT_LIMIT) return body

    try {
        return JSON.stringify(JSON.parse(body), null, 2)
    } catch {
        return body
    }
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return translate('{n} B', { n: bytes })
    if (bytes < 1024 * 1024) return translate('{n} KB', { n: (bytes / 1024).toFixed(1) })

    return translate('{n} MB', { n: (bytes / (1024 * 1024)).toFixed(1) })
}
