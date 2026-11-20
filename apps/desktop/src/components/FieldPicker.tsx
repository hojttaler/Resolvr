import { useState } from 'react'

import { useT } from '../i18n/index.js'
import { DialogSurface } from './DialogSurface.js'

const FIELD_PAGE_SIZE = 100

export interface IFieldPickerConfig {
    typeName: string
    fields: readonly { name: string; type: string; description?: string; selected?: boolean }[]
    maxDepth?: number
    single?: boolean
    readOnly?: boolean
    emptyMessage?: string
    apply: (names: ReadonlySet<string>, depth: number) => string | undefined
}

/** Ограниченный по высоте выбор полей для запроса и переменных. */
export function FieldPicker(props: {
    config: IFieldPickerConfig
    onClose: () => void
}): React.JSX.Element {
    const { config, onClose } = props
    const [search, setSearch] = useState('')
    const [chosen, setChosen] = useState(new Set<string>())
    const [depth, setDepth] = useState(1)
    const [visibleCount, setVisibleCount] = useState(FIELD_PAGE_SIZE)
    const [error, setError] = useState<string>()
    const t = useT()
    const needle = search.trim().toLowerCase()
    const fields = config.fields.filter((field) => field.name.toLowerCase().includes(needle))
    const title = t('Fields of {name}', { name: config.typeName })
    const available = fields.filter((field) => !field.selected)
    const all = available.length > 0 && available.every((field) => chosen.has(field.name))
    const existing = depth > 1 ? config.fields.filter((field) => field.selected) : []
    const canApply = chosen.size > 0 || existing.length > 0

    function toggle(name: string, checked: boolean): void {
        setChosen((current) => {
            const next = new Set(config.single ? [] : current)
            if (checked) next.add(name)
            else next.delete(name)
            return next
        })
        setError(undefined)
    }

    return (
        <DialogSurface
            label={title}
            className="dialog--field-picker"
            onClose={onClose}
            onKeyDown={(event) => event.stopPropagation()}
        >
            <form
                className="field-picker"
                onSubmit={(event) => {
                    event.preventDefault()
                    if (!canApply) return
                    const message = config.apply(new Set([...chosen, ...existing.map((field) => field.name)]), depth)
                    if (message) setError(message)
                    else onClose()
                }}
            >
                <header className="field-picker__header">
                    <h2 className="dialog__title">{title}</h2>
                    <input
                        type="search"
                        className="input"
                        placeholder={t('Filter fields…')}
                        aria-label={t('Filter fields…')}
                        value={search}
                        onChange={(event) => {
                            setSearch(event.target.value)
                            setVisibleCount(FIELD_PAGE_SIZE)
                        }}
                    />
                    <div className="field-picker__tools">
                        {!config.single && (
                            <button
                                type="button"
                                className="btn btn--quiet"
                                disabled={!available.length}
                                onClick={() => {
                                    setChosen((current) => {
                                        const next = new Set(current)
                                        for (const field of available) {
                                            if (all) next.delete(field.name)
                                            else next.add(field.name)
                                        }
                                        return next
                                    })
                                    setError(undefined)
                                }}
                            >
                                {t(
                                    all
                                        ? 'Clear selection'
                                        : needle
                                          ? 'Select filtered fields'
                                          : 'Select all fields',
                                )}
                            </button>
                        )}
                        {config.maxDepth && (
                            <label className="field-picker__depth">
                                {t('Nesting depth')}
                                <select
                                    className="select"
                                    value={depth}
                                    onChange={(event) => {
                                        setDepth(Number(event.target.value))
                                        setError(undefined)
                                    }}
                                >
                                    {Array.from(
                                        { length: config.maxDepth },
                                        (_, index) => index + 1,
                                    ).map((level) => (
                                        <option key={level} value={level}>
                                            {level}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        )}
                    </div>
                </header>
                <div className="field-picker__list" role="group" aria-label={title}>
                    {fields.slice(0, visibleCount).map((field) => (
                        <label
                            key={field.name}
                            className={`field-picker__row${field.selected ? ' field-picker__row--existing' : ''}`}
                            title={field.selected ? t('Already added') : field.description}
                        >
                            <input
                                type="checkbox"
                                checked={field.selected || chosen.has(field.name)}
                                disabled={field.selected || config.readOnly}
                                onChange={(event) => toggle(field.name, event.target.checked)}
                            />
                            <span className="field-picker__name mono">{field.name}</span>
                            <span className="field-picker__type mono">{field.type}</span>
                        </label>
                    ))}
                    {fields.length > visibleCount && (
                        <button
                            type="button"
                            className="btn btn--quiet"
                            onClick={() => setVisibleCount((current) => current + FIELD_PAGE_SIZE)}
                        >
                            {t('Show more')}
                        </button>
                    )}
                    {!fields.length && (
                        <div className="empty">{config.emptyMessage ?? t('Nothing found')}</div>
                    )}
                </div>
                {error && (
                    <p className="field-picker__error" role="status">
                        {error}
                    </p>
                )}
                <footer className="dialog__footer">
                    <button type="button" className="btn" onClick={onClose}>
                        {t('Cancel')}
                    </button>
                    <button type="submit" className="btn btn--primary" disabled={!canApply}>
                        {!chosen.size && existing.length
                            ? t('Add nested fields')
                            : t('Insert fields ({n})', { n: chosen.size })}
                    </button>
                </footer>
            </form>
        </DialogSurface>
    )
}
