import { useEffect, useState } from 'react'

import { useAppStore } from '../state/store.js'

export interface ISaveValueDialogProps {
    /** Путь в ответе — из него предлагается имя переменной. */
    path: string
    value: string
    onClose: () => void
}

/** Признак того, что значение похоже на токен: такие лучше прятать в Keychain. */
const TOKEN_HINT = /token|secret|key|password|jwt/i

/**
 * Сохранение значения из ответа в переменную окружения.
 *
 * Это недостающее звено между «логин вернул токен» и «остальные запросы уходят
 * с этим токеном»: раньше значение приходилось копировать в заголовок каждой
 * вкладки руками.
 */
export function SaveValueDialog(props: ISaveValueDialogProps): React.JSX.Element {
    const workspace = useAppStore((state) => state.workspace)
    const tabs = useAppStore((state) => state.tabs)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const saveValue = useAppStore((state) => state.saveValueToEnvironment)

    const suggested = suggestName(props.path)
    const looksLikeToken = TOKEN_HINT.test(props.path)

    const [name, setName] = useState(suggested)
    const [secret, setSecret] = useState(looksLikeToken)
    const [asAuthHeader, setAsAuthHeader] = useState(looksLikeToken)
    const [error, setError] = useState<string | undefined>()

    const activeTab = tabs.find((tab) => tab.id === activeTabId)
    const environment = workspace?.environments.find(
        (item) => item.id === (activeTab?.environmentId ?? workspace.defaultEnvironmentId),
    )

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (event.key === 'Escape') props.onClose()
        }

        window.addEventListener('keydown', onKeyDown)

        return () => window.removeEventListener('keydown', onKeyDown)
    }, [props])

    async function submit(): Promise<void> {
        if (name.trim().length === 0) {
            setError('Укажите имя переменной')

            return
        }

        try {
            await saveValue({ name: name.trim(), value: props.value, secret, asAuthHeader })
            props.onClose()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught))
        }
    }

    return (
        <div className="overlay" onMouseDown={props.onClose}>
            <div className="dialog" onMouseDown={(event) => event.stopPropagation()}>
                <div className="dialog__body">
                    <div className="dialog__title">Сохранить значение</div>

                    <div className="inspector__hint">
                        Из ответа: <span className="mono">{props.path}</span>
                        <br />
                        В окружение: <b>{environment?.name ?? '—'}</b>
                    </div>

                    <div className="field">
                        <label className="field__label">Имя переменной</label>
                        <input
                            className="input mono"
                            autoFocus
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                        />
                        <span className="inspector__hint">
                            Использовать в заголовках и переменных как{' '}
                            <span className="mono">{`{{${name || 'имя'}}}`}</span>
                        </span>
                    </div>

                    <label className="row">
                        <input
                            type="checkbox"
                            checked={secret}
                            onChange={(event) => setSecret(event.target.checked)}
                        />
                        <span>
                            Секрет — хранить в Keychain
                            <div className="inspector__hint">
                                в файлы попадёт только ссылка, значение маскируется в истории
                            </div>
                        </span>
                    </label>

                    <label className="row">
                        <input
                            type="checkbox"
                            checked={asAuthHeader}
                            onChange={(event) => setAsAuthHeader(event.target.checked)}
                        />
                        <span>
                            Добавить заголовок окружения
                            <div className="inspector__hint mono">
                                authorization: Bearer {`{{${name || 'имя'}}}`}
                            </div>
                        </span>
                    </label>

                    <div className="raw mono selectable" style={{ maxHeight: 90, overflow: 'auto' }}>
                        {props.value.slice(0, 300)}
                        {props.value.length > 300 ? '…' : ''}
                    </div>

                    {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
                </div>

                <div className="dialog__footer">
                    <button type="button" className="btn" onClick={props.onClose}>
                        Отмена
                    </button>
                    <button type="button" className="btn btn--primary" onClick={() => void submit()}>
                        Сохранить
                    </button>
                </div>
            </div>
        </div>
    )
}

/** Имя переменной по пути: последний осмысленный сегмент. */
function suggestName(path: string): string {
    const segments = path.split('.').filter((segment) => segment.length > 0 && !/^\d+$/.test(segment))

    return segments.at(-1) ?? 'value'
}
