import { describe, expect, it } from 'vitest'

import { countMatches, highlightParts, nodeMatches, subtreeMatches } from './json-search.js'

const RESPONSE = {
    user: { id: 'u-1', email: 'admin@example.com', roles: ['ADMIN', 'USER'] },
    session: { token: 'abc', expiresIn: 3600 },
}

describe('поиск по ответу', () => {
    it('находит по имени поля и по значению', () => {
        expect(nodeMatches('email', 'admin@example.com', 'mail')).toBe(true)
        expect(nodeMatches('id', 'u-1', 'u-1')).toBe(true)
        expect(nodeMatches('id', 'u-1', 'нет')).toBe(false)
    })

    it('не ищет по строковому представлению контейнера', () => {
        expect(nodeMatches('user', RESPONSE.user, 'admin')).toBe(false)
    })

    it('показывает ветку, если совпадение внутри неё', () => {
        expect(subtreeMatches('user', RESPONSE.user, 'admin')).toBe(true)
        expect(subtreeMatches('session', RESPONSE.session, 'admin')).toBe(false)
    })

    it('находит числа и null', () => {
        expect(subtreeMatches('session', RESPONSE.session, '3600')).toBe(true)
        expect(subtreeMatches(undefined, { reason: null }, 'null')).toBe(true)
    })

    it('считает совпадения по всем строкам', () => {
        // admin@example.com и роль ADMIN — регистр не учитывается.
        expect(countMatches(RESPONSE, 'admin')).toBe(2)
        expect(countMatches(RESPONSE, '')).toBe(0)
    })

    it('разбивает текст для подсветки', () => {
        expect(highlightParts('ADMIN role', 'admin')).toEqual([
            { text: 'ADMIN', match: true },
            { text: ' role', match: false },
        ])
        expect(highlightParts('нет', 'admin')).toEqual([{ text: 'нет', match: false }])
    })
})
