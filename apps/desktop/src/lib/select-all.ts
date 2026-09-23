import { selectAll } from '@codemirror/commands'
import { EditorView } from '@codemirror/view'

/**
 * «Выделить всё» с учётом области фокуса.
 *
 * Панели, у которых выделение устроено не как у обычного текста (ответ,
 * нарисованный виртуализированным деревом), помечаются атрибутом
 * `data-select-all` и сами обрабатывают событие `SELECT_ALL_EVENT`. Нужно для
 * пункта меню «Правка → Выделить всё»: он свой на всех платформах, поэтому
 * ⌘A / Ctrl+A приходит командой меню, а не нажатием клавиш.
 */
export const SELECT_ALL_EVENT = 'resolvr:select-all'

/** Выделяет всё в области фокуса; вне особых панелей — стандартное поведение документа. */
export function selectAllInFocus(): void {
    const active = document.activeElement
    const region = active instanceof HTMLElement ? active.closest('[data-select-all]') : null

    if (region) {
        region.dispatchEvent(new CustomEvent(SELECT_ALL_EVENT))

        return
    }

    // CodeMirror рисует только видимые строки: выделение через DOM захватило
    // бы лишь их, поэтому редактору команда передаётся напрямую.
    const editor = active instanceof HTMLElement ? active.closest('.cm-editor') : null
    const view = editor instanceof HTMLElement ? EditorView.findFromDOM(editor) : null
    if (view) {
        selectAll(view)

        return
    }

    // Устаревший, но единственный способ повторить системное «выделить всё»
    // для поля ввода или обычного текста.
    document.execCommand('selectAll')
}
