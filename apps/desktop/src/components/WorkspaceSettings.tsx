import { toSlug, type IEndpoint, type IEnvironment, type IWorkspace } from '@resolvr/core'
import { useEffect, useState } from 'react'

import { useT } from '../i18n/index.js'
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
    const t = useT()

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
                    <div className="empty">{t('Create a workspace first')}</div>
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

    /** Свободный идентификатор из названия: «Staging» → `staging`, повтор — `staging-2`. */
    function freshId(name: string, taken: string[]): string {
        const base = toSlug(name) || 'item'
        let id = base
        for (let index = 2; taken.includes(id); index += 1) id = `${base}-${index}`

        return id
    }

    function addEnvironment(): void {
        setDraft((current) => {
            if (!current) return current

            const name = t('New environment')
            const id = freshId(name, current.environments.map((item) => item.id))
            const environment: IEnvironment = {
                id,
                name,
                production: false,
                variables: {},
                headers: {},
                auth: { type: 'none' },
            }

            return {
                ...current,
                environments: [...current.environments, environment],
                defaultEnvironmentId: current.defaultEnvironmentId ?? id,
            }
        })
    }

    function removeEnvironment(id: string): void {
        setDraft((current) => {
            if (!current) return current

            const environments = current.environments.filter((item) => item.id !== id)

            return {
                ...current,
                environments,
                defaultEnvironmentId:
                    current.defaultEnvironmentId === id
                        ? environments[0]?.id
                        : current.defaultEnvironmentId,
            }
        })
    }

    function addEndpoint(): void {
        setDraft((current) => {
            if (!current) return current

            const name = t('New endpoint')
            const id = freshId(name, current.endpoints.map((item) => item.id))
            const endpoint: IEndpoint = {
                id,
                name,
                url: 'https://',
                headers: {},
                acceptInvalidCerts: false,
            }

            return {
                ...current,
                endpoints: [...current.endpoints, endpoint],
                defaultEndpointId: current.defaultEndpointId ?? id,
            }
        })
    }

    function removeEndpoint(id: string): void {
        setDraft((current) => {
            if (!current) return current

            const endpoints = current.endpoints.filter((item) => item.id !== id)

            return {
                ...current,
                endpoints,
                defaultEndpointId:
                    current.defaultEndpointId === id ? endpoints[0]?.id : current.defaultEndpointId,
            }
        })
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
                            {t('Environments')}
                        </button>
                        <button
                            type="button"
                            className={`segmented__item${
                                tab === 'endpoints' ? ' segmented__item--active' : ''
                            }`}
                            onClick={() => setTab('endpoints')}
                        >
                            {t('Endpoints')}
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
                                    {draft.defaultEnvironmentId === environment.id ? (
                                        <span className="badge badge--ok">{t('default')}</span>
                                    ) : (
                                        <button
                                            type="button"
                                            className="btn btn--quiet"
                                            onClick={() =>
                                                setDraft((current) =>
                                                    current
                                                        ? { ...current, defaultEnvironmentId: environment.id }
                                                        : current,
                                                )
                                            }
                                        >
                                            {t('Make default')}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="btn btn--quiet btn--icon"
                                        disabled={draft.environments.length <= 1}
                                        onClick={() => removeEnvironment(environment.id)}
                                        title={t('Delete environment')}
                                        aria-label={t('Delete environment')}
                                    >
                                        ×
                                    </button>
                                </div>

                                <div className="flow__grid">
                                    <label className="field__label">
                                        {t('Production')}
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
                                            {t('Mark as')} <span className="badge badge--prod">PROD</span>{' '}
                                            {t('and ask for confirmation before mutations and flows')}
                                        </span>
                                    </label>

                                    <label className="field__label">
                                        {t('Headers')}
                                        <div className="inspector__hint">
                                            {t('for all requests of the environment')}
                                        </div>
                                    </label>
                                    <KeyValueEditor
                                        value={environment.headers}
                                        onChange={(headers) =>
                                            patchEnvironment(environment.id, { headers })
                                        }
                                        keyPlaceholder="authorization"
                                        valuePlaceholder="Bearer {{token}}"
                                        addLabel={t('+ Header')}
                                    />

                                    <label className="field__label">
                                        {t('Variables')}
                                        <div className="inspector__hint">
                                            {t('substitution {{name}}')}
                                        </div>
                                    </label>
                                    <KeyValueEditor
                                        value={environment.variables}
                                        onChange={(variables) =>
                                            patchEnvironment(environment.id, { variables })
                                        }
                                        keyPlaceholder="token"
                                        valuePlaceholder={t('value')}
                                        addLabel={t('+ Variable')}
                                        secretHint={
                                            secretStorage === 'file'
                                                ? t('stored in the file')
                                                : t('stored in Keychain')
                                        }
                                    />

                                    <label className="field__label">
                                        {t('Authorization')}
                                        <div className="inspector__hint">
                                            {t('where the token comes from')}
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

                    {tab === 'environments' && (
                        <button type="button" className="btn" onClick={addEnvironment}>
                            {t('+ Environment')}
                        </button>
                    )}

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
                                    {draft.defaultEndpointId === endpoint.id ? (
                                        <span className="badge badge--ok">{t('default')}</span>
                                    ) : (
                                        <button
                                            type="button"
                                            className="btn btn--quiet"
                                            onClick={() =>
                                                setDraft((current) =>
                                                    current
                                                        ? { ...current, defaultEndpointId: endpoint.id }
                                                        : current,
                                                )
                                            }
                                        >
                                            {t('Make default')}
                                        </button>
                                    )}
                                    <button
                                        type="button"
                                        className="btn btn--quiet btn--icon"
                                        disabled={draft.endpoints.length <= 1}
                                        onClick={() => removeEndpoint(endpoint.id)}
                                        title={t('Delete endpoint')}
                                        aria-label={t('Delete endpoint')}
                                    >
                                        ×
                                    </button>
                                </div>

                                <div className="flow__grid">
                                    <label className="field__label">{t('URL')}</label>
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

                                    <label className="field__label">{t('Headers')}</label>
                                    <KeyValueEditor
                                        value={endpoint.headers}
                                        onChange={(headers) =>
                                            patchEndpoint(endpoint.id, { headers })
                                        }
                                        keyPlaceholder="x-api-key"
                                        valuePlaceholder={t('value or {{variable}}')}
                                        addLabel={t('+ Header')}
                                    />
                                </div>
                            </section>
                        ))}

                    {tab === 'endpoints' && (
                        <button type="button" className="btn" onClick={addEndpoint}>
                            {t('+ Endpoint')}
                        </button>
                    )}

                    <div className="inspector__hint">
                        {t(
                            'Header precedence: endpoint → environment → collection → operation → tab. The auth profile is applied last.',
                        )}
                    </div>
                </div>

                <div className="dialog__footer">
                    <button type="button" className="btn" onClick={props.onClose}>
                        {t('Close')}
                    </button>
                    <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => {
                            void saveWorkspace(draft).then(props.onClose)
                        }}
                    >
                        {t('Save')}
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
    const t = useT()

    if (props.flowOptions.length === 0) {
        return (
            <div className="inspector__hint">
                {t(
                    'First create an authorization flow in “Flows”: for example, a login whose response yields the token.',
                )}
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
                    <option value="">— {t('no token')} —</option>
                    {props.flowOptions.map((flow) => (
                        <option key={flow.id} value={flow.id}>
                            {flow.name}
                        </option>
                    ))}
                </select>
            </div>

            {recovery && (
                <div className="inspector__hint">
                    {t('The header button runs this flow. The token from its response is saved as')}{' '}
                    <span className="mono">{tokenVariable}</span>{' '}
                    {t('and substituted wherever')}{' '}
                    <span className="mono">{`{{${tokenVariable}}}`}</span> {t('is written.')}
                    {expiresAt && left !== undefined && (
                        <>
                            {' '}
                            {t('Now:')}{' '}
                            {left > 0
                                ? t('valid for {n} more min', { n: Math.round(left / 60_000) })
                                : t('expired')}
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
                    <div className="settings__caption">{t('How to refresh')}</div>

                    <div className="recovery__grid">
                    <span className="inspector__hint">{t('Variable name')}</span>
                    <input
                        className="input mono"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        placeholder={t('as in the flow extract')}
                        title={t(
                            'The variable the flow obtains. It is not substituted into the flow’s own requests: by refresh time the old token has expired and the server would reject the login itself.',
                        )}
                        value={recovery.tokenVariable ?? ''}
                        onChange={(event) =>
                            props.onChange({
                                ...recovery,
                                tokenVariable: event.target.value.trim() || undefined,
                            })
                        }
                    />

                    <span className="inspector__hint">{t('When to run')}</span>
                    <div className="row" style={{ flexWrap: 'wrap' }}>
                        <label className="row">
                            <input
                                type="checkbox"
                                checked={recovery.onExpiry}
                                onChange={(event) =>
                                    props.onChange({ ...recovery, onExpiry: event.target.checked })
                                }
                            />
                            <span>{t('before expiry')}</span>
                        </label>
                        <label className="row">
                            <input
                                type="checkbox"
                                checked={recovery.onError}
                                onChange={(event) =>
                                    props.onChange({ ...recovery, onError: event.target.checked })
                                }
                            />
                            <span>{t('on error')}</span>
                        </label>
                    </div>

                    <span className="inspector__hint">{t('Margin, sec')}</span>
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

                    <span className="inspector__hint">{t('Statuses')}</span>
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

                    <span className="inspector__hint">{t('Error text')}</span>
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

                    <span className="inspector__hint">{t('Retries')}</span>
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
