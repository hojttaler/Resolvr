import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'

import { getAppContext } from '../platform/context.js'
import { logError } from '../platform/logger.js'
import { useAppStore } from '../state/store.js'

/** Подписки на нативное меню, закрытие окна и изменения файлов библиотеки. */
export function useAppEvents(onMenuAction: (action: string) => void): void {
    useEffect(() => {
        if (!isTauri()) return

        const window = getCurrentWindow()
        const unlisteners: Array<() => void> = []
        let disposed = false

        function register(listener: Promise<() => void>): void {
            void listener
                .then((unlisten) => {
                    if (disposed) unlisten()
                    else unlisteners.push(unlisten)
                })
                .catch((error) => logError('Ошибка подписки на событие приложения', error))
        }

        register(window.listen<string>('menu-action', (event) => onMenuAction(event.payload)))
        register(
            window.listen('before-quit', () => {
                void useAppStore
                    .getState()
                    .flushAll()
                    .catch((error) => logError('Не удалось сохранить сессию', error))
                    .finally(() => {
                        void window.destroy()
                    })
            }),
        )
        register(
            window.listen<{ paths: string[] }>('library-changed', (event) => {
                const store = useAppStore.getState()
                const paths = event.payload.paths.map((path) => path.replaceAll('\\', '/').split('/'))

                if (store.dialog === 'activity' && paths.some(([root]) => root === '.activity')) {
                    void store.loadActivity().catch((error) => logError('Не удалось обновить журнал', error))
                }

                const workspaceId = store.workspace?.id
                if (
                    workspaceId &&
                    paths.some(([root, workspace, area]) =>
                        root === 'workspaces' &&
                        workspace === workspaceId &&
                        (area === 'collections' || area === 'flows' || area === undefined),
                    )
                ) {
                    void store.reloadTree().catch((error) => logError('Не удалось обновить коллекции', error))
                }
            }),
        )

        void getAppContext()
            .then(async (context) => {
                if (!disposed) await invoke('watch_library', { root: context.paths.root })
            })
            .catch((error) => logError('Не удалось включить наблюдение за библиотекой', error))

        return () => {
            disposed = true
            for (const unlisten of unlisteners) unlisten()
            void invoke('unwatch_library').catch(() => undefined)
        }
    }, [onMenuAction])
}

/** Показывает окно после отрисовки сохранённой раскладки. */
export function useShowWindowWhenReady(ready: boolean): void {
    useEffect(() => {
        if (!ready) return

        const frame = requestAnimationFrame(() => {
            void invoke('show_main_window').catch(() => undefined)
        })

        return () => cancelAnimationFrame(frame)
    }, [ready])
}
