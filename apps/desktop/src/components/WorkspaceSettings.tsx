import type { IEndpoint, IEnvironment, IWorkspace } from '@resolvr/core'
import { useEffect, useState } from 'react'

import { useAppStore } from '../state/store.js'
import { KeyValueEditor } from './KeyValueEditor.js'

export interface IWorkspaceSettingsProps {
    onClose: () => void
}

/**
 * Настройки workspace: эндпоинты и окружения.
 *
 * До этого экрана заголовки существовали только в файлах и в каждой вкладке
 * отдельно, поэтому один и тот же `Authorization` приходилось копировать в
 * каждый запрос. Здесь он задаётся один раз на окружение или эндпоинт и
 * применяется ко всем запросам.
 */
export function WorkspaceSettings(props: IWorkspaceSettingsProps): React.JSX.Element {
    const workspace = useAppStore((state) => state.workspace)
    const flows = useAppStore((state) => state.flows)
    const secretStorage = useAppStore((state) => state.settings.secrets.storage)
    const saveWorkspace = useAppStore((state) => state.saveWorkspaceSettings)

    const [draft, setDraft] = useState<IWorkspace | undefined>(workspace)
    const [tab, setTab] = useState<'environments' | 'endpoints'>('environments')

    useEffect(() => {
        setDraft(workspace)
    }, [workspace])

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (event.key === 'Escape') props.onClose()
        }

        window.addEventListener('keydown', onKeyDown)

        return () => window.removeEventListener('keydown', onKeyDown)
    }, [props])

    if (!draft) {
        return (
            <div className="overlay" onMouseDown={props.onClose}>
                <div className="dialog" onMouseDown={(event) => event.stopPropagation()}>
                    <div className="empty">Сначала создайте workspace</div>
                </div>
            </div>
        )
    }

    function patchEnvironment(id: string, patch: Partial<IEnvironment>): void {
        setDraft((current) =>
            current
                ? {
                      ...current,
                      environments: current.environments.map((item) =>
                          item.id === id ? { ...item, ...patch } : item,
                      ),
                  }
                : current,
        )
    }

    function patchEndpoint(id: string, patch: Partial<IEndpoint>): void {
        setDraft((current) =>
            current
                ? {
                      ...current,
                      endpoints: current.endpoints.map((item) =>
                          item.id === id ? { ...item, ...patch } : item,
                      ),
                  }
                : current,
        )
    }

    return (
        <div className="overlay" onMouseDown={props.onClose}>
            <div className="dialog dialog--wide" onMouseDown={(event) => event.stopPropagation()}>
                <div className="dialog__body">
                    <div className="dialog__title">Workspace: {draft.name}</div>

                    <div className="segmented">
                        <button
                            type="button"
                            className={`segmented__item${
                                tab === 'environments' ? ' segmented__item--active' : ''
                            }`}
                            onClick={() => setTab('environments')}
                        >
                            Окружения
                        </button>
                        <button
                            type="button"
                            className={`segmented__item${
                                tab === 'endpoints' ? ' segmented__item--active' : ''
                            }`}
                            onClick={() => setTab('endpoints')}
                        >
                            Эндпоинты
                        </button>
                    </div>

                    {tab === 'environments' &&
                        draft.environments.map((environment) => (
                            <section key={environment.id} className="flow__step">
                                <div className="flow__step-head">
                                    <span className="badge">ENV</span>
                                    <input
                                        className="input input--name"
                                        value={environment.name}
                                        onChange={(event) =>
                                            patchEnvironment(environment.id, {
                                                name: event.target.value,
                                            })
                                        }
                                    />
                                    {draft.defaultEnvironmentId === environment.id && (
                                        <span className="badge badge--ok">по умолчанию</span>
                                    )}
                                </div>

                                <div className="flow__grid">
                                    <label className="field__label">
                                        Боевое
                                        <div className="inspector__hint">prod-guard</div>
                                    </label>
                                    <label className="row" style={{ alignSelf: 'center' }}>
                                        <input
                                            type="checkbox"
                                            checked={environment.production}
                                            onChange={(event) =>
                                                patchEnvironment(environment.id, {
                                                    production: event.target.checked,
                                                })
                                            }
                                        />
                                        <span>
                                            Помечать <span className="badge badge--prod">PROD</span>{' '}
                                            и спрашивать подтверждение перед мутациями и цепочками
                                        </span>
                                    </label>

                                    <label className="field__label">
                                        Заголовки
                                        <div className="inspector__hint">
                                            для всех запросов окружения
                                        </div>
                                    </label>
                                    <KeyValueEditor
                                        value={environment.headers}
                                        onChange={(headers) =>
                                            patchEnvironment(environment.id, { headers })
                                        }
                                        keyPlaceholder="authorization"
                                        valuePlaceholder="Bearer {{token}}"
                                        addLabel="+ Заголовок"
                                    />

                                    <label className="field__label">
                                        Переменные
                                        <div className="inspector__hint">
                                            подстановка {'{{имя}}'}
                                        </div>
                                    </label>
                                    <KeyValueEditor
                                        value={environment.variables}
                                        onChange={(variables) =>
                                            patchEnvironment(environment.id, { variables })
                                        }
                                        keyPlaceholder="token"
                                        valuePlaceholder="значение"
                                        addLabel="+ Переменная"
                                        secretHint={
                                            secretStorage === 'file'
                                                ? 'хранится в файле'
                                                : 'хранится в Keychain'
                                        }
                                    />

                                    <label className="field__label">
                                        Авторизация
                                        <div className="inspector__hint">
                                            откуда берётся токен
                                        </div>
                                    </label>
                                    <RecoveryEditor
                                        environment={environment}
                                        flowOptions={flows.map((flow) => ({
                                            id: flow.id,
                                            name: flow.name,
                                        }))}
                                        onChange={(recovery) =>
                                            patchEnvironment(environment.id, { recovery })
                                        }
                                    />
                                </div>
                            </section>
                        ))}

                    {tab === 'endpoints' &&
                        draft.endpoints.map((endpoint) => (
                            <section key={endpoint.id} className="flow__step">
                                <div className="flow__step-head">
                                    <span className="badge">URL</span>
                                    <input
                                        className="input input--name"
                                        value={endpoint.name}
                                        onChange={(event) =>
                                            patchEndpoint(endpoint.id, { name: event.target.value })
                                        }
                                    />
                                </div>

                                <div className="flow__grid">
                                    <label className="field__label">Адрес</label>
                                    <input
                                        className="input mono"
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        spellCheck={false}
                                        value={endpoint.url}
                                        onChange={(event) =>
                                            patchEndpoint(endpoint.id, { url: event.target.value })
                                        }
                                    />

                                    <label className="field__label">Заголовки</label>
                                    <KeyValueEditor
                                        value={endpoint.headers}
                                        onChange={(headers) =>
                                            patchEndpoint(endpoint.id, { headers })
                                        }
                                        keyPlaceholder="x-api-key"
                                        valuePlaceholder="значение или {{переменная}}"
                                        addLabel="+ Заголовок"
                                    />
                                </div>
                            </section>
                        ))}

                    <div className="inspector__hint">
                        Порядок наложения заголовков: эндпоинт → окружение → коллекция → операция →
                        вкладка. Авторизация из auth-профиля применяется последней.
                    </div>
                </div>

                <div className="dialog__footer">
                    <button type="button" className="btn" onClick={props.onClose}>
                        Закрыть
                    </button>
                    <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => {
                            void saveWorkspace(draft).then(props.onClose)
                        }}
                    >
                        Сохранить
                    </button>
                </div>
            </div>
        </div>
    )
}

