import {
    autocompletion,
    closeBrackets,
    closeBracketsKeymap,
    startCompletion,
    type CompletionSource,
} from '@codemirror/autocomplete'
import {
    addSchemaFields,
    findSchemaFieldTarget,
    MAX_SCHEMA_FIELD_DEPTH,
    schemaFieldChoices,
    type ISchemaCompletion,
} from '@resolvr/core'
import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
    isolateHistory,
    redo,
    redoDepth,
    selectAll,
    undo,
    undoDepth,
} from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript'
import {
    bracketMatching,
    foldGutter,
    foldKeymap,
    indentOnInput,
    indentUnit,
} from '@codemirror/language'
import { lintKeymap } from '@codemirror/lint'
import {
    highlightSelectionMatches,
    openSearchPanel,
    search,
    searchKeymap,
} from '@codemirror/search'
import { Annotation, Compartment, EditorState, type Extension, type Text } from '@codemirror/state'
import {
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
    placeholder as editorPlaceholder,
    rectangularSelection,
    tooltips,
} from '@codemirror/view'
import { graphql, updateSchema } from 'cm6-graphql'
import { parse, print, type GraphQLSchema } from 'graphql'
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'

import { useT } from '../../i18n/index.js'
import { copyText, readClipboardText } from '../../lib/clipboard.js'
import { kbd } from '../../lib/keys.js'
import { ContextMenu, type IContextMenuItem, type IContextMenuState } from '../ContextMenu.js'
import { FieldPicker, type IFieldPickerConfig } from '../FieldPicker.js'
import { parseVariables, useAppStore } from '../../state/store.js'
import { autoArguments } from './auto-arguments.js'
import {
    createEnvCompletion,
    envPlaceholderHighlight,
    refreshEnvHighlight,
    type IEnvVariablesContext,
} from './env-completion.js'
import { createSearchPanel } from './search-panel.js'
import { standardScriptCompletion } from './script-completion.js'
import { appEditorTheme } from './theme.js'
import {
    createVariablesCompletion,
    findInputObjectFields,
    insertInputFields,
} from './variables-completion.js'

export type IEditorLanguage = 'graphql' | 'json' | 'javascript'

export interface ICodeEditorHandle {
    selectFields(): void
    insertAtStart(text: string): void
}

export interface ICodeEditorProps {
    ref?: Ref<ICodeEditorHandle>
    value: string
    language: IEditorLanguage
    schema?: GraphQLSchema
    readOnly?: boolean
    onChange?: (value: string) => void
    ariaLabel?: string
    ariaDescribedBy?: string
    placeholder?: string
    maxLength?: number
    completionSource?: CompletionSource
    /** Cmd+Enter выполняет операцию прямо из редактора. */
    onRun?: () => void
    /**
     * Текст GraphQL-операции для панели переменных: из него берутся имена
     * переменных, а из схемы — структура их типов для автодополнения.
     */
    completionQuery?: string
    schemaCompletion?: ISchemaCompletion
    variablesSource?: string
    /**
     * Вызывается, когда выбор поля из подсказки объявил новые переменные:
     * панель переменных дополняет JSON их скелетом.
     */
    onVariablesAdded?: (variables: Record<string, unknown>) => void
    /**
     * Переменные окружения для подстановки `{{name}}`: подсказки после `{{`
     * и подсветка неизвестных имён. Без них эти возможности выключены.
     */
    envVariables?: IEnvVariablesContext
}

const NO_ENV_VARIABLES: IEnvVariablesContext = { variables: [] }

const externalChange = Annotation.define<boolean>()

const languageCompartment = new Compartment()
const readOnlyCompartment = new Compartment()
const appearanceCompartment = new Compartment()
const contentAttributesCompartment = new Compartment()

/**
 * Обёртка над CodeMirror 6.
 *
 * Редактор создаётся один раз и живёт всё время существования вкладки: пересборка
 * состояния теряла бы историю отмен, положение курсора и открытые подсказки.
 * Внешние изменения текста применяются точечной транзакцией, а смена схемы —
 * через `updateSchema`, без пересоздания языкового расширения.
 */
