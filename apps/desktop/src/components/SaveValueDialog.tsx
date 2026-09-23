import { useEffect, useState } from 'react'

import { toEnvironmentValue } from '@resolvr/core'

import { findOperation, selectActiveEnvironment, useAppStore } from '../state/store.js'
import { useT } from '../i18n/index.js'

export interface ISaveValueDialogProps {
    /** Путь в ответе — из него предлагается имя переменной. */
    path: string
    /** Значение любого типа: объекты и массивы сохраняются JSON-текстом. */
    value: unknown
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
    const t = useT()
    const saveValue = useAppStore((state) => state.saveValueToEnvironment)
    const setEnvironmentCaptures = useAppStore((state) => state.setEnvironmentCaptures)
    const operationRef = useAppStore(
        (state) => state.tabs.find((tab) => tab.id === state.activeTabId)?.operationRef,
    )
    const operation = useAppStore((state) => findOperation(state.tree, operationRef))
    const text = toEnvironmentValue(props.value)
    // Правило читает путь от корня ответа; путь события подписки к нему не привязан.
    const canCapture = operation !== undefined && /^data(\.|$)/.test(props.path)

    const suggested = suggestName(props.path)
    const looksLikeToken = TOKEN_HINT.test(props.path)

    const [name, setName] = useState(suggested)
    const [secret, setSecret] = useState(looksLikeToken)
    const [asAuthHeader, setAsAuthHeader] = useState(looksLikeToken)
    const [everyRun, setEveryRun] = useState(false)
    const [error, setError] = useState<string | undefined>()

    const environment = useAppStore(selectActiveEnvironment)

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (event.key === 'Escape') props.onClose()
        }

        window.addEventListener('keydown', onKeyDown)

        return () => window.removeEventListener('keydown', onKeyDown)
    }, [props])

    async function submit(): Promise<void> {
        if (name.trim().length === 0) {
            setError(t('Enter a variable name'))

            return
        }

        try {
            await saveValue({ name: name.trim(), value: text, secret, asAuthHeader })

            // Правило заменяет прежнее для той же переменной: две записи в
            // одну переменную спорили бы, чья победит.
            if (everyRun && canCapture && operationRef && operation) {
                await setEnvironmentCaptures(operationRef, [
                    ...operation.saveToEnvironment.filter((item) => item.variable !== name.trim()),
                    { variable: name.trim(), path: props.path, secret },
                ])
            }
            props.onClose()
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught))
        }
    }

    return (
        <div className="overlay" onMouseDown={props.onClose}>
            <div className="dialog" onMouseDown={(event) => event.stopPropagation()}>
                <div className="dialog__body">
                    <div className="dialog__title">{t('Save value')}</div>

                    <div className="inspector__hint">
                        {t('From response:')} <span className="mono">{props.path}</span>
                        <br />
                        {t('To environment:')} <b>{environment?.name ?? '—'}</b>
                    </div>

                    <div className="field">
                        <label className="field__label">{t('Variable name')}</label>
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
                            {t('Use in headers and variables as')}{' '}
                            <span className="mono">{`{{${name || t('name')}}}`}</span>
                        </span>
                    </div>

                    <label className="row">
                        <input
                            type="checkbox"
                            checked={secret}
                            onChange={(event) => setSecret(event.target.checked)}
                        />
                        <span>
                            {t('Secret — keep in the secret store')}
                            <div className="inspector__hint">
                                {t('only a reference goes to files; the value is masked in history')}
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
                            {t('Add environment header')}
                            <div className="inspector__hint mono">
                                authorization: Bearer {`{{${name || t('name')}}}`}
                            </div>
                        </span>
                    </label>

                    <label className="row">
                        <input
                            type="checkbox"
                            checked={everyRun}
                            disabled={!canCapture}
                            onChange={(event) => setEveryRun(event.target.checked)}
                        />
                        <span>
                            {t('Save after every run')}
                            <div className="inspector__hint">
                                {canCapture
                                    ? t('the rule is stored in operation “{name}”', { name: operation.name })
                                    : t('available for saved operations')}
                            </div>
                        </span>
                    </label>

                    <div className="raw mono selectable" style={{ maxHeight: 90, overflow: 'auto' }}>
                        {text.slice(0, 300)}
                        {text.length > 300 ? '…' : ''}
                    </div>

                    {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}
                </div>

                <div className="dialog__footer">
                    <button type="button" className="btn" onClick={props.onClose}>
                        {t('Cancel')}
                    </button>
                    <button type="button" className="btn btn--primary" onClick={() => void submit()}>
                        {t('Save')}
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
