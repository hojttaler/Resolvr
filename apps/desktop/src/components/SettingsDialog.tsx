import { useEffect, useState } from 'react'
import { DialogSurface } from './DialogSurface.js'

import { copyText } from '../lib/clipboard.js'
import { useT } from '../i18n/index.js'
import { formatDiagnostics, readAboutInfo, type IAboutInfo } from '../platform/about.js'
import { logError, openLogDir } from '../platform/logger.js'
import { useAppStore } from '../state/store.js'
import { ThemeCatalog } from './ThemeCatalog.js'

/** Размытие и прозрачность окна существуют только на macOS. */
function isMacOs(): boolean {
    return document.documentElement.getAttribute('data-platform') === 'macos'
}

const SECTIONS = [
    {
        id: 'appearance',
        label: 'Appearance',
        icon: 'M8 5a3 3 0 1 0 0 6 3 3 0 1 0 0-6z M8 1v2m0 10v2M1 8h2m10 0h2M3 3l1.4 1.4m7.2 7.2L13 13M3 13l1.4-1.4m7.2-7.2L13 3',
    },
    { id: 'themes', label: 'Themes', icon: 'M2 3h12v10H2z M2 6h12 M5 9h6' },
    { id: 'editor', label: 'Editor', icon: 'M5 4 1.5 8 5 12m6-8 3.5 4-3.5 4M9.5 2l-3 12' },
    {
        id: 'requests',
        label: 'Requests and responses',
        icon: 'M1.5 5h12m-3-3 3 3-3 3M14.5 11h-12m3-3-3 3 3 3',
    },
    {
        id: 'secrets',
        label: 'Tokens and secrets',
        icon: 'M5 7V5a3 3 0 1 1 6 0v2M4 7h8a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z',
    },
    {
        id: 'about',
        label: 'About',
        icon: 'M8 2a6 6 0 1 0 0 12 6 6 0 1 0 0-12z M8 7.5v3.2M8 5.3h.01',
    },
] as const

export interface ISettingsDialogProps {
    onClose: () => void
}

/**
 * Настройки приложения.
 *
 * Изменения применяются сразу и сохраняются в `~/Resolvr/settings.json` —
 * без кнопки «Применить»: настроек мало, каждая даёт видимый эффект, и
 * подтверждение здесь только добавляло бы шаг.
 */
