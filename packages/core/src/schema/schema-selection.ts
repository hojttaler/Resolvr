import {
    getNamedType,
    isAbstractType,
    isCompositeType,
    isInterfaceType,
    isObjectType,
    isRequiredArgument,
    isTypeSubTypeOf,
    Kind,
    parse,
    print,
    type FieldNode,
    type GraphQLCompositeType,
    type GraphQLField,
    type GraphQLSchema,
    type InlineFragmentNode,
    type Location,
    type OperationDefinitionNode,
    type SelectionSetNode,
} from 'graphql'

import type { IOperationKind } from '../model/schemas.js'
import { buildInputSkeleton } from './selection-set-builder.js'

export interface ISchemaSelectionTarget {
    /** Смещение открывающей скобки в текущем документе. */
    offset: number
    label: string
}

interface ISelectionEdit {
    query: string
    kind: IOperationKind
    operationIndex?: number
    /** Путь полей от корня, с фрагментами в виде `... on Type`. */
    path?: readonly string[]
    target?: ISchemaSelectionTarget
    field: string
    reservedVariables?: readonly string[]
}

export interface ISchemaCompletion {
    anchor: number
    head: number
    insertion?: { prefix: string; suffix: string }
}

interface ISelectionPatch {
    query: string
    variables: Record<string, unknown>
    completion?: ISchemaCompletion
}

interface ITextEdit {
    from: number
    to: number
    text: string
}

interface IFieldInsertion {
    at: number
    prefix: string
    suffix: string
    block?: { indent: string; step: string; newline: string }
}

export const MAX_SCHEMA_FIELD_DEPTH = 5

export interface ISchemaFieldTarget {
    query: string
    type: GraphQLCompositeType
    operation?: OperationDefinitionNode
    selection?: SelectionSetNode
    field?: FieldNode
}

export interface ISchemaFieldChoice {
    name: string
    type: string
    description?: string
    selected?: boolean
}

/** Операции документа в порядке редактора. Незавершённый текст нельзя менять через схему. */
export function schemaOperations(query: string): OperationDefinitionNode[] {
    if (!query.trim()) return []

    return parse(query).definitions.filter(
        (node): node is OperationDefinitionNode => node.kind === Kind.OPERATION_DEFINITION,
    )
}

/** Корневой тип выбранной операции. */
export function schemaOperationRoot(
    schema: GraphQLSchema,
    kind: IOperationKind,
): GraphQLCompositeType | undefined {
    return schema.getRootType(kind) ?? undefined
}

/** Семантический тип одного звена пути в дереве. */
export function nextSchemaType(
    schema: GraphQLSchema,
    parent: GraphQLCompositeType,
    part: string,
): GraphQLCompositeType | undefined {
    if (part.startsWith('... on ')) {
        const type = schema.getType(part.slice(7))

        return type && isObjectType(type) && isTypeSubTypeOf(schema, type, parent)
            ? type
            : undefined
    }
    const field =
        isObjectType(parent) || isInterfaceType(parent) ? parent.getFields()[part] : undefined
    const type = field ? getNamedType(field.type) : undefined

    return type && isCompositeType(type) ? type : undefined
}

/** Уже выбранная ветка. При неоднозначном алиасе ветку выбирают в браузере типов. */
export function schemaSelectionBranch(
    selection: SelectionSetNode | undefined,
    part: string,
): FieldNode | undefined {
    const fields =
        selection?.selections.filter(
            (node): node is FieldNode => node.kind === Kind.FIELD && node.name.value === part,
        ) ?? []

    return fields.find((node) => !node.alias) ?? (fields.length === 1 ? fields[0] : undefined)
}

function selectionBranch(
    selection: SelectionSetNode | undefined,
    part: string,
): FieldNode | InlineFragmentNode | undefined {
    return part.startsWith('... on ')
        ? selection?.selections.find(
              (node): node is InlineFragmentNode =>
                  node.kind === Kind.INLINE_FRAGMENT &&
                  node.typeCondition?.name.value === part.slice(7),
          )
        : schemaSelectionBranch(selection, part)
}

