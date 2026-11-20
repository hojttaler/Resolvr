import {
    insertCompletionText,
    snippetCompletion,
    type Completion,
    type CompletionContext,
    type CompletionResult,
    type CompletionSource,
} from '@codemirror/autocomplete'
import { completionPath, scopeCompletionSource } from '@codemirror/lang-javascript'
import { syntaxTree } from '@codemirror/language'
import type { IRequestScripts } from '@resolvr/core'

import { t } from '../../i18n/index.js'
import type { IScriptField } from './script-context.js'

type ISyntaxNode = ReturnType<typeof syntaxTree>['topNode']
type IPathPart = string | number | undefined

const STANDARD_GLOBALS = {
    Array, Boolean, Date, Error, JSON, Map, Math, Number, Object, RegExp, Set, String,
    parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
}

export const standardScriptCompletion = scopeCompletionSource(Object.assign(
    Object.create(null) as Record<string, unknown>,
    STANDARD_GLOBALS,
))

const assertion = snippetCompletion('assert(${condition}, "${message}")', {
    label: 'assert',
    type: 'function',
    detail: '(condition, message?)',
})

export function createScriptCompletion(
    scope: { request: IScriptField; response: IScriptField },
    phase: keyof IRequestScripts,
): CompletionSource {
    const binding = phase === 'preRequest' ? 'request' : 'response'

    return (context) => {
        const tree = syntaxTree(context.state)
        const inner = tree.resolveInner(context.pos, -1)
        let member = inner.name === 'MemberExpression' ? inner : inner.parent
        // Дефис анализируется как вычитание, пока имя HTTP-заголовка без кавычек.
        const headerSuffix = member?.name === 'MemberExpression'
            ? null : context.matchBefore(/[\w$]+(?:-[\w$]*)+/)
        if (headerSuffix) {
            const operator = tree.resolveInner(headerSuffix.from, -1)
            if (operator.name === '.' || operator.name === '?.') member = operator.parent
        }
        if (member?.name === 'MemberExpression') {
            const base = member.firstChild
            const access = base && memberAccess(base)
            if (!base || !access || context.pos < access.operator.to) return null

            const path = readPath(context, base)
            if (!path || path[0] !== binding) return null
            if (headerSuffix && (path.length !== 2 || path[1] !== 'headers')) return null
            let target: IScriptField | undefined = scope[binding]
            for (const part of path.slice(1)) {
                target = typeof part === 'string' ? target?.fields?.().get(part) : target?.element?.(part)
                if (!target) return null
            }

            const fields = target.fields?.()
            if (!fields?.size) return null

            return completeMember(context, access, fields, headerSuffix?.from)
        }

        const path = completionPath(context)
        if (!path || path.path.length > 0) return null
        const prefix = context.matchBefore(/[$A-Z_a-z][$\w]*/)
        if (!prefix && !context.explicit) return null

        return {
            from: prefix?.from ?? context.pos,
            options: [{ label: binding, type: 'variable', boost: 10 }, assertion],
            validFor: /^[$\w]*$/,
        }
    }
}

function memberAccess(base: ISyntaxNode): {
    operator: ISyntaxNode
    optional: boolean
    bracket: boolean
    property: ISyntaxNode | null
    close: ISyntaxNode | null
} | undefined {
    const first = base.nextSibling
    if (!first || !['.', '?.', '['].includes(first.name)) return undefined

    const optional = first.name === '?.'
    const operator = optional && first.nextSibling?.name === '[' ? first.nextSibling : first
    const property = operator.nextSibling
    const close = base.parent?.lastChild

    return {
        operator,
        optional,
        bracket: operator.name === '[',
        property: property && property.from < property.to && property.name !== ']' && !property.type.isError
            ? property : null,
        close: close?.name === ']' ? close : null,
    }
}

function readPath(context: CompletionContext, node: ISyntaxNode): IPathPart[] | undefined {
    const parts: IPathPart[] = []
    let current = node
    while (current.name === 'MemberExpression') {
        const base = current.firstChild
        const access = base && memberAccess(base)
        if (!base || !access?.property) return undefined

        const { property } = access
        const text = context.state.sliceDoc(property.from, property.to)
        if (!access.bracket && property.name === 'PropertyName') {
            parts.push(text)
        } else if (access.bracket) {
            if (property.name === 'String') {
                const key = unquoteProperty(text)
                if (key === undefined) return undefined
                parts.push(key)
            } else {
                parts.push(/^\d+$/.test(text) ? Number(text) : undefined)
            }
        } else {
            return undefined
        }

        current = base
    }
    if (current.name !== 'VariableName') return undefined
    parts.push(context.state.sliceDoc(current.from, current.to))

    return parts.reverse()
}

function unquoteProperty(text: string): string | undefined {
    if (text.startsWith("'") && text.endsWith("'")) {
        return text.slice(1, -1).replace(/\\(['"\\])/g, '$1')
    }

    try {
        const value: unknown = JSON.parse(text)
        return typeof value === 'string' ? value : undefined
    } catch {
        return undefined
    }
}

function completeMember(
    context: CompletionContext,
    access: NonNullable<ReturnType<typeof memberAccess>>,
    fields: ReadonlyMap<string, IScriptField>,
    headerFrom?: number,
): CompletionResult | null {
    const { operator, optional, bracket, property, close } = access
    const quoted = bracket && property?.name === 'String'
    if (bracket && property && !quoted) return null
    if (quoted && context.pos < property.from + 1) return null
    if (quoted && context.pos >= property.to && !property.lastChild?.type.isError) return null
    if (headerFrom === undefined && !bracket && property?.name === 'PropertyName' && context.pos > property.to) return null

    const from = headerFrom ?? (quoted ? property.from + 1 : property?.name === 'PropertyName' ? property.from : context.pos)
    const options: Completion[] = [...fields].map(([label, field]) => ({
        label,
        type: 'property',
        detail: field.detail && t(field.detail),
        info: field.info,
        apply: (view, _option, start, to) => {
            let replaceFrom = start
            let end = property ? Math.max(to, property.to) : to
            let insert = label
            if (bracket) {
                if (close) end = close.to
                else if (view.state.sliceDoc(end, end + 1) === ']') end += 1
                replaceFrom = operator.to
                insert = JSON.stringify(label) + ']'
            } else if (!/^[$A-Z_a-z][$\w]*$/.test(label)) {
                replaceFrom = optional ? operator.to : operator.from
                insert = '[' + JSON.stringify(label) + ']'
            }

            view.dispatch(insertCompletionText(view.state, insert, replaceFrom, end))
        },
    }))

    return { from, options }
}