export function SettingsDialog(props: ISettingsDialogProps): React.JSX.Element {
    const settings = useAppStore((state) => state.settings)
    const updateSettings = useAppStore((state) => state.updateSettings)
    const t = useT()
    const [section, setSection] = useState<(typeof SECTIONS)[number]['id']>('appearance')

    return (
        <DialogSurface label={t('Settings')} className="settings-dialog" onClose={props.onClose}>
            <div className="settings-dialog__header">
                <h1 className="dialog__title">{t('Settings')}</h1>
                <button
                    type="button"
                    className="btn btn--quiet btn--icon"
                    aria-label={t('Close')}
                    onClick={props.onClose}
                >
                    ×
                </button>
            </div>
            <div className="settings-dialog__layout">
                <nav className="settings-dialog__nav" aria-label={t('Settings')}>
                    {SECTIONS.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className="settings-dialog__link"
                            aria-current={section === item.id ? 'true' : undefined}
                            onClick={() => setSection(item.id)}
                        >
                            <svg
                                width="17"
                                height="17"
                                viewBox="0 0 16 16"
                                fill="none"
                                aria-hidden="true"
                            >
                                <path
                                    d={item.icon}
                                    stroke="currentColor"
                                    strokeWidth="1.35"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                />
                            </svg>
                            {t(item.label)}
                        </button>
                    ))}
                </nav>
                <div className="settings-dialog__content" key={section}>
                    {section === 'appearance' && (
                        <section className="settings__group">
                            <h2 className="settings-dialog__heading">{t('Appearance')}</h2>

                            <SettingRow label={t('Theme')}>
                                <button type="button" className="btn" onClick={() => setSection('themes')}>
                                    {t('Theme catalog')}
                                </button>
                            </SettingRow>

                            <SettingRow label={t('Language')}>
                                <select
                                    className="select"
                                    aria-label={t('Language')}
                                    value={settings.language}
                                    onChange={(event) => {
                                        const language = event.target.value
                                        if (
                                            language === 'system' ||
                                            language === 'en' ||
                                            language === 'ru'
                                        ) {
                                            void updateSettings({ language })
                                        }
                                    }}
                                >
                                    <option value="system">{t('System')}</option>
                                    <option value="en">English</option>
                                    <option value="ru">Русский</option>
                                </select>
                            </SettingRow>

                            {isMacOs() && (
                                <>
                                    <SettingRow
                                        label={t('Window opacity')}
                                        hint={
                                            settings.appearance.opacity === 0
                                                ? t('No background tint')
                                                : settings.appearance.opacity === 100
                                                  ? t('Opaque window')
                                                  : t('Background density {n} %', {
                                                        n: settings.appearance.opacity,
                                                    })
                                        }
                                    >
                                        <input
                                            type="range"
                                            aria-label={t('Window opacity')}
                                            min={0}
                                            max={100}
                                            step={5}
                                            value={settings.appearance.opacity}
                                            onChange={(event) =>
                                                void updateSettings({
                                                    appearance: {
                                                        ...settings.appearance,
                                                        opacity: Number(event.target.value),
                                                    },
                                                })
                                            }
                                        />
                                        <output>{settings.appearance.opacity}%</output>
                                    </SettingRow>

                                    <SettingRow label={t('Workspace transparency')}>
                                        <Toggle
                                            label={t('Workspace transparency')}
                                            checked={settings.appearance.workspaceTransparency}
                                            onChange={(workspaceTransparency) =>
                                                void updateSettings({
                                                    appearance: {
                                                        ...settings.appearance,
                                                        workspaceTransparency,
                                                    },
                                                })
                                            }
                                        />
                                    </SettingRow>

                                    <SettingRow
                                        label={t('Blur material')}
                                        hint={t('Density of the native effect under the window')}
                                    >
                                        <select
                                            className="select"
                                            aria-label={t('Blur material')}
                                            value={settings.appearance.material}
                                            onChange={(event) =>
                                                void updateSettings({
                                                    appearance: {
                                                        ...settings.appearance,
                                                        material: event.target
                                                            .value as typeof settings.appearance.material,
                                                    },
                                                })
                                            }
                                        >
                                            <option value="hud">{t('HUD')}</option>
                                            <option value="sidebar">{t('Sidebar')}</option>
                                            <option value="under-window">
                                                {t('Under window')}
                                            </option>
                                            <option value="popover">{t('Popover')}</option>
                                            <option value="window">{t('Window')}</option>
                                            <option value="none">{t('No blur')}</option>
                                        </select>
                                    </SettingRow>
                                </>
                            )}

                            <SettingRow
                                label={t('Editor font size')}
                                hint={`${settings.editor.fontSize} px`}
                            >
                                <input
                                    type="range"
                                    aria-label={t('Editor font size')}
                                    min={9}
                                    max={24}
                                    value={settings.editor.fontSize}
                                    onChange={(event) =>
                                        void updateSettings({
                                            editor: {
                                                ...settings.editor,
                                                fontSize: Number(event.target.value),
                                            },
                                        })
                                    }
                                />
                            </SettingRow>
                            <pre className="settings-dialog__sample">
                                <span>query</span> Products {'{'} <strong>products</strong> {'{'} id{' '}
                                {'} }'}
                            </pre>
                        </section>
                    )}

                    {section === 'themes' && <ThemeCatalog />}

                    {section === 'editor' && (
                        <section className="settings__group">
                            <h2 className="settings-dialog__heading">{t('Editor')}</h2>

                            <SettingRow
                                label={t('Indent size')}
                                hint={t('Spaces per nesting level')}
                            >
                                <input
                                    className="input input--narrow"
                                    type="number"
                                    min={2}
                                    max={8}
                                    value={settings.editor.tabSize}
                                    onChange={(event) =>
                                        void updateSettings({
                                            editor: {
                                                ...settings.editor,
                                                tabSize: clamp(Number(event.target.value), 2, 8),
                                            },
                                        })
                                    }
                                />
                            </SettingRow>

                            <SettingRow label={t('Line numbers')}>
                                <Toggle
                                    checked={settings.editor.lineNumbers}
                                    onChange={(lineNumbers) =>
                                        void updateSettings({
                                            editor: { ...settings.editor, lineNumbers },
                                        })
                                    }
                                />
                            </SettingRow>

                            <SettingRow
                                label={t('Wrap long lines')}
                                hint={t('Otherwise horizontal scrolling appears')}
                            >
                                <Toggle
                                    checked={settings.editor.lineWrapping}
                                    onChange={(lineWrapping) =>
                                        void updateSettings({
                                            editor: { ...settings.editor, lineWrapping },
                                        })
                                    }
                                />
                            </SettingRow>

                            <SettingRow
                                label={t('Selection autofill depth')}
                                hint={t(
                                    'How many levels of nested types to expand when clicking a schema field',
                                )}
                            >
                                <input
                                    className="input input--narrow"
                                    type="number"
                                    min={1}
                                    max={6}
                                    value={settings.editor.autofillDepth}
                                    onChange={(event) =>
                                        void updateSettings({
                                            editor: {
                                                ...settings.editor,
                                                autofillDepth: clamp(
                                                    Number(event.target.value),
                                                    1,
                                                    6,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </SettingRow>
                        </section>
                    )}

                    {section === 'requests' && (
                        <section className="settings__group">
                            <h2 className="settings-dialog__heading">
                                {t('Requests and responses')}
                            </h2>

                            <SettingRow label={t('Request timeout')} hint={t('Milliseconds')}>
                                <input
                                    className="input input--narrow"
                                    type="number"
                                    min={1000}
                                    max={600000}
                                    step={1000}
                                    value={settings.request.timeoutMs}
                                    onChange={(event) =>
                                        void updateSettings({
                                            request: {
                                                timeoutMs: clamp(
                                                    Number(event.target.value),
                                                    1000,
                                                    600_000,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </SettingRow>

                            <SettingRow
                                label={t('Expand response to levels')}
                                hint={t('Deeper nodes stay collapsed')}
                            >
                                <input
                                    className="input input--narrow"
                                    type="number"
                                    min={1}
                                    max={8}
                                    value={settings.response.expandDepth}
                                    onChange={(event) =>
                                        void updateSettings({
                                            response: {
                                                expandDepth: clamp(
                                                    Number(event.target.value),
                                                    1,
                                                    8,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </SettingRow>

                            <SettingRow
                                label={t('Keep history, days')}
                                hint={t('Older log files are deleted at startup')}
                            >
                                <input
                                    className="input input--narrow"
                                    type="number"
                                    min={1}
                                    max={365}
                                    value={settings.history.retentionDays}
                                    onChange={(event) =>
                                        void updateSettings({
                                            history: {
                                                retentionDays: clamp(
                                                    Number(event.target.value),
                                                    1,
                                                    365,
                                                ),
                                            },
                                        })
                                    }
                                />
                            </SettingRow>
                        </section>
                    )}

                    {section === 'secrets' && (
                        <section className="settings__group">
                            <h2 className="settings-dialog__heading">{t('Tokens and secrets')}</h2>

                            <SettingRow
                                label={t('Where to store')}
                                hint={
                                    settings.secrets.storage === 'file'
                                        ? t(
                                              'File ~/Resolvr/.secrets/, owner-only access. No password prompts.',
                                          )
                                        : t(
                                              'macOS Keychain. After each reinstall the system asks for the password again.',
                                          )
                                }
                            >
                                <select
                                    className="select"
                                    value={settings.secrets.storage}
                                    onChange={(event) =>
                                        void updateSettings({
                                            secrets: {
                                                storage:
                                                    event.target.value === 'keychain'
                                                        ? 'keychain'
                                                        : 'file',
                                            },
                                        })
                                    }
                                >
                                    <option value="file">{t('In the library file')}</option>
                                    <option value="keychain">{t('In macOS Keychain')}</option>
                                </select>
                            </SettingRow>

                            <div className="inspector__hint">
                                {t(
                                    'Storages are not synchronized: after switching, obtain the token again with the button in the header. Values in the file are not encrypted — like SSH keys.',
                                )}
                            </div>
                        </section>
                    )}

                    {section === 'about' && (
                        <AboutSection secretStorage={settings.secrets.storage} />
                    )}
                </div>
            </div>

            <div className="dialog__footer settings-dialog__footer">
                <span className="mono">~/Resolvr/settings.json</span>
                <button type="button" className="btn btn--primary" onClick={props.onClose}>
                    {t('Done')}
                </button>
            </div>
        </DialogSurface>
    )
}

/**
 * Версия и диагностика.
 *
 * Без номера версии сообщение «у меня не работает» не с чем сопоставить;
 * кнопка собирает всё нужное для баг-репорта одним нажатием.
 */
function AboutSection(props: { secretStorage: string }): React.JSX.Element {
    const workspaces = useAppStore((state) => state.workspaces)
    const initError = useAppStore((state) => state.initError)
    const update = useAppStore((state) => state.update)
    const updateChecking = useAppStore((state) => state.updateChecking)
    const checkUpdates = useAppStore((state) => state.checkUpdates)
    const installUpdate = useAppStore((state) => state.installUpdate)
    const [info, setInfo] = useState<IAboutInfo | undefined>()
    const [copied, setCopied] = useState(false)
    const t = useT()

    useEffect(() => {
        void readAboutInfo().then(setInfo)
    }, [])

    return (
        <section className="settings__group">
            <h2 className="settings-dialog__heading">{t('About')}</h2>

            <SettingRow
                label={`Resolvr ${info?.appVersion ?? ''}`}
                hint={info ? `${info.platform} ${info.osVersion} · ${info.arch}` : undefined}
            >
                <button
                    type="button"
                    className="btn"
                    disabled={!info}
                    onClick={() => {
                        if (!info) return
                        void copyText(
                            formatDiagnostics(info, {
                                secretStorage: props.secretStorage,
                                workspaces: workspaces.length,
                                lastError: initError,
                            }),
                        )
                        setCopied(true)
                        window.setTimeout(() => setCopied(false), 1500)
                    }}
                    title={t('Version, OS and library path — attach to a bug report')}
                >
                    {copied ? t('Copied') : t('Copy diagnostics')}
                </button>
            </SettingRow>

            <SettingRow
                label={t('Logs')}
                hint={t('Errors and crashes are written here — attach the file to a bug report')}
            >
                <button
                    type="button"
                    className="btn"
                    onClick={() =>
                        void openLogDir().catch((error: unknown) =>
                            logError('Не удалось открыть журнал', error),
                        )
                    }
                    title={info?.logDir}
                >
                    {t('Open folder')}
                </button>
            </SettingRow>

            <SettingRow
                label={t('Updates')}
                hint={
                    update
                        ? t('Version {version} is available', { version: update.version })
                        : update === null
                          ? t('Latest version installed')
                          : t('Checked automatically after launch')
                }
            >
                {update ? (
                    <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => void installUpdate()}
                    >
                        {t('Update')}
                    </button>
                ) : (
                    <button
                        type="button"
                        className="btn"
                        disabled={updateChecking}
                        onClick={() => void checkUpdates()}
                    >
                        {updateChecking ? t('Checking…') : t('Check for updates')}
                    </button>
                )}
            </SettingRow>

            <SettingRow
                label={t('Agent via MCP')}
                hint={t(
                    'The server is bundled with the app; the command registers it in Claude Code',
                )}
            >
                <button
                    type="button"
                    className="btn"
                    disabled={!info}
                    onClick={() => {
                        if (info) void copyText(info.mcpCommand)
                    }}
                    title={info?.mcpCommand}
                >
                    {t('Copy command')}
                </button>
            </SettingRow>
        </section>
    )
}

interface ISettingRowProps {
    label: string
    hint?: string
    children: React.ReactNode
}

function SettingRow(props: ISettingRowProps): React.JSX.Element {
    return (
        <div className="settings__row">
            <div className="settings__label">
                <div>{props.label}</div>
                {props.hint && <div className="inspector__hint">{props.hint}</div>}
            </div>
            <div className="settings__control">{props.children}</div>
        </div>
    )
}

function Toggle(props: {
    label?: string
    checked: boolean
    onChange: (checked: boolean) => void
}): React.JSX.Element {
    return (
        <button
            type="button"
            role="switch"
            aria-label={props.label}
            aria-checked={props.checked}
            className={`toggle${props.checked ? ' toggle--on' : ''}`}
            onClick={() => props.onChange(!props.checked)}
        >
            <span className="toggle__knob" />
        </button>
    )
}

function clamp(value: number, min: number, max: number): number {
    if (Number.isNaN(value)) return min

    return Math.min(Math.max(value, min), max)
}
