import { FlowSchema } from '@resolvr/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { useAppStore } from '../state/store.js'
import { AgentActivity } from './AgentActivity.js'
import { collectPaths, FlowPage } from './FlowEditor.js'
import { JsonViewer } from './JsonViewer.js'
import { KeyValueEditor } from './KeyValueEditor.js'
import { SettingsDialog } from './SettingsDialog.js'
import { WorkspaceSettings } from './WorkspaceSettings.js'
import { TitleBar } from './TitleBar.js'

afterEach(() => {
    cleanup()
    useAppStore.setState({ flowRun: undefined })
})

describe('KeyValueEditor', () => {
    it('не теряет фокус при вводе имени по символам', () => {
        // Регрессия: раньше строка выводилась из ключей объекта, поэтому React
        // пересоздавал поле на каждый символ и ввод обрывался после первой буквы.
        function Harness(): React.JSX.Element {
            const [value, setValue] = useState<Record<string, string>>({})

            return <KeyValueEditor value={value} onChange={setValue} keyPlaceholder="имя" />
        }

        render(<Harness />)
        fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }))

        const input = screen.getByPlaceholderText('имя')
        input.focus()

        for (const character of 'token') {
            const next = `${(input as HTMLInputElement).value}${character}`
            fireEvent.change(input, { target: { value: next } })

            expect(document.activeElement).toBe(input)
        }

        expect((input as HTMLInputElement).value).toBe('token')
    })

    it('отдаёт наружу только строки с непустым именем', () => {
        const changes: Array<Record<string, string>> = []

        render(
            <KeyValueEditor
                value={{}}
                onChange={(value) => changes.push(value)}
                keyPlaceholder="имя"
                valuePlaceholder="значение"
            />,
        )

        fireEvent.click(screen.getByRole('button', { name: '+ Добавить' }))
        fireEvent.change(screen.getByPlaceholderText('значение'), {
            target: { value: 'data.token' },
        })
        fireEvent.change(screen.getByPlaceholderText('имя'), { target: { value: 'token' } })

        expect(changes.at(-1)).toEqual({ token: 'data.token' })
    })
})

describe('диалоги', () => {
    it('редактор цепочек открывается для новой цепочки', () => {
        // Регрессия: заготовка новой цепочки прогонялась через строгую схему
        // с пустым id и роняла экран.
        useAppStore.setState({
            flowDrafts: {
                't-new': { id: '', name: 'Новая цепочка', description: '', steps: [] },
            },
        })
        render(<FlowPage tabId="t-new" />)

        expect(screen.getByDisplayValue('Новая цепочка')).toBeTruthy()
        expect(screen.getByRole('button', { name: '+ Шаг' })).toBeTruthy()
    })

    it('в шапке есть видимая кнопка настроек', () => {
        // Держать настройки только за сочетанием клавиш недостаточно: без
        // кнопки их попросту не находят.
        render(<TitleBar />)

        expect(screen.getByLabelText('Настройки')).toBeTruthy()
    })

    it('настройки показывают все разделы', () => {
        // Прозрачность и материал — только на macOS; тест проверяет полный набор.
        document.documentElement.setAttribute('data-platform', 'macos')
        render(<SettingsDialog onClose={() => undefined} />)

        expect(screen.getByText('Внешний вид')).toBeTruthy()
        expect(screen.getByText('Редактор')).toBeTruthy()
        expect(screen.getByText('Запросы и ответы')).toBeTruthy()
        expect(screen.getByText('Прозрачность окна')).toBeTruthy()
    })
})

