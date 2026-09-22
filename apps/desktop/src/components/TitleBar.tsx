import { invoke } from '@tauri-apps/api/core'
import { detectOperationKind } from '@resolvr/core'
import { useEffect, useState } from 'react'

import { useT } from '../i18n/index.js'
import { kbd } from '../lib/keys.js'
import { useAppStore } from '../state/store.js'
import { ContextMenu, type IContextMenuState } from './ContextMenu.js'
import { initials, LogoMark } from './Logo.js'

/**
 * Верхняя полоса окна.
 *
 * Заголовок окна скрыт (`titleBarStyle: Overlay`), поэтому эта полоса заменяет
 * его: слева резервируется место под traffic lights, а свободная область
 * работает как зона перетаскивания окна.
 */
export function TitleBar(): React.JSX.Element {
    const workspace = useAppStore((state) => state.workspace)
    const workspaces = useAppStore((state) => state.workspaces)
    const selectWorkspace = useAppStore((state) => state.selectWorkspace)
    const tabs = useAppStore((state) => state.tabs)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const setTabEnvironment = useAppStore((state) => state.setTabEnvironment)
    const setTabEndpoint = useAppStore((state) => state.setTabEndpoint)
    const setPaletteOpen = useAppStore((state) => state.setPaletteOpen)
    const setDialog = useAppStore((state) => state.setDialog)
    const t = useT()

    const activeTab = tabs.find((tab) => tab.id === activeTabId)
    const activeEnvironment = workspace?.environments.find(
        (item) => item.id === (activeTab?.environmentId ?? workspace.defaultEnvironmentId),
    )
    const activeEndpoint = workspace?.endpoints.find(
        (endpoint) => endpoint.id === (activeTab?.endpointId ?? workspace.defaultEndpointId),
    )

    return (
        <div className="titlebar">
            <div
                className="titlebar__drag"
                onMouseDown={(event) => {
                    // Двойной клик по полосе — системное «развернуть окно»,
                    // поэтому перетаскивание запускается только на одиночном.
                    if (event.detail === 1 && event.button === 0) {
                        void invoke('start_window_drag').catch(() => undefined)
                    }
                }}
            >
                <span className="brand" title="Resolvr">
                    <span className="brand__mark">
                        <LogoMark size={15} />
                    </span>
                    Resolvr
                </span>

                <span className="select-with-badge">
                    <span className="ws-badge">{initials(workspace?.name ?? '')}</span>
                    <select
                        className="select"
                        value={workspace?.id ?? ''}
                        onMouseDown={(event) => event.stopPropagation()}
                        onChange={(event) => void selectWorkspace(event.target.value)}
                        title={t('Workspace')}
                    >
                        {workspaces.length === 0 && <option value="">{t('No workspace')}</option>}
                        {workspaces.map((item) => (
                            <option key={item.id} value={item.id}>
                                {item.name}
                            </option>
                        ))}
                    </select>
                </span>

                {activeTab && workspace && workspace.endpoints.length > 1 && (
                    <select
                        className="select"
                        value={activeTab.endpointId ?? workspace.defaultEndpointId ?? ''}
                        onMouseDown={(event) => event.stopPropagation()}
                        onChange={(event) => setTabEndpoint(activeTab.id, event.target.value)}
                        title={t('Endpoint')}
                    >
                        {workspace.endpoints.map((endpoint) => (
                            <option key={endpoint.id} value={endpoint.id}>
                                {endpoint.name}
                            </option>
                        ))}
                    </select>
                )}

                {activeTab && workspace && (
                    <span className="select-with-badge select-with-dot">
                        <span
                            className={`env-dot${activeEnvironment?.production ? ' env-dot--prod' : ''}`}
                        />
                        <select
                            className={`select${activeEnvironment?.production ? ' select--prod' : ''}`}
                            value={activeTab.environmentId ?? workspace.defaultEnvironmentId ?? ''}
                            onMouseDown={(event) => event.stopPropagation()}
                            onChange={(event) => setTabEnvironment(activeTab.id, event.target.value)}
                            title={
                                activeEnvironment?.production
                                    ? t('Production environment: mutations and flows ask for confirmation')
                                    : t('Environment')
                            }
                        >
                            {workspace.environments.map((environment) => (
                                <option key={environment.id} value={environment.id}>
                                    {environment.production
                                        ? `${environment.name} · PROD`
                                        : environment.name}
                                </option>
                            ))}
                        </select>
                    </span>
                )}

                {activeEnvironment?.production && (
                    <span className="badge badge--prod" title={t('Production environment')}>
                        PROD
                    </span>
                )}

                <span className="panel__spacer" />

                {activeEndpoint && (
                    <span className="endpoint-pill" title={activeEndpoint.url}>
                        <LinkIcon />
                        <span className="endpoint-pill__url">{activeEndpoint.url}</span>
                        <LastRunStatus />
                    </span>
                )}
            </div>

            <TokenStatus />

            <button
                type="button"
                className="btn btn--quiet"
                onClick={() => setPaletteOpen(true)}
                title={t('Command palette ({keys})', { keys: kbd('K') })}
            >
                {kbd('K')}
            </button>

            <button
                type="button"
                className="btn btn--quiet btn--icon"
                onClick={() => setDialog('activity')}
                title={t('Agent activity ({keys})', { keys: kbd('Shift+A') })}
                aria-label={t('Agent activity')}
            >
                <AgentIcon />
            </button>

            <button
                type="button"
                className="btn btn--quiet btn--icon"
                onClick={() => setDialog('settings')}
                title={t('Settings ({keys})', { keys: kbd(',') })}
                aria-label={t('Settings')}
            >
                <GearIcon />
            </button>
        </div>
    )
}