export function CodeEditor(props: ICodeEditorProps): React.JSX.Element {
    const hostRef = useRef<HTMLDivElement>(null)
    const viewRef = useRef<EditorView>(null)
    const onChangeRef = useRef(props.onChange)
    const onRunRef = useRef(props.onRun)
    const completionSource = useRef(props.completionSource)
    const lastText = useRef(props.value)
    const fieldInsertion = useRef<{ at: number; doc: Text; prefix: Text; suffix: Text }>(undefined)

    const [menu, setMenu] = useState<IContextMenuState>()
    const [picker, setPicker] = useState<IFieldPickerConfig>()
    const t = useT()

    const tabSize = useAppStore((state) => state.settings.editor.tabSize)
    const lineNumbersEnabled = useAppStore((state) => state.settings.editor.lineNumbers)
    const lineWrapping = useAppStore((state) => state.settings.editor.lineWrapping)

    // Автодополнение переменных читает запрос и схему через ref: пересоздавать
    // из-за них редактор нельзя, а свежие значения нужны на каждый вызов.
    const completionQueryRef = useRef(props.completionQuery ?? '')
    const schemaRef = useRef(props.schema)
    const onVariablesAddedRef = useRef(props.onVariablesAdded)
    const variablesSourceRef = useRef(props.variablesSource)
    const envVariablesRef = useRef(props.envVariables ?? NO_ENV_VARIABLES)
    const envEnabled = useRef(props.envVariables !== undefined).current

    onChangeRef.current = props.onChange
    onRunRef.current = props.onRun
    completionSource.current = props.completionSource
    completionQueryRef.current = props.completionQuery ?? ''
    schemaRef.current = props.schema
    onVariablesAddedRef.current = props.onVariablesAdded
    variablesSourceRef.current = props.variablesSource
    envVariablesRef.current = props.envVariables ?? NO_ENV_VARIABLES

    useImperativeHandle(props.ref, () => ({
        selectFields() {
            const view = viewRef.current
            if (view) selectOutputFields(view, view.state.selection.main.head, view.state.doc)
        },
        insertAtStart(text) {
            const view = viewRef.current
            if (!view || view.state.readOnly) return

            const changes = view.state.changes({ from: 0, insert: text })
            view.dispatch({
                changes,
                selection: view.state.selection.map(changes, 1),
                annotations: isolateHistory.of('full'),
                scrollIntoView: true,
                userEvent: 'input',
            })
            window.requestAnimationFrame(() => {
                if (view === viewRef.current) view.focus()
            })
        },
    }))

    useEffect(() => {
        const host = hostRef.current
        if (!host) return
        const dialog = host.closest('dialog')
        const document = host.ownerDocument

        const view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: props.value,
                extensions: [
                    highlightActiveLineGutter(),
                    highlightActiveLine(),
                    foldGutter(),
                    history(),
                    drawSelection(),
                    dropCursor(),
                    rectangularSelection(),
                    indentOnInput(),
                    bracketMatching(),
                    closeBrackets(),
                    // WebKit может позиционировать подсказки абсолютно. Вынесенный
                    // слой остаётся видимым за пределами прокручиваемой панели.
                    tooltips({
                        parent: dialog ?? document.body,
                        position: 'absolute',
                        tooltipSpace: () => {
                            const bounds = dialog?.getBoundingClientRect()
                            const { clientWidth, clientHeight } = document.documentElement
                            return {
                                left: Math.max(0, bounds?.left ?? 0) + 8,
                                top: Math.max(0, bounds?.top ?? 0) + 8,
                                right: Math.min(clientWidth, bounds?.right ?? clientWidth) - 8,
                                bottom: Math.min(clientHeight, bounds?.bottom ?? clientHeight) - 8,
                            }
                        },
                    }),
                    autocompletion({
                        activateOnTyping: true,
                        closeOnBlur: props.language === 'javascript',
                        compareCompletions:
                            props.language === 'graphql'
                                ? (left, right) =>
                                      Number(left.label.startsWith('__')) -
                                          Number(right.label.startsWith('__')) ||
                                      left.label.localeCompare(right.label)
                                : undefined,
                        override:
                            props.language === 'json'
                                ? [
                                      createVariablesCompletion(
                                          () => completionQueryRef.current,
                                          () => schemaRef.current,
                                      ),
                                      ...(envEnabled
                                          ? [createEnvCompletion(() => envVariablesRef.current)]
                                          : []),
                                  ]
                                : undefined,
                    }),
                    EditorState.transactionFilter.of((transaction) => {
                        if (
                            props.maxLength !== undefined &&
                            transaction.docChanged &&
                            !transaction.annotation(externalChange) &&
                            transaction.newDoc.length > Math.max(transaction.startState.doc.length, props.maxLength)
                        ) return []

                        const field = fieldInsertion.current
                        const { main } = transaction.startState.selection
                        if (
                            !field ||
                            field.doc !== transaction.startState.doc ||
                            !main.empty ||
                            main.head !== field.at ||
                            !transaction.docChanged ||
                            !transaction.isUserEvent('input.complete')
                        )
                            return transaction

                        const end = transaction.newSelection.main.head

                        // Дополняет уже вставленное имя и оставляет курсор перед переносом.
                        return [
                            transaction,
                            {
                                changes: [
                                    { from: field.at, insert: field.prefix },
                                    { from: end, insert: field.suffix },
                                ],
                                selection: { anchor: end + field.prefix.length },
                                sequential: true,
                            },
                        ]
                    }),
                    envEnabled ? envPlaceholderHighlight(() => envVariablesRef.current) : [],
                    highlightSelectionMatches(),
                    search({ top: true, createPanel: createSearchPanel }),
                    EditorState.allowMultipleSelections.of(true),
                    keymap.of([
                        {
                            key: 'Mod-Enter',
                            preventDefault: true,
                            run: () => {
                                if (!onRunRef.current) return false
                                onRunRef.current()

                                return true
                            },
                        },
                        ...closeBracketsKeymap,
                        ...defaultKeymap,
                        ...searchKeymap,
                        ...historyKeymap,
                        ...foldKeymap,
                        ...lintKeymap,
                        indentWithTab,
                    ]),
                    languageCompartment.of(createLanguage(props.language, props.schema)),
                    props.language === 'javascript' ? [
                        javascriptLanguage.data.of({
                            autocomplete: (context: Parameters<CompletionSource>[0]) =>
                                completionSource.current?.(context) ?? null,
                        }),
                        javascriptLanguage.data.of({ autocomplete: standardScriptCompletion }),
                    ] : [],
                    props.placeholder ? editorPlaceholder(props.placeholder) : [],
                    contentAttributesCompartment.of([]),
                    props.language === 'graphql'
                        ? autoArguments({
                              getSchema: () => schemaRef.current,
                              onVariablesAdded: (variables) =>
                                  onVariablesAddedRef.current?.(variables),
                          })
                        : [],
                    readOnlyCompartment.of(EditorState.readOnly.of(props.readOnly ?? false)),
                    appearanceCompartment.of(
                        createAppearance({
                            tabSize,
                            lineNumbers: lineNumbersEnabled,
                            lineWrapping,
                        }),
                    ),
                    appEditorTheme,
                    EditorView.updateListener.of((update) => {
                        if (
                            !update.docChanged ||
                            update.transactions.every((transaction) =>
                                transaction.annotation(externalChange),
                            )
                        )
                            return

                        const text = update.state.doc.toString()
                        lastText.current = text
                        onChangeRef.current?.(text)
                    }),
                ],
            }),
        })

        viewRef.current = view

        return () => {
            view.destroy()
            viewRef.current = null
        }
        // Редактор намеренно создаётся один раз: значение, схема и режим
        // применяются отдельными эффектами ниже, поэтому список зависимостей
        // здесь пуст.
    }, [])

    // Внешнее изменение текста (загрузка операции, вставка из схемы, undo из меню).
    useEffect(() => {
        const view = viewRef.current
        if (!view) return

        if (lastText.current === props.value) return

        lastText.current = props.value
        const doc = view.state.toText(props.value)
        view.dispatch({
            annotations: externalChange.of(true),
            changes: { from: 0, to: view.state.doc.length, insert: doc },
            // Курсор восстанавливается в пределах нового текста, чтобы вставка
            // не выбрасывала пользователя в начало документа.
            selection: { anchor: Math.min(view.state.selection.main.anchor, doc.length) },
        })
    }, [props.value])

    useEffect(() => {
        const view = viewRef.current
        if (!view || props.language !== 'graphql') return

        updateSchema(view, props.schema)
    }, [props.schema, props.language])

    useEffect(() => {
        const view = viewRef.current
        const selection = props.schemaCompletion
        fieldInsertion.current = undefined
        if (!view || !selection) return

        const anchor = view.state.toText(props.value.slice(0, selection.anchor)).length
        const head = view.state.toText(props.value.slice(0, selection.head)).length
        if (selection.insertion) {
            fieldInsertion.current = {
                at: head,
                doc: view.state.doc,
                prefix: view.state.toText(selection.insertion.prefix),
                suffix: view.state.toText(selection.insertion.suffix),
            }
        }
        view.dispatch({ selection: { anchor, head }, scrollIntoView: true })
        view.focus()
        startCompletion(view)
    }, [props.schemaCompletion, props.value])

    // Смена окружения меняет, какие `{{name}}` известны, — текст при этом прежний.
    useEffect(() => {
        const view = viewRef.current
        if (view && envEnabled) refreshEnvHighlight(view)
    }, [props.envVariables, envEnabled])

    useEffect(() => {
        viewRef.current?.dispatch({
            effects: readOnlyCompartment.reconfigure(
                EditorState.readOnly.of(props.readOnly ?? false),
            ),
        })
    }, [props.readOnly])

    useEffect(() => {
        const attributes: Record<string, string> = {}
        if (props.ariaLabel) attributes['aria-label'] = props.ariaLabel
        if (props.ariaDescribedBy) attributes['aria-describedby'] = props.ariaDescribedBy
        viewRef.current?.dispatch({
            effects: contentAttributesCompartment.reconfigure(EditorView.contentAttributes.of(attributes)),
        })
    }, [props.ariaLabel, props.ariaDescribedBy])

    // Настройки внешнего вида меняются через compartment: содержимое, история
    // отмен и позиция курсора при этом сохраняются.
    useEffect(() => {
        viewRef.current?.dispatch({
            effects: appearanceCompartment.reconfigure(
                createAppearance({ tabSize, lineNumbers: lineNumbersEnabled, lineWrapping }),
            ),
        })
    }, [tabSize, lineNumbersEnabled, lineWrapping])

    function selectOutputFields(view: EditorView, position: number, openedDocument: Text): void {
        const schema = schemaRef.current
        if (!schema || view.state.readOnly || view.state.doc !== openedDocument) return

        const target = (() => {
            try {
                return findSchemaFieldTarget(schema, openedDocument.toString(), position)
            } catch {
                return undefined
            }
        })()
        if (!target) {
            setPicker({
                typeName: t('Query'),
                fields: [],
                emptyMessage: t('Place the cursor inside a GraphQL operation to select fields'),
                apply: () => undefined,
            })
            return
        }
        setPicker({
            typeName: target.type.name,
            fields: schemaFieldChoices(schema, target),
            maxDepth: MAX_SCHEMA_FIELD_DEPTH,
            apply: (names: ReadonlySet<string>, depth: number) => {
                if (
                    view !== viewRef.current ||
                    view.state.doc !== openedDocument ||
                    view.state.readOnly ||
                    schemaRef.current !== schema
                )
                    return t('The request changed. Choose the field again.')

                const previous = parseVariables(variablesSourceRef.current ?? '')
                try {
                    const result = addSchemaFields(
                        schema,
                        target,
                        [...names],
                        depth,
                        previous instanceof Error ? [] : Object.keys(previous),
                    )
                    const hasVariables = Object.keys(result.variables).length > 0
                    if (hasVariables && previous instanceof Error) {
                        return t('Fix the variables JSON to add fields with required arguments')
                    }
                    if (result.query !== target.query) {
                        view.dispatch({
                            changes: { from: 0, to: openedDocument.length, insert: result.query },
                            userEvent: 'input.schema',
                        })
                    }
                    if (hasVariables) onVariablesAddedRef.current?.(result.variables)
                } catch (error) {
                    return error instanceof RangeError
                        ? t('Choose fewer fields or a smaller depth')
                        : t('Cannot add fields to the selected operation')
                }
                return undefined
            },
        })
    }

    function openMenu(event: React.MouseEvent): void {
        const view = viewRef.current
        if (!view) return
        event.preventDefault()
        event.stopPropagation()
        view.focus()
        const selected = view.state.selection.ranges
            .filter((range) => !range.empty)
            .map((range) => view.state.sliceDoc(range.from, range.to))
            .join('\n')
        const readOnly = view.state.readOnly
        const hasContent = view.state.doc.length > 0

        const schema = schemaRef.current
        const query = completionQueryRef.current
        const openedDocument = view.state.doc
        const position =
            event.clientX || event.clientY
                ? view.posAtCoords({ x: event.clientX, y: event.clientY }, false)
                : view.state.selection.main.head
        const input =
            !readOnly && props.language === 'json' && schema && query
                ? findInputObjectFields(view.state, position, query, schema)
                : undefined
        const fieldMenu: IContextMenuItem[] = []
        if (input) {
            fieldMenu.push({
                label: t('Insert fields from {type}…', { type: input.typeName }),
                run: () => setPicker({
                    typeName: input.typeName,
                    fields: input.fields.map((field) => ({
                        name: field.name,
                        type: String(field.type),
                        description: field.description ?? undefined,
                        selected: input.filled.has(field.name),
                    })),
                    single: input.single,
                    readOnly: input.single && input.filled.size > 0,
                    apply: (names) => {
                        if (
                            view !== viewRef.current ||
                            view.state.doc !== openedDocument ||
                            view.state.readOnly ||
                            schemaRef.current !== schema ||
                            completionQueryRef.current !== query
                        )
                            return t('The variables changed. Choose the fields again.')

                        view.dispatch({
                            ...insertInputFields(view.state, input, names, tabSize),
                            userEvent: 'input.schema',
                        })
                        return undefined
                    },
                }),
            })
        }
        if (!readOnly && props.language === 'graphql' && props.onVariablesAdded && schema) {
            fieldMenu.push({
                label: t('Select fields…'),
                run: () => selectOutputFields(view, position, openedDocument),
            })
        }

        function format(): void {
            if (!view || view !== viewRef.current) return
            const source = view.state.doc.toString()
            let formatted: string
            try {
                formatted =
                    props.language === 'graphql'
                        ? print(parse(source))
                        : JSON.stringify(JSON.parse(source), null, tabSize)
            } catch {
                return
            }
            view.dispatch({
                changes: { from: 0, to: source.length, insert: formatted + '\n' },
                userEvent: 'input.format',
            })
        }

        setMenu({
            x: event.clientX,
            y: event.clientY,
            items: [
                ...fieldMenu,
                {
                    label: t('Undo'),
                    separated: fieldMenu.length > 0,
                    hint: kbd('Z'),
                    disabled: readOnly || undoDepth(view.state) === 0,
                    run: () => {
                        undo(view)
                    },
                },
                {
                    label: t('Redo'),
                    hint: kbd('Shift+Z'),
                    disabled: readOnly || redoDepth(view.state) === 0,
                    run: () => {
                        redo(view)
                    },
                },
                {
                    label: t('Cut'),
                    hint: kbd('X'),
                    disabled: readOnly || !selected,
                    separated: true,
                    run: async () => {
                        const state = view.state
                        if (
                            (await copyText(selected)) &&
                            view === viewRef.current &&
                            view.state === state
                        ) {
                            view.dispatch(state.replaceSelection(''), { userEvent: 'delete.cut' })
                        }
                    },
                },
                {
                    label: t('Copy'),
                    hint: kbd('C'),
                    disabled: !selected,
                    run: () => copyText(selected),
                },
                {
                    label: t('Paste'),
                    hint: kbd('V'),
                    disabled: readOnly,
                    run: async () => {
                        const text = await readClipboardText()
                        if (
                            text !== undefined &&
                            view === viewRef.current &&
                            !view.state.readOnly
                        ) {
                            view.dispatch(view.state.replaceSelection(text), {
                                userEvent: 'input.paste',
                            })
                        }
                    },
                },
                {
                    label: t('Select all'),
                    hint: kbd('A'),
                    disabled: !hasContent,
                    run: () => {
                        selectAll(view)
                    },
                },
                {
                    label: t('Find'),
                    hint: kbd('F'),
                    separated: true,
                    run: () => {
                        openSearchPanel(view)
                    },
                },
                ...(props.language !== 'javascript' ? [{
                    label: t(props.language === 'graphql' ? 'Format query' : 'Format JSON'),
                    disabled: readOnly || !hasContent,
                    run: format,
                }] : []),
                ...(props.onRun
                    ? [{ label: t('Run'), hint: kbd('Enter'), separated: true, run: props.onRun }]
                    : []),
            ],
        })
    }

    return (
        <>
            <div className="editor-host" ref={hostRef} onContextMenu={openMenu} />
            <ContextMenu menu={menu} onClose={() => setMenu(undefined)} />
            {picker && (
                <FieldPicker
                    config={picker}
                    onClose={() => {
                        setPicker(undefined)
                        window.requestAnimationFrame(() => viewRef.current?.focus())
                    }}
                />
            )}
        </>
    )
}

function createLanguage(language: IEditorLanguage, schema?: GraphQLSchema): Extension {
    if (language === 'javascript') return javascript()

    // `fillLeafsOnComplete` сразу раскрывает выборку у полей объектного типа —
    // вместе с автоподстановкой аргументов выбор поля даёт готовый фрагмент.
    return language === 'graphql'
        ? graphql(schema, { autocompleteOptions: { fillLeafsOnComplete: true } })
        : json()
}

/** Расширения, зависящие от пользовательских настроек редактора. */
function createAppearance(settings: {
    tabSize: number
    lineNumbers: boolean
    lineWrapping: boolean
}): Extension {
    return [
        indentUnit.of(' '.repeat(settings.tabSize)),
        EditorState.tabSize.of(settings.tabSize),
        settings.lineNumbers ? lineNumbers() : [],
        settings.lineWrapping ? EditorView.lineWrapping : [],
    ]
}
