import {
    getNamedType,
    isEnumType,
    isInputObjectType,
    isInterfaceType,
    isObjectType,
    isScalarType,
    isUnionType,
    printType,
    type GraphQLNamedType,
    type GraphQLSchema,
} from 'graphql'

/** Краткая сводка схемы: с чего агенту начинать, не читая весь SDL. */
export interface ISchemaSummary {
    typeCount: number
    queryCount: number
    mutationCount: number
    subscriptionCount: number
    /** Несколько имён для ориентира; полный список — через `listRootFields`. */
    sampleQueries: string[]
    sampleMutations: string[]
}

/** Раздел корневых операций для постраничного просмотра. */
export type IRootSection = 'queries' | 'mutations' | 'subscriptions'

export interface IRootFieldPage {
    section: IRootSection
    total: number
    offset: number
    fields: IFieldSummary[]
}

export interface IFieldSummary {
    name: string
    /** Сигнатура вида `user(id: ID!): User`. */
    signature: string
}

export interface ISchemaSearchHit {
    kind: 'type' | 'field'
    /** `User` или `Query.user`. */
    path: string
    signature: string
}

const DEFAULT_SEARCH_LIMIT = 40

/**
 * Сводка схемы вместо полного SDL.
 *
 * Схема реального гейтвея — около мегабайта текста, а это сотни тысяч токенов
 * на один ответ. Агенту почти всегда нужны имена корневых операций и один-два
 * типа, поэтому по умолчанию отдаётся оглавление, а подробности запрашиваются
 * точечно.
 */
export function buildSchemaSummary(schema: GraphQLSchema, sampleSize = 15): ISchemaSummary {
    const queries = collectRootFields(schema.getQueryType())
    const mutations = collectRootFields(schema.getMutationType())
    const subscriptions = collectRootFields(schema.getSubscriptionType())

    // У крупного гейтвея полторы тысячи корневых операций: даже их имена — это
    // тысячи токенов, поэтому в сводку идут только счётчики и образцы.
    return {
        typeCount: Object.keys(schema.getTypeMap()).filter((name) => !name.startsWith('__')).length,
        queryCount: queries.length,
        mutationCount: mutations.length,
        subscriptionCount: subscriptions.length,
        sampleQueries: queries.slice(0, sampleSize).map((field) => field.name),
        sampleMutations: mutations.slice(0, sampleSize).map((field) => field.name),
    }
}

/** Страница корневых операций: полный список читается порциями. */
export function listRootFields(
    schema: GraphQLSchema,
    section: IRootSection,
    offset = 0,
    limit = 50,
): IRootFieldPage {
    const type =
        section === 'queries'
            ? schema.getQueryType()
            : section === 'mutations'
              ? schema.getMutationType()
              : schema.getSubscriptionType()

    const fields = collectRootFields(type)

    return { section, total: fields.length, offset, fields: fields.slice(offset, offset + limit) }
}

function collectRootFields(type: ReturnType<GraphQLSchema['getQueryType']>): IFieldSummary[] {
    if (!type) return []

    return Object.values(type.getFields()).map((field) => ({
        name: field.name,
        signature: formatFieldSignature(field.name, field),
    }))
}

function formatFieldSignature(
    name: string,
    field: { args: readonly { name: string; type: unknown }[]; type: unknown },
): string {
    const args = field.args
        .map((argument) => `${argument.name}: ${String(argument.type)}`)
        .join(', ')

    return `${name}${args ? `(${args})` : ''}: ${String(field.type)}`
}

/**
 * Поиск по схеме: типы и поля, содержащие подстроку.
 *
 * Заменяет чтение всего SDL ради одного поля — типичный вопрос «где здесь
 * accessToken» решается ответом на пару строк.
 */
export function searchSchema(
    schema: GraphQLSchema,
    query: string,
    limit = DEFAULT_SEARCH_LIMIT,
): ISchemaSearchHit[] {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return []

    const hits: ISchemaSearchHit[] = []

    for (const [typeName, type] of Object.entries(schema.getTypeMap())) {
        if (typeName.startsWith('__')) continue

        if (typeName.toLowerCase().includes(needle)) {
            hits.push({ kind: 'type', path: typeName, signature: describeType(type) })
            if (hits.length >= limit) return hits
        }

        const fields = readFields(type)
        for (const [fieldName, signature] of fields) {
            if (!fieldName.toLowerCase().includes(needle)) continue

            hits.push({ kind: 'field', path: `${typeName}.${fieldName}`, signature })
            if (hits.length >= limit) return hits
        }
    }

    return hits
}

/** Поля типа с сигнатурами; для типов без полей — пустой список. */
function readFields(type: GraphQLNamedType): Array<[string, string]> {
    if (isObjectType(type) || isInterfaceType(type)) {
        return Object.values(type.getFields()).map((field) => [
            field.name,
            formatFieldSignature(field.name, field),
        ])
    }

    if (isInputObjectType(type)) {
        return Object.values(type.getFields()).map((field) => [
            field.name,
            `${field.name}: ${String(field.type)}`,
        ])
    }

    if (isEnumType(type)) {
        return type.getValues().map((value) => [value.name, `${type.name}.${value.name}`])
    }

    return []
}

function describeType(type: GraphQLNamedType): string {
    if (isScalarType(type)) return `scalar ${type.name}`
    if (isEnumType(type)) return `enum ${type.name}`
    if (isUnionType(type)) return `union ${type.name}`
    if (isInputObjectType(type)) return `input ${type.name}`
    if (isInterfaceType(type)) return `interface ${type.name}`

    return `type ${type.name}`
}

/**
 * Печать типа с ограничением по числу полей.
 *
 * Корневые `Query` и `Mutation` крупного гейтвея занимают десятки тысяч
 * токенов, поэтому длинные типы отдаются частями.
 */
export function printTypeLimited(
    schema: GraphQLSchema,
    typeName: string,
    limit = 60,
): { sdl: string; truncated: boolean; totalFields: number } | undefined {
    const type = schema.getType(typeName)
    if (!type) return undefined

    const fields = readFields(type)
    if (fields.length <= limit) {
        return { sdl: printType(type), truncated: false, totalFields: fields.length }
    }

    const shown = fields.slice(0, limit).map(([, signature]) => `  ${signature}`)

    return {
        sdl: `${describeType(type)} {\n${shown.join('\n')}\n  # …и ещё ${fields.length - limit} полей\n}`,
        truncated: true,
        totalFields: fields.length,
    }
}

/** Именованный тип поля — для подсказки, куда смотреть дальше. */
export function namedTypeOf(schema: GraphQLSchema, typeName: string): string | undefined {
    const type = schema.getType(typeName)

    return type ? getNamedType(type).name : undefined
}
