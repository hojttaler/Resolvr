import { describe, expect, it } from 'vitest'

import { formatAppLink, parseAppLink } from './links.js'

describe('ссылки resolvr://', () => {
    it('кодирует и разбирает ссылку на операцию', () => {
        const link = formatAppLink({ workspaceId: 'dev', operationRef: 'users/Get Me' })

        expect(link).toBe('resolvr://open?workspace=dev&operation=users%2FGet+Me')
        expect(parseAppLink(link)).toEqual({
            workspaceId: 'dev',
            operationRef: 'users/Get Me',
            flowId: undefined,
        })
    })

    it('разбирает ссылку на цепочку и отвергает чужие', () => {
        expect(parseAppLink('resolvr://open?workspace=dev&flow=auth')).toEqual({
            workspaceId: 'dev',
            operationRef: undefined,
            flowId: 'auth',
        })
        expect(parseAppLink('https://example.com/?workspace=dev')).toBeUndefined()
        expect(parseAppLink('resolvr://open')).toBeUndefined()
        expect(parseAppLink('не ссылка')).toBeUndefined()
    })
})
