import { useEffect, useState } from 'react'

import { useT } from '../i18n/index.js'
import { formatDiagnostics, readAboutInfo, type IAboutInfo } from '../platform/about.js'
import { logError, openLogDir } from '../platform/logger.js'

/** Размытие и прозрачность окна существуют только на macOS. */
function isMacOs(): boolean {
    return document.documentElement.getAttribute('data-platform') === 'macos'
}

import { useAppStore } from '../state/store.js'

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

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (event.key === 'Escape') props.onClose()
        }

        window.addEventListener('keydown', onKeyDown)

        return () => window.removeEventListener('keydown', onKeyDown)
    }, [props])

    return (
        <div className="overlay" onMouseDown={props.onClose}>
            <div
                className="dialog dialog--wide"
                onMouseDown={(event) => event.stopPropagation()}
            >
                <div className="dialog__body">
                    <div className="dialog__title">{t('Settings')}</div>

                    <section className="settings__group">
                        <div className="settings__caption">{t('Appearance')}</div>

                        <SettingRow label={t('Theme')} hint={t('Follow the system or fix')}>
                            <div className="segmented">
                                {(['system', 'light', 'dark'] as const).map((theme) => (
                                    <button
                                        key={theme}
                                        type="button"
                                        className={`segmented__item${
                                            settings.theme === theme ? ' segmented__item--active' : ''
                                        }`}
                                        onClick={() => void updateSettings({ theme })}
                                    >
                                        {theme === 'system'
                                            ? t('System')
                                            : theme === 'light'
                                              ? t('Light')
                                              : t('Dark')}
                                    </button>
                                ))}
                            </div>
                        </SettingRow>

                        <SettingRow label={t('Language')} hint={t('Interface language; “System” follows the OS')}>
                            <div className="segmented">
                                {(['system', 'en', 'ru'] as const).map((language) => (
                                    <button
                                        key={language}
                                        type="button"
                                        className={`segmented__item${
                                            settings.language === language ? ' segmented__item--active' : ''
                                        }`}
                                        onClick={() => void updateSettings({ language })}
                                    >
                                        {language === 'system'
                                            ? t('System')
                                            : language === 'en'
                                              ? 'English'
                                              : 'Русский'}
                                    </button>
                                ))}
                            </div>
                        </SettingRow>

                        {isMacOs() && (
                            <>
                                <SettingRow
                                    label={t('Window transparency')}
                                    hint={
                                        settings.appearance.opacity === 0
                                            ? t('Native blur only — background fully transparent')
                                            : settings.appearance.opacity === 100
                                              ? t('Opaque window')
                                              : t('Background density {n} %', { n: settings.appearance.opacity })
                                    }
                                >
                                    <input
                                        type="range"
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
                                </SettingRow>

                                <SettingRow
                                    label={t('Blur material')}
                                    hint={t('Density of the native effect under the window')}
                                >
                                    <select
                                        className="select"
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
                                        <option value="under-window">{t('Under window')}</option>
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
                    </section>

                    <section className="settings__group">
                        <div className="settings__caption">{t('Editor')}</div>

                        <SettingRow label={t('Indent size')} hint={t('Spaces per nesting level')}>
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
                            hint={t('How many levels of nested types to expand when clicking a schema field')}
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
                                            autofillDepth: clamp(Number(event.target.value), 1, 6),
                                        },
                                    })
                                }
                            />
                        </SettingRow>
                    </section>

                    <section className="settings__group">
                        <div className="settings__caption">{t('Requests and responses')}</div>

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
                                            expandDepth: clamp(Number(event.target.value), 1, 8),
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

                    <section className="settings__group">
                        <div className="settings__caption">{t('Tokens and secrets')}</div>

                        <SettingRow
                            label={t('Where to store')}
                            hint={
                                settings.secrets.storage === 'file'
                                    ? t('File ~/Resolvr/.secrets/, owner-only access. No password prompts.')
                                    : t('macOS Keychain. After each reinstall the system asks for the password again.')
                            }
                        >
                            <select
                                className="select"
                                value={settings.secrets.storage}
                                onChange={(event) =>
                                    void updateSettings({
                                        secrets: {
                                            storage: event.target.value === 'keychain' ? 'keychain' : 'file',
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

                    <AboutSection secretStorage={settings.secrets.storage} />

                    <div className="inspector__hint">
                        {t('Settings are stored in')} <span className="mono">~/Resolvr/settings.json</span>
                    </div>
                </div>

                <div className="dialog__footer">
                    <button type="button" className="btn btn--primary" onClick={props.onClose}>
                        {t('Done')}
                    </button>
                </div>
            </div>
        </div>
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
            <div className="settings__caption">{t('About')}</div>

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
                        void navigator.clipboard.writeText(
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
                    <button type="button" className="btn btn--primary" onClick={() => void installUpdate()}>
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
                hint={t('The server is bundled with the app; the command registers it in Claude Code')}
            >
                <button
                    type="button"
                    className="btn"
                    disabled={!info}
                    onClick={() => {
                        if (info) void navigator.clipboard.writeText(info.mcpCommand)
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
    checked: boolean
    onChange: (checked: boolean) => void
}): React.JSX.Element {
    return (
        <button
            type="button"
            role="switch"
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
