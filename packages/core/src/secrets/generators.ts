/**
 * Генераторы значений в шаблонах: `{{$uuid}}`, `{{$timestamp}}`, `{{$randomInt}}`.
 *
 * Без них сценарий с ключом идемпотентности, уникальным e-mail или внешним
 * идентификатором проходит ровно один раз: повторный запуск упирается в
 * «уже существует». Генератор вычисляется в каждом месте подстановки заново —
 * чтобы значение осталось одним на весь прогон, его объявляют константой
 * флоу (`variables: { orderKey: '{{$uuid}}' }`) и дальше используют как
 * обычную переменную.
 *
 * Аргументы пишутся через двоеточие: `{{$randomInt:100:999}}`.
 */
export interface IGeneratorContext {
    /** Момент запуска: все `{{$timestamp}}` одного вызова дают одно значение. */
    now: Date
    random: () => number
}

const HEX = '0123456789abcdef'
const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/** Известен ли генератор с таким именем (без `$`). */
export function isGeneratorName(name: string): boolean {
    return name.startsWith('$')
}

/**
 * Вычисляет генератор по имени вида `$randomInt:1:10`.
 * Неизвестное имя даёт `undefined` — плейсхолдер остаётся в тексте как есть,
 * и это видно в запросе, а не превращается в пустую строку.
 */
export function evaluateGenerator(
    expression: string,
    context: IGeneratorContext = defaultContext(),
): string | undefined {
    const [name, ...args] = expression.slice(1).split(':')

    switch (name) {
        case 'uuid':
            return uuid(context.random)
        case 'timestamp':
            return String(context.now.getTime())
        case 'unix':
            return String(Math.floor(context.now.getTime() / 1000))
        case 'isoDate':
            return context.now.toISOString()
        case 'date':
            return context.now.toISOString().slice(0, 10)
        case 'randomInt': {
            const min = args.length > 1 ? Number(args[0]) : 0
            const max = args.length > 1 ? Number(args[1]) : Number(args[0] ?? 1_000_000)
            if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return undefined

            return String(min + Math.floor(context.random() * (max - min + 1)))
        }
        case 'randomString': {
            const length = args[0] === undefined ? 8 : Number(args[0])
            if (!Number.isInteger(length) || length < 1 || length > 256) return undefined

            return randomString(length, context.random)
        }
        case 'randomEmail':
            return `${randomString(10, context.random)}@example.com`
        default:
            return undefined
    }
}

/** Имена генераторов для подсказок и документации. */
export const GENERATOR_NAMES = [
    '$uuid',
    '$timestamp',
    '$unix',
    '$isoDate',
    '$date',
    '$randomInt',
    '$randomString',
    '$randomEmail',
] as const

export function defaultContext(): IGeneratorContext {
    return { now: new Date(), random: Math.random }
}

/** UUID v4 из `Math.random`: идентификатор для тестовых данных, не для криптографии. */
function uuid(random: () => number): string {
    const bytes: string[] = []
    for (let index = 0; index < 16; index += 1) {
        const value = Math.floor(random() * 256)
        bytes.push(HEX[Math.floor(value / 16)]! + HEX[value % 16]!)
    }

    // Версия 4 и вариант RFC 4122.
    bytes[6] = `4${bytes[6]!.slice(1)}`
    bytes[8] = HEX[8 + Math.floor(random() * 4)]! + bytes[8]!.slice(1)

    return [
        bytes.slice(0, 4).join(''),
        bytes.slice(4, 6).join(''),
        bytes.slice(6, 8).join(''),
        bytes.slice(8, 10).join(''),
        bytes.slice(10, 16).join(''),
    ].join('-')
}

function randomString(length: number, random: () => number): string {
    let result = ''
    for (let index = 0; index < length; index += 1) {
        result += ALPHABET[Math.floor(random() * ALPHABET.length)]
    }

    return result
}
