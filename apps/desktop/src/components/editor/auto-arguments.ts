import { buildInputSkeleton } from '@resolvr/core'
import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { offsetToPos } from 'cm6-graphql'
import { isNonNullType, type GraphQLArgument, type GraphQLSchema } from 'graphql'
import { getTokenAtPosition, getTypeInfo } from 'graphql-language-service'

export interface IAutoArgumentsOptions {
    getSchema: () => GraphQLSchema | undefined
    /** Вызывается со скелетом новых переменных, чтобы панель дополнила JSON. */
    onVariablesAdded: (variables: Record<string, unknown>) => void
}

/** Заголовок операции, в который дописываются объявления переменных. */
const OPERATION_HEADER = /^([ \t]*)(query|mutation|subscription)([ \t]+[A-Za-z_][\w]*)?(\([^)]*\))?/m
const ANONYMOUS_OPERATION = /^(\s*)\{/

/**
 * Автоподстановка обязательных аргументов при выборе поля из подсказки.
 *
 * При наборе запроса вручную выбор поля даёт только его имя, после чего
 * обязательные аргументы и объявления переменных приходится дописывать руками —
 * а это как раз то, что известно из схемы. Расширение реагирует на завершение
 * автодополнения: подставляет `(input: $input)`, объявляет переменные в
 * заголовке операции и отдаёт наружу скелет их значений.
 */
export function autoArguments(options: IAutoArgumentsOptions): Extension {
    return EditorView.updateListener.of((update) => {
        const completed = update.transactions.some((transaction) =>
            transaction.isUserEvent('input.complete'),
        )
        if (!completed || !update.docChanged) return

        const schema = options.getSchema()
        if (!schema) return

        let insertedAt: number | undefined
        update.changes.iterChanges((_fromA, _toA, _fromB, toB, inserted) => {
            if (inserted.length > 0) insertedAt = toB
        })
        if (insertedAt === undefined) return

        const position = insertedAt
        const view = update.view

        // Правка документа из обработчика обновления недопустима: транзакция
        // ещё применяется. Изменения откладываются на следующий микротакт.
        queueMicrotask(() => {
            applyRequiredArguments(view, schema, position, options.onVariablesAdded)
        })
    })
}

function applyRequiredArguments(
    view: EditorView,
    schema: GraphQLSchema,
    position: number,
    onVariablesAdded: (variables: Record<string, unknown>) => void,
): void {
    const doc = view.state.doc.toString()
    if (position > doc.length) return

    // Аргументы уже расставлены — например, поле выбрано повторно.
    if (doc.slice(position, position + 1) === '(') return

    const required = findRequiredArguments(view, schema, position)
    if (required.length === 0) return

    const declared = collectDeclaredVariables(doc)
    const newVariables: Record<string, unknown> = {}
    const declarations: string[] = []
    const parts: string[] = []

    for (const argument of required) {
        const argumentType = argument.type.toString()
        const variableName = pickVariableName(argument.name, argumentType, declared)
        parts.push(`${argument.name}: $${variableName}`)

        // Переменная того же типа уже объявлена — она и используется; повторное
        // объявление сделало бы документ невалидным.
        if (declared.get(variableName) === argumentType) continue

        declared.set(variableName, argumentType)
        declarations.push(`$${variableName}: ${argumentType}`)
        newVariables[variableName] = buildInputSkeleton(argument.type, 3)
    }

    const argumentsText = `(${parts.join(', ')})`
    const changes: Array<{ from: number; to?: number; insert: string }> = [
        { from: position, insert: argumentsText },
    ]

    const headerChange = buildHeaderChange(doc, declarations)
    if (headerChange) changes.push(headerChange)

    view.dispatch({
        changes,
        // Курсор ставится внутрь вставленной выборки, а не в конец аргументов:
        // следующим шагом почти всегда выбирают поля результата.
        selection: { anchor: position + argumentsText.length },
        // Событие намеренно не потомок `input.complete`: иначе расширение
        // среагировало бы на собственную вставку и продублировало аргументы.
        userEvent: 'input.autoarguments',
    })

    if (Object.keys(newVariables).length > 0) onVariablesAdded(newVariables)
}

/**
 * Обязательные аргументы поля под курсором.
 *
 * Поле определяется тем же анализатором, что и подсказки: он знает родительский
 * тип в текущей позиции, поэтому одноимённые поля разных типов не путаются.
 */
function findRequiredArguments(
    view: EditorView,
    schema: GraphQLSchema,
    position: number,
): GraphQLArgument[] {
    const doc = view.state.doc.toString()

    try {
        // Позиция сразу за именем уже вне поля — анализатор возвращает там
        // пустой токен уровня документа, поэтому смотрим последний символ имени.
        const inside = Math.max(0, position - 1)
        const token = getTokenAtPosition(doc, offsetToPos(view.state.doc, inside))
        const info = getTypeInfo(schema, token.state)

        const fieldDef =
            info.fieldDef ??
            (info.parentType && 'getFields' in info.parentType
                ? info.parentType.getFields()[token.string]
                : undefined)

        if (!fieldDef || !('args' in fieldDef)) return []

        return fieldDef.args.filter(isRequiredArgument)
    } catch {
        // Незавершённый документ анализатор разбирает не всегда — тогда просто
        // ничего не подставляем, ручной ввод остаётся доступен.
        return []
    }
}

/** Объявление переменных в заголовке операции. */
function buildHeaderChange(
    doc: string,
    declarations: readonly string[],
): { from: number; to: number; insert: string } | undefined {
    if (declarations.length === 0) return undefined

    const header = OPERATION_HEADER.exec(doc)
    if (header) {
        const [matched, indent, keyword, name, existing] = header
        const from = header.index
        const to = from + matched.length

        const insert = existing
            ? `${indent}${keyword}${name ?? ''}${existing.replace(
                  /\)$/,
                  `, ${declarations.join(', ')})`,
              )}`
            : `${indent}${keyword}${name ?? ''}(${declarations.join(', ')})`

        return { from, to, insert }
    }

    // Анонимная операция `{ … }` не может объявлять переменные — превращаем её
    // в именованную форму `query (…) { … }`.
    const anonymous = ANONYMOUS_OPERATION.exec(doc)
    if (anonymous) {
        const from = anonymous.index
        const to = from + anonymous[0].length

        return { from, to, insert: `${anonymous[1]}query (${declarations.join(', ')}) {` }
    }

    return undefined
}

/** Объявленные в документе переменные: имя → тип. */
function collectDeclaredVariables(doc: string): Map<string, string> {
    const result = new Map<string, string>()

    for (const match of doc.matchAll(/\$([A-Za-z_][\w]*)\s*:\s*([[\]!\w]+)/g)) {
        if (match[1] && match[2]) result.set(match[1], match[2])
    }

    return result
}

/**
 * Имя переменной для аргумента.
 *
 * Одноимённая переменная того же типа переиспользуется. Если тип отличается,
 * подставлять её нельзя — запрос стал бы невалидным, поэтому имя получает
 * числовой суффикс.
 */
function pickVariableName(
    argumentName: string,
    argumentType: string,
    declared: ReadonlyMap<string, string>,
): string {
    const existing = declared.get(argumentName)
    if (existing === undefined || existing === argumentType) return argumentName

    let index = 2
    while (declared.has(`${argumentName}${index}`)) index += 1

    return `${argumentName}${index}`
}

/** Проверка обязательности аргумента: значение по умолчанию снимает требование. */
export function isRequiredArgument(argument: GraphQLArgument): boolean {
    return isNonNullType(argument.type) && argument.defaultValue === undefined
}
