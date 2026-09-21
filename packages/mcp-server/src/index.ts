#!/usr/bin/env node
import { createNodeContext, resolveLibraryRoot } from '@resolvr/core/node'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { ActivityRecorder } from './activity-recorder.js'
import { registerTools } from './tools.js'

/**
 * MCP-сервер Resolvr.
 *
 * Работает независимо от приложения: читает и пишет ту же библиотеку
 * `~/Resolvr` тем же кодом ядра. Поэтому операция, сохранённая агентом,
 * появляется в открытом GUI, а запуск через MCP попадает в общую историю.
 *
 * Корень библиотеки можно переопределить переменной `RESOLVR_HOME` —
 * это же используется в тестах, чтобы не трогать рабочие данные.
 */
async function main(): Promise<void> {
    const root = resolveLibraryRoot()
    const context = createNodeContext(root)
    // Сначала миграция и настройки, затем создание структуры: иначе новая
    // пустая библиотека появилась бы раньше, чем старая успела переехать.
    await context.ready
    await context.workspaces.init()

    // Идентификатор сессии связывает все вызовы одного запуска агента: журнал
    // показывает их единой цепочкой, а не разрозненными событиями.
    const sessionId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const recorder = new ActivityRecorder(context, sessionId)

    const server = new McpServer(
        { name: 'resolvr', version: '0.1.0' },
        {
            instructions: [
                'GraphQL-клиент Resolvr.',
                '',
                'ПОРЯДОК РАБОТЫ. Первым вызовом объяви план через `plan`: цель и шаги.',
                'Каждый последующий вызов обязан содержать поле `intent` — одной фразой,',
                'что делает вызов и зачем, — и `step` с номером шага плана.',
                'После значимых результатов вызывай `note` с выводом своими словами,',
                'особенно если результат разошёлся с ожиданием и меняет план.',
                'Всё это показывается пользователю в журнале действий приложения: он читает',
                'ход работы, а не только итог, поэтому формулировки должны быть понятны человеку.',
                '',
                'ЧТО ГДЕ. Начинай с `workspace_list`. Схему изучай через `schema_get`:',
                'без аргументов — оглавление, `search` — поиск поля или типа по подстроке,',
                '`typeName` — определение типа, `list` — раздел операций постранично.',
                'Не запрашивай полный SDL (`full: true`) без крайней необходимости: у крупного',
                'гейтвея это сотни тысяч токенов. Для больших ответов `run` указывай `select` —',
                'путь к нужной части. Операции сохраняй через `operation_save` и запускай через',
                '`run`. Сценарии из нескольких шагов — `flow_run`.',
                'Значения секретов недоступны: они хранятся в macOS Keychain и всегда',
                'возвращаются замаскированными.',
            ].join('\n'),
        },
    )

    // Заголовок сессии пишется после рукопожатия: только там известно, какой
    // клиент подключился.
    server.server.oninitialized = () => {
        const client = server.server.getClientVersion()
        void recorder.startSession(
            { name: client?.name ?? 'unknown', version: client?.version ?? '' },
            root,
        )
    }

    registerTools(server, context, recorder)

    // stdout занят протоколом MCP, поэтому диагностика уходит только в stderr.
    process.stderr.write(`Resolvr MCP: библиотека ${root}\n`)

    await server.connect(new StdioServerTransport())
}

main().catch((error: unknown) => {
    process.stderr.write(
        `Resolvr MCP не запустился: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exit(1)
})
