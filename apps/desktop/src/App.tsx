import { useCallback, useEffect, useState } from 'react'

import { AgentActivity } from './components/AgentActivity.js'
import { ImportDialog } from './components/ImportDialog.js'
import { CommandPalette } from './components/CommandPalette.js'
import {
    CreateWorkspaceDialog,
    ConfirmDialog,
    SaveOperationDialog,
} from './components/Dialogs.js'
import { SettingsDialog } from './components/SettingsDialog.js'
import { WorkspaceSettings } from './components/WorkspaceSettings.js'
import { TabStrip, TitleBar, UpdateBanner } from './components/TitleBar.js'
import { WorkspaceLayout } from './components/WorkspaceLayout.js'
import { useAppEvents, useShowWindowWhenReady } from './hooks/use-app-events.js'
import { useDeepLinks } from './hooks/use-deep-links.js'
import { tn, useT } from './i18n/index.js'
import { isModKey, kbd } from './lib/keys.js'
import { useAppStore } from './state/store.js'

export function App(): React.JSX.Element {
    const ready = useAppStore((state) => state.ready)
    const initError = useAppStore((state) => state.initError)
    const workspaces = useAppStore((state) => state.workspaces)
    const tabs = useAppStore((state) => state.tabs)
    const initialize = useAppStore((state) => state.initialize)
    const dialog = useAppStore((state) => state.dialog)
    const setDialog = useAppStore((state) => state.setDialog)
    const t = useT()

    useEffect(() => {
        void initialize()
    }, [initialize])

    const onMenuAction = useCallback((action: string) => {
        const store = useAppStore.getState()

        switch (action) {
            case 'tab.new':
                void store.openTab()
                break
            case 'tab.close':
                if (store.activeTabId) void store.closeTab(store.activeTabId)
                break
            // ⌘S у уже сохранённой операции пишет её на место без вопросов;
            // диалог нужен только черновику и «Сохранить как».
            case 'operation.save':
                void store.saveActiveTabInPlace().then((saved) => {
                    if (!saved) store.setDialog('save')
                })
                break
            case 'operation.saveAs':
                store.setDialog('save')
                break
            case 'workspace.new':
                store.setDialog('workspace')
                break
            case 'workspace.settings':
                store.setDialog('workspaceSettings')
                break
            case 'settings':
                store.setDialog('settings')
                break
            case 'agent.activity':
                store.setDialog('activity')
                break
            case 'operation.run':
                void store.runActiveTab()
                break
            case 'operation.stop':
                store.stopActiveTab()
                break
            case 'schema.refresh':
                void store.refreshSchema()
                break
            case 'schema.diff':
                store.setLayoutPreset('inspector')
                void store.compareSchema()
                break
            case 'editor.format':
                store.formatActiveQuery()
                break
            case 'response.toggle':
                store.toggleResponseExpanded()
                break
            case 'palette.open':
                store.setPaletteOpen(true)
                break
            case 'layout.classic':
                store.setLayoutPreset('classic')
                break
            case 'layout.inspector':
                store.setLayoutPreset('inspector')
                break
            case 'layout.focus':
                store.setLayoutPreset('focus')
                break
            case 'sidebar.toggle':
                store.toggleSidebar()
                break
            case 'flow.run': {
                const flow = store.flows[0]
                if (flow) void store.runFlow(flow.id)
                break
            }
            default:
                break
        }
    }, [])

    useAppEvents(onMenuAction)
    useShowWindowWhenReady(ready)
    useDeepLinks(ready)

    // Часть сочетаний дублируется здесь: пункты меню срабатывают только когда
    // фокус не перехвачен редактором, а ⌘K и ⌘W нужны всегда.
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (!isModKey(event)) return

            if (event.key === 'k') {
                event.preventDefault()
                useAppStore.getState().setPaletteOpen(true)
            }

            // Системное ⌘, приходит пунктом меню, но в фокусе редактора события
            // меню до приложения не доходят — дублируем здесь.
            if (event.key === ',') {
                event.preventDefault()
                useAppStore.getState().setDialog('settings')
            }

            if (event.key === 'a' && event.shiftKey) {
                event.preventDefault()
                useAppStore.getState().setDialog('activity')
            }
        }

        window.addEventListener('keydown', onKeyDown)

        return () => window.removeEventListener('keydown', onKeyDown)
    }, [])

    if (!ready) return <div className="app" />

    if (initError) {
        return (
            <div className="app">
                <div className="empty selectable" style={{ color: 'var(--danger)' }}>
                    {t('Failed to start the app: {error}', { error: initError })}
                </div>
            </div>
        )
    }

    return (
        <div className="app">
            <TitleBar />
            <UpdateBanner />

            {workspaces.length === 0 ? (
                <Onboarding onCreate={() => setDialog('workspace')} />
            ) : (
                <>
                    <TabStrip />
                    <div className="app__body">
                        {tabs.length === 0 ? (
                            <div className="empty">
                                {t('No open tabs.')}
                                <br />
                                {t('Press {keys} or pick an operation in the collections.', {
                                    keys: kbd('T'),
                                })}
                            </div>
                        ) : (
                            <WorkspaceLayout />
                        )}
                    </div>
                    <StatusBar />
                </>
            )}

            <CommandPalette />
            <ConfirmDialog />
            {dialog === 'save' && <SaveOperationDialog onClose={() => setDialog('none')} />}
            {dialog === 'workspace' && <CreateWorkspaceDialog onClose={() => setDialog('none')} />}
            {dialog === 'settings' && <SettingsDialog onClose={() => setDialog('none')} />}
            {dialog === 'activity' && <AgentActivity onClose={() => setDialog('none')} />}
            {dialog === 'import' && <ImportDialog onClose={() => setDialog('none')} />}
            {dialog === 'workspaceSettings' && (
                <WorkspaceSettings onClose={() => setDialog('none')} />
            )}
        </div>
    )
}

