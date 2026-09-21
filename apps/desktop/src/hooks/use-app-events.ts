import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect } from 'react'

import { getAppContext } from '../platform/context.js'
import { useAppStore } from '../state/store.js'

/** Идентификаторы пунктов меню, приходящие из Rust. */
type IMenuAction = string

/**
 * Подписки на события окружения: меню, закрытие окна и изменения файлов.
 *
 * Логика команд живёт здесь, а не в Rust: только интерфейс знает, какая вкладка
 * активна и что в ней открыто.
 */
export function useAppEvents(onMenuAction: (action: IMenuAction) => void): void {
    useEffect(() => {
        const window = getCurrentWindow()
        const unlisteners: Array<() => void> = []

        void window.listen<string>('menu-action', (event) => onMenuAction(event.payload))
            .then((unlisten) => unlisteners.push(unlisten))

        // Перед закрытием окна дожидаемся записи всех отложенных черновиков:
        // это последняя точка, где несохранённый текст ещё можно сохранить.
        void window
            .listen('before-quit', () => {
                void useAppStore
                    .getState()
                    .flushAll()
                    .finally(() => {
                        void window.destroy()
                    })
            })
            .then((unlisten) => unlisteners.push(unlisten))

        // Изменения на диске, сделанные агентом через MCP, подхватываются
        // в открытом приложении без перезапуска.
        void window
            .listen<{ paths: string[] }>('library-changed', (event) => {
                const paths = event.payload.paths

                // Журнал агента и дерево коллекций обновляются раздельно: правка
                // одной коллекции не должна перечитывать весь журнал, и наоборот.
                if (paths.some((path) => path.startsWith('.activity'))) {
                    void useAppStore.getState().loadActivity()
                }

                if (paths.some((path) => !path.startsWith('.activity'))) {
                    void useAppStore.getState().reloadTree()
                }
            })
            .then((unlisten) => unlisteners.push(unlisten))

        void getAppContext().then((context) =>
            invoke('watch_library', { root: context.paths.root }).catch(() => {
                // Наблюдение необязательно: без него UI просто не обновляется
                // автоматически, всё остальное продолжает работать.
            }),
        )

        return () => {
            for (const unlisten of unlisteners) unlisten()
            void invoke('unwatch_library').catch(() => undefined)
        }
    }, [onMenuAction])
}

/** Показывает окно после того, как интерфейс отрисовал сохранённый лейаут. */
export function useShowWindowWhenReady(ready: boolean): void {
    useEffect(() => {
        if (!ready) return

        const frame = requestAnimationFrame(() => {
            void invoke('show_main_window').catch(() => undefined)
        })

        return () => cancelAnimationFrame(frame)
    }, [ready])
}