describe('цепочки: результат запуска', () => {
    const flow = FlowSchema.parse({
        id: 'smoke',
        name: 'Smoke',
        steps: [{ id: 'login', name: 'Логин', query: 'mutation { login { accessToken } }' }],
    })

    function seedRun(): void {
        useAppStore.setState({
            flowDrafts: { 't-smoke': flow },
            flowRun: {
                flowId: 'smoke',
                ok: true,
                durationMs: 12,
                context: { token: 'tok-123' },
                steps: [
                    {
                        stepId: 'login',
                        name: 'Логин',
                        ok: true,
                        skipped: false,
                        status: 200,
                        durationMs: 5,
                        asserts: [],
                        extracted: { token: 'tok-123' },
                        result: {
                            ok: true,
                            status: 200,
                            statusText: 'OK',
                            headers: {},
                            body: '{}',
                            data: { login: { accessToken: 'tok-123' } },
                            kind: 'mutation',
                            durationMs: 5,
                            responseBytes: 42,
                            requestHeaders: {},
                            endpointId: 'default',
                        },
                    },
                ],
            },
        })
    }

    it('показывает ответ шага и итоговый контекст', () => {
        seedRun()
        render(<FlowPage tabId="t-smoke" />)

        expect(screen.getByText(/Ответ шага/)).toBeTruthy()
        // Поле встречается и в редакторе запроса, и в дереве ответа.
        expect(screen.getAllByText('accessToken').length).toBeGreaterThan(1)
        expect(screen.getByText('Итог цепочки')).toBeTruthy()
        expect(screen.getAllByText('"tok-123"').length).toBeGreaterThan(0)
    })

    it('клик по кнопке пути добавляет извлечение с этим путём', () => {
        seedRun()
        render(<FlowPage tabId="t-smoke" />)

        fireEvent.click(screen.getByTitle('Взять путь: data.login.accessToken'))

        expect(screen.getByDisplayValue('data.login.accessToken')).toBeTruthy()
        expect(screen.getByDisplayValue('accessToken')).toBeTruthy()
    })

    it('alt-клик по кнопке пути добавляет проверку', () => {
        seedRun()
        render(<FlowPage tabId="t-smoke" />)

        fireEvent.click(screen.getByTitle('Взять путь: data.login.accessToken'), { altKey: true })

        expect(screen.getByDisplayValue('data.login.accessToken')).toBeTruthy()
        expect(screen.getByDisplayValue('существует')).toBeTruthy()
    })
})

describe('JsonViewer', () => {
    it('нумерует элементы массива позицией, а не ключом с двоеточием', () => {
        const { container } = render(<JsonViewer value={['a', 'b']} defaultExpandDepth={3} />)

        expect(container.querySelectorAll('.json-index').length).toBe(2)
        expect(container.querySelectorAll('.json-key').length).toBe(0)
    })

    it('поля объекта остаются ключами', () => {
        const { container } = render(<JsonViewer value={{ id: 'u1' }} defaultExpandDepth={3} />)

        expect(container.querySelectorAll('.json-key').length).toBe(1)
        expect(container.querySelectorAll('.json-index').length).toBe(0)
    })

    it('показывает количество элементов у свёрнутого массива', () => {
        render(<JsonViewer value={{ list: [1, 2] }} defaultExpandDepth={1} />)

        expect(screen.getByText(/2 элемента/)).toBeTruthy()
    })
})

describe('collectPaths', () => {
    it('собирает пути ответа для подсказок', () => {
        const paths = collectPaths({ data: { login: { accessToken: 'x' } }, status: 200 })

        expect(paths).toContain('data.login.accessToken')
        expect(paths).toContain('status')
    })
})

