import {
    FileSecretStore,
    FlowRunner,
    HistoryStore,
    LibraryPaths,
    migrateLegacyLibrary,
    RunEngine,
    SchemaService,
    SecretResolver,
    SessionStore,
    SwitchableSecretStore,
    TokenInfoStore,
    WorkspaceStore,
} from '@resolvr/core'
import { isTauri } from '@tauri-apps/api/core'
import { homeDir } from '@tauri-apps/api/path'

import { TauriFileSystem } from './tauri-file-system.js'
import { TauriSecretStore } from './tauri-secret-store.js'
import { TauriTransport } from './tauri-transport.js'

/** Собранное ядро приложения: те же классы, что использует MCP-сервер. */
export interface IAppContext {
    paths: LibraryPaths
    fs: TauriFileSystem
    secrets: SwitchableSecretStore
    transport: TauriTransport
    workspaces: WorkspaceStore
    sessions: SessionStore
    history: HistoryStore
    resolver: SecretResolver
    tokens: TokenInfoStore
    schemas: SchemaService
    runner: RunEngine
    flows: FlowRunner
}

let contextPromise: Promise<IAppContext> | undefined

/**
 * Возвращает единственный экземпляр ядра.
 *
 * Собирается один раз за сессию: `SchemaService` держит разобранную схему в
 * памяти, и пересоздание контекста означало бы повторную сборку схемы на
 * каждый рендер.
 */
export function getAppContext(): Promise<IAppContext> {
    contextPromise ??= createAppContext()

    return contextPromise
}

async function createAppContext(): Promise<IAppContext> {
    // Вне Tauri (витрина интерфейса, тесты) нативных команд нет — работаем от
    // условного корня, чтобы компоненты рендерились без обращения к диску.
    const home = isTauri() ? await homeDir() : '/showcase'
    const paths = new LibraryPaths(`${home.replace(/\/$/, '')}/Resolvr`)

    const fs = new TauriFileSystem()
    if (isTauri()) await migrateLegacyLibrary(fs, home)
    const secrets = new SwitchableSecretStore(
        { file: new FileSecretStore(fs, paths), keychain: new TauriSecretStore() },
        'file',
    )
    const transport = new TauriTransport()

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

    if (isTauri()) {
        await workspaces.init()
        secrets.use((await workspaces.getSettings()).secrets.storage)
    }

    return {
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
