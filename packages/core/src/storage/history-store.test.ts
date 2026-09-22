import { describe, expect, it } from 'vitest'

import { historyTitle } from './history-store.js'

describe('historyTitle', () => {
    it('предпочитает имя сохранённой операции, затем имя из документа, затем первое поле', () => {
        expect(historyTitle({ operationRef: 'users/Get Me', operationName: 'Me', query: '' })).toBe('Get Me')
        expect(historyTitle({ operationName: 'Me', query: '{ me { id } }' })).toBe('Me')
        expect(historyTitle({ query: '{ me { id } }' })).toBe('me')
        expect(historyTitle({ query: 'query { # comment\n  products(first: 1) { id } }' })).toBe('products')
        expect(historyTitle({ query: 'not graphql' })).toBeUndefined()
    })
})
