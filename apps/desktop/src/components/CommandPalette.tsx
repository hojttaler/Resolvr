import { formatOperationRef } from '@resolvr/core'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useAppStore } from '../state/store.js'
import { pluralize, STEPS } from '../lib/plural.js'

export interface ICommand {
    id: string
    label: string
    hint?: string
    badge?: string
    run: () => void | Promise<void>
}

/**
 * Единая точка входа для всех действий: операции, флоу, окружения и команды.
 *
 * Заменяет собой блуждание по панелям — то, ради чего в редакторах кода
 * существует ⌘K. Список собирается из текущего состояния, поэтому в нём всегда
 * актуальные коллекции и окружения.
 */
export function CommandPalette(): React.JSX.Element | null {
    const open = useAppStore((state) => state.paletteOpen)
    const setPaletteOpen = useAppStore((state) => state.setPaletteOpen)
    const commands = useCommands()

    const [query, setQuery] = useState('')
    const [activeIndex, setActiveIndex] = useState(0)
    const inputRef = useRef<HTMLInputElement>(null)

    const filtered = useMemo(() => filterCommands(commands, query), [commands, query])

    useEffect(() => {
        if (!open) return

        setQuery('')
        setActiveIndex(0)
        inputRef.current?.focus()
    }, [open])

    useEffect(() => {
        setActiveIndex(0)
    }, [query])

    if (!open) return null

    function runCommand(index: number): void {
        const command = filtered[index]
        if (!command) return

        setPaletteOpen(false)
        void command.run()
    }

    return (
        <div className="overlay" onMouseDown={() => setPaletteOpen(false)}>
            <div className="dialog" onMouseDown={(event) => event.stopPropagation()}>
                <input
                    ref={inputRef}
                    className="palette__input"
                    placeholder="Операция, флоу или команда…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === 'ArrowDown') {
                            event.preventDefault()
                            setActiveIndex((index) => Math.min(index + 1, filtered.length - 1))
                        } else if (event.key === 'ArrowUp') {
                            event.preventDefault()
                            setActiveIndex((index) => Math.max(index - 1, 0))
                        } else if (event.key === 'Enter') {
                            event.preventDefault()
                            runCommand(activeIndex)
                        } else if (event.key === 'Escape') {
                            setPaletteOpen(false)
                        }
                    }}
                />

                <div className="palette__list">
                    {filtered.length === 0 && <div className="empty">Ничего не найдено</div>}

                    {filtered.map((command, index) => (
                        <div
                            key={command.id}
                            className={`palette__item${
                                index === activeIndex ? ' palette__item--active' : ''
                            }`}
                            onMouseEnter={() => setActiveIndex(index)}
                            onMouseDown={(event) => {
                                event.preventDefault()
                                runCommand(index)
                            }}
                        >
                            {command.badge && <span className="badge">{command.badge}</span>}
                            <span>{command.label}</span>
                            {command.hint && <span className="palette__hint">{command.hint}</span>}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}

function useCommands(): ICommand[] {
    const tree = useAppStore((state) => state.tree)
    const flows = useAppStore((state) => state.flows)
    const workspace = useAppStore((state) => state.workspace)
    const workspaces = useAppStore((state) => state.workspaces)
    const activeTabId = useAppStore((state) => state.activeTabId)
    const store = useAppStore

    return useMemo(() => {
        const commands: ICommand[] = []

        for (const node of tree) {
            for (const operation of node.operations) {
                const ref = formatOperationRef({
                    collectionId: node.collection.id,
                    name: operation.name,
                })
                commands.push({
                    id: `operation:${ref}`,
                    label: operation.name,
                    hint: node.collection.name,
                    badge: operation.kind.charAt(0).toUpperCase(),
                    run: () => store.getState().openTab({ operationRef: ref }),
                })
            }
        }

        for (const flow of flows) {
            commands.push({
                id: `flow:${flow.id}`,
                label: `Запустить флоу: ${flow.name}`,
                hint: pluralize(flow.steps.length, STEPS),
                badge: '▶',
                run: () => store.getState().runFlow(flow.id),
            })
        }

        for (const environment of workspace?.environments ?? []) {
            commands.push({
                id: `env:${environment.id}`,
                label: `Окружение: ${environment.name}`,
                badge: 'ENV',
                run: () => {
                    if (activeTabId) store.getState().setTabEnvironment(activeTabId, environment.id)
                },
            })
        }

        for (const item of workspaces) {
            if (item.id === workspace?.id) continue

            commands.push({
                id: `workspace:${item.id}`,
                label: `Workspace: ${item.name}`,
                badge: 'WS',
                run: () => store.getState().selectWorkspace(item.id),
            })
        }

        commands.push(
            {
                id: 'action:activity',
                label: 'Действия агента',
                hint: '⌘⇧A',
                run: () => store.getState().setDialog('activity'),
            },
            {
                id: 'action:workspace-settings',
                label: 'Настройки workspace',
                hint: 'заголовки, окружения · ⌘⇧,',
                run: () => store.getState().setDialog('workspaceSettings'),
            },
            {
                id: 'action:settings',
                label: 'Настройки',
                hint: '⌘,',
                run: () => store.getState().setDialog('settings'),
            },
            {
                id: 'action:save-operation',
                label: 'Сохранить операцию',
                hint: '⌘S',
                run: () =>
                    store
                        .getState()
                        .saveActiveTabInPlace()
                        .then((saved) => {
                            if (!saved) store.getState().setDialog('save')
                        }),
            },
            {
                id: 'action:run-all-flows',
                label: 'Запустить все цепочки (smoke-тест)',
                hint: 'отчёт откроется вкладкой',
                run: () => store.getState().runAllFlows(),
            },
            {
                id: 'action:save-operation-as',
                label: 'Сохранить операцию как…',
                hint: 'в другую коллекцию или под другим именем',
                run: () => store.getState().setDialog('save'),
            },
            {
                id: 'action:new-workspace',
                label: 'Новый workspace',
                hint: '⌘N',
                run: () => store.getState().setDialog('workspace'),
            },
            {
                id: 'action:run',
                label: 'Выполнить операцию',
                hint: '⌘↩',
                run: () => store.getState().runActiveTab(),
            },
            {
                id: 'action:new-tab',
                label: 'Новая вкладка',
                hint: '⌘T',
                run: () => store.getState().openTab(),
            },
            {
                id: 'action:refresh-schema',
                label: 'Обновить схему',
                hint: '⌘R',
                run: () => store.getState().refreshSchema(),
            },
            {
                id: 'action:layout-classic',
                label: 'Лейаут: Classic',
                hint: '⌘1',
                run: () => store.getState().setLayoutPreset('classic'),
            },
            {
                id: 'action:layout-inspector',
                label: 'Лейаут: Inspector',
                hint: '⌘2',
                run: () => store.getState().setLayoutPreset('inspector'),
            },
            {
                id: 'action:layout-focus',
                label: 'Лейаут: Focus',
                hint: '⌘3',
                run: () => store.getState().setLayoutPreset('focus'),
            },
            {
                id: 'action:toggle-sidebar',
                label: 'Показать/скрыть сайдбар',
                hint: '⌘B',
                run: () => store.getState().toggleSidebar(),
            },
        )

        return commands
    }, [tree, flows, workspace, workspaces, activeTabId, store])
}

/**
 * Нечёткий поиск: символы запроса должны встречаться в подписи по порядку.
 * Точное вхождение подстроки ранжируется выше, чем разрозненное совпадение.
 */
function filterCommands(commands: ICommand[], query: string): ICommand[] {
    const needle = query.trim().toLowerCase()
    if (needle.length === 0) return commands.slice(0, 60)

    const scored: Array<{ command: ICommand; score: number }> = []

    for (const command of commands) {
        const haystack = `${command.label} ${command.hint ?? ''}`.toLowerCase()

        const exactIndex = haystack.indexOf(needle)
        if (exactIndex >= 0) {
            scored.push({ command, score: 1000 - exactIndex })
            continue
        }

        let position = 0
        let matched = 0
        for (const character of needle) {
            const found = haystack.indexOf(character, position)
            if (found < 0) {
                matched = -1
                break
            }
            position = found + 1
            matched += 1
        }

        if (matched === needle.length) scored.push({ command, score: matched })
    }

    return scored
        .sort((left, right) => right.score - left.score)
        .slice(0, 60)
        .map((item) => item.command)
}
