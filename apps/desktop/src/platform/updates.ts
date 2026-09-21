import { isTauri } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type Update } from '@tauri-apps/plugin-updater'

export interface IAvailableUpdate {
    version: string
    notes: string
    date?: string
    /** Скачивает, устанавливает и перезапускает приложение. */
    install: (onProgress: (fraction: number) => void) => Promise<void>
}

/**
 * Проверка обновлений через GitHub Releases.
 *
 * Сборки подписаны собственным ключом (minisign): подпись проверяет сам
 * updater, аккаунт Apple для этого не нужен. Вне Tauri и при отсутствии
 * сети проверка молча возвращает «обновлений нет» — это не ошибка
 * пользователя, и мешать ему уведомлением незачем.
 */
export async function checkForUpdate(): Promise<IAvailableUpdate | undefined> {
    if (!isTauri()) return undefined

    let update: Update | null
    try {
        update = await check({ timeout: 10_000 })
    } catch {
        return undefined
    }
    if (!update) return undefined

    return {
        version: update.version,
        notes: update.body ?? '',
        date: update.date,
        install: async (onProgress) => {
            let total = 0
            let received = 0

            await update.downloadAndInstall((event) => {
                if (event.event === 'Started') total = event.data.contentLength ?? 0
                if (event.event === 'Progress') {
                    received += event.data.chunkLength
                    if (total > 0) onProgress(Math.min(received / total, 1))
                }
                if (event.event === 'Finished') onProgress(1)
            })

            await relaunch()
        },
    }
}
