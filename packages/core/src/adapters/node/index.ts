import { homedir } from 'node:os'

import { HistoryStore } from '../../storage/history-store.js'
import { LibraryPaths, migrateLegacyLibrary } from '../../storage/paths.js'
import { SessionStore } from '../../storage/session-store.js'
import { WorkspaceStore } from '../../storage/workspace-store.js'
import { FileSecretStore } from '../../secrets/file-secret-store.js'
import { SecretResolver } from '../../secrets/secret-resolver.js'
import { SwitchableSecretStore } from '../../secrets/switchable-secret-store.js'
import { TokenInfoStore } from '../../secrets/token-info-store.js'
import { RunEngine } from '../../run/run-engine.js'
import { FlowRunner } from '../../flow/flow-runner.js'
import { SchemaService } from '../../schema/schema-service.js'
import { NodeFileSystem } from './node-file-system.js'
import { NodeSecretStore } from './node-secret-store.js'
import { NodeTransport } from './node-transport.js'

export { NodeFileSystem } from './node-file-system.js'
export { NodeSecretStore } from './node-secret-store.js'
export { NodeTransport } from './node-transport.js'

/** Полностью собранное ядро для среды Node. */
export interface INodeContext {
    paths: LibraryPaths
    fs: NodeFileSystem
    secrets: SwitchableSecretStore
    transport: NodeTransport
    workspaces: WorkspaceStore
    sessions: SessionStore
    history: HistoryStore
    resolver: SecretResolver
    tokens: TokenInfoStore
    schemas: SchemaService
    runner: RunEngine
    flows: FlowRunner
    /** Завершается, когда настройки прочитаны и бэкенд секретов выбран. */
    ready: Promise<void>
}

/** Путь к библиотеке: переменная окружения имеет приоритет над `~/Resolvr`. */
export function resolveLibraryRoot(explicitRoot?: string): string {
    return explicitRoot ?? process.env.RESOLVR_HOME ?? `${homedir()}/Resolvr`
}

/**
 * Собирает ядро для Node-среды. Используется MCP-сервером и тестами — состав
 * и порядок зависимостей задан здесь один раз, чтобы обе среды вели себя
 * одинаково.
 */
export function createNodeContext(explicitRoot?: string): INodeContext {
    const paths = new LibraryPaths(resolveLibraryRoot(explicitRoot))
    const fs = new NodeFileSystem()
    // Бэкенд секретов — настройка; до её чтения действует файловый.
    const secrets = new SwitchableSecretStore(
        { file: new FileSecretStore(fs, paths), keychain: new NodeSecretStore() },
        'file',
    )
    const transport = new NodeTransport()

    const workspaces = new WorkspaceStore(fs, paths)
    const sessions = new SessionStore(fs, paths)
    const history = new HistoryStore(fs, paths)
    const resolver = new SecretResolver(secrets)
    const tokens = new TokenInfoStore(fs, paths)
    const schemas = new SchemaService(fs, paths, transport)
    const runner = new RunEngine({ workspaces, history, resolver, tokens, transport, secrets })
    const flows = new FlowRunner(workspaces, runner)

    // Движок и раннер знают друг о друге: раннер выполняет шаги через движок,
    // а движок вызывает цепочки подготовки и восстановления.
    runner.setFlowExecutor(flows)

    // Настройки лежат на диске и читаются асинхронно; вызывающий ждёт `ready`,
    // чтобы первый же запрос ушёл с правильным хранилищем секретов. Перед этим
    // старая библиотека `~/GraphQLAI` переезжает на новое имя.
    const ready = migrateLegacyLibrary(fs, homedir())
        .then(() => workspaces.getSettings())
        .then((settings) => secrets.use(settings.secrets.storage))
        .catch(() => undefined)

    return {
        ready,
        paths,
        fs,
        secrets,
        transport,
        workspaces,
        sessions,
        history,
        resolver,
        tokens,
        schemas,
        runner,
        flows,
    }
}
