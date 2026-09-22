import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { AgentActivity } from '../components/AgentActivity.js'
import { CommandPalette } from '../components/CommandPalette.js'
import { SaveOperationDialog } from '../components/Dialogs.js'
import { SettingsDialog } from '../components/SettingsDialog.js'
import { TabStrip, TitleBar } from '../components/TitleBar.js'
import { WorkspaceLayout } from '../components/WorkspaceLayout.js'
import { WorkspaceSettings } from '../components/WorkspaceSettings.js'
import { useAppStore } from '../state/store.js'
import '../styles/global.css'
import { setLanguage, tn, useT } from '../i18n/index.js'
import { seedBigResponse, seedReport, seedSchemaBrowser, seedShowcase, SHOWCASE_SCHEMA } from './fixtures.js'

document.documentElement.setAttribute('data-platform', 'macos')

// Язык и платформа витрины — из адреса: `?lang=en&platform=windows`.
const showcaseParams = new URLSearchParams(location.search)
setLanguage(showcaseParams.get('lang') === 'ru' ? 'ru' : 'en')
if (showcaseParams.get('platform')) {
    document.documentElement.setAttribute('data-platform', showcaseParams.get('platform') ?? 'macos')
}

/**
 * Витрина интерфейса.
 *
 * Открывает те же экраны, что и приложение, но вне Tauri и с готовыми данными.
 * Нужна для проверки вёрстки скриншотами: без неё каждую правку оформления
 * пришлось бы проверять вручную в собранном приложении.
 */
function Showcase(): React.JSX.Element {
    const [screen, setScreen] = useState(() => new URLSearchParams(location.search).get('screen'))

    useEffect(() => {
        seedShowcase()

        // Экран цепочки — это вкладка: открывается через состояние, как в приложении.
        const screenParam = new URLSearchParams(location.search).get('screen')
        if (screenParam === 'flow') {
            void useAppStore.getState().openFlowTab('sign-in')
        }
        if (screenParam === 'report') {
            seedReport()
        }
        if (screenParam === 'schema') {
            seedSchemaBrowser(showcaseParams.get('type') ?? 'User')
        }
        if (screenParam === 'big') {
            seedBigResponse()
        }
        if (screenParam === 'schema-sidebar') {
            useAppStore.setState({ schema: SHOWCASE_SCHEMA, sidebarTab: 'schema' })
        }
    }, [])

    useEffect(() => {
        const theme = new URLSearchParams(location.search).get('theme')
        if (theme) document.documentElement.setAttribute('data-theme', theme)
    }, [])

    // Панель поиска по ответу открывается тем же сочетанием, что и в
    // приложении: отдельного способа показать её у витрины нет.
    useEffect(() => {
        if (screen !== 'search') return

        const open = window.setTimeout(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true }))
        }, 60)

        // Ввод — отдельным тиком: поле появляется только после перерисовки,
        // вызванной открытием панели.
        const type = window.setTimeout(() => {
            const input = document.querySelector<HTMLInputElement>('.searchbar__input')
            if (!input) return

            const setter = Object.getOwnPropertyDescriptor(
                HTMLInputElement.prototype,
                'value',
            )?.set
            setter?.call(input, 'admin')
            input.dispatchEvent(new Event('input', { bubbles: true }))
        }, 200)

        return () => {
            window.clearTimeout(open)
            window.clearTimeout(type)
        }
    }, [screen])

    const ready = useAppStore((state) => state.ready)
    if (!ready) return <div className="app" />

    return (
        <div className="app">
            <TitleBar />
            <TabStrip />
            <div className="app__body">
                <WorkspaceLayout />
            </div>
            <StatusBar />

            {screen === 'palette' && <PaletteScreen />}
            {screen === 'settings' && <SettingsDialog onClose={() => setScreen(null)} />}
            {screen === 'workspace' && <WorkspaceSettings onClose={() => setScreen(null)} />}
            {screen === 'activity' && <AgentActivity onClose={() => setScreen(null)} />}
            {screen === 'save' && <SaveOperationDialog onClose={() => setScreen(null)} />}
        </div>
    )
}

function PaletteScreen(): React.JSX.Element {
    useEffect(() => {
        useAppStore.getState().setPaletteOpen(true)
    }, [])

    return <CommandPalette />
}

/** Копия статусной строки приложения: она живёт в App и здесь недоступна. */
function StatusBar(): React.JSX.Element {
    const workspace = useAppStore((state) => state.workspace)
    const preset = useAppStore((state) => state.layoutPreset)
    const t = useT()

    return (
        <div className="statusbar">
            <span className="statusbar__dot statusbar__dot--ok" />
            <span>{workspace?.name}</span>
            <span>{t('schema loaded')}</span>
            <span className="mono">catalog/Products</span>
            <span className="panel__spacer" style={{ flex: 1 }} />
            <span>{tn(1, 'draft|drafts')}</span>
            <span>{t('layout: {preset}', { preset })}</span>
        </div>
    )
}

const container = document.getElementById('root')
if (container) {
    createRoot(container).render(
        <StrictMode>
            <Showcase />
        </StrictMode>,
    )
}