/** Итог последнего запуска активной вкладки: точка и время, как «Online 42 ms». */
function LastRunStatus(): React.JSX.Element | null {
    const run = useAppStore((state) => (state.activeTabId ? state.runs[state.activeTabId] : undefined))
    const result = run?.status === 'done' ? run.result : undefined
    const t = useT()
    if (!result) return null

    return (
        <span className="row" style={{ gap: 5 }}>
            <span className={`statusbar__dot ${result.ok ? 'statusbar__dot--ok' : 'statusbar__dot--fail'}`} />
            <span>{t('{n} ms', { n: Math.round(result.durationMs) })}</span>
        </span>
    )
}

function LinkIcon(): React.JSX.Element {
    return (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
                d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.5 2.5 0 013.5 3.5L10.5 8M5.5 8l-1.2 1.2a2.5 2.5 0 003.5 3.5L9 11.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
            />
        </svg>
    )
}

/**
 * Состояние токена окружения.
 *
 * Срок берётся из `exp` последнего полученного JWT. Без индикатора протухший
 * токен обнаруживался только по ошибке очередного запроса.
 */
function TokenStatus(): React.JSX.Element | null {
    const workspace = useAppStore((state) => state.workspace)
    const tabs = useAppStore((state) => state.tabs)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const refreshToken = useAppStore((state) => state.refreshToken)
    const refreshing = useAppStore((state) => state.tokenRefreshing)
    const setDialog = useAppStore((state) => state.setDialog)
    const setSidebarTab = useAppStore((state) => state.setSidebarTab)
    const [now, setNow] = useState(() => Date.now())
    const [menu, setMenu] = useState<IContextMenuState | undefined>()
    const t = useT()

    // Обратный отсчёт обновляется раз в полминуты: чаще незачем, а без этого
    // подпись «истекает через 3 мин» застывала бы до следующего запроса.
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30_000)

        return () => clearInterval(timer)
    }, [])

    const activeTab = tabs.find((tab) => tab.id === activeTabId)
    const environment = workspace?.environments.find(
        (item) => item.id === (activeTab?.environmentId ?? workspace.defaultEnvironmentId),
    )

    const canRefresh = Boolean(environment?.recovery?.flowId)

    // Индикатор показывается всегда, когда выбрано окружение: без цепочки он
    // объясняет, что авторизация не настроена, и ведёт в настройки.
    if (!environment) return null

    const left = environment.tokenExpiresAt
        ? new Date(environment.tokenExpiresAt).getTime() - now
        : undefined

    const state = refreshing
        ? 'unknown'
        : left === undefined
          ? 'unknown'
          : left <= 0
            ? 'expired'
            : left < 5 * 60_000
              ? 'soon'
              : 'fresh'

    const label = refreshing
        ? t('refreshing token…')
        : !canRefresh
          ? t('auth not configured')
          : state === 'unknown'
            ? t('token not obtained')
            : state === 'expired'
              ? t('token expired')
              : t('token {left}', { left: formatLeft(left ?? 0, t) })

    const flowId = environment.recovery?.flowId

    return (
        <>
        <button
            type="button"
            className={`token-status token-status--${state}`}
            onClick={() => (canRefresh ? void refreshToken() : setDialog('workspaceSettings'))}
            onContextMenu={(event) => {
                event.preventDefault()
                setMenu({
                    x: event.clientX,
                    y: event.clientY,
                    items: [
                        {
                            label: canRefresh
                                ? t('Get token: {flow}', { flow: flowId ?? '' })
                                : t('No flow selected'),
                            run: () => (canRefresh ? refreshToken() : setDialog('workspaceSettings')),
                        },
                        {
                            label: t('Configure authorization…'),
                            hint: t('environment'),
                            run: () => setDialog('workspaceSettings'),
                        },
                        {
                            label: t('Show flow'),
                            separated: true,
                            run: () => setSidebarTab('flows'),
                        },
                    ],
                })
            }}
            disabled={refreshing}
            title={
                canRefresh
                    ? t('Click — run flow “{flow}” and save the token. Right-click — configure.', {
                          flow: flowId ?? '',
                      }) +
                      (environment.tokenSubject
                          ? ` ${t('Now: {subject}', { subject: environment.tokenSubject })}`
                          : '')
                    : t('No flow selected. Right-click → “Configure authorization…”')
            }
        >
            <span className="token-status__dot" />
            {label}
        </button>

        <ContextMenu menu={menu} onClose={() => setMenu(undefined)} />
        </>
    )
}

