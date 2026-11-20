import {
    toSlug,
    WorkspaceSchema,
    type IEndpoint,
    type IEnvironment,
    type IWorkspace,
} from '@resolvr/core'
import { useEffect, useRef, useState } from 'react'
import { DialogSurface } from './DialogSurface.js'

import { useT } from '../i18n/index.js'
import { useAppStore } from '../state/store.js'
import { KeyValueEditor } from './KeyValueEditor.js'
import { RequestScriptsEditor } from './RequestScriptsEditor.js'

export interface IWorkspaceSettingsProps {
    onClose: () => void
}

const WORKSPACE_SECTIONS = ['General', 'Endpoints', 'Environments'] as const
const ENVIRONMENT_SECTIONS = ['General', 'Headers and variables', 'Authorization', 'Scripts'] as const

type IWorkspaceSection = typeof WORKSPACE_SECTIONS[number]
type IEnvironmentSection = typeof ENVIRONMENT_SECTIONS[number]

/** Настройки workspace, эндпоинтов и окружений в общем черновике. */
export function WorkspaceSettings(props: IWorkspaceSettingsProps): React.JSX.Element {
    const workspace = useAppStore((state) => state.workspace)
    const flows = useAppStore((state) => state.flows)
    const secretStorage = useAppStore((state) => state.settings.secrets.storage)
    const saveWorkspace = useAppStore((state) => state.saveWorkspaceSettings)
    const deleteWorkspace = useAppStore((state) => state.deleteWorkspace)
    const requestConfirm = useAppStore((state) => state.requestConfirm)
    const t = useT()

    const [draft, setDraft] = useState<IWorkspace | undefined>(workspace)
    const sourceWorkspace = useRef(workspace)
    const [warning, setWarning] = useState<string>()
    const [saving, setSaving] = useState(false)
    const [section, setSection] = useState<IWorkspaceSection>('General')
    const [environmentSection, setEnvironmentSection] = useState<IEnvironmentSection>('General')
    const [environmentId, setEnvironmentId] = useState<string>()
    const [endpointId, setEndpointId] = useState<string>()

    useEffect(() => {
        const previous = sourceWorkspace.current
        sourceWorkspace.current = workspace
        setDraft((current) => current !== previous && current?.id === workspace?.id ? current : workspace)
    }, [workspace])

    if (!draft) {
        return (
            <DialogSurface label={t('Workspace')} onClose={props.onClose}>
                <div className="empty">{t('Create a workspace first')}</div>
            </DialogSurface>
        )
    }

    const environment = draft.environments.find((item) => item.id === environmentId) ??
        draft.environments.find((item) => item.id === draft.defaultEnvironmentId) ??
        draft.environments[0]
    const endpoint = draft.endpoints.find((item) => item.id === endpointId) ??
        draft.endpoints.find((item) => item.id === draft.defaultEndpointId) ??
        draft.endpoints[0]

    function patch(patchValue: Partial<IWorkspace>): void {
        setDraft((current) => current ? { ...current, ...patchValue } : current)
    }

    function patchEnvironment(value: Partial<IEnvironment>): void {
        if (!environment) return
        setDraft((current) => current && ({
            ...current,
            environments: current.environments.map((item) =>
                item.id === environment.id ? { ...item, ...value } : item,
            ),
        }))
    }

    function patchEndpoint(value: Partial<IEndpoint>): void {
        if (!endpoint) return
        setDraft((current) => current && ({
            ...current,
            endpoints: current.endpoints.map((item) =>
                item.id === endpoint.id ? { ...item, ...value } : item,
            ),
        }))
    }

    function addEnvironment(): void {
        if (!draft) return
        const name = t('New environment')
        const id = freshId(name, draft.environments)
        patch({
            environments: [
                ...draft.environments,
                { id, name, production: false, variables: {}, headers: {}, auth: { type: 'none' } },
            ],
            defaultEnvironmentId: draft.defaultEnvironmentId ?? id,
        })
        setEnvironmentId(id)
        setEnvironmentSection('General')
    }

    function removeEnvironment(): void {
        if (!draft || !environment) return
        const environments = draft.environments.filter((item) => item.id !== environment.id)
        patch({
            environments,
            defaultEnvironmentId: draft.defaultEnvironmentId === environment.id
                ? environments[0]?.id
                : draft.defaultEnvironmentId,
        })
        setEnvironmentId(undefined)
        setEnvironmentSection('General')
    }

    function addEndpoint(): void {
        if (!draft) return
        const name = t('New endpoint')
        const id = freshId(name, draft.endpoints)
        patch({
            endpoints: [
                ...draft.endpoints,
                { id, name, url: 'https://', headers: {}, acceptInvalidCerts: false },
            ],
            defaultEndpointId: draft.defaultEndpointId ?? id,
        })
        setEndpointId(id)
    }

    function removeEndpoint(): void {
        if (!draft || !endpoint) return
        const endpoints = draft.endpoints.filter((item) => item.id !== endpoint.id)
        patch({
            endpoints,
            defaultEndpointId: draft.defaultEndpointId === endpoint.id
                ? endpoints[0]?.id
                : draft.defaultEndpointId,
        })
        setEndpointId(undefined)
    }

    function confirmDeleteWorkspace(): void {
        if (!workspace || workspace.id !== draft?.id) return

        requestConfirm({
            title: t('Delete workspace'),
            description: t('Workspace “{name}” will be permanently deleted from disk, including its collections, flows, history and open drafts.', {
                name: workspace.name,
            }),
            actionLabel: t('Delete workspace'),
            danger: true,
            run: async () => {
                setSaving(true)
                setWarning(undefined)
                try {
                    await deleteWorkspace(workspace.id)
                    props.onClose()
                } catch (error) {
                    setWarning(error instanceof Error ? error.message : String(error))
                } finally {
                    setSaving(false)
                }
            },
        })
    }

    return (
        <DialogSurface
            label={t('Workspace settings')}
            className="dialog--wide workspace-settings"
            onClose={() => { if (!saving) props.onClose() }}
        >
            <header className="workspace-settings__header">
                <h2 className="dialog__title">{t('Workspace settings')}</h2>
                <span className="workspace-settings__name" title={draft.name}>{draft.name}</span>
            </header>
            <div className="settings-dialog__layout workspace-settings__layout">
                <nav className="settings-dialog__nav" aria-label={t('Workspace settings')}>
                    {WORKSPACE_SECTIONS.map((item) => (
                        <button
                            key={item}
                            type="button"
                            className="settings-dialog__link"
                            aria-current={section === item ? 'page' : undefined}
                            onClick={() => setSection(item)}
                        >
                            {t(item)}
                        </button>
                    ))}
                </nav>

                <div className="settings-dialog__content workspace-settings__content">
                    {section === 'General' && (
                        <div className="workspace-settings__entry">
                            <label className="field">
                                <span className="field__label">{t('Protection')}</span>
                                <select
                                    className="select"
                                    value={draft.protection}
                                    onChange={(event) => patch({
                                        protection: WorkspaceSchema.shape.protection.parse(event.target.value),
                                    })}
                                >
                                    <option value="none">{t('None — mutations run as usual')}</option>
                                    <option value="confirm">{t('Confirmation for every mutation')}</option>
                                    <option value="readOnly">{t('Read only — mutations are refused')}</option>
                                </select>
                                <span className="inspector__hint">{t('applies to the app and to the agent (MCP)')}</span>
                            </label>
                            <div className="workspace-settings__delete">
                                <button
                                    type="button"
                                    className="btn btn--danger"
                                    disabled={saving}
                                    onClick={confirmDeleteWorkspace}
                                >
                                    {t('Delete workspace…')}
                                </button>
                            </div>
                        </div>
                    )}

                    {section === 'Endpoints' && (
                        <div className="workspace-settings__detail-layout">
                            <WorkspaceItemPicker
                                label={t('Endpoints')}
                                items={draft.endpoints}
                                activeId={endpoint?.id}
                                defaultId={draft.defaultEndpointId}
                                addLabel={t('+ Endpoint')}
                                onSelect={setEndpointId}
                                onAdd={addEndpoint}
                            />
                            {endpoint && (
                                <section key={endpoint.id} className="workspace-settings__entry">
                                    <WorkspaceItemActions
                                        name={endpoint.name}
                                        nameLabel={t('Endpoint name')}
                                        isDefault={draft.defaultEndpointId === endpoint.id}
                                        deleteLabel={t('Delete endpoint')}
                                        canDelete={draft.endpoints.length > 1}
                                        onName={(name) => patchEndpoint({ name })}
                                        onDefault={() => patch({ defaultEndpointId: endpoint.id })}
                                        onDelete={removeEndpoint}
                                    />
                                    <label className="field">
                                        <span className="field__label">{t('URL')}</span>
                                        <input
                                            className="input mono"
                                            autoCorrect="off"
                                            autoCapitalize="off"
                                            spellCheck={false}
                                            value={endpoint.url}
                                            onChange={(event) => patchEndpoint({ url: event.target.value })}
                                        />
                                    </label>
                                    <div className="field">
                                        <span className="field__label">{t('Headers')}</span>
                                        <KeyValueEditor
                                            value={endpoint.headers}
                                            onChange={(headers) => patchEndpoint({ headers })}
                                            keyPlaceholder="x-api-key"
                                            valuePlaceholder={t('value or {{variable}}')}
                                            addLabel={t('+ Header')}
                                        />
                                    </div>
                                </section>
                            )}
                        </div>
                    )}

                    {section === 'Environments' && (
                        <div className="workspace-settings__detail-layout">
                            <WorkspaceItemPicker
                                label={t('Environments')}
                                items={draft.environments}
                                activeId={environment?.id}
                                defaultId={draft.defaultEnvironmentId}
                                addLabel={t('+ Environment')}
                                onSelect={setEnvironmentId}
                                onAdd={addEnvironment}
                            />
                            {environment && (
                                <section key={environment.id} className="workspace-settings__entry">
                                    <nav className="workspace-settings__tabs" aria-label={t('Environment settings')}>
                                        {ENVIRONMENT_SECTIONS.map((item) => (
                                            <button
                                                key={item}
                                                type="button"
                                                className="workspace-settings__tab"
                                                aria-current={environmentSection === item ? 'page' : undefined}
                                                onClick={() => setEnvironmentSection(item)}
                                            >
                                                {t(item)}
                                            </button>
                                        ))}
                                    </nav>
                                    {environmentSection === 'General' && (
                                        <>
                                            <WorkspaceItemActions
                                                name={environment.name}
                                                nameLabel={t('Environment name')}
                                                isDefault={draft.defaultEnvironmentId === environment.id}
                                                deleteLabel={t('Delete environment')}
                                                canDelete={draft.environments.length > 1}
                                                onName={(name) => patchEnvironment({ name })}
                                                onDefault={() => patch({ defaultEnvironmentId: environment.id })}
                                                onDelete={removeEnvironment}
                                            />
                                            <label className="row">
                                                <input
                                                    type="checkbox"
                                                    checked={environment.production}
                                                    onChange={(event) => patchEnvironment({ production: event.target.checked })}
                                                />
                                                <span>
                                                    {t('Mark as')}{' '}
                                                    <span className="badge badge--prod">PROD</span>{' '}
                                                    {t('and ask for confirmation before mutations and flows')}
                                                </span>
                                            </label>
                                        </>
                                    )}
                                    {environmentSection === 'Headers and variables' && (
                                        <>
                                            <div className="field">
                                                <span className="field__label">{t('Variables')}</span>
                                                <KeyValueEditor
                                                    value={environment.variables}
                                                    onChange={(variables) => patchEnvironment({ variables })}
                                                    keyPlaceholder="token"
                                                    valuePlaceholder={t('value')}
                                                    addLabel={t('+ Variable')}
                                                    secretHint={secretStorage === 'file' ? t('stored in the file') : t('stored in Keychain')}
                                                />
                                            </div>
                                            <div className="field">
                                                <span className="field__label">{t('Headers')}</span>
                                                <KeyValueEditor
                                                    value={environment.headers}
                                                    onChange={(headers) => patchEnvironment({ headers })}
                                                    keyPlaceholder="authorization"
                                                    valuePlaceholder="Bearer {{token}}"
                                                    addLabel={t('+ Header')}
                                                />
                                            </div>
                                        </>
                                    )}
                                    {environmentSection === 'Authorization' && (
                                        <RecoveryEditor
                                            environment={environment}
                                            flowOptions={flows}
                                            onChange={(recovery) => patchEnvironment({ recovery })}
                                        />
                                    )}
                                    {environmentSection === 'Scripts' && (
                                        <RequestScriptsEditor
                                            scripts={environment.scripts}
                                            environment={environment}
                                            onChange={(scripts) => patchEnvironment({ scripts })}
                                        />
                                    )}
                                </section>
                            )}
                        </div>
                    )}

                    {warning && <div className="form-error" role="alert">{warning}</div>}
                </div>
            </div>

            <div className="dialog__footer">
                <button type="button" className="btn" disabled={saving} onClick={props.onClose}>
                    {t('Close')}
                </button>
                <button
                    type="button"
                    className="btn btn--primary"
                    disabled={saving}
                    onClick={() => {
                        setSaving(true)
                        setWarning(undefined)
                        void saveWorkspace(draft)
                            .then(props.onClose)
                            .catch((error) =>
                                setWarning(error instanceof Error ? error.message : String(error)),
                            )
                            .finally(() => setSaving(false))
                    }}
                >
                    {t('Save')}
                </button>
            </div>
        </DialogSurface>
    )
}

