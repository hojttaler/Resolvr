import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { JsonViewer } from './JsonViewer.js'

afterEach(cleanup)

/** JWT-подобное значение: именно на таких строках ломалась вёрстка. */
const LONG_TOKEN = `eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.${'a'.repeat(400)}.signature`

describe('JsonViewer: вёрстка строк', () => {
    it('не даёт ключу переноситься при длинном значении рядом', () => {
        // Регрессия: перенос стоял на всей строке, ключ сжимался до нуля и
        // печатался по одной букве в столбик.
        const { container } = render(
            <JsonViewer value={{ accessToken: LONG_TOKEN }} defaultExpandDepth={3} />,
        )

        const key = container.querySelector('.json-key')
        expect(key?.textContent).toBe('accessToken')
        expect(key?.className).toContain('json-key')
    })

    it('выравнивает закрывающую скобку по колонке шеврона', () => {
        // Регрессия: строка с открывающей скобкой имела колонку под шеврон,
        // а закрывающая — нет, из-за чего уезжала вбок.
        const { container } = render(
            <JsonViewer value={{ params: {} }} defaultExpandDepth={3} />,
        )

        const rows = [...container.querySelectorAll('.json-row')]
        expect(rows.length).toBeGreaterThan(1)
        for (const row of rows) {
            expect(row.querySelector('.json-gutter')).not.toBeNull()
        }
    })

    it('переносит только значение, но не подпись', () => {
        const { container } = render(
            <JsonViewer value={{ token: LONG_TOKEN }} defaultExpandDepth={3} />,
        )

        expect(container.querySelector('.json-value')).not.toBeNull()
    })
})

describe('JsonViewer: длинные строки', () => {
    it('показывает начало значения и кнопку раскрытия', () => {
        render(<JsonViewer value={{ accessToken: LONG_TOKEN }} defaultExpandDepth={3} />)

        const more = screen.getByTitle('Показать значение целиком')
        expect(more.textContent).toContain('ещё')
        expect(screen.queryByText(new RegExp(LONG_TOKEN.slice(-20)))).toBeNull()
    })

    it('раскрывает значение целиком по клику', () => {
        const { container } = render(
            <JsonViewer value={{ accessToken: LONG_TOKEN }} defaultExpandDepth={3} />,
        )

        fireEvent.click(screen.getByTitle('Показать значение целиком'))

        expect(container.textContent).toContain(LONG_TOKEN)
        expect(screen.queryByTitle('Показать значение целиком')).toBeNull()
    })

    it('короткие строки показывает целиком без кнопки', () => {
        render(<JsonViewer value={{ email: 'ada@example.com' }} defaultExpandDepth={3} />)

        expect(screen.getByText(/ada@example\.com/)).toBeTruthy()
        expect(screen.queryByTitle('Показать значение целиком')).toBeNull()
    })
})

describe('JsonViewer: сохранение значения', () => {
    it('предлагает сохранить строку в переменную окружения', () => {
        const saved: Array<{ path: string; value: string }> = []
        const { container } = render(
            <JsonViewer
                value={{ accessToken: 'tok-123' }}
                defaultExpandDepth={3}
                rootPath="data"
                onSaveValue={(input) => saved.push(input)}
            />,
        )

        const row = container.querySelectorAll('.json-row')[1]!
        fireEvent.contextMenu(row)

        fireEvent.click(screen.getByText('Сохранить в переменную окружения…'))

        expect(saved).toEqual([{ path: 'data.accessToken', value: 'tok-123' }])
    })

    it('без действия сохранения пункт не появляется', () => {
        const { container } = render(
            <JsonViewer value={{ accessToken: 'tok-123' }} defaultExpandDepth={3} />,
        )

        fireEvent.contextMenu(container.querySelectorAll('.json-row')[1]!)

        expect(screen.queryByText('Сохранить в переменную окружения…')).toBeNull()
        expect(screen.getByText('Копировать значение')).toBeTruthy()
    })
})