function Onboarding({ onCreate }: { onCreate: () => void }): React.JSX.Element {
    const t = useT()

    return (
        <div className="app__body" style={{ alignItems: 'center', justifyContent: 'center' }}>
            <div className="empty" style={{ maxWidth: 420 }}>
                <div style={{ fontSize: 15, color: 'var(--text-primary)', marginBottom: 8 }}>
                    {t('Welcome to Resolvr')}
                </div>
                {t(
                    'Create a workspace: a name and the GraphQL endpoint URL. The schema is fetched by introspection.',
                )}
                <div style={{ marginTop: 16 }}>
                    <button type="button" className="btn btn--primary" onClick={onCreate}>
                        {t('Create workspace')}
                    </button>
                </div>
            </div>
        </div>
    )
}

/** Сутки: старше этого снимок схемы считается устаревшим. */
const SCHEMA_STALE_MS = 24 * 60 * 60_000

/**
 * Возраст снимка схемы.
 *
 * После деплоя бэкенда автокомплит подсказывает по старой схеме, и заметить
 * это нечем — кроме даты последней интроспекции. Клик обновляет схему.
 */
function SchemaFreshness(props: {
    loaded: boolean
    fetchedAt: string | undefined
    onRefresh: () => void
}): React.JSX.Element {
    const [now, setNow] = useState(() => Date.now())
    const t = useT()

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 60_000)

        return () => clearInterval(timer)
    }, [])

    const age = props.fetchedAt ? now - new Date(props.fetchedAt).getTime() : undefined
    const stale = age !== undefined && age > SCHEMA_STALE_MS

    return (
        <button
            type="button"
            className={`statusbar__action${!props.loaded ? ' statusbar__action--warn' : stale ? ' statusbar__action--warn' : ''}`}
            onClick={props.onRefresh}
            title={
                props.fetchedAt
                    ? t('Schema fetched {date}. Click to refresh', {
                          date: new Date(props.fetchedAt).toLocaleString(),
                      })
                    : t('Schema not loaded. Click to introspect')
            }
        >
            {!props.loaded
                ? t('schema not loaded')
                : age === undefined
                  ? t('schema loaded')
                  : t('schema · {age}', { age: formatAge(age, t) })}
        </button>
    )
}

/** «5 мин назад», «2 ч назад», «3 дн назад». */
function formatAge(milliseconds: number, t: ReturnType<typeof useT>): string {
    const minutes = Math.round(milliseconds / 60_000)
    if (minutes < 1) return t('just now')
    if (minutes < 60) return t('{n} min ago', { n: minutes })

    const hours = Math.round(minutes / 60)
    if (hours < 24) return t('{n} h ago', { n: hours })

    return t('{n} d ago', { n: Math.round(hours / 24) })
}

function StatusBar(): React.JSX.Element {
    const workspace = useAppStore((state) => state.workspace)
    const schema = useAppStore((state) => state.schema)
    const schemaFetchedAt = useAppStore((state) => state.schemaFetchedAt)
    const refreshSchema = useAppStore((state) => state.refreshSchema)
    const tabs = useAppStore((state) => state.tabs)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const run = useAppStore((state) => (state.activeTabId ? state.runs[state.activeTabId] : undefined))
    const preset = useAppStore((state) => state.layoutPreset)
    const t = useT()

    const dirtyCount = tabs.filter((tab) => tab.dirty).length
    const activeTab = tabs.find((tab) => tab.id === activeTabId)

    return (
        <div className="statusbar">
            <span
                className={`statusbar__dot${
                    run?.status === 'streaming'
                        ? ' statusbar__dot--live'
                        : run?.status === 'error'
                          ? ' statusbar__dot--fail'
                          : run?.result?.ok
                            ? ' statusbar__dot--ok'
                            : ''
                }`}
            />
            <span>{workspace?.name ?? t('no workspace')}</span>
            <SchemaFreshness
                loaded={Boolean(schema)}
                fetchedAt={schemaFetchedAt}
                onRefresh={() => void refreshSchema()}
            />
            {activeTab?.operationRef && <span className="mono">{activeTab.operationRef}</span>}
            <span className="panel__spacer" style={{ flex: 1 }} />
            {dirtyCount > 0 && <span>{tn(dirtyCount, 'draft|drafts')}</span>}
            <span>{t('layout: {preset}', { preset })}</span>
        </div>
    )
}
