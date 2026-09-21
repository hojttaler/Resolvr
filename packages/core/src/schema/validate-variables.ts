import {
    isEnumType,
    isInputObjectType,
    isInputType,
    isListType,
    isNonNullType,
    isScalarType,
    parse,
    print,
    typeFromAST,
    type GraphQLInputType,
    type GraphQLSchema,
    type OperationDefinitionNode,
} from 'graphql'

export interface IVariableProblem {
    /** Путь до проблемного значения: `input.captcha.clientToken`. */
    path: string
    message: string
    severity: 'error' | 'warning'
}

/**
 * Проверка переменных перед отправкой.
 *
 * Незаполненная обязательная переменная или значение не того типа выясняются
 * только по ответу сервера — это лишний круг и лишний шум в истории. Схема
 * известна локально, поэтому проверка выполняется до запроса.
 */
export function validateVariables(
    query: string,
    variables: Record<string, unknown>,
    schema: GraphQLSchema | undefined,
): IVariableProblem[] {
    let definitions: readonly OperationDefinitionNode[]
    try {
        definitions = parse(query).definitions.filter(
            (definition): definition is OperationDefinitionNode =>
                definition.kind === 'OperationDefinition',
        )
    } catch {
        // Незавершённый запрос проверяет редактор — здесь молчим.
        return []
    }

    const problems: IVariableProblem[] = []
    const declared = new Set<string>()

    for (const definition of definitions) {
        for (const variable of definition.variableDefinitions ?? []) {
            const name = variable.variable.name.value
            declared.add(name)

            const typeName = print(variable.type)
            const required = variable.type.kind === 'NonNullType' && !variable.defaultValue
            const value = variables[name]

            if (value === undefined || value === null) {
                if (required) {
                    problems.push({
                        path: name,
                        message: `обязательная переменная не заполнена (${typeName})`,
                        severity: 'error',
                    })
                }
                continue
            }

            // Тип берётся из AST вместе с обёртками `[…]` и `!`, поэтому списки
            // и вложенные объекты проверяются так же, как их видит сервер.
            const type = schema ? typeFromAST(schema, variable.type) : undefined
            if (type && isInputType(type)) problems.push(...checkValue(name, value, type))
        }
    }

    for (const name of Object.keys(variables)) {
        if (declared.has(name)) continue

        problems.push({
            path: name,
            message: 'переменная не объявлена в запросе — сервер её проигнорирует',
            severity: 'warning',
        })
    }

    return problems
}

/** Сверяет значение с типом схемы, спускаясь по спискам и input-объектам. */
function checkValue(path: string, value: unknown, type: GraphQLInputType): IVariableProblem[] {
    if (isNonNullType(type)) {
        if (value === null) {
            return [{ path, message: 'значение null для обязательного поля', severity: 'error' }]
        }

        return checkValue(path, value, type.ofType)
    }

    if (value === null || value === undefined) return []

    if (isListType(type)) {
        if (!Array.isArray(value)) {
            return [{ path, message: `ожидается список ${String(type)}`, severity: 'error' }]
        }

        return value.flatMap((item, index) => checkValue(`${path}.${index}`, item, type.ofType))
    }

    if (isEnumType(type)) {
        const allowed = type.getValues().map((item) => item.name)
        if (typeof value !== 'string' || !allowed.includes(value)) {
            return [
                {
                    path,
                    message: `недопустимое значение enum ${type.name}: ожидается ${allowed.slice(0, 6).join(', ')}`,
                    severity: 'error',
                },
            ]
        }

        return []
    }

    if (isScalarType(type)) return checkScalar(path, value, type.name)

    if (isInputObjectType(type)) {
        if (typeof value !== 'object' || Array.isArray(value)) {
            return [{ path, message: `ожидается объект ${type.name}`, severity: 'error' }]
        }

        const record = value as Record<string, unknown>
        const problems: IVariableProblem[] = []

        for (const field of Object.values(type.getFields())) {
            const fieldValue = record[field.name]
            const required = isNonNullType(field.type) && field.defaultValue === undefined

            if (fieldValue === undefined || fieldValue === null) {
                if (required) {
                    problems.push({
                        path: `${path}.${field.name}`,
                        message: `обязательное поле не заполнено (${String(field.type)})`,
                        severity: 'error',
                    })
                }
                continue
            }

            problems.push(...checkValue(`${path}.${field.name}`, fieldValue, field.type))
        }

        for (const key of Object.keys(record)) {
            if (type.getFields()[key]) continue

            problems.push({
                path: `${path}.${key}`,
                message: `поля нет в типе ${type.name}`,
                severity: 'warning',
            })
        }

        return problems
    }

    return []
}

/**
 * Проверка встроенных скаляров.
 *
 * Пользовательские скаляры не проверяются: их формат известен только серверу,
 * и любая догадка здесь давала бы ложные срабатывания.
 */
function checkScalar(path: string, value: unknown, typeName: string): IVariableProblem[] {
    const fail = (expected: string): IVariableProblem[] => [
        { path, message: `ожидается ${expected}, получено ${describe(value)}`, severity: 'error' },
    ]

    switch (typeName) {
        case 'Int':
            return Number.isInteger(value) ? [] : fail('целое число')
        case 'Float':
            return typeof value === 'number' ? [] : fail('число')
        case 'Boolean':
            return typeof value === 'boolean' ? [] : fail('true или false')
        case 'String':
            return typeof value === 'string' ? [] : fail('строка')
        case 'ID':
            return typeof value === 'string' || typeof value === 'number' ? [] : fail('строка или число')
        default:
            return []
    }
}

function describe(value: unknown): string {
    if (Array.isArray(value)) return 'список'
    if (value === null) return 'null'

    return typeof value === 'object' ? 'объект' : `${typeof value} (${JSON.stringify(value)})`
}
