import type { ISchemaChange } from '@resolvr/core'

import { useAppStore } from '../state/store.js'

/**
 * Правая панель: сведения о схеме и о том, что в ней изменилось.
 *
 * Diff отвечает на вопрос «что сломалось после деплоя»: сравнивается снимок
 * схемы, сохранённый при предыдущей интроспекции, с текущим.
 */
export function Inspector(): React.JSX.Element {
    const workspace = useAppStore((state) => state.workspace)
    const schema = useAppStore((state) => state.schema)
    const schemaFetchedAt = useAppStore((state) => state.schemaFetchedAt)
    const refreshSchema = useAppStore((state) => state.refreshSchema)
    const tabs = useAppStore((state) => state.tabs)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const compareSchema = useAppStore((state) => state.compareSchema)
    const changes = useAppStore((state) => state.schemaDiff)
    const diffError = useAppStore((state) => state.schemaDiffNote)

    const activeTab = tabs.find((tab) => tab.id === activeTabId)

    return (
        <div className="panel">
            <div className="panel__header">
                <span className="panel__title">Инспектор</span>
                <span className="panel__spacer" />
                <button type="button" className="btn btn--quiet" onClick={() => void refreshSchema()}>
                    Обновить схему
                </button>
            </div>

            <div className="panel__content" style={{ padding: 'var(--pad-md)' }}>
                <div className="inspector__section">
                    <div className="inspector__label">Схема</div>
                    <div className="inspector__value">
                        {schema
                            ? `${Object.keys(schema.getTypeMap()).filter((name) => !name.startsWith('__')).length} типов`
                            : 'не загружена'}
                    </div>
                    {schemaFetchedAt && (
                        <div className="inspector__hint">
                            обновлена {new Date(schemaFetchedAt).toLocaleString()}
                        </div>
                    )}
                </div>

                <div className="inspector__section">
                    <div className="inspector__label">Изменения после деплоя</div>
                    <button type="button" className="btn" onClick={() => void compareSchema()}>
                        Сравнить со снимком
                    </button>

                    {diffError && <div className="inspector__hint">{diffError}</div>}

                    {changes && changes.length === 0 && !diffError && (
                        <div className="inspector__hint">Схема не менялась.</div>
                    )}

                    {changes && changes.length > 0 && (
                        <div className="diff">
                            {changes.map((change) => (
                                <div
                                    key={`${change.kind}-${change.path}`}
                                    className={`diff__row${change.breaking ? ' diff__row--breaking' : ''}`}
                                    title={change.description}
                                >
                                    <span className={`badge badge--${badgeFor(change)}`}>
                                        {symbolFor(change)}
                                    </span>
                                    <span className="mono diff__path">{change.path}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="inspector__section">
                    <div className="inspector__label">Окружение</div>
                    <div className="inspector__value">
                        {workspace?.environments.find(
                            (environment) =>
                                environment.id ===
                                (activeTab?.environmentId ?? workspace.defaultEnvironmentId),
                        )?.name ?? '—'}
                    </div>
                    <div className="inspector__hint">
                        Секреты хранятся в Keychain и не попадают в файлы и историю.
                    </div>
                </div>
            </div>
        </div>
    )
}

function badgeFor(change: ISchemaChange): string {
    if (change.breaking) return 'fail'

    return change.kind === 'added' ? 'ok' : 'query'
}

function symbolFor(change: ISchemaChange): string {
    if (change.kind === 'added') return '+'
    if (change.kind === 'removed') return '−'

    return '~'
}