/** Остаток времени в человекочитаемом виде. */
function formatLeft(milliseconds: number, t: ReturnType<typeof useT>): string {
    const minutes = Math.round(milliseconds / 60_000)
    if (minutes < 60) return t('{n} min', { n: minutes })

    return t('{n} h', { n: Math.round(minutes / 60) })
}

/** Значок журнала действий агента: список строк с отметками выполнения. */
function AgentIcon(): React.JSX.Element {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
                d="M2.6 4.2 4 5.6l2.2-2.2M2.6 11.2 4 12.6l2.2-2.2"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            <path
                d="M8.4 4.4h5M8.4 11.4h5M8.4 7.9h3"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
            />
        </svg>
    )
}

/**
 * Шестерёнка.
 *
 * Рисуется зубцами по контуру, а не лучами из центра: вариант с лучами читался
 * как солнце и выглядел переключателем темы.
 */
function GearIcon(): React.JSX.Element {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
                d="M6.9 1.6h2.2l.28 1.62a4.8 4.8 0 0 1 1.06.61l1.54-.6 1.1 1.9-1.25 1.06a4.8 4.8 0 0 1 0 1.22l1.25 1.06-1.1 1.9-1.54-.6a4.8 4.8 0 0 1-1.06.61L9.1 12h-2.2l-.28-1.62a4.8 4.8 0 0 1-1.06-.61l-1.54.6-1.1-1.9 1.25-1.06a4.8 4.8 0 0 1 0-1.22L2.92 5.13l1.1-1.9 1.54.6a4.8 4.8 0 0 1 1.06-.61L6.9 1.6Z"
                stroke="currentColor"
                strokeWidth="1.15"
                strokeLinejoin="round"
            />
            <circle cx="8" cy="6.8" r="1.9" stroke="currentColor" strokeWidth="1.15" />
        </svg>
    )
}

/**
 * Полоса вкладок с индикатором несохранённых изменений.
 *
 * Правая кнопка даёт групповое закрытие — как в браузере и редакторах:
 * после долгой сессии вкладок набирается больше, чем помещается в полосу.
 */
