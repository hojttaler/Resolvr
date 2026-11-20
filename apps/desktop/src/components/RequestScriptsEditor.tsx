import {
    REQUEST_SCRIPT_CRYPTO_MODULE,
    REQUEST_SCRIPT_MAX_LENGTH,
    splitScriptImports,
    type IEnvironment,
    type IRequestScripts,
} from '@resolvr/core'
import { useId, useMemo, useRef, useState } from 'react'

import { useT } from '../i18n/index.js'
import { extractOperationName, findOperation, parseVariables, selectActiveEndpoint, selectActiveEnvironment, useAppStore } from '../state/store.js'
import { DialogSurface } from './DialogSurface.js'
import { CodeEditor, type ICodeEditorHandle } from './editor/CodeEditor.js'
import { createScriptCompletion } from './editor/script-completion.js'
import { buildScriptContext } from './editor/script-context.js'

interface IRequestScriptsEditorProps {
    scripts?: IRequestScripts
    environment?: IEnvironment
    onChange: (scripts: IRequestScripts) => void
}

const EDITORS = [
    {
        key: 'preRequest',
        label: 'Pre-request',
        placeholder: 'request.variables.timestamp = new Date().toISOString()',
        hint: 'Edit request.variables or request.headers before sending.',
    },
    {
        key: 'postRequest',
        label: 'Post-request',
        placeholder: "assert(response.status === 200, 'Expected HTTP 200')",
        hint: 'Read response.data or response.errors and use assert(condition, message).',
    },
] as const

export function RequestScriptsEditor(props: IRequestScriptsEditorProps): React.JSX.Element {
    const t = useT()
    const id = useId()
    const [phase, setPhase] = useState<(typeof EDITORS)[number]['key']>('preRequest')
    const [modulesOpen, setModulesOpen] = useState(false)
    const preRequestEditor = useRef<ICodeEditorHandle>(null)
    const tab = useAppStore((state) => state.tabs.find((item) => item.id === state.activeTabId))
    const content = useAppStore((state) => tab?.kind === 'operation' ? state.contents[tab.id] : undefined)
    const schema = useAppStore((state) => state.schema)
    const operation = useAppStore((state) => findOperation(state.tree, tab?.operationRef))
    const collectionHeaders = useAppStore((state) =>
        state.tree.find((node) => node.collection.id === operation?.collectionId)?.collection.headers,
    )
    const endpoint = useAppStore(selectActiveEndpoint)
    const activeEnvironment = useAppStore(selectActiveEnvironment)
    const environment = props.environment ?? activeEnvironment
    const result = useAppStore((state) => tab ? state.runs[tab.id]?.result : undefined)
    const responseHeaders = result?.endpointId === endpoint?.id && result?.environmentId === environment?.id
        ? result?.headers : undefined

    const query = content?.query ?? ''
    const variablesText = content?.variables
    const requestHeaders = content?.headers
    const completion = useMemo(() => {
        const parsed = parseVariables(variablesText ?? '{}')
        const scope = buildScriptContext({
            query,
            operationName: extractOperationName(query),
            schema,
            variables: { ...operation?.variables, ...(parsed instanceof Error ? {} : parsed) },
            requestHeaders: Object.keys({ ...operation?.headers, ...requestHeaders }),
            inheritedHeaders: Object.keys({ ...endpoint?.headers, ...environment?.headers, ...collectionHeaders }),
            responseHeaders: Object.keys(responseHeaders ?? {}),
        })

        return {
            preRequest: createScriptCompletion(scope, 'preRequest'),
            postRequest: createScriptCompletion(scope, 'postRequest'),
        }
    }, [query, schema, variablesText, operation, requestHeaders, endpoint?.headers, environment?.headers, collectionHeaders, responseHeaders])

    return (
        <div className="request-scripts">
            <div className="request-scripts__toolbar">
                <div className="segmented" role="group" aria-label={t('Scripts')}>
                    {EDITORS.map(({ key, label }) => (
                        <button
                            key={key}
                            type="button"
                            className={`segmented__item${phase === key ? ' segmented__item--active' : ''}`}
                            aria-pressed={phase === key}
                            aria-controls={`${id}-${key}`}
                            onClick={() => setPhase(key)}
                        >
                            {t(label)}
                        </button>
                    ))}
                </div>
                <div className="request-scripts__tools">
                    <button
                        type="button"
                        className="btn btn--quiet"
                        aria-haspopup="dialog"
                        onClick={() => setModulesOpen(true)}
                    >
                        {t('Modules')}
                    </button>
                    <span className="inspector__hint" title={t('Press Ctrl+Space for JavaScript suggestions')}>
                        JavaScript · <kbd>Ctrl+Space</kbd>
                    </span>
                </div>
            </div>
            {EDITORS.map(({ key, label, placeholder, hint }) => (
                <div key={key} id={`${id}-${key}`} className="request-scripts__stage" hidden={phase !== key}>
                    <div className="request-scripts__editor">
                        <CodeEditor
                            ref={key === 'preRequest' ? preRequestEditor : undefined}
                            language="javascript"
                            ariaLabel={t(label)}
                            ariaDescribedBy={`${id}-${key}-hint`}
                            value={props.scripts?.[key] ?? ''}
                            onChange={(value) => props.onChange({
                                ...props.scripts,
                                [key]: value || undefined,
                            })}
                            completionSource={completion[key]}
                            placeholder={placeholder}
                            maxLength={REQUEST_SCRIPT_MAX_LENGTH}
                        />
                    </div>
                    <div id={`${id}-${key}-hint`} className="inspector__hint">{t(hint)}</div>
                </div>
            ))}
            {modulesOpen && (
                <ScriptModules
                    preRequest={props.scripts?.preRequest ?? ''}
                    onClose={() => setModulesOpen(false)}
                    onInsert={(text) => {
                        preRequestEditor.current?.insertAtStart(text)
                        setPhase('preRequest')
                        setModulesOpen(false)
                    }}
                />
            )}
        </div>
    )
}

interface IScriptModulesProps {
    preRequest: string
    onClose: () => void
    onInsert: (text: string) => void
}

function ScriptModules({ preRequest, onClose, onInsert }: IScriptModulesProps): React.JSX.Element {
    const t = useT()
    const module = REQUEST_SCRIPT_CRYPTO_MODULE
    const imported = splitScriptImports(preRequest).modules.includes(module.name)
    const text = module.importStatement + (preRequest.trim() ? '\n\n' : '\n')
    const tooLong = preRequest.length + text.length > REQUEST_SCRIPT_MAX_LENGTH

    return (
        <DialogSurface label={t('Available script modules')} onClose={onClose}>
            <div className="dialog__body">
                <h2 className="dialog__title">{t('Available script modules')}</h2>
                <div className="row">
                    <strong className="mono selectable">{module.name}</strong>
                    <span className="badge">{t('Pre-request')}</span>
                </div>
                <pre className="request-scripts__import selectable"><code>{module.importStatement}</code></pre>
                <code className="selectable">{module.signature}</code>
                <div className="inspector__hint">
                    {t('Signs the given UTF-8 string using a secret from the selected environment. The result is hex by default. Pass "base64" for Base64.')}
                </div>
            </div>
            <div className="dialog__footer">
                <button type="button" className="btn" onClick={onClose}>{t('Close')}</button>
                <button
                    type="button"
                    className="btn btn--primary"
                    disabled={imported || tooLong}
                    onClick={() => onInsert(text)}
                >
                    {t(imported ? 'Import already added' : tooLong ? 'Script length limit reached' : 'Insert import')}
                </button>
            </div>
        </DialogSurface>
    )
}
