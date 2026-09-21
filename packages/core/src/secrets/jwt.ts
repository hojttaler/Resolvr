/**
 * Чтение срока жизни JWT.
 *
 * Подпись не проверяется и не может быть проверена клиентом: нужен только
 * `exp`, чтобы обновить токен заранее, а не после отказа сервера. Значение
 * используется как подсказка, а не как решение о доступе.
 */
export interface IJwtInfo {
    expiresAt: Date
    /** Кому выдан — показывается в интерфейсе, помогает понять, под кем запрос. */
    subject?: string
    /** Роль или список ролей, если сервер их кладёт в токен. */
    role?: string
}

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/
const TOKEN_PREFIX = /^(Bearer|JWT|Token)\s+/i

/**
 * Отбрасывает схему авторизации перед токеном.
 *
 * Бэкенды нередко отдают готовый заголовок целиком — `Bearer eyJ…`, — и без
 * этого шага такое значение не распознавалось как токен вовсе.
 */
export function stripTokenPrefix(value: string): string {
    return value.trim().replace(TOKEN_PREFIX, '')
}

/** Похоже ли значение на JWT: три части, разделённые точками. */
export function looksLikeJwt(value: string): boolean {
    return JWT_SHAPE.test(stripTokenPrefix(value))
}

/**
 * Разбирает полезную нагрузку токена.
 *
 * Возвращает `undefined` для всего, что не является JWT с полем `exp`:
 * непрозрачные токены тоже встречаются, и это не ошибка.
 */
export function readJwtInfo(value: string): IJwtInfo | undefined {
    if (!looksLikeJwt(value)) return undefined

    const payload = stripTokenPrefix(value).split('.')[1]
    if (!payload) return undefined

    try {
        const json = decodeBase64Url(payload)
        const claims = JSON.parse(json) as {
            exp?: number
            sub?: string
            role?: unknown
            roles?: unknown
        }

        if (typeof claims.exp !== 'number') return undefined

        return {
            expiresAt: new Date(claims.exp * 1000),
            subject: typeof claims.sub === 'string' ? claims.sub : undefined,
            role: readRole(claims),
        }
    } catch {
        return undefined
    }
}

/** Сколько миллисекунд осталось до истечения; отрицательное — уже истёк. */
export function millisecondsUntilExpiry(info: IJwtInfo, now = Date.now()): number {
    return info.expiresAt.getTime() - now
}

/** Первый JWT среди значений — например, в контексте выполненной цепочки. */
export function findJwt(values: Record<string, unknown>): { name: string; token: string } | undefined {
    for (const [name, value] of Object.entries(values)) {
        if (typeof value === 'string' && looksLikeJwt(value)) return { name, token: value }
    }

    return undefined
}

function readRole(claims: { role?: unknown; roles?: unknown }): string | undefined {
    if (typeof claims.role === 'string') return claims.role
    if (Array.isArray(claims.roles)) {
        return claims.roles.filter((item) => typeof item === 'string').join(', ') || undefined
    }

    return undefined
}

/**
 * Декодирование base64url.
 *
 * `atob` есть и в webview, и в Node 18+, поэтому отдельной реализации на
 * `Buffer` не требуется — ядро остаётся независимым от среды.
 */
function decodeBase64Url(value: string): string {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
    const binary = atob(padded)

    // Полезная нагрузка — UTF-8: без перекодирования кириллица в `sub` ломается.
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))

    return new TextDecoder().decode(bytes)
}
