/**
 * Русское склонение существительного при числительном.
 *
 * Формы задаются в порядке «1 / 2 / 5»: `plural(1, ['ошибка', 'ошибки',
 * 'ошибок'])` → «ошибка». Без этого счётчики выводились одной формой
 * («1 ошибок»), что читается как опечатка.
 */
export function plural(count: number, forms: readonly [string, string, string]): string {
    const tail = Math.abs(count) % 10
    const hundreds = Math.abs(count) % 100

    if (tail === 1 && hundreds !== 11) return forms[0]
    if (tail >= 2 && tail <= 4 && (hundreds < 12 || hundreds > 14)) return forms[1]

    return forms[2]
}

/** Число вместе со склонённым существительным: `2 ошибки`. */
export function pluralize(count: number, forms: readonly [string, string, string]): string {
    return `${count} ${plural(count, forms)}`
}

export const ERRORS = ['ошибка', 'ошибки', 'ошибок'] as const
export const FIELDS = ['поле', 'поля', 'полей'] as const
export const ITEMS = ['элемент', 'элемента', 'элементов'] as const
export const EVENTS = ['событие', 'события', 'событий'] as const
export const LINES = ['строка', 'строки', 'строк'] as const
export const CALLS = ['вызов', 'вызова', 'вызовов'] as const
export const STEPS = ['шаг', 'шага', 'шагов'] as const
export const CHAINS = ['цепочка', 'цепочки', 'цепочек'] as const
export const DRAFTS = ['черновик', 'черновика', 'черновиков'] as const
