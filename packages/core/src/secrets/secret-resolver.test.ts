import { describe, expect, it } from 'vitest'

import { WorkspaceSchema } from '../model/schemas.js'
import { MemorySecretStore } from '../testing/fakes.js'
import {
    hasUnresolvedPlaceholders,
    interpolate,
    interpolateHeaders,
    interpolateJson,
    maskHeaders,
    maskSecrets,
    maskSecretsInJson,
    SECRET_MASK,
    SecretResolver,
} from './secret-resolver.js'

function createWorkspace() {
    return WorkspaceSchema.parse({
        id: 'api',
        name: 'API',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    })
}

describe('interpolate', () => {
    it('подставляет известные переменные и оставляет неизвестные как есть', () => {
        const result = interpolate('Bearer {{token}} / {{unknown}}', { token: 'abc' })

        expect(result).toBe('Bearer abc / {{unknown}}')
    })

    it('подставляет значения во вложенные структуры переменных', () => {
        const result = interpolateJson(
            { filter: { ids: ['{{id}}'], label: 'user-{{id}}' }, limit: 10 },
            { id: '42' },
        )

        expect(result).toEqual({ filter: { ids: ['42'], label: 'user-42' }, limit: 10 })
    })

    it('подставляет значения в заголовки', () => {
        expect(interpolateHeaders({ 'x-tenant': '{{tenant}}' }, { tenant: 'acme' })).toEqual({
            'x-tenant': 'acme',
        })
    })
})

describe('SecretResolver', () => {
    it('раскрывает ссылку keychain:// и помечает значение как секретное', async () => {
        const secrets = new MemorySecretStore()
        await secrets.set({ workspace: 'api', environment: 'staging', key: 'token' }, 'super-token')

        const resolver = new SecretResolver(secrets)
        const resolved = await resolver.resolveEnvironment(createWorkspace(), {
            id: 'staging',
            name: 'Staging',
            production: false,
            variables: { token: 'keychain://api/staging/token', host: 'example.com' },
            headers: {},
            auth: { type: 'none' },
        })

        expect(resolved.variables).toEqual({ token: 'super-token', host: 'example.com' })
        expect(resolved.secretValues).toEqual(['super-token'])
    })

    it('оставляет переменную нераскрытой, если секрета в хранилище нет', async () => {
        const resolver = new SecretResolver(new MemorySecretStore())

        const resolved = await resolver.resolveEnvironment(createWorkspace(), {
            id: 'staging',
            name: 'Staging',
            production: false,
            variables: { token: 'keychain://api/staging/token', host: 'example.com' },
            headers: {},
            auth: { type: 'none' },
        })

        expect(resolved.variables).toEqual({ host: 'example.com' })
        expect(resolved.missing).toEqual(['token'])
    })
})

describe('маскирование', () => {
    it('заменяет значение секрета в произвольном тексте', () => {
        expect(maskSecrets('token=super-token;', ['super-token'])).toBe(`token=${SECRET_MASK};`)
    })

    it('не трогает слишком короткие значения, чтобы не портить текст ложными срабатываниями', () => {
        expect(maskSecrets('a=1;b=2', ['1'])).toBe('a=1;b=2')
    })

    it('маскирует секреты внутри JSON-структуры', () => {
        const masked = maskSecretsInJson({ nested: { token: 'super-token' } }, ['super-token'])

        expect(masked).toEqual({ nested: { token: SECRET_MASK } })
    })

    it('всегда скрывает значения авторизационных заголовков', () => {
        const masked = maskHeaders(
            { authorization: 'Bearer whatever', 'x-trace': 'plain' },
            [],
        )

        expect(masked.authorization).toBe(SECRET_MASK)
        expect(masked['x-trace']).toBe('plain')
    })
})

describe('генераторы значений', () => {
    const context = { now: new Date('2026-09-30T10:00:00.000Z'), random: () => 0.5 }

    it('подставляет uuid, время и случайные значения', () => {
        expect(interpolate('{{$timestamp}}', {}, context)).toBe('1790762400000')
        expect(interpolate('{{$unix}}', {}, context)).toBe('1790762400')
        expect(interpolate('{{$isoDate}}', {}, context)).toBe('2026-09-30T10:00:00.000Z')
        expect(interpolate('{{$date}}', {}, context)).toBe('2026-09-30')
        expect(interpolate('{{$uuid}}', {}, context)).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        )
        expect(interpolate('{{$randomInt:10:10}}', {}, context)).toBe('10')
        expect(interpolate('{{$randomString:6}}', {}, context)).toHaveLength(6)
        expect(interpolate('{{$randomEmail}}', {}, context)).toMatch(/^[a-z0-9]{10}@example\.com$/)
    })

    it('переменная с тем же именем важнее генератора, неизвестный остаётся текстом', () => {
        expect(interpolate('{{$uuid}}', { $uuid: 'fixed' }, context)).toBe('fixed')
        expect(interpolate('{{$nope}}', {}, context)).toBe('{{$nope}}')
        expect(interpolate('{{$randomInt:abc}}', {}, context)).toBe('{{$randomInt:abc}}')
    })

    it('работает в JSON и заголовках', () => {
        expect(interpolateJson({ key: '{{$date}}', nested: ['{{$unix}}'] }, {}, context)).toEqual({
            key: '2026-09-30',
            nested: ['1790762400'],
        })
        expect(interpolateHeaders({ 'x-request-id': '{{$uuid}}' }, {}, context)['x-request-id']).toMatch(
            /^[0-9a-f-]{36}$/,
        )
    })

    it('нераскрытым считается только то, что не подставилось', () => {
        expect(hasUnresolvedPlaceholders(interpolate('{{$uuid}}', {}, context))).toBe(false)
        expect(hasUnresolvedPlaceholders('{{$unknown}}')).toBe(true)
    })
})