/** Наборы полей указанного типа, уже открытые в операции. Алиасы различают одинаковые типы. */
export function schemaSelectionTargets(
    schema: GraphQLSchema,
    operation: OperationDefinitionNode,
    typeName: string,
): ISchemaSelectionTarget[] {
    const root = schemaOperationRoot(schema, operation.operation)
    const targets: ISchemaSelectionTarget[] = []
    if (!root) return targets

    function visit(selection: SelectionSetNode, type: GraphQLCompositeType, label: string): void {
        if (type.name === typeName && selection.loc)
            targets.push({ offset: selection.loc.start, label })

        for (const node of selection.selections) {
            if (node.kind === Kind.FIELD && node.selectionSet) {
                const child = nextSchemaType(schema, type, node.name.value)
                if (child)
                    visit(
                        node.selectionSet,
                        child,
                        `${label} › ${node.alias?.value ?? node.name.value}`,
                    )
            }
            if (node.kind === Kind.INLINE_FRAGMENT) {
                const condition = node.typeCondition?.name.value
                const child = condition ? schema.getType(condition) : type
                if (child && isCompositeType(child)) {
                    visit(node.selectionSet, child, condition ? `${label} › ${condition}` : label)
                }
            }
        }
    }

    visit(operation.selectionSet, root, operation.name?.value ?? root.name)

    return targets
}

function findSchemaContainer(
    schema: GraphQLSchema,
    operation: OperationDefinitionNode,
    root: GraphQLCompositeType,
    offset: number,
): { node: SelectionSetNode; type: GraphQLCompositeType } | undefined {
    function find(
        node: SelectionSetNode,
        type: GraphQLCompositeType,
    ): { node: SelectionSetNode; type: GraphQLCompositeType } | undefined {
        if (node.loc?.start === offset) return { node, type }

        for (const entry of node.selections) {
            if (entry.kind === Kind.FRAGMENT_SPREAD || !entry.selectionSet) continue
            const child =
                entry.kind === Kind.FIELD
                    ? nextSchemaType(schema, type, entry.name.value)
                    : entry.typeCondition
                      ? schema.getType(entry.typeCondition.name.value)
                      : type
            if (!child || !isCompositeType(child)) continue
            const found = find(entry.selectionSet, child)
            if (found) return found
        }

        return undefined
    }

    return find(operation.selectionSet, root)
}

function fieldInsertion(query: string, set: SelectionSetNode, loc: Location): IFieldInsertion {
    const closing = loc.end - 1
    const last = set.selections.at(-1)?.loc
    const tail = /[ \t\r\n]*$/.exec(query.slice(last?.end ?? loc.start + 1, closing))?.[0] ?? ''
    if (loc.startToken.line === loc.endToken.line) {
        return { at: closing - tail.length, prefix: ' ', suffix: '' }
    }

    const openingLine = query.slice(loc.start - loc.startToken.column + 1, loc.start)
    const base = /^[ \t]*/.exec(openingLine)?.[0] ?? ''
    const token = last?.startToken
    const lastIndent = token && query.slice(token.start - token.column + 1, token.start)
    const indent =
        lastIndent !== undefined && /^[ \t]*$/.test(lastIndent) ? lastIndent : `${base}  `
    const step = indent.startsWith(base) ? indent.slice(base.length) || '  ' : '  '
    const lineBreak = /\r\n?|\n/.exec(tail)
    const newline = lineBreak?.[0] ?? /\r\n?|\n/.exec(query)?.[0] ?? '\n'
    const block = { indent, step, newline }

    if (lineBreak) {
        // Вставка после конца предыдущей строки сохраняет комментарии и отступ закрывающей скобки.
        return {
            at: closing - tail.length + lineBreak.index + newline.length,
            prefix: indent,
            suffix: newline,
            block,
        }
    }

    return { at: closing, prefix: newline + indent, suffix: newline + base, block }
}

function selectionEdit(
    query: string,
    set: SelectionSetNode,
    loc: Location,
    text: string,
): ITextEdit {
    const { at, prefix, suffix, block } = fieldInsertion(query, set, loc)
    const field = block
        ? print(parse(`{ ${text} }`))
              .split('\n')
              .slice(1, -1)
              .map((line, index) =>
                  line.replace(
                      /^(?: {2})+/,
                      (spaces) =>
                          (index ? block.indent : '') + block.step.repeat(spaces.length / 2 - 1),
                  ),
              )
              .join(block.newline)
        : text

    return { from: at, to: at, text: prefix + field + suffix }
}

