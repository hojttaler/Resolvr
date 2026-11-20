import { parser } from '@lezer/javascript'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'
import type { QuickJSContext } from 'quickjs-emscripten-core'

export const REQUEST_SCRIPT_CRYPTO_MODULE = {
    name: '@resolvr/crypto',
    importStatement: 'import { hmacSha256 } from "@resolvr/crypto";',
    signature: 'hmacSha256(secretName, message, format = "hex")',
} as const

export interface IRequestScriptSigningKeys {
    keys: ReadonlyMap<string, string>
    secretValues: readonly string[]
}

const SIGNING_FUNCTION = '__resolvrHmacSha256'

/** Поднимает статические импорты над телом скрипта, сохраняя прежнюю область выполнения. */
export function splitScriptImports(code: string): { imports: string[]; body: string; modules: Array<string | undefined> } {
    const imports: string[] = []
    const modules: Array<string | undefined> = []
    if (!code.includes('import')) return { imports, body: code, modules }

    const parts: string[] = []
    let cursor = 0
    const tree = parser.parse(code)
    for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
        if (node.name !== 'ImportDeclaration') continue
        const declaration = code.slice(node.from, node.to)
        const target = node.getChild('String')
        modules.push(target ? code.slice(target.from + 1, target.to - 1) : undefined)
        imports.push(declaration)
        parts.push(code.slice(cursor, node.from), declaration.replace(/[^\r\n]/g, ' '))
        cursor = node.to
    }
    parts.push(code.slice(cursor))

    return { imports, body: parts.join(''), modules }
}

/** Модуль получает только функцию подписи. Ключи остаются в процессе Resolvr. */
export function installSigningModule(
    context: QuickJSContext,
    keys: ReadonlyMap<string, string>,
    maxInputLength: number,
    deadline: number,
): void {
    context.runtime.setModuleLoader(
        (name) => name === REQUEST_SCRIPT_CRYPTO_MODULE.name
            ? `export const hmacSha256 = globalThis.${SIGNING_FUNCTION}; delete globalThis.${SIGNING_FUNCTION};`
            : { error: new Error('Модуль недоступен в скриптах Resolvr') },
        (_base, name) => name,
    )
    const sign = context.newFunction('hmacSha256', (secret, message, encoding) => {
        if (
            !secret || !message ||
            context.typeof(secret) !== 'string' ||
            context.typeof(message) !== 'string'
        ) {
            throw new Error('hmacSha256 ожидает имя секрета и строку для подписи')
        }
        const format = encoding && context.typeof(encoding) !== 'undefined'
            ? context.typeof(encoding) === 'string' && context.getString(encoding)
            : 'hex'
        if (format !== 'hex' && format !== 'base64') {
            throw new Error('hmacSha256 поддерживает форматы hex и base64')
        }

        const key = keys.get(context.getString(secret))
        if (!key) throw new Error('Ключ подписи не найден среди секретов выбранного окружения')
        const payload = context.getString(message)
        if (payload.length > maxInputLength || key.length > maxInputLength) {
            throw new Error('hmacSha256: превышен лимит входных данных')
        }
        if (performance.now() >= deadline) throw new Error('превышен лимит времени')

        const keyBytes = utf8ToBytes(key)
        try {
            const digest = hmac(sha256, keyBytes, utf8ToBytes(payload))
            const signature = format === 'hex' ? bytesToHex(digest) : btoa(String.fromCharCode(...digest))

            return context.newString(signature)
        } finally {
            keyBytes.fill(0)
        }
    })
    try {
        context.setProp(context.global, SIGNING_FUNCTION, sign)
    } finally {
        sign.dispose()
    }
}
