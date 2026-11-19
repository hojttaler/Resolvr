import { parseAppLink } from '@resolvr/core'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { useEffect } from 'react'

import { useAppStore } from '../state/store.js'

/**
 * Открытие ссылок `resolvr://`.
 *
 * Ссылка может прийти в уже запущенное приложение (событие) или запустить
 * его (тогда она лежит в `getCurrent()`), поэтому обе точки входа ведут в
 * один обработчик. До готовности состояния ссылка ждёт: workspace и
 * коллекции ещё не загружены, открывать нечего.
 */
export function useDeepLinks(ready: boolean): void {
    useEffect(() => {
        if (!ready || !isTauri()) return

        let disposed = false

        function handle(urls: string[]): void {
            if (disposed) return

            for (const raw of urls) {
                const link = parseAppLink(raw)
                if (link) void useAppStore.getState().openLink(link)
            }
        }

        let unlisten: (() => void) | undefined
        void onOpenUrl(handle).then((stop) => {
            if (disposed) stop()
            else unlisten = stop
        })
        void getCurrent().then((urls) => {
            if (urls) handle(urls)
        })

        return () => {
            disposed = true
            unlisten?.()
        }
    }, [ready])
}
