import { afterEach, describe, expect, it, vi } from 'vitest'

const LINUX_AGENT = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)'
const MAC_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)'

/** Загружает модуль заново с заданным user agent и подменённым исходным fetch. */
async function load(agent: string) {
    vi.resetModules()
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(agent)
    const original = vi.fn(() => Promise.resolve(new Response('ok')))
    window.fetch = original as unknown as typeof window.fetch

    await import('./linux-ipc.js')

    return original
}

describe('IPC на Linux', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('на Linux отклоняет запросы к ipc://, остальные пропускает', async () => {
        const original = await load(LINUX_AGENT)

        await expect(window.fetch('ipc://localhost/plugin%3Afs%7Cread_text_file')).rejects.toThrow(
            /ipc:\/\//,
        )
        expect(original).not.toHaveBeenCalled()

        await window.fetch('https://api.example.com/graphql')
        expect(original).toHaveBeenCalledTimes(1)
    })

    it('на macOS fetch не трогает', async () => {
        const original = await load(MAC_AGENT)

        expect(window.fetch).toBe(original)
    })
})
