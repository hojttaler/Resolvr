/**
 * Сквозная проверка MCP-сервера: сценарий агента от плана до журнала действий.
 *
 * Повторяет то, как работает настоящий агент: объявляет план, сопровождает
 * каждый вызов намерением, оставляет заметки и в конце проверяет, что вся
 * цепочка попала в журнал и читается как связная история.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const HOME = '/tmp/gqlai-mcp-check'
const SERVER = new URL('../dist/index.js', import.meta.url).pathname

const client = new Client({ name: 'e2e-checker', version: '1.0.0' })
await client.connect(
    new StdioClientTransport({
        command: 'node',
        args: [SERVER],
        env: { ...process.env, RESOLVR_HOME: HOME },
    }),
)

async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args })
    const text = result.content?.[0]?.text ?? ''
    const parsed = (() => {
        try {
            return JSON.parse(text)
        } catch {
            return text
        }
    })()

    console.log(`\n▸ ${name}${result.isError ? ' [ОШИБКА]' : ''}`)
    const preview = JSON.stringify(parsed, null, 2)
    console.log(preview.length > 400 ? `${preview.slice(0, 400)}…` : preview)

    return { parsed, isError: result.isError === true }
}

const tools = await client.listTools()
console.log(`Инструментов: ${tools.tools.length}`)
console.log(tools.tools.map((tool) => tool.name).join(', '))

await call('plan', {
    goal: 'Проверить, что логин выдаёт токен и профиль читается по нему',
    steps: [
        'Подготовить workspace и схему',
        'Сохранить операцию чтения пользователя',
        'Выполнить операции и убедиться в ответах',
        'Прогнать цепочку логин → профиль',
    ],
})

await call('workspace_create', {
    intent: 'Создаю рабочее пространство для mock-сервера',
    step: 0,
    name: 'Mock',
    endpointUrl: 'http://localhost:4000/graphql',
})

await call('introspect', {
    intent: 'Загружаю схему, чтобы знать доступные операции',
    expectation: 'Схема содержит login и user',
    step: 0,
    workspaceId: 'mock',
})

await call('schema_get', {
    intent: 'Смотрю форму ответа логина',
    step: 0,
    workspaceId: 'mock',
    typeName: 'AuthPayload',
})

await call('collection_create', {
    intent: 'Завожу коллекцию для пользовательских запросов',
    step: 1,
    workspaceId: 'mock',
    name: 'Users',
})

await call('operation_save', {
    intent: 'Сохраняю запрос пользователя по идентификатору',
    step: 1,
    workspaceId: 'mock',
    collectionId: 'users',
    name: 'getUser',
    query: 'query GetUser($id: ID!) {\n  user(id: $id) {\n    id\n    email\n    role\n  }\n}\n',
    variables: { id: 'u1' },
})

await call('run', {
    intent: 'Проверяю, что запрос возвращает пользователя u1',
    expectation: 'HTTP 200 и email ada@example.com',
    step: 2,
    workspaceId: 'mock',
    ref: 'users/getUser',
})

await call('run', {
    intent: 'Повторяю запрос для второго пользователя',
    step: 2,
    workspaceId: 'mock',
    ref: 'users/getUser',
    variables: { id: 'u2' },
})

await call('note', {
    text: 'Оба пользователя читаются, ответы совпали с ожиданием — перехожу к цепочке',
    step: 2,
})

// Файл цепочки создаётся напрямую — так же, как это сделал бы агент.
mkdirSync(`${HOME}/workspaces/mock/flows`, { recursive: true })
writeFileSync(
    `${HOME}/workspaces/mock/flows/smoke.flow.json`,
    JSON.stringify(
        {
            id: 'smoke',
            name: 'Логин и профиль',
            steps: [
                {
                    id: 'login',
                    name: 'Логин',
                    query: 'mutation Login($email: String!, $password: String!) { login(email: $email, password: $password) { accessToken } }',
                    variables: { email: 'ada@example.com', password: 'secret' },
                    extract: { token: 'data.login.accessToken' },
                    assert: [{ path: 'data.login.accessToken', op: 'exists' }],
                },
                {
                    id: 'me',
                    name: 'Профиль по токену',
                    query: 'query Me { me { id email } }',
                    assert: [{ path: 'data.me.id', op: 'eq', value: 'u1' }],
                },
            ],
        },
        null,
        4,
    ),
)

await call('flow_list', {
    intent: 'Убеждаюсь, что цепочка видна серверу',
    step: 3,
    workspaceId: 'mock',
})

const flow = await call('flow_run', {
    intent: 'Прогоняю цепочку логин → профиль',
    expectation: 'Оба шага зелёные, токен пробрасывается',
    step: 3,
    workspaceId: 'mock',
    flowId: 'smoke',
})

// Заведомо неверный вызов: журнал обязан фиксировать и неудачи.
await call('operation_get', {
    intent: 'Проверяю поведение на несуществующей операции',
    expectation: 'Ошибка OPERATION_NOT_FOUND',
    step: 3,
    workspaceId: 'mock',
    ref: 'users/missing',
})

await call('note', {
    text: 'Цепочка проходит целиком; несуществующая операция даёт понятную ошибку',
    step: 3,
})

await client.close()

// ── Проверка журнала ─────────────────────────────────────────────────────────

const activityDir = `${HOME}/.activity`
const files = readdirSync(activityDir).filter((name) => name.endsWith('.jsonl'))
const records = files
    .flatMap((name) => readFileSync(`${activityDir}/${name}`, 'utf8').split('\n'))
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line))

const sessions = new Set(records.map((record) => record.sessionId))
const calls = records.filter((record) => record.kind === 'call')
const withoutIntent = calls.filter((record) => !record.intent)
const failed = calls.filter((record) => !record.ok)

console.log('\n── Журнал действий ──')
console.log(`сессий: ${sessions.size}`)
console.log(`план: ${records.some((record) => record.kind === 'plan') ? 'есть' : 'НЕТ'}`)
console.log(`заметок: ${records.filter((record) => record.kind === 'note').length}`)
console.log(`вызовов: ${calls.length}, из них неудачных: ${failed.length}`)
console.log(`вызовов без intent: ${withoutIntent.length}`)

for (const record of calls.slice(0, 4)) {
    console.log(`  #${record.seq} ${record.tool} — ${record.intent} → ${record.summary}`)
}

const journalOk =
    sessions.size === 1 &&
    records.some((record) => record.kind === 'plan') &&
    calls.length >= 9 &&
    withoutIntent.length === 0 &&
    failed.length === 1

console.log(`\nИТОГ: цепочка ${flow.parsed?.ok ? 'зелёная' : 'красная'}, журнал ${journalOk ? 'полный' : 'НЕПОЛНЫЙ'}`)
process.exit(flow.parsed?.ok && journalOk ? 0 : 1)
