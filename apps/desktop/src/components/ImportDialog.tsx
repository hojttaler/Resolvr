import { parseImportFile, type IImportBundle, type IImportResult } from '@resolvr/core'
import { useEffect, useRef, useState } from 'react'

import { tn, useT } from '../i18n/index.js'
import { useAppStore } from '../state/store.js'

/**
 * Импорт коллекций из Postman и Insomnia.
 *
 * Файл читается в webview через `<input type="file">`, а не через плагин
 * файловой системы: экспорт лежит где угодно, а доступ плагина ограничен
 * библиотекой. Перед записью показывается, что именно будет создано, —
 * импорт необратим, и человек должен видеть счёт до подтверждения.
 */
export function ImportDialog(props: { onClose: () => void }): React.JSX.Element {
    const importFromBundle = useAppStore((state) => state.importFromBundle)
    const t = useT()
    const fileInput = useRef<HTMLInputElement>(null)
    const [fileName, setFileName] = useState<string | undefined>()
    const [bundle, setBundle] = useState<IImportBundle | undefined>()
    const [error, setError] = useState<string | undefined>()
    const [result, setResult] = useState<IImportResult | undefined>()
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        function onKeyDown(event: KeyboardEvent): void {
            if (event.key === 'Escape') props.onClose()
        }

        window.addEventListener('keydown', onKeyDown)

        return () => window.removeEventListener('keydown', onKeyDown)
    }, [props])

    async function pick(file: File | undefined): Promise<void> {
        setResult(undefined)
        setError(undefined)
        setBundle(undefined)
        if (!file) return

        setFileName(file.name)
        const text = await file.text()
        const parsed = parseImportFile(text)
        if (!parsed) {
            setError(t('This file is not a Postman collection, a Postman environment or an Insomnia export'))

            return
        }

        setBundle(parsed)
    }

    async function run(): Promise<void> {
        if (!bundle) return

        setBusy(true)
        try {
            setResult(await importFromBundle(bundle))
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : String(caught))
        } finally {
            setBusy(false)
        }
    }

    const operations = bundle?.collections.reduce((sum, item) => sum + item.operations.length, 0) ?? 0

    return (
        <div className="overlay" onMouseDown={props.onClose}>
            <div className="dialog" onMouseDown={(event) => event.stopPropagation()}>
                <div className="dialog__body">
                    <div className="dialog__title">{t('Import from Postman or Insomnia')}</div>

                    <p className="dialog__text">
                        {t(
                            'Postman Collection v2.1, Postman Environment or Insomnia export v4. Only GraphQL requests are imported; folders become collections.',
                        )}
                    </p>

                    <input
                        ref={fileInput}
                        type="file"
                        accept=".json,application/json"
                        style={{ display: 'none' }}
                        onChange={(event) => void pick(event.target.files?.[0])}
                    />

                    <div className="row">
                        <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
                            {t('Choose file…')}
                        </button>
                        {fileName && <span className="inspector__hint mono">{fileName}</span>}
                    </div>

                    {error && <div style={{ color: 'var(--danger)' }}>{error}</div>}

                    {bundle && !result && (
                        <div className="import-preview">
                            <div className="settings__caption">
                                {bundle.source === 'postman' ? 'Postman' : 'Insomnia'}
                            </div>
                            <div>
                                {tn(bundle.collections.length, 'collection|collections')} ·{' '}
                                {tn(operations, 'operation|operations')} ·{' '}
                                {tn(bundle.environments.length, 'environment|environments')}
                                {bundle.skipped > 0 && (
                                    <span className="inspector__hint">
                                        {' '}
                                        · {t('{n} non-GraphQL requests skipped', { n: bundle.skipped })}
                                    </span>
                                )}
                            </div>
                            <ul className="import-preview__list">
                                {bundle.collections.map((collection) => (
                                    <li key={collection.name}>
                                        <b>{collection.name}</b>{' '}
                                        <span className="inspector__hint">
                                            {tn(collection.operations.length, 'operation|operations')}
                                        </span>
                                    </li>
                                ))}
                                {bundle.environments.map((environment) => (
                                    <li key={`env-${environment.name}`}>
                                        <span className="badge">ENV</span> {environment.name}{' '}
                                        <span className="inspector__hint">
                                            {tn(Object.keys(environment.variables).length, 'variable|variables')}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                            {bundle.environments.length > 0 && (
                                <div className="inspector__hint">
                                    {t(
                                        'Environment values are imported as plain variables. Move tokens to secrets afterwards: right-click a value in a response → “Save to environment variable…”.',
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {result && (
                        <div className="notice">
                            <b>{t('Imported')}:</b> {tn(result.collections, 'collection|collections')},{' '}
                            {tn(result.operations, 'operation|operations')},{' '}
                            {tn(result.environments, 'environment|environments')}.
                        </div>
                    )}
                </div>

                <div className="dialog__footer">
                    <button type="button" className="btn" onClick={props.onClose}>
                        {result ? t('Done') : t('Cancel')}
                    </button>
                    {!result && (
                        <button
                            type="button"
                            className="btn btn--primary"
                            disabled={!bundle || busy}
                            onClick={() => void run()}
                        >
                            {busy ? t('Importing…') : t('Import')}
                        </button>
                    )}
                </div>
            </div>
        </div>
    )
}