describe('журнал действий агента', () => {
    const session = {
        sessionId: 's1',
        startedAt: '2026-08-14T10:00:00.000Z',
        client: { name: 'claude-code', version: '2.0' },
        plan: {
            kind: 'plan' as const,
            sessionId: 's1',
            seq: 1,
            ts: '2026-08-14T10:00:01.000Z',
            goal: 'Проверить, что логин выдаёт токен',
            steps: ['Загрузить схему', 'Выполнить логин'],
        },
        entries: [
            {
                kind: 'call' as const,
                sessionId: 's1',
                seq: 2,
                ts: '2026-08-14T10:00:02.000Z',
                tool: 'run',
                intent: 'Выполняю логин и проверяю токен',
                expectation: 'HTTP 200 и непустой accessToken',
                step: 1,
                args: { workspaceId: 'api', ref: 'auth/login' },
                ok: true,
                durationMs: 42,
                summary: 'HTTP 200, успех, 42 мс',
                result: { data: { login: { accessToken: 'tok-123' } } },
                truncated: false,
            },
            {
                kind: 'call' as const,
                sessionId: 's1',
                seq: 3,
                ts: '2026-08-14T10:00:03.000Z',
                tool: 'operation_get',
                intent: 'Читаю несуществующую операцию',
                args: { ref: 'users/missing' },
                ok: false,
                durationMs: 3,
                summary: 'ошибка: OPERATION_NOT_FOUND',
                error: 'Операция "users/missing" не найдена',
                truncated: false,
            },
        ],
        stats: {
            totalCalls: 2,
            failedCalls: 1,
            durationMs: 45,
            lastActivityAt: '2026-08-14T10:00:03.000Z',
        },
    }

    it('показывает план, намерения вызовов и статистику сессии', () => {
        useAppStore.setState({ activitySessions: [session] })
        render(<AgentActivity onClose={() => undefined} />)

        expect(screen.getByText('Проверить, что логин выдаёт токен')).toBeTruthy()
        expect(screen.getByText('Загрузить схему')).toBeTruthy()
        expect(screen.getAllByText('Выполняю логин и проверяю токен').length).toBeGreaterThan(0)
        expect(screen.getByText('2 вызова')).toBeTruthy()
        expect(screen.getByText('1 с ошибкой')).toBeTruthy()

        useAppStore.setState({ activitySessions: [] })
    })

    it('раскрывает аргументы и результат выбранного вызова', () => {
        useAppStore.setState({ activitySessions: [session] })
        render(<AgentActivity onClose={() => undefined} />)

        fireEvent.click(screen.getAllByText('Выполняю логин и проверяю токен')[0]!)

        expect(screen.getByText('Аргументы')).toBeTruthy()
        expect(screen.getByText(/Ожидалось/)).toBeTruthy()
        expect(screen.getAllByText('accessToken').length).toBeGreaterThan(0)

        useAppStore.setState({ activitySessions: [] })
    })

    it('фильтр «Ошибки» оставляет только неудачные вызовы', () => {
        useAppStore.setState({ activitySessions: [session] })
        render(<AgentActivity onClose={() => undefined} />)

        fireEvent.click(screen.getByRole('button', { name: 'Ошибки' }))

        expect(screen.queryByText('Выполняю логин и проверяю токен')).toBeNull()
        expect(screen.getAllByText('Читаю несуществующую операцию').length).toBeGreaterThan(0)

        useAppStore.setState({ activitySessions: [] })
    })
})

describe('заголовки и подготовка запроса', () => {
    it('настройки workspace показывают заголовки окружения', () => {
        useAppStore.setState({
            workspace: {
                id: 'api',
                name: 'API',
                description: '',
                endpoints: [
                    {
                        id: 'default',
                        name: 'Default',
                        url: 'https://api.example.com/graphql',
                        headers: {},
                        acceptInvalidCerts: false,
                    },
                ],
                environments: [
                    {
                        id: 'default',
                        name: 'Staging',
                        production: false,
                        variables: {},
                        headers: { authorization: 'Bearer {{token}}' },
                        auth: { type: 'none' },
                    },
                ],
                defaultEndpointId: 'default',
                defaultEnvironmentId: 'default',
                layout: {
                    preset: 'classic',
                    sizes: {},
                    sidebarCollapsed: false,
                    sidebarTab: 'collections',
                },
                createdAt: '2026-08-17T00:00:00.000Z',
                updatedAt: '2026-08-17T00:00:00.000Z',
            },
            flows: [
                { id: 'auth', name: 'Авторизация', description: '', steps: [] },
            ],
        })

        render(<WorkspaceSettings onClose={() => undefined} />)

        expect(screen.getByDisplayValue('Staging')).toBeTruthy()
        expect(screen.getByDisplayValue('authorization')).toBeTruthy()
        expect(screen.getByDisplayValue('Bearer {{token}}')).toBeTruthy()

        useAppStore.setState({ workspace: undefined, flows: [] })
    })

    it('предлагает цепочку восстановления из существующих', () => {
        useAppStore.setState({
            workspace: {
                id: 'api',
                name: 'API',
                description: '',
                endpoints: [],
                environments: [
                    {
                        id: 'default',
                        name: 'Staging',
                        production: false,
                        variables: {},
                        headers: {},
                        auth: { type: 'none' },
                    },
                ],
                defaultEnvironmentId: 'default',
                layout: {
                    preset: 'classic',
                    sizes: {},
                    sidebarCollapsed: false,
                    sidebarTab: 'collections',
                },
                createdAt: '2026-08-17T00:00:00.000Z',
                updatedAt: '2026-08-17T00:00:00.000Z',
            },
            flows: [{ id: 'auth', name: 'Авторизация', description: '', steps: [] }],
        })

        render(<WorkspaceSettings onClose={() => undefined} />)

        expect(screen.getByText('— токен не получаем —')).toBeTruthy()
        expect(screen.getByRole('option', { name: 'Авторизация' })).toBeTruthy()

        useAppStore.setState({ workspace: undefined, flows: [] })
    })
})

