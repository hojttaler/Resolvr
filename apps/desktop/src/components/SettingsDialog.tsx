import { useEffect, useState } from 'react'

import { formatDiagnostics, readAboutInfo, type IAboutInfo } from '../platform/about.js'

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
                    <div className="dialog__title">Настройки</div>

                    <section className="settings__group">
                        <div className="settings__caption">Внешний вид</div>

                        <SettingRow label="Тема" hint="Следовать системе или зафиксировать">
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
                                            ? 'Системная'
                                            : theme === 'light'
                                              ? 'Светлая'
                                              : 'Тёмная'}
                                    </button>
                                ))}
                            </div>
                        </SettingRow>

                        {isMacOs() && (
                            <>
                                <SettingRow
                                    label="Прозрачность окна"
                                    hint={
                                        settings.appearance.opacity === 0
                                            ? 'Только нативное размытие — фон полностью прозрачный'
                                            : settings.appearance.opacity === 100
                                              ? 'Сплошной фон, содержимое под окном не просвечивает'
                                              : `Плотность фона ${settings.appearance.opacity} %`
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
                                    label="Материал размытия"
                                    hint="Плотность нативного эффекта под окном"
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
                                        <option value="hud">Нейтральный</option>
                                        <option value="sidebar">Как у сайдбара</option>
                                        <option value="under-window">Максимально прозрачный</option>
                                        <option value="popover">Как у поповера</option>
                                        <option value="window">Как у окна</option>
                                        <option value="none">Без размытия</option>
                                    </select>
                                </SettingRow>
                            </>
                        )}

                        <SettingRow
                            label="Размер шрифта в редакторе"
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
                        <div className="settings__caption">Редактор</div>

                        <SettingRow label="Размер отступа" hint="Пробелов на уровень вложенности">
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

                        <SettingRow label="Номера строк">
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
                            label="Переносить длинные строки"
                            hint="Иначе появляется горизонтальная прокрутка"
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
                            label="Глубина автозаполнения выборки"
                            hint="На сколько уровней раскрывать вложенные типы при клике по полю схемы"
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
                        <div className="settings__caption">Запросы и ответы</div>

                        <SettingRow label="Таймаут запроса" hint="Миллисекунды">
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
                            label="Раскрывать ответ на уровней"
                            hint="Глубже этого узлы остаются свёрнутыми"
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
                            label="Хранить историю, дней"
                            hint="Старые файлы журнала удаляются при запуске"
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
                        <div className="settings__caption">Токены и секреты</div>

                        <SettingRow
                            label="Где хранить"
                            hint={
                                settings.secrets.storage === 'file'
                                    ? 'Файл ~/Resolvr/.secrets/, доступ только владельцу. Пароль не спрашивается.'
                                    : 'macOS Keychain. После каждой переустановки приложения система снова спросит пароль.'
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
                                <option value="file">В файле библиотеки</option>
                                <option value="keychain">В macOS Keychain</option>
                            </select>
                        </SettingRow>

                        <div className="inspector__hint">
                            Хранилища не синхронизируются: после переключения токен нужно получить
                            заново кнопкой в шапке. Значения в файле не шифруются — как ключи SSH.
                        </div>
                    </section>

                    <AboutSection secretStorage={settings.secrets.storage} />

                    <div className="inspector__hint">
                        Настройки хранятся в <span className="mono">~/Resolvr/settings.json</span>
                    </div>
                </div>

                <div className="dialog__footer">
                    <button type="button" className="btn btn--primary" onClick={props.onClose}>
                        Готово
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

    useEffect(() => {
        void readAboutInfo().then(setInfo)
    }, [])

    return (
        <section className="settings__group">
            <div className="settings__caption">О программе</div>

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
                    title="Версия, система и путь библиотеки — приложите к сообщению о проблеме"
                >
                    {copied ? 'Скопировано' : 'Скопировать диагностику'}
                </button>
            </SettingRow>

            <SettingRow
                label="Обновления"
                hint={
                    update
                        ? `Доступна версия ${update.version}`
                        : update === null
                          ? 'Установлена последняя версия'
                          : 'Проверяются автоматически после запуска'
                }
            >
                {update ? (
                    <button type="button" className="btn btn--primary" onClick={() => void installUpdate()}>
                        Обновить
                    </button>
                ) : (
                    <button
                        type="button"
                        className="btn"
                        disabled={updateChecking}
                        onClick={() => void checkUpdates()}
                    >
                        {updateChecking ? 'Проверяю…' : 'Проверить обновления'}
                    </button>
                )}
            </SettingRow>

            <SettingRow
                label="Агент через MCP"
                hint="Сервер вложен в приложение; команда регистрирует его в Claude Code"
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
                    Скопировать команду
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