function variableEdit(
    operation: OperationDefinitionNode,
    definitions: readonly string[],
): ITextEdit | undefined {
    if (!definitions.length || !operation.loc) return undefined

    const variableText = definitions.join(', ')
    const last = operation.variableDefinitions?.at(-1)
    if (last?.loc) {
        return { from: last.loc.end, to: last.loc.end, text: `, ${variableText}` }
    }
    if (operation.loc.start === operation.selectionSet.loc?.start) {
        const at = operation.loc.start
        return { from: at, to: at, text: `query (${variableText}) ` }
    }

    const at = operation.name?.loc?.end ?? operation.loc.start + operation.operation.length
    return { from: at, to: at, text: `(${variableText})` }
}

function applySelectionEdits(query: string, edits: readonly ITextEdit[]): string {
    const parts: string[] = []
    let from = 0
    for (const edit of edits.toSorted((left, right) => left.from - right.from)) {
        parts.push(query.slice(from, edit.from), edit.text)
        from = edit.to
    }
    parts.push(query.slice(from))

    return parts.join('')
}

function fieldArgumentCollector(
    operations: readonly OperationDefinitionNode[],
    reserved: readonly string[],
): {
    definitions: string[]
    variables: Record<string, unknown>
    fieldText: (field: GraphQLField<unknown, unknown>) => string
} {
    const names = new Set([
        ...operations.flatMap((operation) =>
            (operation.variableDefinitions ?? []).map(
                (definition) => definition.variable.name.value,
            ),
        ),
        ...reserved,
    ])
    const definitions: string[] = []
    const variables = Object.create(null) as Record<string, unknown>

    return {
        definitions,
        variables,
        fieldText(field): string {
            const args = field.args.filter(isRequiredArgument).map((arg) => {
                let name = arg.name
                for (let suffix = 2; names.has(name); suffix += 1) name = `${arg.name}${suffix}`
                names.add(name)
                definitions.push(`$${name}: ${String(arg.type)}`)
                variables[name] = buildInputSkeleton(arg.type, 2)

                return `${arg.name}: $${name}`
            })
            return `${field.name}${args.length ? `(${args.join(', ')})` : ''}`
        },
    }
}

