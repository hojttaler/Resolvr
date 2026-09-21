import type { ILanguage } from '@resolvr/core'
import { useSyncExternalStore } from 'react'

import { ru } from './ru.js'

/** Язык, на котором реально отрисован интерфейс (без `system`). */
export type IResolvedLanguage = 'en' | 'ru'

type IDictionary = Record<string, string | readonly [string, string, string]>

const DICTIONARIES: Record<IResolvedLanguage, IDictionary | undefined> = { en: undefined, ru }

let current: IResolvedLanguage = 'en'
const listeners = new Set<() => void>()

/**
 * Разрешает настройку в конкретный язык: `system` берётся из языка ОС в
 * webview, всё незнакомое — английский.
 */
export function resolveLanguage(setting: ILanguage): IResolvedLanguage {
    if (setting === 'ru' || setting === 'en') return setting

    const system = typeof navigator === 'undefined' ? 'en' : navigator.language.toLowerCase()

    return system.startsWith('ru') ? 'ru' : 'en'
}

export function setLanguage(language: IResolvedLanguage): void {
    if (language === current) return

    current = language
    document.documentElement.setAttribute('lang', language)
    for (const listener of listeners) listener()
}

export function currentLanguage(): IResolvedLanguage {
    return current
}

/**
 * Перевод строки.
 *
 * Ключ — английский текст как он написан в коде; в словаре другого языка
 * лежит перевод. Подстановки вида `{name}` заполняются из `params`;
 * фигурные скобки, которых нет в `params`, остаются как есть — так
 * `{{variable}}` в подсказках доходит до экрана нетронутым.
 */
export function t(key: string, params?: Record<string, string | number>): string {
    const entry = DICTIONARIES[current]?.[key]
    const text = typeof entry === 'string' ? entry : key

    return interpolate(text, params)
}

/**
 * Существительное с числительным: `tn(3, 'error|errors')` → «3 errors» /
 * «3 ошибки». Английские формы разделены `|`; русские — тройка в словаре.
 */
export function tn(count: number, forms: string): string {
    return `${count} ${plural(count, forms)}`
}

/** Только форма слова без числа. */
export function plural(count: number, forms: string): string {
    const entry = DICTIONARIES[current]?.[forms]
    const [one, other] = forms.split('|') as [string, string]

    // `Array.isArray` сужает readonly-кортеж до `any[]`; явная проверка
    // формы сохраняет тип тройки.
    if (current === 'ru' && typeof entry !== 'string' && entry !== undefined) {
        const [first, second, third] = entry
        const tail = Math.abs(count) % 10
        const hundreds = Math.abs(count) % 100

        if (tail === 1 && hundreds !== 11) return first
        if (tail >= 2 && tail <= 4 && (hundreds < 12 || hundreds > 14)) return second

        return third
    }

    return count === 1 ? one : other
}

function interpolate(text: string, params?: Record<string, string | number>): string {
    if (!params) return text

    return text.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
    )
}

/** Хук: компонент перерисовывается при смене языка. */
export function useT(): typeof t {
    useSyncExternalStore(subscribe, currentLanguage, currentLanguage)

    return t
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener)

    return () => listeners.delete(listener)
}

/** Пары «английский → перевод» для тестов полноты словаря. */
export function dictionaryKeys(language: IResolvedLanguage): string[] {
    return Object.keys(DICTIONARIES[language] ?? {})
}
