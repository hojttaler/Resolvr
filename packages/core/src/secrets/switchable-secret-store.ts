import type { ISecretStorage } from '../model/schemas.js'
import type { ISecretRef, ISecretStore } from '../ports/secret-store.js'

/**
 * Хранилище секретов с переключаемым бэкендом.
 *
 * Выбор между файлом и Keychain — настройка приложения, а не константа
 * сборки: остальное ядро получает один объект и не знает, куда именно
 * уходят значения. Переключение в настройках меняет бэкенд на лету, без
 * пересоздания движка и разобранной схемы.
 */
export class SwitchableSecretStore implements ISecretStore {
    private readonly _backends: Record<ISecretStorage, ISecretStore>
    private _current: ISecretStorage

    constructor(backends: Record<ISecretStorage, ISecretStore>, initial: ISecretStorage) {
        this._backends = backends
        this._current = initial
    }

    public get storage(): ISecretStorage {
        return this._current
    }

    public use(storage: ISecretStorage): void {
        this._current = storage
    }

    public get(ref: ISecretRef): Promise<string | undefined> {
        return this._backends[this._current].get(ref)
    }

    public set(ref: ISecretRef, value: string): Promise<void> {
        return this._backends[this._current].set(ref, value)
    }

    public delete(ref: ISecretRef): Promise<void> {
        return this._backends[this._current].delete(ref)
    }
}
