import { describe, expect, it } from 'vitest'

import { MemoryFileSystem } from '../testing/memory-file-system.js'
import { migrateLegacyLibrary } from './paths.js'

describe('миграция библиотеки GraphQLAI → Resolvr', () => {
    it('переименовывает старую библиотеку, если новой ещё нет', async () => {
        const fs = new MemoryFileSystem()
        await fs.writeTextAtomic('/home/GraphQLAI/settings.json', '{}')

        expect(await migrateLegacyLibrary(fs, '/home/')).toBe(true)
        expect(await fs.exists('/home/Resolvr/settings.json')).toBe(true)
        expect(await fs.exists('/home/GraphQLAI')).toBe(false)
    })

    it('не трогает данные, если новая библиотека уже существует', async () => {
        const fs = new MemoryFileSystem()
        await fs.writeTextAtomic('/home/GraphQLAI/settings.json', '{"old":1}')
        await fs.writeTextAtomic('/home/Resolvr/settings.json', '{"new":1}')

        expect(await migrateLegacyLibrary(fs, '/home')).toBe(false)
        expect(await fs.readText('/home/Resolvr/settings.json')).toBe('{"new":1}')
    })
})
