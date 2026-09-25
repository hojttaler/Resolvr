/** Замер времени инструментов MCP на реальной библиотеке. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const SERVER = new URL('../dist/index.js', import.meta.url).pathname

const started = Date.now()
const client = new Client({ name: 'bench', version: '1.0.0' })
await client.connect(new StdioClientTransport({ command: 'node', args: [SERVER] }))
console.log(`подключение (холодный старт): ${Date.now() - started} мс`)

async function call(name, args) {
    const at = Date.now()
    const result = await client.callTool({ name, arguments: args })
    const text = result.content?.[0]?.text ?? ''
    const ms = Date.now() - at
    console.log(
        `${name.padEnd(18)} ${String(ms).padStart(6)} мс   ответ: ${String(text.length).padStart(9)} символов ≈ ${Math.round(text.length / 4).toLocaleString('ru')} токенов`,
    )

    return text
}

await call('plan', { goal: 'Замер производительности', steps: ['Замер'] })
await call('workspace_list', { intent: 'Список workspace', step: 0 })
await call('collection_list', { intent: 'Дерево коллекций', step: 0, workspaceId: 'demo' })
await call('history_list', { intent: 'История', step: 0, workspaceId: 'demo', limit: 20 })
await call('schema_get', { intent: 'Сводка схемы', step: 0, workspaceId: 'demo' })
await call('schema_get', { intent: 'Поиск поля', step: 0, workspaceId: 'demo', search: 'continent' })
await call('schema_get', { intent: 'Список мутаций', step: 0, workspaceId: 'demo', list: 'mutations', limit: 30 })
await call('schema_get', { intent: 'Определение типа', step: 0, workspaceId: 'demo', typeName: 'SignInInput' })
await call('operation_get', { intent: 'Одна операция', step: 0, workspaceId: 'demo', ref: 'countries/Continents' })

await client.close()
