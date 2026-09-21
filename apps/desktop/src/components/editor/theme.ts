import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { tags } from '@lezer/highlight'
import type { Extension } from '@codemirror/state'

/**
 * Оформление редактора.
 *
 * Цвета заданы CSS-переменными, а не константами: тема переключается вместе с
 * системной без пересоздания редактора и без второго набора стилей.
 */
const editorTheme = EditorView.theme({
    '&': {
        height: '100%',
        fontSize: 'var(--code-size)',
        color: 'var(--text-primary)',
        backgroundColor: 'transparent',
    },
    '.cm-content': {
        fontFamily: 'var(--font-mono)',
        padding: '8px 0',
        caretColor: 'var(--accent)',
        userSelect: 'text',
    },
    '.cm-scroller': {
        fontFamily: 'var(--font-mono)',
        lineHeight: '1.55',
        overflow: 'auto',
    },
    '.cm-gutters': {
        backgroundColor: 'transparent',
        color: 'var(--text-tertiary)',
        border: 'none',
        paddingRight: '4px',
    },
    '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--text-secondary)',
    },
    '.cm-activeLine': { backgroundColor: 'var(--surface-hover)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 26%, transparent)',
    },
    '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
    '.cm-tooltip': {
        border: '1px solid var(--separator-strong)',
        borderRadius: 'var(--radius-md)',
        backgroundColor: 'var(--surface-overlay)',
        backdropFilter: 'blur(30px) saturate(180%)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-size)',
        overflow: 'hidden',
    },
    '.cm-tooltip-autocomplete > ul > li': {
        padding: '3px 10px',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--code-size)',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--accent)',
        color: 'var(--accent-contrast)',
    },
    '.cm-completionDetail': { color: 'var(--text-tertiary)', fontStyle: 'normal' },
    '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
    '.cm-lintRange-error': {
        backgroundImage: 'none',
        textDecoration: 'underline wavy var(--danger)',
    },
    '.cm-panels': {
        backgroundColor: 'var(--surface-raised)',
        color: 'var(--text-primary)',
        borderTop: '1px solid var(--separator)',
    },
    '.cm-searchMatch': {
        backgroundColor: 'color-mix(in srgb, var(--warning) 32%, transparent)',
    },
    '.cm-searchMatch-selected': {
        backgroundColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
    },
    '.cm-foldPlaceholder': {
        backgroundColor: 'var(--surface-active)',
        border: 'none',
        color: 'var(--text-secondary)',
        borderRadius: '3px',
        padding: '0 4px',
    },
})

const highlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--syntax-keyword)' },
    { tag: tags.definitionKeyword, color: 'var(--syntax-keyword)' },
    { tag: [tags.propertyName, tags.attributeName], color: 'var(--syntax-field)' },
    { tag: [tags.variableName, tags.definition(tags.variableName)], color: 'var(--syntax-variable)' },
    { tag: [tags.typeName, tags.className], color: 'var(--syntax-keyword)' },
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--syntax-string)' },
    { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
    { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
    { tag: [tags.punctuation, tags.bracket, tags.separator], color: 'var(--syntax-punctuation)' },
    { tag: tags.meta, color: 'var(--text-tertiary)' },
])

export const appEditorTheme: Extension = [editorTheme, syntaxHighlighting(highlightStyle)]
