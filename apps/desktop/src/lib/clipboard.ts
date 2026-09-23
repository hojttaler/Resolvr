import { isTauri } from '@tauri-apps/api/core'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'

import { logError } from '../platform/logger.js'

/**
 * Копирует текст в системный буфер обмена.
 *
 * В приложении запись идёт через Rust: WebKitGTK на Linux отклоняет
 * `navigator.clipboard.writeText` с `NotAllowedError`, и копирование там не
 * работало совсем. Вне Tauri (витрина, тесты) используется API браузера.
 * Сбой записи попадает в журнал, а не в необработанный отказ промиса;
 * результат — удалось ли скопировать, чтобы не показывать «Скопировано» зря.
 */
export async function copyText(text: string): Promise<boolean> {
    try {
        if (isTauri()) await writeText(text)
        else await navigator.clipboard.writeText(text)

        return true
    } catch (error) {
        logError('Не удалось скопировать в буфер обмена', error)

        return false
    }
}
