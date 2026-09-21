import {
    buildSchema,
    isEnumType,
    isInputObjectType,
    isInterfaceType,
    isObjectType,
    printType,
    type GraphQLSchema,
} from 'graphql'

export type ISchemaChangeKind = 'added' | 'removed' | 'changed'

export interface ISchemaChange {
    kind: ISchemaChangeKind
    /** `User` или `User.email` — тип или конкретное поле. */
    path: string
    /**
     * Изменение ломает существующие запросы: удалено поле или тип, у поля
     * появился обязательный аргумент, изменился тип поля.
     */
    breaking: boolean
    description: string
}

export interface ISchemaDiff {
    changes: ISchemaChange[]
    breakingCount: number
}

/** Поля типа в виде «имя → печатное описание сигнатуры». */
type IFieldMap = Map<string, string>

/**
 * Сравнивает два снимка схемы.
 *
 * Ответ на вопрос «что сломалось после деплоя»: показывает исчезнувшие типы и
 * поля, изменившиеся сигнатуры и новые обязательные аргументы. Служебные типы
 * интроспекции (`__Type` и подобные) пропускаются как шум.
 */
export function diffSchemas(previousSdl: string, currentSdl: string): ISchemaDiff {
    const previous = buildSchema(previousSdl, { assumeValidSDL: true })
    const current = buildSchema(currentSdl, { assumeValidSDL: true })

    const previousTypes = collectTypes(previous)
    const currentTypes = collectTypes(current)
    const changes: ISchemaChange[] = []

    for (const typeName of previousTypes.keys()) {
        if (currentTypes.has(typeName)) continue

        changes.push({
            kind: 'removed',
            path: typeName,
            breaking: true,
            description: `Тип "${typeName}" удалён из схемы`,
        })
    }

    for (const typeName of currentTypes.keys()) {
        if (previousTypes.has(typeName)) continue

        changes.push({
            kind: 'added',
            path: typeName,
            breaking: false,
            description: `Добавлен тип "${typeName}"`,
        })
    }

    for (const [typeName, previousFields] of previousTypes) {
        const currentFields = currentTypes.get(typeName)
        if (!currentFields) continue

        changes.push(...diffFields(typeName, previousFields, currentFields))
    }

    return { changes, breakingCount: changes.filter((change) => change.breaking).length }
}

function diffFields(
    typeName: string,
    previousFields: IFieldMap,
    currentFields: IFieldMap,
): ISchemaChange[] {
    const changes: ISchemaChange[] = []

    for (const [fieldName, signature] of previousFields) {
        const currentSignature = currentFields.get(fieldName)

        if (currentSignature === undefined) {
            changes.push({
                kind: 'removed',
                path: `${typeName}.${fieldName}`,
                breaking: true,
                description: `Поле "${typeName}.${fieldName}" удалено`,
            })
            continue
        }

        if (currentSignature !== signature) {
            changes.push({
                kind: 'changed',
                path: `${typeName}.${fieldName}`,
                breaking: isBreakingSignatureChange(signature, currentSignature),
                description: `Поле "${typeName}.${fieldName}": было "${signature}", стало "${currentSignature}"`,
            })
        }
    }

    for (const fieldName of currentFields.keys()) {
        if (previousFields.has(fieldName)) continue

        changes.push({
            kind: 'added',
            path: `${typeName}.${fieldName}`,
            breaking: false,
            description: `Добавлено поле "${typeName}.${fieldName}"`,
        })
    }

    return changes
}

/**
 * Изменение сигнатуры считается ломающим, если поменялся возвращаемый тип или
 * добавилась обязательная (`!` без значения по умолчанию) часть — такие правки
 * требуют изменения существующих запросов.
 */
function isBreakingSignatureChange(previous: string, current: string): boolean {
    const previousReturn = previous.slice(previous.lastIndexOf(':') + 1).trim()
    const currentReturn = current.slice(current.lastIndexOf(':') + 1).trim()
    if (previousReturn !== currentReturn) return true

    const previousRequired = countRequiredArguments(previous)
    const currentRequired = countRequiredArguments(current)

    return currentRequired > previousRequired
}

function countRequiredArguments(signature: string): number {
    const start = signature.indexOf('(')
    const end = signature.lastIndexOf(')')
    if (start < 0 || end <= start) return 0

    return signature
        .slice(start + 1, end)
        .split(',')
        .filter((argument) => argument.trim().endsWith('!')).length
}

/** Типы схемы без служебных интроспекционных, с сигнатурами полей. */
function collectTypes(schema: GraphQLSchema): Map<string, IFieldMap> {
    const result = new Map<string, IFieldMap>()

    for (const [name, type] of Object.entries(schema.getTypeMap())) {
        if (name.startsWith('__')) continue

        const fields: IFieldMap = new Map()

        if (isObjectType(type) || isInterfaceType(type)) {
            for (const [fieldName, field] of Object.entries(type.getFields())) {
                const args = field.args
                    .map((argument) => `${argument.name}: ${argument.type.toString()}`)
                    .join(', ')
                fields.set(fieldName, `${args ? `(${args})` : ''}: ${field.type.toString()}`)
            }
        } else if (isInputObjectType(type)) {
            for (const [fieldName, field] of Object.entries(type.getFields())) {
                fields.set(fieldName, `: ${field.type.toString()}`)
            }
        } else if (isEnumType(type)) {
            for (const value of type.getValues()) {
                fields.set(value.name, ': enum value')
            }
        }

        result.set(name, fields)
    }

    return result
}

/** Печатает определение одного типа в SDL — для панели документации. */
export function printTypeDefinition(schema: GraphQLSchema, typeName: string): string | undefined {
    const type = schema.getType(typeName)

    return type ? printType(type) : undefined
}
