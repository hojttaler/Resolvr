import {
    getNamedType,
    isEnumType,
    isInputObjectType,
    isInterfaceType,
    isListType,
    isNonNullType,
    isObjectType,
    isScalarType,
    isUnionType,
    type GraphQLArgument,
    type GraphQLField,
    type GraphQLInputType,
    type GraphQLNamedType,
    type GraphQLObjectType,
    type GraphQLSchema,
} from 'graphql'

import { ErrorCodeEnum, ResolvrError } from '../model/errors.js'
import type { IOperationKind } from '../model/schemas.js'

const INDENT = '  '
const DEFAULT_DEPTH = 3
const INPUT_SKELETON_DEPTH = 2

export interface IBuildOperationInput {
    kind: IOperationKind
    /** Имя поля корневого типа, например `user` для `Query.user`. */
    fieldName: string
    /** Глубина раскрытия вложенных объектов. */
    depth?: number
    /** Имя операции; по умолчанию выводится из имени поля. */
    operationName?: string
}

export interface IBuiltOperation {
    query: string
    /** Скелет переменных: обязательные аргументы уже присутствуют. */
    variables: Record<string, unknown>
    operationName: string
}

/**
 * Сборка готовой операции по клику на поле в схеме.
 *
 * Раскрывает вложенные объекты до заданной глубины, подставляет все скалярные
 * поля, превращает обязательные аргументы в переменные и генерирует для них
 * скелет значений. Это та ручная работа, которая в существующих клиентах
 * занимает больше всего времени.
 */
export function buildOperation(
    schema: GraphQLSchema,
    input: IBuildOperationInput,
): IBuiltOperation {
    const rootType = getRootType(schema, input.kind)
    const field = rootType.getFields()[input.fieldName]

    if (!field) {
        throw new ResolvrError(
            ErrorCodeEnum.INVALID_OPERATION,
            `Поле "${input.fieldName}" отсутствует в типе ${rootType.name}`,
            { fieldName: input.fieldName, rootType: rootType.name },
        )
    }

    const depth = input.depth ?? DEFAULT_DEPTH
    const variables: Record<string, unknown> = {}
    const variableDefinitions: string[] = []

    const args = collectArguments(field, variables, variableDefinitions)
    const selection = buildSelectionSet(getNamedType(field.type), depth, new Set(), 2)

    const operationName = input.operationName ?? toOperationName(input.kind, input.fieldName)
    const definitions =
        variableDefinitions.length > 0 ? `(${variableDefinitions.join(', ')})` : ''

    const body = selection.length > 0 ? ` ${selection}` : ''
    const query = `${input.kind} ${operationName}${definitions} {\n${INDENT}${field.name}${args}${body}\n}\n`

    return { query, variables, operationName }
}

/**
 * Selection set для типа без обёртки операции — для вставки в уже открытый
 * запрос. Возвращает пустую строку для скалярных типов.
 */
export function buildSelectionSetForType(
    schema: GraphQLSchema,
    typeName: string,
    depth = DEFAULT_DEPTH,
): string {
    const type = schema.getType(typeName)
    if (!type) {
        throw new ResolvrError(
            ErrorCodeEnum.INVALID_OPERATION,
            `Тип "${typeName}" не найден в схеме`,
            { typeName },
        )
    }

    return buildSelectionSet(type, depth, new Set(), 1)
}

function getRootType(schema: GraphQLSchema, kind: IOperationKind): GraphQLObjectType {
    const rootType =
        kind === 'query'
            ? schema.getQueryType()
            : kind === 'mutation'
              ? schema.getMutationType()
              : schema.getSubscriptionType()

    if (!rootType) {
        throw new ResolvrError(
            ErrorCodeEnum.INVALID_OPERATION,
            `В схеме нет корневого типа для операции "${kind}"`,
            { kind },
        )
    }

    return rootType
}

/**
 * Строит тело выборки.
 *
 * Циклы в схеме (`User.friends: [User]`) обрываются через набор типов, уже
 * присутствующих в текущей ветке: без этого обход ушёл бы в бесконечность на
 * любой реальной схеме.
 */
