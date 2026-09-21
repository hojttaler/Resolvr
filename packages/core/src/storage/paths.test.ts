import { describe, expect, it } from 'vitest'

import { historyDayKey, LibraryPaths, toSlug } from './paths.js'

describe('toSlug', () => {
    it('транслитерирует кириллицу вместо того, чтобы её выбрасывать', () => {
        expect(toSlug('Пользователи')).toBe('polzovateli')
        expect(toSlug('Логин и профиль')).toBe('login-i-profil')
    })

    it('различает названия, которые раньше слипались в untitled', () => {
        expect(toSlug('Заказы')).not.toBe(toSlug('Платежи'))
    })

    it('нормализует латиницу и разделители', () => {
        expect(toSlug('  Backend   API!  ')).toBe('backend-api')
    })

    it('на пустой ввод отдаёт запасное имя', () => {
        expect(toSlug('!!!')).toBe('untitled')
    })
})

describe('LibraryPaths', () => {
    it('собирает пути хранилища относительно корня', () => {
        const paths = new LibraryPaths('/library/')

        expect(paths.workspaceFile('api')).toBe('/library/workspaces/api/workspace.json')
        expect(paths.operationQueryFile('api', 'users', 'getUser')).toBe(
            '/library/workspaces/api/collections/users/getUser.graphql',
        )
        expect(paths.draftQueryFile('tab-1')).toBe('/library/.state/drafts/tab-1.graphql')
    })
})

describe('historyDayKey', () => {
    it('форматирует дату для имени файла журнала', () => {
        expect(historyDayKey(new Date(2026, 7, 12))).toBe('2026-08-12')
    })
})
