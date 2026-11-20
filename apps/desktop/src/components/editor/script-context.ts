import {
    getNamedType,
    getNullableType,
    getOperationAST,
    isCompositeType,
    isInputObjectType,
    isInputType,
    isListType,
    isObjectType,
    isInterfaceType,
    Kind,
    parse,
    print,
    typeFromAST,
    type FragmentDefinitionNode,
    type GraphQLCompositeType,
    type GraphQLInputType,
    type GraphQLOutputType,
    type GraphQLSchema,
    type InlineFragmentNode,
    type SelectionSetNode,
} from 'graphql'

const REQUEST_HEADERS = [
    'accept', 'accept-language', 'authorization', 'cache-control', 'content-type', 'cookie',
    'idempotency-key', 'if-none-match', 'user-agent', 'x-api-key', 'x-correlation-id', 'x-request-id',
]
const RESPONSE_HEADERS = [
    'cache-control', 'content-type', 'etag', 'last-modified', 'location',
    'retry-after', 'server-timing', 'set-cookie', 'vary', 'www-authenticate', 'x-request-id',
]

export interface IScriptContextInput {
    query: string
    operationName?: string
    schema?: GraphQLSchema
    variables: Record<string, unknown>
    requestHeaders: readonly string[]
    inheritedHeaders: readonly string[]
    responseHeaders: readonly string[]
}

export interface IScriptField {
    detail?: string
    info?: string
    fields?: () => ReadonlyMap<string, IScriptField>
    element?: (index?: number) => IScriptField
}

type IScriptFields = ReadonlyMap<string, IScriptField>
interface ISelectionScope {
    selection: SelectionSetNode
    parent?: GraphQLCompositeType
}

const stringField: IScriptField = { detail: 'string' }
const numberField: IScriptField = { detail: 'number' }
const booleanField: IScriptField = { detail: 'boolean' }

export function buildScriptContext(input: IScriptContextInput): { request: IScriptField; response: IScriptField } {
    const document = parseQuery(input.query)
    const operation = document && getOperationAST(document, input.operationName)
    const fragments = new Map(document?.definitions.flatMap((definition) =>
        definition.kind === Kind.FRAGMENT_DEFINITION ? [[definition.name.value, definition] as const] : [],
    ))
    const definitions = new Map(operation?.variableDefinitions?.map((definition) => {
        const type = input.schema && typeFromAST(input.schema, definition.type)

        return [definition.variable.name.value, {
            type: isInputType(type) ? type : undefined,
            detail: print(definition.type),
        }] as const
    }))
    const variables = new Map<string, IScriptField>()
    for (const [name, variable] of definitions) {
        const value = Object.hasOwn(input.variables, name) ? input.variables[name] : undefined
        variables.set(name, { ...inputNode(variable.type, value), detail: variable.detail })
    }
    for (const [name, value] of Object.entries(input.variables)) {
        if (!variables.has(name)) variables.set(name, inputNode(undefined, value))
    }

    const subscription = operation?.operation === 'subscription'
    const root = operation ? input.schema?.getRootType(operation.operation) ?? undefined : undefined
    const data: IScriptField = operation ? {
        fields: () => outputFields(input.schema, fragments, [{ selection: operation.selectionSet, parent: root }]),
    } : {}
    const errors: IScriptField = listField(() => objectField({
        message: stringField,
        path: listField(() => ({ detail: 'string | number' })),
        locations: listField(() => objectField({ line: numberField, column: numberField })),
        extensions: objectField({ code: stringField }),
    }))

    return {
        request: objectField({
            variables: { fields: () => variables },
            headers: { fields: () => headerFields(input.requestHeaders, input.inheritedHeaders, REQUEST_HEADERS) },
        }),
        response: objectField(subscription
            ? { data, errors, extensions: { detail: 'object' } }
            : {
                status: numberField,
                ok: booleanField,
                data,
                errors,
                body: stringField,
                headers: { fields: () => headerFields(input.responseHeaders, [], RESPONSE_HEADERS, true) },
            }),
    }
}

function parseQuery(query: string): ReturnType<typeof parse> | undefined {
    try {
        return parse(query)
    } catch {
        return undefined
    }
}

function objectField(fields: Record<string, IScriptField>): IScriptField {
    const entries = new Map(Object.entries(fields))

    return { fields: () => entries }
}

function listField(element: IScriptField['element']): IScriptField {
    return { ...objectField({ length: numberField }), detail: 'Array', element }
}