function freshId(name: string, items: readonly { id: string }[]): string {
    const base = toSlug(name) || 'item'
    const taken = new Set(items.map((item) => item.id))
    let id = base
    for (let index = 2; taken.has(id); index += 1) id = `${base}-${index}`

    return id
}

interface IWorkspaceItemPickerProps {
    label: string
    items: readonly { id: string; name: string }[]
    activeId?: string
    defaultId?: string
    addLabel: string
    onSelect: (id: string) => void
    onAdd: () => void
}

function WorkspaceItemPicker(props: IWorkspaceItemPickerProps): React.JSX.Element {
    const t = useT()
    return (
        <div className="workspace-settings__picker">
            <select
                className="select"
                aria-label={props.label}
                value={props.activeId ?? ''}
                disabled={props.items.length === 0}
                onChange={(event) => props.onSelect(event.target.value)}
            >
                {props.items.length === 0 && <option value="">—</option>}
                {props.items.map((item) => (
                    <option key={item.id} value={item.id}>
                        {item.name || item.id}{item.id === props.defaultId ? ` · ${t('default')}` : ''}
                    </option>
                ))}
            </select>
            <button type="button" className="btn" onClick={props.onAdd}>
                {props.addLabel}
            </button>
        </div>
    )
}

interface IWorkspaceItemActionsProps {
    name: string
    nameLabel: string
    isDefault: boolean
    deleteLabel: string
    canDelete: boolean
    onName: (name: string) => void
    onDefault: () => void
    onDelete: () => void
}

function WorkspaceItemActions(props: IWorkspaceItemActionsProps): React.JSX.Element {
    const t = useT()
    return (
        <div className="workspace-settings__item-actions">
            <label className="field">
                <span className="field__label">{props.nameLabel}</span>
                <input className="input" value={props.name} onChange={(event) => props.onName(event.target.value)} />
            </label>
            {!props.isDefault && (
                <button type="button" className="btn" onClick={props.onDefault}>{t('Make default')}</button>
            )}
            <button
                type="button"
                className="btn btn--quiet"
                title={props.deleteLabel}
                aria-label={props.deleteLabel}
                disabled={!props.canDelete}
                onClick={props.onDelete}
            >
                {t('Delete')}
            </button>
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
                    <span className="mono">{tokenVariable}</span> {t('and substituted wherever')}{' '}
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
                                        props.onChange({
                                            ...recovery,
                                            onExpiry: event.target.checked,
                                        })
                                    }
                                />
                                <span>{t('before expiry')}</span>
                            </label>
                            <label className="row">
                                <input
                                    type="checkbox"
                                    checked={recovery.onError}
                                    onChange={(event) =>
                                        props.onChange({
                                            ...recovery,
                                            onError: event.target.checked,
                                        })
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
