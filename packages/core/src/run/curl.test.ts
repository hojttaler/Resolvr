import { describe, expect, it } from 'vitest'

import { formatCurl, maskCurlSecrets } from './curl.js'

describe('formatCurl', () => {
    it('собирает команду с заголовками и телом', () => {
        const command = formatCurl({
            url: 'https://api.example.com/graphql',
            headers: { 'content-type': 'application/json', authorization: 'Bearer abc' },
            body: '{"query":"{ me { id } }"}',
        })

        expect(command).toBe(
            [
                "curl 'https://api.example.com/graphql'",
                '  -X POST',
                "  -H 'content-type: application/json'",
                "  -H 'authorization: Bearer abc'",
                `  --data-raw '{"query":"{ me { id } }"}'`,
            ].join(' \\\n'),
        )
    })

    it('экранирует одинарные кавычки для shell', () => {
        const command = formatCurl({ url: 'https://x', headers: {}, body: `{"q":"it's"}` })

        expect(command).toContain(`'{"q":"it'\\''s"}'`)
    })

    it('маскирует секреты в заголовках', () => {
        expect(
            maskCurlSecrets({ authorization: 'Bearer secret-1', 'x-id': '7' }, ['secret-1']),
        ).toEqual({ authorization: 'Bearer <SECRET>', 'x-id': '7' })
    })
})
