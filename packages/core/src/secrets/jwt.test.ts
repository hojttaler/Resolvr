import { describe, expect, it } from 'vitest'

import { findJwt, looksLikeJwt, millisecondsUntilExpiry, readJwtInfo } from './jwt.js'

/**
 * Собирает JWT с заданными полями: подпись не проверяется, важна нагрузка.
 *
 * Кодирование идёт через UTF-8: `btoa` принимает только байты, и без этого шага
 * кириллица в полезной нагрузке не собирается — ровно та причина, по которой
 * разбор в коде тоже проходит через `TextDecoder`.
 */
function makeJwt(claims: Record<string, unknown>): string {
    const encode = (value: object): string => {
        const bytes = new TextEncoder().encode(JSON.stringify(value))
        const binary = String.fromCharCode(...bytes)

        return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }

    return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}.signature`
}

describe('readJwtInfo', () => {
    it('читает срок жизни и владельца', () => {
        const exp = Math.floor(Date.now() / 1000) + 3600
        const info = readJwtInfo(makeJwt({ exp, sub: 'demo@example.com', role: 'ADMIN' }))

        expect(info?.expiresAt.getTime()).toBe(exp * 1000)
        expect(info?.subject).toBe('demo@example.com')
        expect(info?.role).toBe('ADMIN')
    })

    it('собирает роли из массива', () => {
        const info = readJwtInfo(makeJwt({ exp: 1, roles: ['ADMIN', 'SUPPORT'] }))

        expect(info?.role).toBe('ADMIN, SUPPORT')
    })

    it('возвращает undefined для непрозрачного токена', () => {
        // Не всякий токен — JWT, и это не ошибка: просто срок неизвестен.
        expect(readJwtInfo('rt-9f2b41ca')).toBeUndefined()
        expect(readJwtInfo(makeJwt({ sub: 'нет exp' }))).toBeUndefined()
    })

    it('корректно разбирает кириллицу в полезной нагрузке', () => {
        const info = readJwtInfo(makeJwt({ exp: 1, sub: 'Пользователь' }))

        expect(info?.subject).toBe('Пользователь')
    })
})

describe('millisecondsUntilExpiry', () => {
    it('даёт отрицательное значение для истёкшего токена', () => {
        const info = readJwtInfo(makeJwt({ exp: Math.floor(Date.now() / 1000) - 60 }))

        expect(millisecondsUntilExpiry(info!)).toBeLessThan(0)
    })
})

describe('looksLikeJwt и findJwt', () => {
    it('отличает JWT от обычной строки', () => {
        expect(looksLikeJwt(makeJwt({ exp: 1 }))).toBe(true)
        expect(looksLikeJwt('Bearer abc')).toBe(false)
    })

    it('находит токен в контексте цепочки', () => {
        const token = makeJwt({ exp: 1 })
        const found = findJwt({ operationId: 'op-1', accessToken: token })

        expect(found).toEqual({ name: 'accessToken', token })
    })
})
