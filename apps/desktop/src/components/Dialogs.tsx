import { toSlug } from '@resolvr/core'
import { useState } from 'react'
import { DialogSurface } from './DialogSurface.js'

import { getAppContext } from '../platform/context.js'
import { useAppStore } from '../state/store.js'
import { useT } from '../i18n/index.js'
import { isModKey } from '../lib/keys.js'

export interface IDialogProps {
    onClose: () => void
}

/** Сохранение текущей вкладки в коллекцию. */
export function SaveOperationDialog(props: IDialogProps): React.JSX.Element {
    const t = useT()
    const tree = useAppStore((state) => state.tree)
    const workspace = useAppStore((state) => state.workspace)
    const tabs = useAppStore((state) => state.tabs)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const saveActiveTab = useAppStore((state) => state.saveActiveTab)
    const reloadTree = useAppStore((state) => state.reloadTree)

    const activeTab = tabs.find((tab) => tab.id === activeTabId)
    const [collectionId, setCollectionId] = useState(tree[0]?.collection.id ?? '')
    const [newCollection, setNewCollection] = useState('')
    const [name, setName] = useState(activeTab?.title ?? 'newOperation')
    const [error, setError] = useState<string | undefined>()

    async function submit(): Promise<void> {
        if (!workspace) return

        try {
            let targetCollection = collectionId

            if (newCollection.trim().length > 0) {
                const context = await getAppContext()
                const created = await context.workspaces.createCollection(
                    workspace.id,
                    newCollection.trim(),
                )
                targetCollection = created.id
                await reloadTree()
            }

            if (!targetCollection) {
                setError(t('Pick a collection or enter a name for a new one'))

                return
            }

            await saveActiveTab(targetCollection, toSlug(name) === '' ? 'operation' : name.trim())
            props.onClose()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught))
        }
    }

    return (
        <Modal title={t('Save operation')} onClose={props.onClose} onSubmit={submit}>
            <div className="field">
                <label className="field__label">{t('Operation name')}</label>
                <input
                    className="input"
                    value={name}
                    autoFocus
                    onChange={(event) => setName(event.target.value)}
                />
            </div>

            <div className="field">
                <label className="field__label">{t('Collection')}</label>
                <select
                    className="select"
                    style={{ maxWidth: 'none', width: '100%' }}
                    value={collectionId}
                    onChange={(event) => setCollectionId(event.target.value)}
                    disabled={newCollection.trim().length > 0}
                >
                    {tree.length === 0 && <option value="">{t('No collections')}</option>}
                    {tree.map((node) => (
                        <option key={node.collection.id} value={node.collection.id}>
                            {node.collection.name}
                        </option>
                    ))}
                </select>
            </div>

            <div className="field">
                <label className="field__label">{t('…or create a new one')}</label>
                <input
                    className="input"
                    placeholder={t('For example, Users')}
                    value={newCollection}
                    onChange={(event) => setNewCollection(event.target.value)}
                />
            </div>

            {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        </Modal>
    )
}

/** Создание workspace: имя и адрес эндпоинта. */
export function CreateWorkspaceDialog(props: IDialogProps): React.JSX.Element {
    const t = useT()
    const createWorkspace = useAppStore((state) => state.createWorkspace)
    const [name, setName] = useState('')
    const [url, setUrl] = useState('http://localhost:4000/graphql')
    const [error, setError] = useState<string | undefined>()

    async function submit(): Promise<void> {
        if (name.trim().length === 0) {
            setError(t('Enter a name'))

            return
        }

        try {
            await createWorkspace(name.trim(), url.trim())
            props.onClose()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught))
        }
    }

    return (
        <Modal title={t('New workspace')} onClose={props.onClose} onSubmit={submit}>
            <div className="field">
                <label className="field__label">{t('Name')}</label>
                <input
                    className="input"
                    autoFocus
                    placeholder="Backend API"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                />
            </div>

            <div className="field">
                <label className="field__label">{t('GraphQL endpoint')}</label>
                <input
                    className="input mono"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                />
                <span className="inspector__hint">
                    {t('The schema will be fetched by introspection after creation.')}
                </span>
            </div>

            {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        </Modal>
    )
}

