import { describe, expect, it } from 'vitest'

import { flattenJson } from './json-rows.js'

const OPTIONS = { expandDepth: 2, autoCollapseSize: 100, needle: '', rootPath: 'data' }

describe('flattenJson', () => {
    it('раскрывает узлы до заданной глубины и закрывает скобки', () => {
        const rows = flattenJson({ user: { id: 1, tags: ['a'] } }, new Map(), OPTIONS)

        expect(rows.map((row) => `${row.kind}:${row.path}`)).toEqual([
            'open:data',
            'open:data.user',
            'scalar:data.user.id',
            'open:data.user.tags',
            'close:data.user',
            'close:data',
        ])
        // Глубина 2: tags свёрнут — ни его элементов, ни закрывающей скобки
        // в списке нет: свёрнутый узел рисуется одной строкой `[ … ]`.
        expect(rows.find((row) => row.path === 'data.user.tags')?.expanded).toBe(false)
    })

    it('учитывает переключения пользователя и авто-сворачивание больших узлов', () => {
        const big = Array.from({ length: 150 }, (_, index) => index)
        const collapsedByDefault = flattenJson({ big }, new Map(), OPTIONS)
        expect(collapsedByDefault.find((row) => row.path === 'data.big')?.expanded).toBe(false)

        const opened = flattenJson({ big }, new Map([['data.big', true]]), OPTIONS)
        expect(opened.filter((row) => row.kind === 'scalar')).toHaveLength(150)
    })

    it('при поиске оставляет только ветки с совпадением и считает показанных', () => {
        const rows = flattenJson(
            { a: { email: 'x@y' }, b: { name: 'z' } },
            new Map(),
            { ...OPTIONS, needle: 'email' },
        )

        expect(rows.map((row) => row.path)).toEqual(['data', 'data.a', 'data.a.email', 'data.a', 'data'])
        expect(rows[0]?.visibleCount).toBe(1)
        expect(rows[0]?.childCount).toBe(2)
    })

    it('пустой контейнер — одна строка', () => {
        const rows = flattenJson({ empty: {} }, new Map(), OPTIONS)

        expect(rows.map((row) => row.kind)).toEqual(['open', 'empty', 'close'])
    })
})
