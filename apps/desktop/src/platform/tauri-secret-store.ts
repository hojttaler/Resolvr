import type { ISecretRef, ISecretStore } from '@resolvr/core'
import { invoke } from '@tauri-apps/api/core'

/**
 * Секреты в системном Keychain через Rust-команды.
 *
 * Каждое обращение к Keychain у приложения с ad-hoc подписью macOS может
 * сопровождать запросом пароля, поэтому обращений должно быть как можно
 * меньше: значения кэшируются на время сессии, а список ключей не хранится —
 * он и так виден по ссылкам `keychain://` в файле окружения.
 */
export class TauriSecretStore implements ISecretStore {
    private readonly _cache = new Map<string, string | undefined>()

    public async get(ref: ISecretRef): Promise<string | undefined> {
        const key = cacheKey(ref)
        if (this._cache.has(key)) return this._cache.get(key)

        const value = await invoke<string | null>('keychain_get', {
            workspace: ref.workspace,
            environment: ref.environment,
            key: ref.key,
        })

        const result = value ?? undefined
        this._cache.set(key, result)

        return result
    }

    public async set(ref: ISecretRef, value: string): Promise<void> {
        await invoke('keychain_set', {
            workspace: ref.workspace,
            environment: ref.environment,
            key: ref.key,
            value,
        })

        this._cache.set(cacheKey(ref), value)
    }

    public async delete(ref: ISecretRef): Promise<void> {
        await invoke('keychain_delete', {
            workspace: ref.workspace,
            environment: ref.environment,
            key: ref.key,
        })

        this._cache.delete(cacheKey(ref))
    }
}

function cacheKey(ref: ISecretRef): string {
    return `${ref.workspace}:${ref.environment}:${ref.key}`
}
