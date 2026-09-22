import {
    getNamedType,
    print,
    isEnumType,
    isInputObjectType,
    isInterfaceType,
    isObjectType,
    isScalarType,
    isUnionType,
    printType,
    type GraphQLArgument,
    type GraphQLField,
    type GraphQLInputField,
    type GraphQLNamedType,
    type GraphQLSchema,
} from 'graphql'

/**
 * Структурное описание схемы для браузера типов.
 *
 * Компоненты получают готовые плоские структуры, а не объекты graphql-js:
 * так навигация «поле → тип → где используется» не зависит от внутренних
 * классов библиотеки, и всё это можно проверить тестами без DOM.
 */
export type ITypeKind = 'object' | 'input' | 'enum' | 'interface' | 'union' | 'scalar'

export interface IArgumentInfo {
    name: string
    type: string
    namedType: string
    description?: string
    defaultValue?: string
    required: boolean
}

export interface IFieldInfo {
    name: string
    type: string
    /** Имя типа без обёрток `[]` и `!` — для перехода. */
    namedType: string
    description?: string
    args: IArgumentInfo[]
    deprecationReason?: string
}

export interface IEnumValueInfo {
    name: string
    description?: string
    deprecationReason?: string
}

export interface ITypeInfo {
    name: string
    kind: ITypeKind
    description?: string
    fields: IFieldInfo[]
    enumValues: IEnumValueInfo[]
    /** Для union — возможные типы; для interface — реализующие. */
    possibleTypes: string[]
    interfaces: string[]
    /** Корневая роль, если тип — Query, Mutation или Subscription. */
    root?: 'query' | 'mutation' | 'subscription'
    sdl: string
}

export interface ITypeUsage {
    typeName: string
    fieldName: string
    role: 'field' | 'argument' | 'input-field'
    /** Имя аргумента, если тип встречается как тип аргумента. */
    argumentName?: string
}

export interface ITypeListEntry {
    name: string
    kind: ITypeKind
    description?: string
    fieldCount: number
}

export function typeKindOf(type: GraphQLNamedType): ITypeKind {
    if (isObjectType(type)) return 'object'
    if (isInputObjectType(type)) return 'input'
    if (isEnumType(type)) return 'enum'
    if (isInterfaceType(type)) return 'interface'
    if (isUnionType(type)) return 'union'
    if (isScalarType(type)) return 'scalar'

    return 'object'
}

function rootRole(schema: GraphQLSchema, name: string): ITypeInfo['root'] | undefined {
    if (schema.getQueryType()?.name === name) return 'query'
    if (schema.getMutationType()?.name === name) return 'mutation'
    if (schema.getSubscriptionType()?.name === name) return 'subscription'

    return undefined
}

/**
 * Значение по умолчанию в текстовом виде.
 *
 * graphql 17 хранит его либо как runtime-значение, либо как литерал AST —
 * в схеме из интроспекции всегда литерал.
 */
function formatDefault(argument: GraphQLArgument | GraphQLInputField): string | undefined {
    const value = argument.default
    if (!value) return undefined
    if (value.literal) return print(value.literal)

    return JSON.stringify(value.value)
}

function describeArgument(argument: GraphQLArgument | GraphQLInputField): IArgumentInfo {
    const defaultValue = formatDefault(argument)

    return {
        name: argument.name,
        type: argument.type.toString(),
        namedType: getNamedType(argument.type).name,
        description: argument.description ?? undefined,
        defaultValue,
        required: argument.type.toString().endsWith('!') && defaultValue === undefined,
    }
}

function describeField(field: GraphQLField<unknown, unknown> | GraphQLInputField): IFieldInfo {
    return {
        name: field.name,
        type: field.type.toString(),
        namedType: getNamedType(field.type).name,
        description: field.description ?? undefined,
        args: 'args' in field ? field.args.map(describeArgument) : [],
        deprecationReason: field.deprecationReason ?? undefined,
    }
}

