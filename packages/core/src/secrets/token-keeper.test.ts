import { describe, expect, it } from 'vitest'

import { LibraryPaths } from '../storage/paths.js'
import { WorkspaceStore } from '../storage/workspace-store.js'
import { MemorySecretStore } from '../testing/fakes.js'
import { MemoryFileSystem } from '../testing/memory-file-system.js'
import { SecretResolver } from './secret-resolver.js'
import { TokenInfoStore } from './token-info-store.js'
import { pickToken, TokenKeeper } from './token-keeper.js'

/** Токен с известным сроком жизни — как его возвращает логин. */
function makeJwt(secondsFromNow: number): string {
    const encode = (value: object): string => {
        const bytes = new TextEncoder().encode(JSON.stringify(value))

        return btoa(String.fromCharCode(...bytes))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '')
    }

    return `${encode({ alg: 'RS256' })}.${encode({
        exp: Math.floor(Date.now() / 1000) + secondsFromNow,
        sub: 'demo@example.com',
    })}.signature`
}

async function createKeeper() {
    const fs = new MemoryFileSystem()
    const paths = new LibraryPaths('/library')
    const workspaces = new WorkspaceStore(fs, paths)
    const secrets = new MemorySecretStore()
    const resolver = new SecretResolver(secrets)

    await workspaces.init()
    await workspaces.createWorkspace({ name: 'API', endpointUrl: 'https://api.example.com/graphql' })

    const tokens = new TokenInfoStore(fs, paths)

    return { workspaces, secrets, tokens, keeper: new TokenKeeper(workspaces, resolver, tokens) }
}

describe('TokenKeeper', () => {
    it('кладёт токен в Keychain, а в окружение — ссылку на него', async () => {
        // Регрессия: значение жило только внутри запроса, поэтому заголовок
        // `Bearer {{accessToken}}` оставался нераскрытым и логин повторялся.
        const harness = await createKeeper()
        const token = makeJwt(3600)

        const remembered = await harness.keeper.remember('api', 'default', {
            operationId: 'op-1',
            accessToken: token,
        })

        expect(remembered?.variable).toBe('accessToken')

        const workspace = await harness.workspaces.getWorkspace('api')
        expect(workspace.environments[0]?.variables.accessToken).toBe(
            'keychain://api/default/accessToken',
        )
        expect(
            await harness.secrets.get({
                workspace: 'api',
                environment: 'default',
                key: 'accessToken',
            }),
        ).toBe(token)
    })

    it('запоминает срок жизни и владельца токена', async () => {
        const harness = await createKeeper()

        await harness.keeper.remember('api', 'default', { accessToken: makeJwt(1800) })

        const info = await harness.tokens.get('api', 'default')
        const expiresAt = new Date(info?.expiresAt ?? 0).getTime()

        expect(expiresAt - Date.now()).toBeGreaterThan(1_700_000)
        expect(info?.subject).toBe('demo@example.com')
    })

    it('ничего не делает, если в контексте нет токена', async () => {
        const harness = await createKeeper()

        const remembered = await harness.keeper.remember('api', 'default', { count: 42 })

        expect(remembered).toBeUndefined()
        expect((await harness.workspaces.getWorkspace('api')).environments[0]?.variables).toEqual({})
    })
})

describe('pickToken', () => {
    it('берёт значение, на которое ссылается заголовок окружения', () => {
        // Случай из практики: бэкенд отдаёт готовый заголовок `Bearer eyJ…`,
        // а заголовок окружения ссылается на `{{accessToken}}`.
        const found = pickToken(
            { operationId: 'op-1', accessToken: 'Bearer eyJhbGci.eyJzdWIi.sig' },
            { Authorization: '{{accessToken}}' },
        )

        expect(found).toEqual({ name: 'accessToken', value: 'Bearer eyJhbGci.eyJzdWIi.sig' })
    })

    it('явное имя переменной важнее заголовка', () => {
        const found = pickToken(
            { token: 'abc', accessToken: 'xyz' },
            { Authorization: '{{accessToken}}' },
            'token',
        )

        expect(found?.name).toBe('token')
    })

    it('берёт единственное строковое значение, если подсказок нет', () => {
        expect(pickToken({ sessionKey: 'opaque-value' }, {})).toEqual({
            name: 'sessionKey',
            value: 'opaque-value',
        })
    })

    it('не гадает, когда строк несколько и подсказок нет', () => {
        expect(pickToken({ a: 'one', b: 'two' }, {})).toBeUndefined()
    })
})

describe('токен с префиксом схемы', () => {
    it('сохраняется целиком, а срок читается из его JWT-части', async () => {
        const harness = await createKeeper()
        const workspace = await harness.workspaces.getWorkspace('api')
        workspace.environments[0]!.headers = { Authorization: '{{accessToken}}' }
        await harness.workspaces.saveWorkspace(workspace)

        const value = `Bearer ${makeJwt(1800)}`
        const remembered = await harness.keeper.remember('api', 'default', { accessToken: value })

        expect(remembered?.variable).toBe('accessToken')
        expect(
            await harness.secrets.get({
                workspace: 'api',
                environment: 'default',
                key: 'accessToken',
            }),
        ).toBe(value)

        const info = await harness.tokens.get('api', 'default')
        expect(info?.expiresAt).toBeTruthy()
        expect(info?.subject).toBe('demo@example.com')
    })
})
