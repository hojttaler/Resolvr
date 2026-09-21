import { isSecretRef } from '@resolvr/core'
import { useEffect, useRef, useState } from 'react'

export interface IKeyValueEditorProps {
    value: Record<string, string>
    onChange: (value: Record<string, string>) => void
    keyPlaceholder?: string
    valuePlaceholder?: string
    addLabel?: string
    /** Разделитель между полями — например, стрелка для «извлечь путь в имя». */
    separator?: string
    /** Подсказки для поля значения (нативный `datalist`). */
    valueSuggestions?: string[]
    /**
     * Подпись хранилища для значений-ссылок на секрет («в файле», «в Keychain»).
     * С ней ссылка показывается бейджем, а не полем: редактировать её руками
     * незачем, а `keychain://…` в поле выдавало себя за место хранения.
     */
    secretHint?: string
}

interface IRow {
    /** Устойчивый идентификатор строки, не зависящий от вводимого текста. */
    id: string
    key: string
    value: string
}

let rowCounter = 0

function createRow(key: string, value: string): IRow {
    rowCounter += 1

    return { id: `row-${rowCounter}`, key, value }
}

/**
 * Редактор пар «ключ — значение».
 *
 * Строки хранятся списком с устойчивыми идентификаторами, а не выводятся из
 * ключей объекта. Иначе при вводе имени менялся бы React-ключ элемента, поле
 * пересоздавалось бы на каждый символ и теряло фокус — печатать было невозможно.
 */
export function KeyValueEditor(props: IKeyValueEditorProps): React.JSX.Element {
    const [rows, setRows] = useState<IRow[]>(() =>
        Object.entries(props.value).map(([key, value]) => createRow(key, value)),
    )

    // Внешние изменения (загрузка другой операции) заменяют строки целиком;
    // собственный ввод сюда не попадает — он уже отражён в состоянии.
    const lastEmitted = useRef<string>(JSON.stringify(props.value))

    useEffect(() => {
        const incoming = JSON.stringify(props.value)
        if (incoming === lastEmitted.current) return

        lastEmitted.current = incoming
        setRows(Object.entries(props.value).map(([key, value]) => createRow(key, value)))
    }, [props.value])

    function emit(next: IRow[]): void {
        setRows(next)

        const result: Record<string, string> = {}
        for (const row of next) {
            if (row.key.trim().length === 0) continue
            result[row.key] = row.value
        }

        lastEmitted.current = JSON.stringify(result)
        props.onChange(result)
    }

    const listId = `suggestions-${rows.length > 0 ? rows[0]?.id : 'empty'}`

    return (
        <div className="kv">
            {props.valueSuggestions && props.valueSuggestions.length > 0 && (
                <datalist id={listId}>
                    {props.valueSuggestions.map((suggestion) => (
                        <option key={suggestion} value={suggestion} />
                    ))}
                </datalist>
            )}

            {rows.map((row, index) => (
                <div key={row.id} className="row">
                    <input
                        className="input mono"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        placeholder={props.keyPlaceholder}
                        value={row.key}
                        onChange={(event) =>
                            emit(
                                rows.map((item, position) =>
                                    position === index
                                        ? { ...item, key: event.target.value }
                                        : item,
                                ),
                            )
                        }
                    />

                    {props.separator && <span className="text-tertiary">{props.separator}</span>}

                    {props.secretHint && isSecretRef(row.value) ? (
                        <span className="kv__secret" title={row.value}>
                            <span className="badge">секрет</span>
                            <span className="text-tertiary">{props.secretHint}</span>
                        </span>
                    ) : (
                        <input
                            className="input mono"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            placeholder={props.valuePlaceholder}
                            list={props.valueSuggestions ? listId : undefined}
                            value={row.value}
                            onChange={(event) =>
                                emit(
                                    rows.map((item, position) =>
                                        position === index
                                            ? { ...item, value: event.target.value }
                                            : item,
                                    ),
                                )
                            }
                        />
                    )}

                    <button
                        type="button"
                        className="btn btn--quiet btn--icon"
                        onClick={() => emit(rows.filter((_, position) => position !== index))}
                        title="Удалить"
                    >
                        ×
                    </button>
                </div>
            ))}

            <button
                type="button"
                className="btn btn--quiet"
                onClick={() => emit([...rows, createRow('', '')])}
            >
                {props.addLabel ?? '+ Добавить'}
            </button>
        </div>
    )
}
