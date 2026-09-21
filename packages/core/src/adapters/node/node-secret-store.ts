import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type { ISecretRef, ISecretStore } from '../../ports/secret-store.js'

const execFileAsync = promisify(execFile)

const SERVICE_PREFIX = 'Resolvr'

/**
 * Доступ к macOS Keychain через системную утилиту `security`.
 *
 * CLI выбран вместо нативного модуля сознательно: MCP-сервер запускается как
 * обычный Node-процесс, и нативная зависимость потребовала бы пересборки под
 * каждую версию Node. Значения передаются через `execFile` без shell, поэтому
 * содержимое секрета не попадает в командную строку интерпретатора.
 */
export class NodeSecretStore implements ISecretStore {
    /**
     * Кэш прочитанных значений.
     *
     * Каждое обращение к Keychain у неподписанного стабильно приложения — это
     * запрос пароля, поэтому один и тот же секрет читается не более раза за
     * время жизни процесса.
     */
    private readonly _cache = new Map<string, string | undefined>()

    public async get(ref: ISecretRef): Promise<string | undefined> {
        assertMacOs()
        const key = cacheKey(ref)
        if (this._cache.has(key)) return this._cache.get(key)

        try {
            const { stdout } = await execFileAsync('security', [
                'find-generic-password',
                '-s',
                serviceName(ref),
                '-a',
                ref.key,
                '-w',
            ])

            const value = stdout.replace(/\n$/, '')
            this._cache.set(key, value)

            return value
        } catch {
            this._cache.set(key, undefined)

            return undefined
        }
    }

    public async set(ref: ISecretRef, value: string): Promise<void> {
        assertMacOs()
        await execFileAsync('security', [
            'add-generic-password',
            '-s',
            serviceName(ref),
            '-a',
            ref.key,
            '-w',
            value,
            '-U',
        ])

        this._cache.set(cacheKey(ref), value)
    }

    public async delete(ref: ISecretRef): Promise<void> {
        try {
            await execFileAsync('security', [
                'delete-generic-password',
                '-s',
                serviceName(ref),
                '-a',
                ref.key,
            ])
        } catch {
            // Отсутствующий секрет — не ошибка: удаление идемпотентно.
        }

        this._cache.delete(cacheKey(ref))
    }
}

/** Утилита `security` есть только в macOS; на других системах доступен файловый режим. */
function assertMacOs(): void {
    if (process.platform !== 'darwin') {
        throw new Error(
            'Хранилище Keychain доступно только в macOS. Выберите «В файле библиотеки» в настройках.',
        )
    }
}

function serviceName(ref: ISecretRef): string {
    return `${SERVICE_PREFIX}:${ref.workspace}:${ref.environment}`
}

function cacheKey(ref: ISecretRef): string {
    return `${ref.workspace}:${ref.environment}:${ref.key}`
}
