import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { json } from '@codemirror/lang-json'
import {
    bracketMatching,
    foldGutter,
    foldKeymap,
    indentOnInput,
    indentUnit,
} from '@codemirror/language'
import { lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
    drawSelection,
    dropCursor,
    EditorView,
    highlightActiveLine,
    highlightActiveLineGutter,
    keymap,
    lineNumbers,
    rectangularSelection,
} from '@codemirror/view'
import { graphql, updateSchema } from 'cm6-graphql'
import type { GraphQLSchema } from 'graphql'
import { useEffect, useRef } from 'react'

import { useAppStore } from '../../state/store.js'
import { autoArguments } from './auto-arguments.js'
import { appEditorTheme } from './theme.js'
import { createVariablesCompletion } from './variables-completion.js'

export type IEditorLanguage = 'graphql' | 'json'

export interface ICodeEditorProps {
    value: string
    language: IEditorLanguage
    schema?: GraphQLSchema
    readOnly?: boolean
    onChange?: (value: string) => void
    /** Cmd+Enter выполняет операцию прямо из редактора. */
    onRun?: () => void
    /**
     * Текст GraphQL-операции для панели переменных: из него берутся имена
     * переменных, а из схемы — структура их типов для автодополнения.
     */
    completionQuery?: string
    /**
     * Вызывается, когда выбор поля из подсказки объявил новые переменные:
     * панель переменных дополняет JSON их скелетом.
     */
    onVariablesAdded?: (variables: Record<string, unknown>) => void
}

const languageCompartment = new Compartment()
const readOnlyCompartment = new Compartment()
const appearanceCompartment = new Compartment()

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

    const editorSettings = useAppStore((state) => state.settings.editor)

    // Автодополнение переменных читает запрос и схему через ref: пересоздавать
    // из-за них редактор нельзя, а свежие значения нужны на каждый вызов.
    const completionQueryRef = useRef(props.completionQuery ?? '')
    const schemaRef = useRef(props.schema)
    const onVariablesAddedRef = useRef(props.onVariablesAdded)

    onChangeRef.current = props.onChange
    onRunRef.current = props.onRun
    completionQueryRef.current = props.completionQuery ?? ''
    schemaRef.current = props.schema
    onVariablesAddedRef.current = props.onVariablesAdded

    useEffect(() => {
        const host = hostRef.current
        if (!host) return

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
                    autocompletion({
                        activateOnTyping: true,
                        closeOnBlur: false,
                        override:
                            props.language === 'json'
                                ? [
                                      createVariablesCompletion(
                                          () => completionQueryRef.current,
                                          () => schemaRef.current,
                                      ),
                                  ]
                                : undefined,
                    }),
                    highlightSelectionMatches(),
                    EditorState.allowMultipleSelections.of(true),
                    keymap.of([
                        {
                            key: 'Mod-Enter',
                            preventDefault: true,
                            run: () => {
                                onRunRef.current?.()

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
                    props.language === 'graphql'
                        ? autoArguments({
                              getSchema: () => schemaRef.current,
                              onVariablesAdded: (variables) =>
                                  onVariablesAddedRef.current?.(variables),
                          })
                        : [],
                    readOnlyCompartment.of(EditorState.readOnly.of(props.readOnly ?? false)),
                    appearanceCompartment.of(createAppearance(editorSettings)),
                    appEditorTheme,
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged) {
                            onChangeRef.current?.(update.state.doc.toString())
                        }
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

        const current = view.state.doc.toString()
        if (current === props.value) return

        view.dispatch({
            changes: { from: 0, to: current.length, insert: props.value },
            // Курсор восстанавливается в пределах нового текста, чтобы вставка
            // не выбрасывала пользователя в начало документа.
            selection: { anchor: Math.min(view.state.selection.main.anchor, props.value.length) },
        })
    }, [props.value])

    useEffect(() => {
        const view = viewRef.current
        if (!view || props.language !== 'graphql' || !props.schema) return

        updateSchema(view, props.schema)
    }, [props.schema, props.language])

    useEffect(() => {
        viewRef.current?.dispatch({
            effects: readOnlyCompartment.reconfigure(
                EditorState.readOnly.of(props.readOnly ?? false),
            ),
        })
    }, [props.readOnly])

    // Настройки внешнего вида меняются через compartment: содержимое, история
    // отмен и позиция курсора при этом сохраняются.
    useEffect(() => {
        viewRef.current?.dispatch({
            effects: appearanceCompartment.reconfigure(createAppearance(editorSettings)),
        })
    }, [editorSettings])

    return <div className="editor-host" ref={hostRef} />
}

function createLanguage(language: IEditorLanguage, schema?: GraphQLSchema): Extension {
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
