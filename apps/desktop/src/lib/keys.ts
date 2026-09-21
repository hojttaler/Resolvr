/**
 * Сочетания клавиш под платформу.
 *
 * На macOS модификатор — ⌘, на Windows и Linux — Ctrl; подписи в интерфейсе
 * и проверка событий должны совпадать с ускорителями нативного меню
 * (`CmdOrCtrl`), иначе подсказка обещает одно, а работает другое.
 */
export function isMacPlatform(): boolean {
    if (typeof document === 'undefined') return true

    return (document.documentElement.getAttribute('data-platform') ?? 'macos') === 'macos'
}

/** Нажат ли платформенный модификатор команды (⌘ или Ctrl). */
export function isModKey(event: { metaKey: boolean; ctrlKey: boolean }): boolean {
    return isMacPlatform() ? event.metaKey : event.ctrlKey
}

const MAC_KEYS: Record<string, string> = {
    Enter: '↩',
    Shift: '⇧',
    Alt: '⌥',
    Backspace: '⌫',
    Escape: '⎋',
}

/**
 * Подпись сочетания: `kbd('K')` → «⌘K» или «Ctrl+K», `kbd('Shift+Enter')` →
 * «⌘⇧↩» или «Ctrl+Shift+Enter». Модификатор команды подразумевается всегда.
 */
export function kbd(keys: string): string {
    const parts = keys.split('+')

    if (isMacPlatform()) {
        return `⌘${parts.map((part) => MAC_KEYS[part] ?? part).join('')}`
    }

    return ['Ctrl', ...parts].join('+')
}
