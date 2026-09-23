import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { StateEffect, type Extension } from '@codemirror/state'
import {
    Decoration,
    type EditorView,
    MatchDecorator,
    ViewPlugin,
    type DecorationSet,
    type ViewUpdate,
} from '@codemirror/view'

import { t } from '../../i18n/index.js'

/** Переменная, доступная для подстановки `{{name}}`. */
export interface IEnvVariable {
    name: string
    /** Секрет: значение не показывается даже в подсказке. */
    secret: boolean
    value?: string
    /** Откуда переменная: окружение или цепочка подготовки. */
    source: 'environment' | 'flow'
}

export interface IEnvVariablesContext {
    variables: IEnvVariable[]
    /** Имя окружения — для текста подсказок. */
    environmentName?: string
}

/** Тот же шаблон, что раскрывает плейсхолдеры при запуске (`secret-resolver.ts`). */
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g
const VALUE_PREVIEW = 40

/** Сигнал пересчитать подсветку: набор переменных сменился, а текст — нет. */
const refreshEffect = StateEffect.define<null>()

/**
 * Подсказки имён переменных окружения после `{{`.
 *
 * Без них имя приходилось вспоминать или подсматривать в настройках
 * окружения, а опечатка обнаруживалась только по нераскрытому `{{…}}`
 * в отправленном запросе.
 */
export function createEnvCompletion(getContext: () => IEnvVariablesContext) {
    return (context: CompletionContext): CompletionResult | null => {
        const match = context.matchBefore(/\{\{\s*[a-zA-Z0-9_.-]*$/)
        if (!match) return null

        const { variables } = getContext()
        if (variables.length === 0) return null

        const typed = /^\{\{\s*/.exec(match.text)?.[0].length ?? 2
        const closed = context.state.sliceDoc(context.pos, context.pos + 2) === '}}'

        const options: Completion[] = variables.map((variable) => ({
            label: variable.name,
            type: 'variable',
            detail: variable.secret ? '••••' : preview(variable.value),
            info: variable.source === 'flow' ? t('from the prerequisite flow') : undefined,
            apply: closed ? variable.name : `${variable.name}}}`,
        }))

        return { from: match.from + typed, options, validFor: /^[a-zA-Z0-9_.-]*$/ }
    }
}

/**
 * Подсветка `{{name}}`: известные переменные — одним цветом, неизвестные
 * окружению — подчёркиванием с пояснением.
 */
export function envPlaceholderHighlight(getContext: () => IEnvVariablesContext): Extension {
    const decorator = new MatchDecorator({
        regexp: PLACEHOLDER,
        decoration: (match) => {
            const { variables, environmentName } = getContext()
            const name = match[1] ?? ''
            const known = variables.some((variable) => variable.name === name)

            return Decoration.mark({
                class: known ? 'cm-env-var' : 'cm-env-var cm-env-var--unknown',
                attributes: known
                    ? {}
                    : {
                          title: environmentName
                              ? t('“{name}” is not defined in environment “{env}”', {
                                    name,
                                    env: environmentName,
                                })
                              : t('“{name}” is not defined', { name }),
                      },
            })
        },
    })

    return ViewPlugin.fromClass(
        class {
            public decorations: DecorationSet

            constructor(view: EditorView) {
                this.decorations = decorator.createDeco(view)
            }

            public update(update: ViewUpdate): void {
                const refresh = update.transactions.some((transaction) =>
                    transaction.effects.some((effect) => effect.is(refreshEffect)),
                )
                this.decorations = refresh
                    ? decorator.createDeco(update.view)
                    : decorator.updateDeco(update, this.decorations)
            }
        },
        { decorations: (plugin) => plugin.decorations },
    )
}

/** Перерисовывает подсветку после смены окружения или его переменных. */
export function refreshEnvHighlight(view: EditorView): void {
    view.dispatch({ effects: refreshEffect.of(null) })
}

/** Имена `{{name}}` в тексте, которых нет среди переменных. */
export function findUnknownPlaceholders(text: string, variables: IEnvVariable[]): string[] {
    const known = new Set(variables.map((variable) => variable.name))
    const unknown = new Set<string>()
    for (const match of text.matchAll(PLACEHOLDER)) {
        const name = match[1]
        if (name && !known.has(name)) unknown.add(name)
    }

    return [...unknown]
}

function preview(value: string | undefined): string | undefined {
    if (value === undefined) return undefined

    return value.length > VALUE_PREVIEW ? `${value.slice(0, VALUE_PREVIEW)}…` : value
}
