import {
    closeSearchPanel,
    findNext,
    findPrevious,
    getSearchQuery,
    replaceAll,
    replaceNext,
    SearchQuery,
    setSearchQuery,
} from '@codemirror/search'
import type { EditorState } from '@codemirror/state'
import type { EditorView, Panel, ViewUpdate } from '@codemirror/view'

import { t } from '../../i18n/index.js'

/** Дальше этого числа совпадения не считаются: счётчик не должен тормозить ввод. */
const MAX_COUNTED_MATCHES = 1000

interface IToggle {
    button: HTMLButtonElement
    key: 'caseSensitive' | 'regexp' | 'wholeWord'
}

/**
 * Панель поиска и замены в редакторе.
 *
 * Стандартная панель CodeMirror выглядит чужеродно: браузерные поля,
 * кнопки без оформления и подписи на английском. Эта собрана из тех же
 * элементов, что и остальной интерфейс, и показывает число совпадений —
 * без него пустой результат неотличим от незавершённого ввода.
 */
export function createSearchPanel(view: EditorView): Panel {
    const readOnly = view.state.readOnly
    let replaceOpen = false

    const dom = element('div', 'editor-search')
    const findRow = element('div', 'editor-search__row')
    const replaceRow = element('div', 'editor-search__row editor-search__row--replace')

    const expand = button('editor-search__expand btn btn--quiet btn--icon', '›', t('Replace'))
    const searchInput = input(t('Find'))
    // Атрибут `main-field` — по нему CodeMirror ставит фокус при открытии панели.
    searchInput.setAttribute('main-field', 'true')
    const counter = element('span', 'editor-search__count')
    const previous = button('btn btn--quiet btn--icon', '↑', t('Previous match (Shift+Enter)'))
    const next = button('btn btn--quiet btn--icon', '↓', t('Next match (Enter)'))
    const toggles: IToggle[] = [
        { key: 'caseSensitive', button: button('btn btn--quiet btn--icon', 'Aa', t('Match case')) },
        {
            key: 'regexp',
            button: button('btn btn--quiet btn--icon', '.*', t('Regular expression')),
        },
        { key: 'wholeWord', button: button('btn btn--quiet btn--icon', 'W', t('Whole word')) },
    ]
    const close = button('editor-search__close btn btn--quiet btn--icon', '×', t('Close (Esc)'))

    const replaceInput = input(t('Replace'))
    const replaceOne = button('btn', t('Replace'), t('Replace the current match (Enter)'))
    const replaceEvery = button('btn', t('Replace all'), t('Replace all matches'))

    if (!readOnly) findRow.append(expand)
    findRow.append(
        searchInput,
        counter,
        previous,
        next,
        ...toggles.map((item) => item.button),
        close,
    )
    replaceRow.append(replaceInput, replaceOne, replaceEvery)
    dom.append(findRow)

    let query = getSearchQuery(view.state)
    searchInput.value = query.search
    replaceInput.value = query.replace

    function commit(patch: Partial<Record<IToggle['key'], boolean>> = {}): void {
        const next = new SearchQuery({
            search: searchInput.value,
            replace: replaceInput.value,
            caseSensitive: patch.caseSensitive ?? query.caseSensitive,
            regexp: patch.regexp ?? query.regexp,
            wholeWord: patch.wholeWord ?? query.wholeWord,
        })
        if (!next.eq(query)) view.dispatch({ effects: setSearchQuery.of(next) })
    }

    function render(state: EditorState): void {
        for (const toggle of toggles) {
            toggle.button.classList.toggle('btn--on', query[toggle.key])
            toggle.button.setAttribute('aria-pressed', String(query[toggle.key]))
        }

        const invalid = query.search.length > 0 && !query.valid
        searchInput.classList.toggle('editor-search__input--invalid', invalid)

        const { total, current } = countMatches(state, query)
        counter.classList.toggle(
            'editor-search__count--empty',
            query.search.length > 0 && total === 0,
        )
        counter.textContent =
            query.search.length === 0
                ? ''
                : invalid
                  ? t('invalid pattern')
                  : total === 0
                    ? t('no matches')
                    : total > MAX_COUNTED_MATCHES
                      ? `${MAX_COUNTED_MATCHES}+`
                      : t('{current} of {total}', { current: current || '–', total })

        previous.disabled = total === 0
        next.disabled = total === 0
        replaceOne.disabled = total === 0
        replaceEvery.disabled = total === 0
    }

    function setReplaceOpen(open: boolean): void {
        replaceOpen = open
        expand.classList.toggle('editor-search__expand--open', open)
        if (open) dom.append(replaceRow)
        else replaceRow.remove()
    }

    searchInput.addEventListener('input', () => commit())
    replaceInput.addEventListener('input', () => commit())
    for (const toggle of toggles) {
        toggle.button.addEventListener('click', () => commit({ [toggle.key]: !query[toggle.key] }))
    }
    previous.addEventListener('click', () => findPrevious(view))
    next.addEventListener('click', () => findNext(view))
    close.addEventListener('click', () => closeSearchPanel(view))
    replaceOne.addEventListener('click', () => replaceNext(view))
    replaceEvery.addEventListener('click', () => replaceAll(view))
    expand.addEventListener('click', () => {
        setReplaceOpen(!replaceOpen)
        ;(replaceOpen ? replaceInput : searchInput).focus()
    })

    dom.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault()
            closeSearchPanel(view)

            return
        }
        if (event.key !== 'Enter') return

        event.preventDefault()
        if (event.target === replaceInput) {
            if (event.metaKey || event.ctrlKey) replaceAll(view)
            else replaceNext(view)
        } else if (event.shiftKey) {
            findPrevious(view)
        } else {
            findNext(view)
        }
    })

    render(view.state)

    return {
        dom,
        top: true,
        // Панель открывается по ⌘F — ввод сразу должен идти в поле поиска.
        mount(): void {
            searchInput.select()
        },
        update(update: ViewUpdate): void {
            const current = getSearchQuery(update.state)
            if (!current.eq(query)) {
                query = current
                // Запрос мог смениться извне — например, ⌘F с выделенным словом.
                if (searchInput.value !== query.search) searchInput.value = query.search
                if (replaceInput.value !== query.replace) replaceInput.value = query.replace
                render(update.state)

                return
            }
            if (update.docChanged || update.selectionSet) render(update.state)
        },
    }
}

/**
 * Число совпадений и номер текущего — того, что совпадает с выделением.
 * Подсчёт ограничен: на огромном тексте точное число не стоит задержки.
 */
function countMatches(state: EditorState, query: SearchQuery): { total: number; current: number } {
    if (!query.valid || query.search.length === 0) return { total: 0, current: 0 }

    const selection = state.selection.main
    const cursor = query.getCursor(state)
    let total = 0
    let current = 0

    for (let step = cursor.next(); !step.done; step = cursor.next()) {
        total += 1
        if (step.value.from === selection.from && step.value.to === selection.to) current = total
        if (total > MAX_COUNTED_MATCHES) break
    }

    return { total, current }
}

function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    node.className = className

    return node
}

function button(className: string, text: string, title: string): HTMLButtonElement {
    const node = element('button', className)
    node.type = 'button'
    node.textContent = text
    node.title = title
    node.setAttribute('aria-label', title)

    return node
}

function input(placeholder: string): HTMLInputElement {
    const node = element('input', 'input editor-search__input mono')
    node.placeholder = placeholder
    node.spellcheck = false
    node.setAttribute('autocomplete', 'off')
    node.setAttribute('autocorrect', 'off')
    node.setAttribute('autocapitalize', 'off')

    return node
}
