import { toSlug } from '@resolvr/core'
import { useEffect, useState } from 'react'

import { getAppContext } from '../platform/context.js'
import { useAppStore } from '../state/store.js'

export interface IDialogProps {
    onClose: () => void
}

/** Сохранение текущей вкладки в коллекцию. */
export function SaveOperationDialog(props: IDialogProps): React.JSX.Element {
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
                setError('Выберите коллекцию или укажите название новой')

                return
            }

            await saveActiveTab(targetCollection, toSlug(name) === '' ? 'operation' : name.trim())
            props.onClose()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught))
        }
    }

    return (
        <Modal title="Сохранить операцию" onClose={props.onClose} onSubmit={submit}>
            <div className="field">
                <label className="field__label">Имя операции</label>
                <input
                    className="input"
                    value={name}
                    autoFocus
                    onChange={(event) => setName(event.target.value)}
                />
            </div>

            <div className="field">
                <label className="field__label">Коллекция</label>
                <select
                    className="select"
                    style={{ maxWidth: 'none', width: '100%' }}
                    value={collectionId}
                    onChange={(event) => setCollectionId(event.target.value)}
                    disabled={newCollection.trim().length > 0}
                >
                    {tree.length === 0 && <option value="">Нет коллекций</option>}
                    {tree.map((node) => (
                        <option key={node.collection.id} value={node.collection.id}>
                            {node.collection.name}
                        </option>
                    ))}
                </select>
            </div>

            <div className="field">
                <label className="field__label">…или создать новую</label>
                <input
                    className="input"
                    placeholder="Например, Users"
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
    const createWorkspace = useAppStore((state) => state.createWorkspace)
    const [name, setName] = useState('')
    const [url, setUrl] = useState('http://localhost:4000/graphql')
    const [error, setError] = useState<string | undefined>()

    async function submit(): Promise<void> {
        if (name.trim().length === 0) {
            setError('Укажите название')

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
        <Modal title="Новый workspace" onClose={props.onClose} onSubmit={submit}>
            <div className="field">
                <label className="field__label">Название</label>
                <input
                    className="input"
                    autoFocus
                    placeholder="Backend API"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                />
            </div>

            <div className="field">
                <label className="field__label">GraphQL-эндпоинт</label>
                <input
                    className="input mono"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                />
                <span className="inspector__hint">
                    После создания приложение выполнит интроспекцию схемы.
                </span>
            </div>

            {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
        </Modal>
    )
}

/**
 * Подтверждение необратимого действия: prod-guard, удаление коллекции.
 *
 * Кнопка действия без фокуса по умолчанию и без ⌘↩: тот же жест, что
 * запустил мутацию, не должен её и подтверждать.
 */
export function ConfirmDialog(): React.JSX.Element | null {
    const confirm = useAppStore((state) => state.confirm)
    const dismiss = useAppStore((state) => state.dismissConfirm)

    useEffect(() => {
        if (!confirm) return

        function onKeyDown(event: KeyboardEvent): void {
            if (event.key === 'Escape') dismiss()
        }

        window.addEventListener('keydown', onKeyDown)

        return () => window.removeEventListener('keydown', onKeyDown)
    }, [confirm, dismiss])

    if (!confirm) return null

    return (
        <div className="overlay" onMouseDown={dismiss}>
            <div
                className={`dialog${confirm.danger ? ' dialog--danger' : ''}`}
                onMouseDown={(event) => event.stopPropagation()}
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
                        Отмена
                    </button>
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
            </div>
        </div>
    )
}

interface IModalProps {
    title: string
    children: React.ReactNode
    onClose: () => void
    onSubmit: () => void | Promise<void>
}

function Modal(props: IModalProps): React.JSX.Element {
    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (event.key === 'Escape') props.onClose()
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void props.onSubmit()
        }

        window.addEventListener('keydown', onKeyDown)

        return () => window.removeEventListener('keydown', onKeyDown)
    }, [props])

    return (
        <div className="overlay" onMouseDown={props.onClose}>
            <div className="dialog" onMouseDown={(event) => event.stopPropagation()}>
                <div className="dialog__body">
                    <div className="dialog__title">{props.title}</div>
                    {props.children}
                </div>

                <div className="dialog__footer">
                    <button type="button" className="btn" onClick={props.onClose}>
                        Отмена
                    </button>
                    <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => void props.onSubmit()}
                    >
                        Сохранить
                    </button>
                </div>
            </div>
        </div>
    )
}