export function TabStrip(): React.JSX.Element {
    const tabs = useAppStore((state) => state.tabs)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const contents = useAppStore((state) => state.contents)
    const activateTab = useAppStore((state) => state.activateTab)
    const closeTab = useAppStore((state) => state.closeTab)
    const closeOtherTabs = useAppStore((state) => state.closeOtherTabs)
    const closeTabsToLeft = useAppStore((state) => state.closeTabsToLeft)
    const closeTabsToRight = useAppStore((state) => state.closeTabsToRight)
    const closeAllTabs = useAppStore((state) => state.closeAllTabs)
    const openTab = useAppStore((state) => state.openTab)
    const [menu, setMenu] = useState<IContextMenuState | undefined>()
    const t = useT()

    function openMenu(event: React.MouseEvent, tabId: string): void {
        event.preventDefault()
        const index = tabs.findIndex((tab) => tab.id === tabId)

        setMenu({
            x: event.clientX,
            y: event.clientY,
            items: [
                { label: t('Close'), hint: kbd('W'), run: () => closeTab(tabId) },
                {
                    label: t('Close others'),
                    disabled: tabs.length < 2,
                    run: () => closeOtherTabs(tabId),
                },
                {
                    label: t('Close to the left'),
                    disabled: index < 1,
                    run: () => closeTabsToLeft(tabId),
                },
                {
                    label: t('Close to the right'),
                    disabled: index >= tabs.length - 1,
                    run: () => closeTabsToRight(tabId),
                },
                { label: t('Close all'), separated: true, run: () => closeAllTabs() },
            ],
        })
    }

    return (
        <div className="tabstrip">
            {tabs.map((tab) => {
                const kind =
                    tab.kind === 'flow'
                        ? 'flow'
                        : tab.kind === 'report'
                          ? 'report'
                          : tab.kind === 'schema'
                            ? 'schema'
                            : cachedOperationKind(contents[tab.id]?.query ?? '')

                return (
                    <div
                        key={tab.id}
                        className={`tab${tab.id === activeTabId ? ' tab--active' : ''}`}
                        onMouseDown={(event) => {
                            // Средняя кнопка закрывает вкладку, как в браузере.
                            if (event.button === 1) {
                                event.preventDefault()
                                void closeTab(tab.id)

                                return
                            }
                            if (event.button === 0) activateTab(tab.id)
                        }}
                        onContextMenu={(event) => openMenu(event, tab.id)}
                        title={
                            tab.operationRef ??
                            (tab.kind === 'flow' ? t('Flow') : tab.kind === 'schema' ? t('Schema') : t('Draft'))
                        }
                    >
                        <span className={`tab__kind tab__kind--${kind}`}>
                            {kind === 'query'
                                ? 'Q'
                                : kind === 'mutation'
                                  ? 'M'
                                  : kind === 'subscription'
                                    ? 'S'
                                    : kind === 'flow'
                                      ? 'F'
                                      : kind === 'schema'
                                        ? 'T'
                                        : 'R'}
                        </span>
                        <span className="tab__label">{tab.title}</span>
                        {tab.dirty ? (
                            <span className="tab__dot" title={t('Unsaved changes')} />
                        ) : null}
                        <button
                            type="button"
                            className="tab__close"
                            onMouseDown={(event) => {
                                event.stopPropagation()
                                if (event.button === 0) void closeTab(tab.id)
                            }}
                            title={t('Close tab ({keys})', { keys: kbd('W') })}
                            aria-label={t('Close')}
                        >
                            <CloseIcon />
                        </button>
                    </div>
                )
            })}

            <button
                type="button"
                className="btn btn--quiet btn--icon"
                style={{ alignSelf: 'center', marginLeft: 4 }}
                onClick={() => void openTab()}
                title={t('New tab ({keys})', { keys: kbd('T') })}
            >
                +
            </button>

            <ContextMenu menu={menu} onClose={() => setMenu(undefined)} />
        </div>
    )
}

/**
 * Плашка «доступна новая версия».
 *
 * Показывается под шапкой, а не диалогом: обновление никогда не срочное, и
 * прерывать работу ради него нельзя. Одна кнопка — скачать, установить и
 * перезапустить.
 */
export function UpdateBanner(): React.JSX.Element | null {
    const update = useAppStore((state) => state.update)
    const progress = useAppStore((state) => state.updateProgress)
    const error = useAppStore((state) => state.updateError)
    const installUpdate = useAppStore((state) => state.installUpdate)
    const dismissUpdate = useAppStore((state) => state.dismissUpdate)
    const t = useT()

    if (!update) return null

    return (
        <div className="update-banner">
            <span>
                {t('Version {version} is available', { version: update.version })}
                {error ? t(' — failed to install: {error}', { error }) : ''}
            </span>
            <span className="panel__spacer" />
            {progress !== undefined && !error ? (
                <span className="inspector__hint">
                    {progress < 1
                        ? t('downloading {percent}%', { percent: Math.round(progress * 100) })
                        : t('installing…')}
                </span>
            ) : (
                <>
                    <button type="button" className="btn btn--quiet" onClick={dismissUpdate}>
                        {t('Later')}
                    </button>
                    <button type="button" className="btn btn--primary" onClick={() => void installUpdate()}>
                        {t('Update and restart')}
                    </button>
                </>
            )}
        </div>
    )
}

/**
 * Род операции по тексту с кэшем.
 *
 * Полоса вкладок перерисовывается на каждое нажатие клавиши, и разбирать
 * GraphQL всех открытых вкладок заново каждый раз незачем: текст меняется
 * только у одной.
 */
const kindCache = new Map<string, ReturnType<typeof detectOperationKind>>()
const KIND_CACHE_LIMIT = 300

function cachedOperationKind(query: string): ReturnType<typeof detectOperationKind> {
    const cached = kindCache.get(query)
    if (cached) return cached

    const kind = detectOperationKind(query)
    if (kindCache.size >= KIND_CACHE_LIMIT) {
        const oldest = kindCache.keys().next().value
        if (oldest !== undefined) kindCache.delete(oldest)
    }
    kindCache.set(query, kind)

    return kind
}

/** Крестик закрытия: SVG вместо символа «×», который в системном шрифте сидит ниже центра. */
function CloseIcon(): React.JSX.Element {
    return (
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            <path
                d="M1.5 1.5l7 7M8.5 1.5l-7 7"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
            />
        </svg>
    )
}