function inputNode(type: GraphQLInputType | undefined, value: unknown): IScriptField {
    const nullable = type && getNullableType(type)
    const list = isListType(nullable) ? nullable : undefined
    const listValues = Array.isArray(value) ? value as unknown[] : undefined
    if (list || listValues) {
        return {
            ...listField((index) => inputNode(list?.ofType, listValues?.[index ?? 0])),
            detail: type?.toString() ?? 'Array',
        }
    }

    const record = value && typeof value === 'object' ? value as Record<string, unknown> : undefined
    return {
        detail: type?.toString() ?? (record ? 'object' : value === null ? 'null' : value === undefined ? undefined : typeof value),
        fields: () => {
            const fields = new Map<string, IScriptField>()
            if (isInputObjectType(nullable)) {
                for (const field of Object.values(nullable.getFields())) {
                    const property = record && Object.hasOwn(record, field.name) ? record[field.name] : undefined
                    fields.set(field.name, { ...inputNode(field.type, property), info: field.description ?? undefined })
                }
            }
            for (const [name, property] of Object.entries(record ?? {})) {
                if (!fields.has(name)) fields.set(name, inputNode(undefined, property))
            }

            return fields
        },
    }
}

/** Имена ответа берутся из selection set, а типы и описания — из схемы. */
function outputFields(
    schema: GraphQLSchema | undefined,
    fragments: ReadonlyMap<string, FragmentDefinitionNode>,
    scopes: readonly ISelectionScope[],
): IScriptFields {
    const fields = new Map<string, { type?: GraphQLOutputType; info?: string; selections: ISelectionScope[] }>()
    const seenFragments = new Set<string>()
    const pending = [...scopes]
    while (pending.length > 0) {
        const scope = pending.pop()!
        for (const selection of scope.selection.selections) {
            if (selection.kind !== Kind.FIELD) {
                let fragment: FragmentDefinitionNode | InlineFragmentNode | undefined
                if (selection.kind === Kind.FRAGMENT_SPREAD) {
                    const name = selection.name.value
                    if (seenFragments.has(name)) continue
                    seenFragments.add(name)
                    fragment = fragments.get(name)
                } else {
                    fragment = selection
                }
                if (fragment) {
                    const named = fragment.typeCondition && schema?.getType(fragment.typeCondition.name.value)
                    pending.push({ selection: fragment.selectionSet, parent: isCompositeType(named) ? named : scope.parent })
                }
                continue
            }
            const key = selection.alias?.value ?? selection.name.value
            const parent = scope.parent
            const field = isObjectType(parent) || isInterfaceType(parent)
                ? parent.getFields()[selection.name.value]
                : undefined
            const entry = fields.get(key) ?? { selections: [] }
            entry.type ??= field?.type
            entry.info ??= field?.description ?? undefined
            if (selection.selectionSet) {
                const child = field && getNamedType(field.type)
                entry.selections.push({
                    selection: selection.selectionSet,
                    parent: isCompositeType(child) ? child : undefined,
                })
            }
            fields.set(key, entry)
        }
    }

    return new Map([...fields].map(([key, field]) => [key, {
        ...outputNode(field.type, () => outputFields(schema, fragments, field.selections)),
        info: field.info,
        detail: field.type?.toString() ?? (key === '__typename' ? 'String!' : undefined),
    }]))
}

function outputNode(type: GraphQLOutputType | undefined, fields: () => IScriptFields): IScriptField {
    const nullable = type && getNullableType(type)
    if (isListType(nullable)) {
        return { ...listField(() => outputNode(nullable.ofType, fields)), detail: type?.toString() }
    }

    // Без SDL выборка всё равно известна, но тип значения может быть списком.
    return type ? { fields, detail: type.toString() } : { fields, element: () => ({ fields }) }
}

function headerFields(
    current: readonly string[],
    inherited: readonly string[],
    possible: readonly string[],
    response = false,
): IScriptFields {
    const fields = new Map<string, IScriptField>()
    const seen = new Set<string>()
    for (const [names, detail] of [
        [current, response ? 'Last response header' : 'Request header'],
        [inherited, 'Inherited header · override'],
        [possible, 'HTTP header'],
    ] as const) {
        for (const name of names) {
            const normalized = name.toLowerCase()
            if (seen.has(normalized)) continue
            seen.add(normalized)
            fields.set(name, { detail })
        }
    }

    return fields
}
