import { describe, expect, it, vi } from 'vitest'

import { Debouncer } from './session-store.js'

describe('Debouncer', () => {
    it('записывает более новый снимок только после завершения предыдущей записи', async () => {
        const saver = new Debouncer(300)
        let releaseFirst!: () => void
        const pending = new Promise<void>((resolve) => {
            releaseFirst = resolve
        })
        const written: string[] = []

        saver.schedule(async () => {
            await pending
            written.push('first')
        })
        const first = saver.flush()
        await Promise.resolve()

        saver.schedule(async () => {
            written.push('obsolete')
        })
        saver.schedule(async () => {
            written.push('latest')
        })
        const latest = saver.flush()
        await Promise.resolve()

        expect(written).toEqual([])
        releaseFirst()
        await Promise.all([first, latest])
        expect(written).toEqual(['first', 'latest'])
    })

    it('после ошибки разрешает следующие записи', async () => {
        const saver = new Debouncer(300)
        saver.schedule(async () => {
            throw new Error('write failed')
        })
        await expect(saver.flush()).rejects.toThrow('write failed')

        const write = vi.fn(async () => {})
        saver.schedule(write)
        await saver.flush()

        expect(write).toHaveBeenCalledOnce()
    })
})
