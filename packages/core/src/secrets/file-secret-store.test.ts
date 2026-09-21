import { describe, expect, it } from 'vitest'

import { LibraryPaths } from '../storage/paths.js'
import { MemoryFileSystem } from '../testing/memory-file-system.js'
import { FileSecretStore } from './file-secret-store.js'
import { SwitchableSecretStore } from './switchable-secret-store.js'
import { MemorySecretStore } from '../testing/fakes.js'

const REF = { workspace: 'dev', environment: 'default', key: 'accessToken' }

function createStore() {
    const fs = new MemoryFileSystem()
    const paths = new LibraryPaths('/library')

    return { fs, paths, store: new FileSecretStore(fs, paths) }
}

describe('FileSecretStore', () => {
    it('сохраняет и читает значение через файл', async () => {
        const { fs, paths, store } = createStore()

        await store.set(REF, 'secret-1')

        expect(await store.get(REF)).toBe('secret-1')
        expect(await fs.readText(paths.secretsFile('dev'))).toContain('secret-1')
    })

    it('переживает перезапуск: новый экземпляр читает тот же файл', async () => {
        const { fs, paths, store } = createStore()
        await store.set(REF, 'secret-1')

        const reopened = new FileSecretStore(fs, paths)

        expect(await reopened.get(REF)).toBe('secret-1')
    })

    it('разделяет окружения и workspace', async () => {
        const { store } = createStore()

        await store.set(REF, 'dev-default')
        await store.set({ ...REF, environment: 'staging' }, 'dev-staging')
        await store.set({ ...REF, workspace: 'other' }, 'other-default')

        expect(await store.get(REF)).toBe('dev-default')
        expect(await store.get({ ...REF, environment: 'staging' })).toBe('dev-staging')
        expect(await store.get({ ...REF, workspace: 'other' })).toBe('other-default')
    })

    it('удаляет значение и пустое окружение', async () => {
        const { fs, paths, store } = createStore()
        await store.set(REF, 'secret-1')

        await store.delete(REF)

        expect(await store.get(REF)).toBeUndefined()
        expect(await fs.readText(paths.secretsFile('dev'))).not.toContain('default')
    })

    it('битый файл считается пустым, а не ошибкой', async () => {
        const { fs, paths, store } = createStore()
        await fs.writeTextAtomic(paths.secretsFile('dev'), '{ не json')

        expect(await store.get(REF)).toBeUndefined()

        await store.set(REF, 'secret-1')
        expect(await store.get(REF)).toBe('secret-1')
    })
})

describe('SwitchableSecretStore', () => {
    it('направляет обращения в выбранный бэкенд', async () => {
        const file = new MemorySecretStore()
        const keychain = new MemorySecretStore()
        const store = new SwitchableSecretStore({ file, keychain }, 'file')

        await store.set(REF, 'in-file')
        store.use('keychain')
        await store.set(REF, 'in-keychain')

        expect(await file.get(REF)).toBe('in-file')
        expect(await keychain.get(REF)).toBe('in-keychain')
        expect(await store.get(REF)).toBe('in-keychain')
    })
})
