/**
 * Представление запроса командой `curl`.
 *
 * Нужно, чтобы приложить воспроизводимый запрос к баг-репорту или прогнать
 * его из терминала. Команда собирается для POSIX-shell: значения берутся в
 * одинарные кавычки, а сама кавычка внутри экранируется через `'\''`.
 */
export interface ICurlInput {
    url: string
    headers: Record<string, string>
    body: string
}

export function formatCurl(input: ICurlInput): string {
    const lines = [`curl '${quote(input.url)}'`, `  -X POST`]

    for (const [name, value] of Object.entries(input.headers)) {
        lines.push(`  -H '${quote(`${name}: ${value}`)}'`)
    }

    lines.push(`  --data-raw '${quote(input.body)}'`)

    return lines.join(' \\\n')
}

/** Скрывает значения секретов, оставляя видимой структуру заголовка. */
export function maskCurlSecrets(
    headers: Record<string, string>,
    secretValues: string[],
    mask = '<SECRET>',
): Record<string, string> {
    const result: Record<string, string> = {}

    for (const [name, value] of Object.entries(headers)) {
        let masked = value
        for (const secret of secretValues) {
            if (secret.length > 0) masked = masked.split(secret).join(mask)
        }
        result[name] = masked
    }

    return result
}

function quote(value: string): string {
    return value.replace(/'/g, `'\\''`)
}
