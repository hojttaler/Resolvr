import { describe, expect, it } from 'vitest'

import { LibraryPaths } from '../storage/paths.js'
import { MemoryFileSystem } from '../testing/memory-file-system.js'
import { ActivityStore, buildCallRecord, buildNoteRecord } from './activity-store.js'

function createStore(): { store: ActivityStore; fs: MemoryFileSystem } {
    const fs = new MemoryFileSystem()

    return { store: new ActivityStore(fs, new LibraryPaths('/library')), fs }
}

describe('ActivityStore', () => {
    it('собирает сессию из плана, вызовов и заметок в порядке выполнения', async () => {
        const { store } = createStore()

        await store.append({
            kind: 'session',
            sessionId: 's1',
            startedAt: '2026-08-14T10:00:00.000Z',
            client: { name: 'claude-code', version: '2.0' },
            libraryRoot: '/library',
        })
        await store.append({
            kind: 'plan',
            sessionId: 's1',
            seq: 1,
            ts: '2026-08-14T10:00:01.000Z',
            goal: 'Проверить логин',
            steps: ['Схема', 'Запуск'],
        })
        await store.append(
            buildCallRecord({
                sessionId: 's1',
                seq: 2,
                tool: 'run',
                intent: 'Проверяю логин',
                args: { workspaceId: 'api' },
                ok: true,
                durationMs: 12.4,
                summary: 'HTTP 200',
                result: { ok: true },
            }),
        )
        await store.append(buildNoteRecord({ sessionId: 's1', seq: 3, text: 'Токен получен' }))

        const sessions = await store.listSessions()

        expect(sessions).toHaveLength(1)
        expect(sessions[0]?.client.name).toBe('claude-code')
        expect(sessions[0]?.plan?.goal).toBe('Проверить логин')
        expect(sessions[0]?.entries.map((entry) => entry.kind)).toEqual(['call', 'note'])
        expect(sessions[0]?.stats).toMatchObject({ totalCalls: 1, failedCalls: 0, durationMs: 12 })
    })

    it('считает неудачные вызовы отдельно', async () => {
        const { store } = createStore()

        await store.append(
            buildCallRecord({
                sessionId: 's1',
                seq: 1,
                tool: 'operation_get',
                intent: 'Читаю несуществующую операцию',
                args: {},
                ok: false,
                durationMs: 3,
                summary: 'ошибка: OPERATION_NOT_FOUND',
                error: 'не найдена',
            }),
        )

        const sessions = await store.listSessions()

        expect(sessions[0]?.stats.failedCalls).toBe(1)
        expect(sessions[0]?.entries[0]).toMatchObject({ ok: false, error: 'не найдена' })
    })

    it('разделяет вызовы разных сессий', async () => {
        const { store } = createStore()

        for (const sessionId of ['s1', 's2']) {
            await store.append(
                buildCallRecord({
                    sessionId,
                    seq: 1,
                    tool: 'workspace_list',
                    intent: 'Смотрю workspace',
                    args: {},
                    ok: true,
                    durationMs: 1,
                    summary: '1 workspace',
                }),
            )
        }

        const sessions = await store.listSessions()

        expect(sessions).toHaveLength(2)
        expect(new Set(sessions.map((session) => session.sessionId))).toEqual(new Set(['s1', 's2']))
    })

    it('пропускает битую строку и сохраняет остальные записи', async () => {
        const { store, fs } = createStore()

        await fs.appendText('/library/.activity/2026-08-14.jsonl', '{ поломанная строка\n')
        await store.append(
            buildCallRecord({
                sessionId: 's1',
                seq: 1,
                tool: 'run',
                intent: 'Запускаю операцию',
                args: {},
                ok: true,
                durationMs: 2,
                summary: 'HTTP 200',
            }),
        )

        const sessions = await store.listSessions()

        expect(sessions[0]?.entries).toHaveLength(1)
    })
})

describe('buildCallRecord', () => {
    it('маскирует секреты в аргументах и результате', () => {
        const record = buildCallRecord({
            sessionId: 's1',
            seq: 1,
            tool: 'run',
            intent: 'Запускаю операцию с токеном',
            args: { headers: { authorization: 'Bearer super-secret-token' } },
            ok: true,
            durationMs: 1,
            summary: 'HTTP 200',
            result: { data: { token: 'super-secret-token' } },
            secretValues: ['super-secret-token'],
        })

        expect(JSON.stringify(record)).not.toContain('super-secret-token')
    })

    it('усекает слишком длинный результат, отмечая это флагом', () => {
        const record = buildCallRecord({
            sessionId: 's1',
            seq: 1,
            tool: 'schema_get',
            intent: 'Читаю схему целиком',
            args: {},
            ok: true,
            durationMs: 1,
            summary: 'схема',
            result: { sdl: 'x'.repeat(30_000) },
        })

        expect(record.truncated).toBe(true)
        expect(JSON.stringify(record.result).length).toBeLessThan(21_000)
    })
})