/** Ввод недостающих переменных с продолжением приостановленного запуска. */
export function MissingVariablesDialog(): React.JSX.Element | null {
    const prompt = useAppStore((state) => state.missingVariables)
    const t = useT()
    if (!prompt) return null

    return (
        <DialogSurface
            label={t('Missing variables')}
            className="dialog--missing-variables"
            onClose={() => prompt.finish()}
        >
            <form
                className="missing-variables-form"
                onKeyDown={(event) => {
                    if (event.key !== 'Enter' || !isModKey(event.nativeEvent)) return
                    event.preventDefault()
                    event.currentTarget.requestSubmit()
                }}
                onSubmit={(event) => {
                    event.preventDefault()
                    const fields = new FormData(event.currentTarget)
                    prompt.finish(Object.fromEntries(
                        prompt.names.map((name) => {
                            const value = fields.get(name)
                            return [name, typeof value === 'string' ? value : '']
                        }),
                    ))
                }}
            >
                <div className="dialog__body">
                    <div className="dialog__title">{t('Missing variables')}</div>
                    <p className="dialog__text">{t('Values are used for this run only.')}</p>
                    <div className="missing-variables-form__fields">
                        {prompt.names.map((name, index) => (
                            <label key={name} className="missing-variables-form__row">
                                <span className="mono">{`{{${name}}}`}</span>
                                <input
                                    className="input"
                                    name={name}
                                    required
                                    autoFocus={index === 0}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </label>
                        ))}
                    </div>
                </div>
                <div className="dialog__footer">
                    <button type="button" className="btn" onClick={() => prompt.finish()}>{t('Cancel')}</button>
                    <button type="submit" className="btn btn--primary">{t('Continue run')}</button>
                </div>
            </form>
        </DialogSurface>
    )
}

/**
 * Подтверждение необратимого действия: prod-guard, удаление коллекции.
 *
 * Кнопка действия без фокуса по умолчанию и без ⌘↩: тот же жест, что
 * запустил мутацию, не должен её и подтверждать.
 */
export function ConfirmDialog(): React.JSX.Element | null {
    const t = useT()
    const confirm = useAppStore((state) => state.confirm)
    const dismiss = useAppStore((state) => state.dismissConfirm)

    if (!confirm) return null

    return (
        <DialogSurface
            label={confirm.title}
            onClose={dismiss}
            className={confirm.danger ? 'dialog--danger' : undefined}
        >
            <div className="dialog__body">
                <div className="dialog__title">
                    {confirm.production && <span className="badge badge--prod">PROD</span>}{' '}
                    {confirm.title}
                </div>
                <p className="dialog__text">{confirm.description}</p>
            </div>

            <div className="dialog__footer">
                <button type="button" className="btn" onClick={dismiss} autoFocus>
                    {t('Cancel')}
                </button>
                {confirm.secondaryLabel && (
                    <button
                        type="button"
                        className="btn"
                        onClick={() => {
                            dismiss()
                            void confirm.secondaryRun?.()
                        }}
                    >
                        {confirm.secondaryLabel}
                    </button>
                )}
                <button
                    type="button"
                    className={`btn ${confirm.danger ? 'btn--danger' : 'btn--primary'}`}
                    onClick={() => {
                        dismiss()
                        void confirm.run()
                    }}
                >
                    {confirm.actionLabel}
                </button>
            </div>
        </DialogSurface>
    )
}

interface IModalProps {
    title: string
    children: React.ReactNode
    onClose: () => void
    onSubmit: () => void | Promise<void>
}

function Modal(props: IModalProps): React.JSX.Element {
    const t = useT()
    return (
        <DialogSurface
            label={props.title}
            onClose={props.onClose}
            onKeyDown={(event) => {
                if (event.key !== 'Enter' || !isModKey(event.nativeEvent)) return
                event.preventDefault()
                void props.onSubmit()
            }}
        >
            <div className="dialog__body">
                <div className="dialog__title">{props.title}</div>
                {props.children}
            </div>

            <div className="dialog__footer">
                <button type="button" className="btn" onClick={props.onClose}>
                    {t('Cancel')}
                </button>
                <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void props.onSubmit()}
                >
                    {t('Save')}
                </button>
            </div>
        </DialogSurface>
    )
}
