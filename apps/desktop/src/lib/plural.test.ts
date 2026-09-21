import { describe, expect, it } from 'vitest'

import { ERRORS, plural, pluralize } from './plural.js'

describe('plural', () => {
    it('выбирает форму по последней цифре', () => {
        expect(plural(1, ERRORS)).toBe('ошибка')
        expect(plural(2, ERRORS)).toBe('ошибки')
        expect(plural(5, ERRORS)).toBe('ошибок')
        expect(plural(0, ERRORS)).toBe('ошибок')
    })

    it('учитывает исключение второго десятка', () => {
        expect(plural(11, ERRORS)).toBe('ошибок')
        expect(plural(12, ERRORS)).toBe('ошибок')
        expect(plural(21, ERRORS)).toBe('ошибка')
        expect(plural(102, ERRORS)).toBe('ошибки')
    })

    it('склеивает число с формой', () => {
        expect(pluralize(3, ERRORS)).toBe('3 ошибки')
    })
})