function buildSelectionSet(
    type: GraphQLNamedType,
    depth: number,
    visited: ReadonlySet<string>,
    indentLevel: number,
): string {
    if (isScalarType(type) || isEnumType(type)) return ''
    if (depth <= 0) return ''

    const pad = INDENT.repeat(indentLevel)
    const closePad = INDENT.repeat(indentLevel - 1)

    if (isUnionType(type)) {
        const lines = [`${pad}__typename`]
        const nextVisited = new Set([...visited, type.name])

        for (const member of type.getTypes()) {
            const memberSelection = buildSelectionSet(
                member,
                depth - 1,
                nextVisited,
                indentLevel + 1,
            )
            if (memberSelection.length > 0) {
                lines.push(`${pad}... on ${member.name} ${memberSelection}`)
            }
        }

        return `{\n${lines.join('\n')}\n${closePad}}`
    }

    if (!isObjectType(type) && !isInterfaceType(type)) return ''

    const nextVisited = new Set([...visited, type.name])
    const lines: string[] = []

    for (const field of Object.values(type.getFields())) {
        const fieldType = getNamedType(field.type)
        const requiredArgs = field.args.filter((argument) => isNonNullType(argument.type))

        // Поле с обязательными аргументами не подставляется автоматически:
        // угадать значение нельзя, а неполный запрос сразу не выполнится.
        if (requiredArgs.length > 0) continue

        if (isScalarType(fieldType) || isEnumType(fieldType)) {
            lines.push(`${pad}${field.name}`)
            continue
        }

        if (nextVisited.has(fieldType.name) || depth - 1 <= 0) continue

        const nested = buildSelectionSet(fieldType, depth - 1, nextVisited, indentLevel + 1)
        if (nested.length > 0) lines.push(`${pad}${field.name} ${nested}`)
    }

    if (lines.length === 0) {
        // Тип без доступных скалярных полей — хотя бы `__typename`, иначе
        // получится синтаксически некорректный пустой selection set.
        lines.push(`${pad}__typename`)
    }

    return `{\n${lines.join('\n')}\n${closePad}}`
}

/** Превращает аргументы поля в переменные и заполняет их скелетными значениями. */
function collectArguments(
    field: GraphQLField<unknown, unknown>,
    variables: Record<string, unknown>,
    definitions: string[],
): string {
    const parts: string[] = []

    for (const argument of field.args) {
        const required = isNonNullType(argument.type)
        const hasDefault = argument.defaultValue !== undefined

        // Необязательные аргументы без значения по умолчанию опускаются:
        // запрос остаётся коротким, а нужное дописывается вручную.
        if (!required && !hasDefault) continue

        parts.push(`${argument.name}: $${argument.name}`)
        definitions.push(`$${argument.name}: ${argument.type.toString()}`)
        variables[argument.name] = buildInputSkeleton(argument.type, INPUT_SKELETON_DEPTH)
    }

    return parts.length > 0 ? `(${parts.join(', ')})` : ''
}

/** Правдоподобное пустое значение для переменной заданного входного типа. */
export function buildInputSkeleton(type: GraphQLInputType, depth: number): unknown {
    if (isNonNullType(type)) return buildInputSkeleton(type.ofType, depth)
    if (isListType(type)) return [buildInputSkeleton(type.ofType, depth - 1)]

    if (isEnumType(type)) return type.getValues()[0]?.name ?? null

    if (isScalarType(type)) {
        switch (type.name) {
            case 'Int':
            case 'Float':
                return 0
            case 'Boolean':
                return false
            case 'ID':
            case 'String':
                return ''
            default:
                return null
        }
    }

    if (isInputObjectType(type) && depth > 0) {
        const skeleton: Record<string, unknown> = {}
        for (const field of Object.values(type.getFields())) {
            if (!isNonNullType(field.type)) continue
            skeleton[field.name] = buildInputSkeleton(field.type, depth - 1)
        }

        return skeleton
    }

    return null
}

function toOperationName(kind: IOperationKind, fieldName: string): string {
    const capitalized = fieldName.charAt(0).toUpperCase() + fieldName.slice(1)
    if (kind === 'query') return capitalized

    // Для мутаций и подписок имя поля обычно уже глагольное (`createUser`),
    // поэтому суффикс добавляется только если он не дублирует само имя.
    const suffix = kind === 'mutation' ? 'Mutation' : 'Subscription'

    return capitalized.toLowerCase().includes(kind) ? capitalized : `${capitalized}${suffix}`
}

/** Аргументы поля, пригодные для показа в панели документации. */
export function describeArguments(args: readonly GraphQLArgument[]): string {
    return args.map((argument) => `${argument.name}: ${argument.type.toString()}`).join(', ')
}
