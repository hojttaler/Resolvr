import { openPath } from '@tauri-apps/plugin-opener'
import { useEffect, useState } from 'react'

import { useT } from '../i18n/index.js'
import { copyText } from '../lib/clipboard.js'
import { getAppContext } from '../platform/context.js'
import { useAppStore } from '../state/store.js'

const BUILTIN_THEMES = [
    { id: 'system', label: 'System' },
    { id: 'light', label: 'Light' },
    { id: 'dark', label: 'Dark' },
    { id: 'graphite', label: 'Graphite' },
] as const

const PREVIEW_COLORS = {
    system: {
        background: 'linear-gradient(110deg, #212225 55%, #f0f0f3 55%)',
        text: '#edeef0',
        accent: '#3e63dd',
    },
    light: { background: '#f0f0f3', text: '#1c2024', accent: '#3e63dd' },
    dark: { background: '#212225', text: '#edeef0', accent: '#9eb1ff' },
    graphite: { background: '#272727', text: '#f1eeea', accent: '#ff652f' },
}

/** Выбор встроенной темы или палитры из каталога библиотеки. */
export function ThemeCatalog(): React.JSX.Element {
    const selected = useAppStore((state) => state.settings.theme)
    const select = useAppStore((state) => state.updateSettings)
    const catalog = useAppStore((state) => state.localThemeCatalog)
    const loadError = useAppStore((state) => state.localThemeCatalogError)
    const refresh = useAppStore((state) => state.refreshLocalThemes)
    const [message, setMessage] = useState<string>()
    const t = useT()

    useEffect(() => {
        void refresh()
    }, [refresh])

    async function openFolder(): Promise<void> {
        try {
            const { paths, fs } = await getAppContext()
            const dir = paths.themesDir()
            await fs.ensureDir(dir)
            await openPath(dir)
            setMessage(undefined)
        } catch {
            setMessage(t('Could not open the themes folder'))
        }
    }

    async function copyTemplate(): Promise<void> {
        const example = {
            name: t('My theme'),
            base: 'graphite',
            colors: {
                'window-base': '#272727',
                accent: '#ffb44c',
                'accent-contrast': '#271707',
                'accent-muted': '#51402a',
            },
        }
        const copied = await copyText(`${JSON.stringify(example, null, 2)}\n`)
        setMessage(t(copied ? 'Theme template copied' : 'Could not copy the theme template'))
    }

    const missing =
        selected.startsWith('local:') && !catalog.themes.some((theme) => theme.id === selected)

    return (
        <section>
            <h2 className="settings-dialog__heading">{t('Themes')}</h2>
            <div className="theme-catalog__grid" role="group" aria-label={t('Built-in themes')}>
                {BUILTIN_THEMES.map(({ id, label }) => (
                    <ThemeCard
                        key={id}
                        name={t(label)}
                        selected={selected === id || (id === 'system' && missing)}
                        preview={PREVIEW_COLORS[id]}
                        onSelect={() => void select({ theme: id })}
                    />
                ))}
            </div>

            <section className="theme-catalog__local">
                <h3>{t('Local themes')}</h3>
                <p className="inspector__hint">
                    {t('Add a .json file to {path}, then refresh the list.', {
                        path: '~/Resolvr/themes',
                    })}
                </p>
                <div className="theme-catalog__actions">
                    <button type="button" className="btn" onClick={() => void openFolder()}>
                        {t('Open themes folder')}
                    </button>
                    <button type="button" className="btn" onClick={() => void copyTemplate()}>
                        {t('Copy JSON template')}
                    </button>
                    <button
                        type="button"
                        className="btn btn--quiet"
                        onClick={() => {
                            setMessage(undefined)
                            void refresh()
                        }}
                    >
                        {t('Refresh themes')}
                    </button>
                </div>
                {catalog.themes.length > 0 && (
                    <div
                        className="theme-catalog__grid"
                        role="group"
                        aria-label={t('Local themes')}
                    >
                        {catalog.themes.map((theme) => (
                            <ThemeCard
                                key={theme.id}
                                name={theme.name}
                                selected={selected === theme.id}
                                preview={{
                                    background:
                                        theme.colors['window-base'] ??
                                        PREVIEW_COLORS[theme.base].background,
                                    text:
                                        theme.colors['text-primary'] ??
                                        PREVIEW_COLORS[theme.base].text,
                                    accent:
                                        theme.colors.accent ?? PREVIEW_COLORS[theme.base].accent,
                                }}
                                onSelect={() => void select({ theme: theme.id })}
                            />
                        ))}
                    </div>
                )}
                {loadError && <p role="status">{t('Could not read the themes folder')}</p>}
                {missing && (
                    <p role="status">
                        {t('The selected theme is unavailable. Using the system theme.')}
                    </p>
                )}
                {catalog.invalidFiles.length > 0 && (
                    <p className="theme-catalog__error" role="status">
                        {t('Invalid theme files: {files}', {
                            files: catalog.invalidFiles.join(', '),
                        })}
                    </p>
                )}
                {message && <p role="status">{message}</p>}
            </section>
        </section>
    )
}

function ThemeCard(props: {
    name: string
    selected: boolean
    preview: { background: string; text: string; accent: string }
    onSelect: () => void
}): React.JSX.Element {
    const { background, text, accent } = props.preview

    return (
        <button
            type="button"
            className="theme-card"
            aria-pressed={props.selected}
            onClick={props.onSelect}
        >
            <span
                className="theme-card__preview"
                style={{ background, color: text }}
                aria-hidden="true"
            >
                <span>Aa</span>
                <span className="theme-card__accent" style={{ backgroundColor: accent }} />
            </span>
            <span className="theme-card__name">{props.name}</span>
        </button>
    )
}
