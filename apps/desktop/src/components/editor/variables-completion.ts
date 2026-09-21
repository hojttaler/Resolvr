import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { syntaxTree } from '@codemirror/language'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { buildInputSkeleton } from '@resolvr/core'
import {
    getNamedType,
    isEnumType,
    isInputObjectType,
    isInputType,
    isListType,
    isNonNullType,
    isScalarType,
    parse,
    type GraphQLInputType,
    type GraphQLSchema,
    type OperationDefinitionNode,
} from 'graphql'

/** Переменная операции: имя и её тип по тексту запроса. */
export interface IQueryVariable {
    name: string
    typeName: string
    required: boolean
}

/** Где стоит курсор: в имени поля или в его значении. */
type ICompletionMode = 'key' | 'value'

interface ICursorLocation {
    mode: ICompletionMode
    /** Путь до уровня, для которого нужны подсказки. */
    path: string[]
}

/**
 * Автодополнение в редакторе переменных.
 *
 * Подсказки берутся из двух источников: имена переменных — из самого запроса
 * (`query GetUser($id: ID!)`), а структура значений — из схемы. В позиции
 * значения предлагаются варианты enum и `true`/`false` для булевых полей:
 * иначе допустимые значения приходится искать в схеме вручную.
 */
export function createVariablesCompletion(
    getQuery: () => string,
    getSchema: () => GraphQLSchema | undefined,
) {
    return (context: CompletionContext): CompletionResult | null => {
        const schema = getSchema()
        const variables = collectQueryVariables(getQuery())
        if (variables.length === 0) return null

        const word = context.matchBefore(/"[^"]*|[\w$]*/)
        if (!word) return null
        if (word.from === word.to && !context.explicit) return null

        // Позиция берётся от курсора, а не от начала совпадения: шаблон слова
        // может зацепиться за закрывающую кавычку предыдущего ключа.
        const location = resolveCursorLocation(context.state, context.pos)

        if (location.mode === 'key') {
            const options =
                location.path.length === 0
                    ? variables.map((variable) => createKeyOption(variable.name, variable.typeName))
                    : collectFieldOptions(schema, variables, location.path)

            return options.length > 0
                ? { from: word.from, options, validFor: /^"?[\w$]*$/ }
                : null
        }

        const options = collectValueOptions(schema, variables, location.path)

        return options.length > 0 ? { from: word.from, options, validFor: /^"?[\w$]*$/ } : null
    }
}

/** Поля input-типа для позиции имени свойства. */
function collectFieldOptions(
    schema: GraphQLSchema | undefined,
    variables: readonly IQueryVariable[],
    path: readonly string[],
): Completion[] {
    const type = resolveTypeAtPath(schema, variables, path)
    if (!type || !isInputObjectType(type)) return []

    return Object.values(type.getFields()).map((field) =>
        createKeyOption(field.name, field.type.toString(), field.description ?? undefined),
    )
}

/** Допустимые значения для позиции значения: enum, булево, пустой объект или список. */
function collectValueOptions(
    schema: GraphQLSchema | undefined,
    variables: readonly IQueryVariable[],
    path: readonly string[],
): Completion[] {
    const type = resolveTypeAtPath(schema, variables, path, { keepWrappers: true })
    if (!type) return []

    const named = getNamedType(type)

    if (isEnumType(named)) {
        return named.getValues().map((value) => ({
            label: `"${value.name}"`,
            detail: named.name,
            info: value.description ?? undefined,
            type: 'enum',
            apply: createValueApply(`"${value.name}"`),
        }))
    }

    if (isScalarType(named) && named.name === 'Boolean') {
        return ['true', 'false'].map((value) => ({
            label: value,
            detail: 'Boolean',
            type: 'keyword',
            apply: createValueApply(value),
        }))
    }

    if (isListType(unwrapNonNull(type))) {
        return [{ label: '[]', detail: type.toString(), type: 'text', apply: createValueApply('[]') }]
    }

    if (isInputObjectType(named)) {
        return [{ label: '{}', detail: named.name, type: 'text', apply: createValueApply('{}') }]
    }

    return []
}

function createKeyOption(name: string, detail: string, info?: string): Completion {
    return {
        label: `"${name}"`,
        detail,
        info,
        type: 'property',
        apply: createValueApply(`"${name}": `),
    }
}

/**
 * Вставка варианта с поглощением автоматически добавленной кавычки.
 *
 * Редактор сам закрывает кавычки и скобки, поэтому справа от курсора почти
 * всегда висит `"`. Простая вставка текста оставляла бы её сиротой — в поле
 * появлялась лишняя кавычка. Здесь она включается в заменяемый диапазон.
 */
function createValueApply(insert: string) {
    return (view: EditorView, _completion: Completion, from: number, to: number): void => {
        let end = to

        const following = view.state.doc.sliceString(to, to + 1)
        if (insert.startsWith('"') && following === '"') end = to + 1
        if (insert === '{}' && following === '}') end = to + 1
        if (insert === '[]' && following === ']') end = to + 1

        view.dispatch({
            changes: { from, to: end, insert },
            selection: { anchor: from + insert.length },
            userEvent: 'input.complete',
        })
    }
}

/** Переменные, объявленные в тексте операции. */
export function collectQueryVariables(query: string): IQueryVariable[] {
    let definitions: readonly OperationDefinitionNode[]
    try {
        definitions = parse(query).definitions.filter(
            (definition): definition is OperationDefinitionNode =>
                definition.kind === 'OperationDefinition',
        )
    } catch {
        // Черновик с синтаксической ошибкой — подсказывать пока нечего.
        return []
    }

    const result: IQueryVariable[] = []
    for (const definition of definitions) {
        for (const variable of definition.variableDefinitions ?? []) {
            result.push({
                name: variable.variable.name.value,
                typeName: printTypeNode(variable.type),
                required: variable.type.kind === 'NonNullType',
            })
        }
    }

    return result
}

/**
 * Готовый JSON переменных для текущего запроса.
 *
 * Заполняет обязательные поля input-типов пустыми значениями подходящего вида —
 * то же, что делает автозаполнение выборки, но для панели переменных.
 */
export function buildVariablesSkeleton(
    query: string,
    schema: GraphQLSchema | undefined,
    existing: Record<string, unknown> = {},
): Record<string, unknown> {
    const variables = collectQueryVariables(query)
    const result: Record<string, unknown> = {}

    for (const variable of variables) {
        // Уже введённые значения не затираются: кнопка дополняет, а не сбрасывает.
        if (variable.name in existing) {
            result[variable.name] = existing[variable.name]
            continue
        }

        const type = schema ? toInputType(schema, variable.typeName) : undefined
        result[variable.name] = type ? buildInputSkeleton(type, 3) : null
    }

    return result
}

function printTypeNode(node: { kind: string; name?: { value: string }; type?: unknown }): string {
    if (node.kind === 'NamedType') return node.name?.value ?? 'Unknown'
    if (node.kind === 'NonNullType') {
        return `${printTypeNode(node.type as Parameters<typeof printTypeNode>[0])}!`
    }
    if (node.kind === 'ListType') {
        return `[${printTypeNode(node.type as Parameters<typeof printTypeNode>[0])}]`
    }

    return 'Unknown'
}

/** Тип схемы по строке вида `[UserFilter!]!`. */
function toInputType(schema: GraphQLSchema, typeName: string): GraphQLInputType | undefined {
    const bare = typeName.replace(/[[\]!]/g, '')
    const type = schema.getType(bare)

    return type && isInputType(type) ? type : undefined
}

function unwrapNonNull(type: GraphQLInputType): GraphQLInputType {
    return isNonNullType(type) ? type.ofType : type
}

/**
 * Тип, соответствующий пути в JSON переменных.
 *
 * Первый сегмент — имя переменной операции, остальные — поля input-типов.
 * Элементы списков пропускаются: индекс в пути не меняет тип элемента.
 */
function resolveTypeAtPath(
    schema: GraphQLSchema | undefined,
    variables: readonly IQueryVariable[],
    path: readonly string[],
    options: { keepWrappers?: boolean } = {},
): GraphQLInputType | undefined {
    if (!schema || path.length === 0) return undefined

    const rootVariable = variables.find((variable) => variable.name === path[0])
    if (!rootVariable) return undefined

    let current = toInputType(schema, rootVariable.typeName)

    for (const segment of path.slice(1)) {
        if (!current) return undefined

        // Индекс массива не меняет тип: `filter.ids.0` — тот же элемент списка.
        if (/^\d+$/.test(segment)) continue

        const named = getNamedType(current)
        if (!isInputObjectType(named)) return undefined

        const field = named.getFields()[segment]
        if (!field) return undefined

        current = field.type
    }

    if (!current) return undefined

    if (options.keepWrappers) return current

    const named = getNamedType(current)

    return isInputType(named) ? named : undefined
}

/**
 * Позиция курсора в JSON-документе: путь и то, что именно набирают.
 *
 * Режим определяется по тексту слева: двоеточие непосредственно перед курсором
 * означает, что набирают значение. Синтаксическое дерево здесь ненадёжно —
 * редактируемый документ почти всегда неполон (незакрытая строка, отсутствующее
 * значение), и парсер восстанавливает его непредсказуемо. Путь, наоборот, берём
 * из дерева: уже завершённые уровни оно разбирает верно.
 */
/**
 * Отбрасывает незакрытую строку в конце текста.
 *
 * Курсор почти всегда стоит внутри только что открытой кавычки, и её содержимое
 * не должно влиять на определение позиции: важно, что стоит перед самой строкой —
 * двоеточие (значит, набирают значение) или запятая либо скобка (значит, имя).
 */
function trimOpenString(text: string): string {
    let quotes = 0
    let lastQuote = -1

    for (let index = 0; index < text.length; index += 1) {
        if (text[index] !== '"') continue
        if (index > 0 && text[index - 1] === '\\') continue

        quotes += 1
        lastQuote = index
    }

    return quotes % 2 === 1 ? text.slice(0, lastQuote) : text
}

function resolveCursorLocation(state: EditorState, position: number): ICursorLocation {
    const before = trimOpenString(state.doc.sliceString(0, position)).replace(/\s+$/, '')
    const mode: ICompletionMode = before.endsWith(':') ? 'value' : 'key'

    const path: string[] = []
    let node = syntaxTree(state).resolveInner(position, -1)

    while (node.parent) {
        if (node.name === 'Property') {
            const nameNode = node.getChild('PropertyName')
            const editingName =
                nameNode !== null && position >= nameNode.from && position <= nameNode.to

            // Имя, которое печатают прямо сейчас, в путь не входит: подсказки
            // нужны для его собственного уровня, а не для вложенного объекта.
            if (nameNode && !editingName) {
                const raw = state.doc.sliceString(nameNode.from, nameNode.to)
                path.unshift(raw.replace(/^"|"$/g, ''))
            }
        }

        node = node.parent
    }

    if (mode === 'value') {
        // У свойства без значения дерево ещё не содержит узла Property,
        // поэтому имя берём из текста перед двоеточием.
        const currentName = /"([^"]+)"\s*:$/.exec(before)?.[1]
        if (currentName && path.at(-1) !== currentName) path.push(currentName)
    }

    return { mode, path }
}
