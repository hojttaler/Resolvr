/**
 * Абстракция хранилища секретов поверх macOS Keychain.
 *
 * Значения секретов никогда не попадают в файлы workspace и в историю запусков:
 * на диске хранятся только ссылки вида `keychain://<workspace>/<env>/<key>`.
 */
export interface ISecretStore {
    /** Возвращает `undefined`, если секрет не найден. */
    get(ref: ISecretRef): Promise<string | undefined>

    set(ref: ISecretRef, value: string): Promise<void>

    delete(ref: ISecretRef): Promise<void>
}

export interface ISecretRef {
    workspace: string
    environment: string
    key: string
}

const SECRET_URI_PREFIX = 'keychain://'

/** Сериализует ссылку на секрет в форму, пригодную для хранения в JSON. */
export function formatSecretRef(ref: ISecretRef): string {
    return `${SECRET_URI_PREFIX}${ref.workspace}/${ref.environment}/${ref.key}`
}

/** Разбирает `keychain://ws/env/key`; возвращает `undefined` для любой другой строки. */
export function parseSecretRef(value: string): ISecretRef | undefined {
    if (!value.startsWith(SECRET_URI_PREFIX)) return undefined

    const parts = value.slice(SECRET_URI_PREFIX.length).split('/')
    if (parts.length !== 3) return undefined

    const [workspace, environment, key] = parts
    if (!workspace || !environment || !key) return undefined

    return { workspace, environment, key }
}

export function isSecretRef(value: string): boolean {
    return parseSecretRef(value) !== undefined
}