describe('состояние токена', () => {
    function seedWorkspace(expiresInMs: number | undefined): void {
        useAppStore.setState({
            workspace: {
                id: 'api',
                name: 'API',
                description: '',
                endpoints: [],
                environments: [
                    {
                        id: 'default',
                        name: 'Default',
                        production: false,
                        variables: {},
                        headers: {},
                        auth: { type: 'none' },
                        recovery: {
                            flowId: 'auth',
                            statuses: [401],
                            messagePatterns: [],
                            maxAttempts: 1,
                            enabled: true,
                            onExpiry: true,
                            onError: true,
                            refreshMarginSec: 60,
                        },
                        tokenExpiresAt:
                            expiresInMs === undefined
                                ? undefined
                                : new Date(Date.now() + expiresInMs).toISOString(),
                        tokenSubject: 'demo@example.com',
                    },
                ],
                defaultEnvironmentId: 'default',
                layout: {
                    preset: 'classic',
                    sizes: {},
                    sidebarCollapsed: false,
                    sidebarTab: 'collections',
                },
                createdAt: '2026-09-08T00:00:00.000Z',
                updatedAt: '2026-09-08T00:00:00.000Z',
            },
        })
    }

    it('показывает остаток времени жизни токена', () => {
        seedWorkspace(20 * 60_000)
        render(<TitleBar />)

        expect(screen.getByText('токен 20 мин')).toBeTruthy()

        useAppStore.setState({ workspace: undefined })
    })

    it('помечает истёкший токен', () => {
        seedWorkspace(-60_000)
        render(<TitleBar />)

        expect(screen.getByText('токен истёк')).toBeTruthy()

        useAppStore.setState({ workspace: undefined })
    })

    it('без настроенной цепочки ведёт в настройки', () => {
        useAppStore.setState({
            workspace: {
                id: 'api',
                name: 'API',
                description: '',
                endpoints: [],
                environments: [
                    {
                        id: 'default',
                        name: 'Default',
                        production: false,
                        variables: {},
                        headers: {},
                        auth: { type: 'none' },
                    },
                ],
                defaultEnvironmentId: 'default',
                layout: {
                    preset: 'classic',
                    sizes: {},
                    sidebarCollapsed: false,
                    sidebarTab: 'collections',
                },
                createdAt: '2026-09-08T00:00:00.000Z',
                updatedAt: '2026-09-08T00:00:00.000Z',
            },
        })

        render(<TitleBar />)
        fireEvent.click(screen.getByText('авторизация не настроена'))

        expect(useAppStore.getState().dialog).toBe('workspaceSettings')

        useAppStore.setState({ workspace: undefined, dialog: 'none' })
    })

    it('без известного срока сообщает, что токен не получен', () => {
        // Регрессия: индикатор исчезал до первого логина, и найти его было
        // невозможно — хотя именно тогда он и нужен.
        seedWorkspace(undefined)
        render(<TitleBar />)

        expect(screen.getByText('токен не получен')).toBeTruthy()

        useAppStore.setState({ workspace: undefined })
    })
})