/** Описание типа по имени; `undefined`, если такого типа нет. */
export function describeType(schema: GraphQLSchema, name: string): ITypeInfo | undefined {
    const type = schema.getType(name)
    if (!type) return undefined

    const kind = typeKindOf(type)
    const fields =
        isObjectType(type) || isInterfaceType(type) || isInputObjectType(type)
            ? Object.values(type.getFields()).map(describeField)
            : []

    return {
        name: type.name,
        kind,
        description: type.description ?? undefined,
        fields,
        enumValues: isEnumType(type)
            ? type.getValues().map((value) => ({
                  name: value.name,
                  description: value.description ?? undefined,
                  deprecationReason: value.deprecationReason ?? undefined,
              }))
            : [],
        possibleTypes: isUnionType(type)
            ? type.getTypes().map((item) => item.name)
            : isInterfaceType(type)
              ? schema.getPossibleTypes(type).map((item) => item.name)
              : [],
        interfaces:
            isObjectType(type) || isInterfaceType(type)
                ? type.getInterfaces().map((item) => item.name)
                : [],
        root: rootRole(schema, type.name),
        sdl: printType(type),
    }
}

/**
 * Где тип встречается: как тип поля, аргумента или поля input-типа.
 *
 * Обход всех типов схемы — на 2000+ типах это десятки миллисекунд; результат
 * кэшируется вызывающей стороной по имени.
 */
export function findTypeUsages(schema: GraphQLSchema, name: string): ITypeUsage[] {
    const usages: ITypeUsage[] = []

    for (const type of Object.values(schema.getTypeMap())) {
        if (type.name.startsWith('__')) continue

        if (isObjectType(type) || isInterfaceType(type)) {
            for (const field of Object.values(type.getFields())) {
                if (getNamedType(field.type).name === name) {
                    usages.push({ typeName: type.name, fieldName: field.name, role: 'field' })
                }
                for (const argument of field.args) {
                    if (getNamedType(argument.type).name === name) {
                        usages.push({
                            typeName: type.name,
                            fieldName: field.name,
                            role: 'argument',
                            argumentName: argument.name,
                        })
                    }
                }
            }
        }

        if (isInputObjectType(type)) {
            for (const field of Object.values(type.getFields())) {
                if (getNamedType(field.type).name === name) {
                    usages.push({ typeName: type.name, fieldName: field.name, role: 'input-field' })
                }
            }
        }
    }

    return usages
}

/** Все типы схемы без служебных, с фильтром по подстроке имени. */
export function listTypes(schema: GraphQLSchema, needle = ''): ITypeListEntry[] {
    const lower = needle.trim().toLowerCase()

    return Object.values(schema.getTypeMap())
        .filter((type) => !type.name.startsWith('__'))
        .filter((type) => lower.length === 0 || type.name.toLowerCase().includes(lower))
        .map((type) => ({
            name: type.name,
            kind: typeKindOf(type),
            description: type.description ?? undefined,
            fieldCount:
                isObjectType(type) || isInterfaceType(type) || isInputObjectType(type)
                    ? Object.keys(type.getFields()).length
                    : isEnumType(type)
                      ? type.getValues().length
                      : 0,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
}

/** Совпадение поля по имени в любом типе — для поиска в сайдбаре. */
export interface IFieldHit {
    typeName: string
    fieldName: string
    type: string
    description?: string
}

export function searchFields(schema: GraphQLSchema, needle: string, limit = 50): IFieldHit[] {
    const lower = needle.trim().toLowerCase()
    if (lower.length === 0) return []

    const hits: IFieldHit[] = []
    for (const type of Object.values(schema.getTypeMap())) {
        if (type.name.startsWith('__')) continue
        if (!(isObjectType(type) || isInterfaceType(type) || isInputObjectType(type))) continue

        for (const field of Object.values(type.getFields())) {
            if (!field.name.toLowerCase().includes(lower)) continue

            hits.push({
                typeName: type.name,
                fieldName: field.name,
                type: field.type.toString(),
                description: field.description ?? undefined,
            })
            if (hits.length >= limit) return hits
        }
    }

    return hits
}