interface IRecoveryEditorProps {
    environment: IEnvironment
    flowOptions: Array<{ id: string; name: string }>
    onChange: (recovery: IEnvironment['recovery']) => void
}

/**
 * Настройка авторизации окружения.
 *
 * Раньше это была строка «Восстановление» с одним селектом: что именно
 * происходит при нажатии на индикатор токена, из интерфейса понять было
 * нельзя. Здесь видны все части — какая цепочка выполняется, куда попадает
 * токен, каким заголовком уходит и когда обновляется.
 */
function RecoveryEditor(props: IRecoveryEditorProps): React.JSX.Element {
    const recovery = props.environment.recovery

    if (props.flowOptions.length === 0) {
        return (
            <div className="inspector__hint">
                Сначала создайте цепочку авторизации в разделе «Цепочки»: например, логин, из
                ответа которого извлекается токен.
            </div>
        )
    }

    const tokenVariable = recovery?.tokenVariable?.trim() || 'accessToken'
    const expiresAt = props.environment.tokenExpiresAt
    const left = expiresAt ? new Date(expiresAt).getTime() - Date.now() : undefined

    return (
        <div className="recovery">
            <div className="row">
                <select
                    className="select"
                    style={{ maxWidth: 'none' }}
                    value={recovery?.flowId ?? ''}
                    onChange={(event) =>
                        props.onChange(
                            event.target.value
                                ? {
                                      flowId: event.target.value,
                                      tokenVariable: recovery?.tokenVariable,
                                      onExpiry: recovery?.onExpiry ?? true,
                                      onError: recovery?.onError ?? true,
                                      refreshMarginSec: recovery?.refreshMarginSec ?? 60,
                                      statuses: recovery?.statuses ?? [401, 403],
                                      messagePatterns: recovery?.messagePatterns ?? [
                                          'unauthorized',
                                          'unauthenticated',
                                          'access denied',
                                          'token is not valid',
                                      ],
                                      maxAttempts: recovery?.maxAttempts ?? 1,
                                      enabled: true,
                                  }
                                : undefined,
                        )
                    }
                >
                    <option value="">— токен не получаем —</option>
                    {props.flowOptions.map((flow) => (
                        <option key={flow.id} value={flow.id}>
                            {flow.name}
                        </option>
                    ))}
                </select>
            </div>

            {recovery && (
                <div className="inspector__hint">
                    Кнопка в шапке запускает эту цепочку. Токен из её ответа сохраняется в
                    Keychain как <span className="mono">{tokenVariable}</span> и подставляется
                    туда, где написано <span className="mono">{`{{${tokenVariable}}}`}</span>.
                    {expiresAt && left !== undefined && (
                        <>
                            {' '}
                            Сейчас:{' '}
                            {left > 0
                                ? `действует ещё ${Math.round(left / 60_000)} мин`
                                : 'истёк'}
                            {props.environment.tokenSubject
                                ? ` · ${props.environment.tokenSubject}`
                                : ''}
                            .
                        </>
                    )}
                </div>
            )}

            {recovery && (
                <div className="recovery__params">
                    <div className="settings__caption">Как обновлять</div>

                    <div className="recovery__grid">
                    <span className="inspector__hint">Имя переменной</span>
                    <input
                        className="input mono"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        placeholder="как в extract цепочки"
                        title={
                            'Переменная, которую добывает цепочка. В её собственные запросы ' +
                            'эта переменная не подставляется: прежний токен к моменту ' +
                            'обновления уже истёк, и сервер отвергал бы им сам логин.'
                        }
                        value={recovery.tokenVariable ?? ''}
                        onChange={(event) =>
                            props.onChange({
                                ...recovery,
                                tokenVariable: event.target.value.trim() || undefined,
                            })
                        }
                    />

                    <span className="inspector__hint">Когда запускать</span>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                        <label className="row">
                            <input
                                type="checkbox"
                                checked={recovery.onExpiry}
                                onChange={(event) =>
                                    props.onChange({ ...recovery, onExpiry: event.target.checked })
                                }
                            />
                            <span>до истечения</span>
                        </label>
                        <label className="row">
                            <input
                                type="checkbox"
                                checked={recovery.onError}
                                onChange={(event) =>
                                    props.onChange({ ...recovery, onError: event.target.checked })
                                }
                            />
                            <span>при ошибке</span>
                        </label>
                    </div>

                    <span className="inspector__hint">Запас, сек</span>
                    <input
                        className="input input--narrow"
                        type="number"
                        min={0}
                        max={3600}
                        value={recovery.refreshMarginSec}
                        onChange={(event) =>
                            props.onChange({
                                ...recovery,
                                refreshMarginSec: Math.min(
                                    Math.max(Number(event.target.value) || 0, 0),
                                    3600,
                                ),
                            })
                        }
                    />

                    <span className="inspector__hint">Статусы</span>
                    <input
                        className="input mono"
                        autoCorrect="off"
                        spellCheck={false}
                        value={recovery.statuses.join(', ')}
                        onChange={(event) =>
                            props.onChange({
                                ...recovery,
                                // Пустые части отбрасываются до преобразования:
                                // `Number('')` даёт 0, и пустое поле превращалось
                                // в правило «срабатывать на статус 0».
                                statuses: event.target.value
                                    .split(',')
                                    .map((part) => part.trim())
                                    .filter((part) => part.length > 0)
                                    .map(Number)
                                    .filter((value) => Number.isInteger(value)),
                            })
                        }
                    />

                    <span className="inspector__hint">Текст ошибки</span>
                    <input
                        className="input mono"
                        autoCorrect="off"
                        spellCheck={false}
                        value={recovery.messagePatterns.join(', ')}
                        onChange={(event) =>
                            props.onChange({
                                ...recovery,
                                messagePatterns: event.target.value
                                    .split(',')
                                    .map((part) => part.trim())
                                    .filter((part) => part.length > 0),
                            })
                        }
                    />

                    <span className="inspector__hint">Повторов</span>
                    <input
                        className="input input--narrow"
                        type="number"
                        min={1}
                        max={3}
                        value={recovery.maxAttempts}
                        onChange={(event) =>
                            props.onChange({
                                ...recovery,
                                maxAttempts: Math.min(
                                    Math.max(Number(event.target.value) || 1, 1),
                                    3,
                                ),
                            })
                        }
                    />
                    </div>
                </div>
            )}
        </div>
    )
}
