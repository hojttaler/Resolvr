import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { dictionaryKeys, plural, setLanguage, t, tn } from './index.js'

/** Все ключи `t('…')` и `tn(n, '…')` из исходников интерфейса. */
function collectKeys(dir: string, keys = new Set<string>()): Set<string> {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) {
            if (name !== 'i18n') collectKeys(path, keys)
            continue
        }
        if (!/\.tsx?$/.test(name) || name.endsWith('.test.tsx') || name.endsWith('.test.ts')) continue

        const source = readFileSync(path, 'utf8')
        for (const match of source.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)+)'/g)) {
            keys.add(match[1]!.replace(/\\'/g, "'"))
        }
        for (const match of source.matchAll(/\btn\(\s*[^,]+,\s*'([^']+)'/g)) keys.add(match[1]!)
        for (const match of source.matchAll(/\bplural\(\s*[^,]+,\s*'([^']+)'/g)) keys.add(match[1]!)
    }

    return keys
}

describe('i18n', () => {
    it('в русском словаре есть перевод для каждой строки интерфейса', () => {
        const used = collectKeys(join(import.meta.dirname, '..'))
        const known = new Set(dictionaryKeys('ru'))
        const missing = [...used].filter((key) => !known.has(key)).sort()

        expect(missing).toEqual([])
    })

    it('подставляет параметры и оставляет {{плейсхолдеры}}', () => {
        setLanguage('en')
        expect(t('Version {version} is available', { version: '1.2' })).toBe(
            'Version 1.2 is available',
        )
        expect(t('value or {{variable}}')).toBe('value or {{variable}}')
    })

    it('склоняет по-русски и по-английски', () => {
        setLanguage('en')
        expect(tn(1, 'error|errors')).toBe('1 error')
        expect(tn(2, 'error|errors')).toBe('2 errors')

        setLanguage('ru')
        expect(tn(1, 'error|errors')).toBe('1 ошибка')
        expect(tn(2, 'error|errors')).toBe('2 ошибки')
        expect(tn(11, 'error|errors')).toBe('11 ошибок')
        expect(plural(21, 'error|errors')).toBe('ошибка')
        setLanguage('en')
    })
})