/** Вставляет поле и объявления его аргументов, сохраняя остальной текст документа. */
export function addSchemaSelection(schema: GraphQLSchema, input: ISelectionEdit): ISelectionPatch {
    const operations = schemaOperations(input.query)
    const operation = operations[input.operationIndex ?? 0]
    if (input.query.trim() && (!operation || operation.operation !== input.kind)) {
        throw new Error('Operation does not match the schema selection')
    }

    const root = schemaOperationRoot(schema, input.kind)
    if (!root) throw new Error('Operation has no root type')

    let parent = root
    let container = operation?.selectionSet
    const missing: Array<{ type: GraphQLCompositeType; part: string }> = []

    if (input.target && operation) {
        const found = findSchemaContainer(schema, operation, root, input.target.offset)
        if (!found) throw new Error('Selection is no longer available')
        container = found.node
        parent = found.type
    }

    const path = [...(input.path ?? []), input.field]
    let composite = false
    for (const [index, part] of path.entries()) {
        const fragment = part.startsWith('... on ')
        const child = missing.length ? undefined : selectionBranch(container, part)
        const nested = nextSchemaType(schema, parent, part)
        const field =
            !fragment && (isObjectType(parent) || isInterfaceType(parent))
                ? parent.getFields()[part]
                : undefined

        if (!nested && !field) throw new Error('Field is not available in this selection')
        if (!child) missing.push({ type: parent, part })
        composite = nested !== undefined
        if (nested) parent = nested
        if (child) {
            if (child.selectionSet) container = child.selectionSet
            else if (index < path.length - 1)
                throw new Error('Complete the parent selection in the editor first')
        }
    }

    const complete = (
        query: string,
        variables: Record<string, unknown>,
        targetOffset = input.target?.offset,
    ): ISelectionPatch => {
        const patch: ISelectionPatch = { query, variables }
        if (!composite) return patch

        const updated = schemaOperations(query)[input.operationIndex ?? 0]
        if (!updated) return patch
        let set =
            targetOffset === undefined
                ? updated.selectionSet
                : findSchemaContainer(schema, updated, root, targetOffset)?.node

        for (const part of path) {
            set = selectionBranch(set, part)?.selectionSet
        }
        if (!set?.loc) return patch

        const placeholder = set.selections[0]
        // Обратное выделение подставляет выбранное поле вместо служебного __typename.
        if (
            missing.length &&
            set.selections.length === 1 &&
            placeholder?.kind === Kind.FIELD &&
            placeholder.name.value === '__typename' &&
            placeholder.loc
        ) {
            patch.completion = { anchor: placeholder.loc.end, head: placeholder.loc.start }
        } else {
            const layout = fieldInsertion(query, set, set.loc)
            let head = layout.block ? layout.at : set.loc.end - 1
            // В компактной записи курсору нужен пробел после последнего имени поля.
            if (/\w$/.test(query.slice(head - 1, head))) {
                patch.query = `${query.slice(0, head)} ${query.slice(head)}`
                head += 1
            }
            patch.completion = {
                anchor: head,
                head,
                ...(layout.block && {
                    insertion: { prefix: layout.prefix, suffix: layout.suffix },
                }),
            }
        }

        return patch
    }

    if (!missing.length) return complete(input.query, {})
    if (input.kind === 'subscription' && operation && container === operation.selectionSet) {
        throw new Error('A subscription can select only one root field')
    }

    const { definitions, variables, fieldText } = fieldArgumentCollector(
        operations,
        input.reservedVariables ?? [],
    )
    let text = ''

    for (const { part, type } of missing.reverse()) {
        if (part.startsWith('... on ')) {
            text = `${part} { ${text || '__typename'} }`
            continue
        }
        const field =
            isObjectType(type) || isInterfaceType(type) ? type.getFields()[part] : undefined
        if (!field) throw new Error('Field is not available in this selection')
        const body = text || (isCompositeType(getNamedType(field.type)) ? '__typename' : '')
        text = `${fieldText(field)}${body ? ` { ${body} }` : ''}`
    }

    const variableText = definitions.join(', ')
    if (!operation || !container?.loc) {
        const query = `${input.kind} Explorer${variableText ? `(${variableText})` : ''} { ${text} }`

        return complete(`${print(parse(query))}\n`, variables)
    }

    const edits = [selectionEdit(input.query, container, container.loc, text)]
    const header = variableEdit(operation, definitions)
    if (header) edits.push(header)
    const query = applySelectionEdits(input.query, edits)

    const originalOffset = input.target?.offset
    const targetOffset =
        originalOffset !== undefined
            ? edits.reduce(
                  (offset, edit) =>
                      edit.to <= originalOffset
                          ? offset + edit.text.length - (edit.to - edit.from)
                          : offset,
                  originalOffset,
              )
            : undefined

    return complete(query, variables, targetOffset)
}

/** Находит ближайшую выборку под курсором, включая клик по имени поля-объекта. */
export function findSchemaFieldTarget(
    schema: GraphQLSchema,
    query: string,
    position: number,
): ISchemaFieldTarget | undefined {
    if (!query.trim()) {
        const type = schemaOperationRoot(schema, 'query')
        return type && { query, type }
    }

    const operations = schemaOperations(query)
    const first = operations[0]
    const last = operations.at(-1)
    const operation =
        operations.find(
            (node) => node.loc && position >= node.loc.start && position <= node.loc.end,
        ) ??
        (first?.loc && position < first.loc.start && !query.slice(0, first.loc.start).trim()
            ? first
            : last?.loc && position >= last.loc.end && !query.slice(last.loc.end).trim()
              ? last
              : undefined)
    const root = operation && schemaOperationRoot(schema, operation.operation)
    if (!operation || !root) return undefined

    function visit(type: GraphQLCompositeType, selection: SelectionSetNode): ISchemaFieldTarget {
        for (const node of selection.selections) {
            if (!node.loc || position < node.loc.start || position >= node.loc.end) continue
            if (node.kind === Kind.FIELD) {
                const child = nextSchemaType(schema, type, node.name.value)
                if (child) {
                    return node.selectionSet
                        ? visit(child, node.selectionSet)
                        : { query, operation, type: child, field: node }
                }
            }
            if (node.kind === Kind.INLINE_FRAGMENT) {
                const name = node.typeCondition?.name.value
                const child = name ? schema.getType(name) : type
                if (child && isCompositeType(child)) return visit(child, node.selectionSet)
            }
        }

        return { query, operation, type, selection }
    }

    return visit(root, operation.selectionSet)
}

function fieldsForType(schema: GraphQLSchema, type: GraphQLCompositeType): ISchemaFieldChoice[] {
    const fields =
        isObjectType(type) || isInterfaceType(type) ? Object.values(type.getFields()) : []
    const members = isAbstractType(type) ? schema.getPossibleTypes(type) : []

    return [
        ...fields.map((field) => ({
            name: field.name,
            type: String(field.type),
            description: field.description ?? undefined,
        })),
        ...members.map((member) => ({ name: `... on ${member.name}`, type: member.name })),
    ]
}

/** Возвращает поля текущей выборки с учётом ограничения корня подписки. */
export function schemaFieldChoices(
    schema: GraphQLSchema,
    target: ISchemaFieldTarget,
): ISchemaFieldChoice[] {
    const selected = new Set<string>()
    for (const entry of target.selection?.selections ?? []) {
        if (entry.kind === Kind.FIELD) selected.add(entry.name.value)
        if (entry.kind === Kind.INLINE_FRAGMENT && entry.typeCondition) {
            selected.add(`... on ${entry.typeCondition.name.value}`)
        }
    }
    const fields = fieldsForType(schema, target.type).map((field) => ({
        ...field,
        selected: selected.has(field.name),
    }))
    if (
        target.operation?.operation !== 'subscription' ||
        target.selection !== target.operation.selectionSet
    )
        return fields

    return fields.filter((field) => field.selected)
}

/**
 * Добавляет отмеченные поля и вложенные выборки одним набором правок.
 * Существующие поля, алиасы и комментарии сохраняются.
 */
export function addSchemaFields(
    schema: GraphQLSchema,
    target: ISchemaFieldTarget,
    names: readonly string[],
    depth: number,
    reserved: readonly string[] = [],
): ISelectionPatch {
    if (!Number.isInteger(depth) || depth < 1 || depth > MAX_SCHEMA_FIELD_DEPTH) {
        throw new RangeError('Invalid selection depth')
    }
    const { query, operation, type, selection, field } = target
    const { definitions, variables, fieldText } = fieldArgumentCollector(
        schemaOperations(query),
        reserved,
    )
    const allowed = new Set(schemaFieldChoices(schema, target).map((choice) => choice.name))
    const edits: ITextEdit[] = []
    let budget = 2_000

    function append(
        parent: GraphQLCompositeType,
        set: SelectionSetNode | undefined,
        choices: Iterable<string>,
        remaining: number,
    ): string {
        const output: string[] = []
        const available = isObjectType(parent) || isInterfaceType(parent) ? parent.getFields() : {}
        const existing = new Map<string, FieldNode | InlineFragmentNode>()
        for (const node of set?.selections ?? []) {
            if (node.kind === Kind.FIELD) {
                if (!node.alias || !existing.has(node.name.value))
                    existing.set(node.name.value, node)
            } else if (node.kind === Kind.INLINE_FRAGMENT && node.typeCondition) {
                existing.set(`... on ${node.typeCondition.name.value}`, node)
            }
        }

        for (const name of choices) {
            if (budget-- <= 0) throw new RangeError('Selection is too large')
            const fragment = name.startsWith('... on ')
            const child = nextSchemaType(schema, parent, name)
            const current = existing.get(name)
            const descend = child && (fragment || remaining > 1)
            if (current && !descend) continue
            const nested = descend
                ? append(
                      child,
                      current?.selectionSet,
                      fieldsForType(schema, child).map((choice) => choice.name),
                      remaining - (fragment ? 0 : 1),
                  )
                : ''
            const body = child ? ` { ${nested || '__typename'} }` : ''
            if (current) {
                if (!current.selectionSet && current.loc) {
                    edits.push({ from: current.loc.end, to: current.loc.end, text: body })
                }
            } else if (fragment) {
                output.push(name + body)
            } else if (available[name]) {
                output.push(fieldText(available[name]) + body)
            }
        }

        const text = output.join(' ')
        if (text && set?.loc) edits.push(selectionEdit(query, set, set.loc, text))

        return text
    }

    const text = append(type, selection, new Set(names.filter((name) => allowed.has(name))), depth)
    if (!operation && text) {
        const header = definitions.length ? `(${definitions.join(', ')})` : ''
        return { query: `${print(parse(`query Explorer${header} { ${text} }`))}\n`, variables }
    }
    if (operation) {
        const header = variableEdit(operation, definitions)
        if (header) edits.push(header)
    }
    if (field?.loc && text) {
        edits.push({ from: field.loc.end, to: field.loc.end, text: ` { ${text} }` })
    }

    return { query: applySelectionEdits(query, edits), variables }
}
