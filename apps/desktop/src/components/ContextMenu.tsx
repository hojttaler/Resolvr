import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { useT } from '../i18n/index.js'

interface IContextMenuLabel {
    label: string
    hint?: string
    separated?: boolean
    disabled?: boolean
}

type IContextMenuAction = IContextMenuLabel & {
    run: () => void | Promise<unknown>
    submenu?: never
}
type IContextMenuBranch = IContextMenuLabel & { submenu: IContextMenuAction[]; run?: never }
export type IContextMenuItem = IContextMenuAction | IContextMenuBranch

export interface IContextMenuState {
    x: number
    y: number
    items: IContextMenuItem[]
}

export interface IContextMenuProps {
    menu: IContextMenuState | undefined
    onClose: () => void
}

const EDGE_PADDING = 8

/** Контекстные команды приложения с управлением мышью и клавиатурой. */
export function ContextMenu(props: IContextMenuProps): React.JSX.Element | null {
    const ref = useRef<HTMLDivElement>(null)
    const [position, setPosition] = useState<{ left: number; top: number }>()
    const [expanded, setExpanded] = useState<{
        menu: IContextMenuState
        item: IContextMenuBranch
    }>()
    const submenu = expanded?.menu === props.menu ? expanded?.item : undefined
    const returningTo = useRef<string | undefined>(undefined)
    const close = useRef(props.onClose)
    close.current = props.onClose
    const t = useT()

    useLayoutEffect(() => {
        const element = ref.current
        if (!props.menu || !element) {
            setPosition(undefined)

            return
        }
        const previous = document.activeElement
        return () => {
            if (
                previous instanceof HTMLElement &&
                previous.isConnected &&
                (element.contains(document.activeElement) ||
                    document.activeElement === document.body)
            ) {
                previous.focus({ preventScroll: true })
            }
        }
    }, [props.menu])

    useLayoutEffect(() => {
        const element = ref.current
        if (!props.menu || !element) return
        setPosition({
            left: Math.max(
                EDGE_PADDING,
                Math.min(props.menu.x, window.innerWidth - element.offsetWidth - EDGE_PADDING),
            ),
            top: Math.max(
                EDGE_PADDING,
                Math.min(props.menu.y, window.innerHeight - element.offsetHeight - EDGE_PADDING),
            ),
        })

        const items = Array.from(
            element.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        )
        const preferred = returningTo.current
        returningTo.current = undefined
        const target =
            items.find((item) => preferred !== undefined && item.dataset.itemLabel === preferred) ??
            (submenu ? (items[1] ?? items[0]) : items[0])
        const focus = target ?? element
        focus.focus({ preventScroll: true })
    }, [props.menu, submenu])

    useEffect(() => {
        if (!props.menu) return
        const dismiss = (): void => close.current()
        window.addEventListener('resize', dismiss)

        return () => window.removeEventListener('resize', dismiss)
    }, [props.menu])

    const menu = props.menu
    if (!menu) return null

    function goBack(): void {
        returningTo.current = submenu?.label
        setExpanded(undefined)
    }

    const items = submenu?.submenu ?? menu.items

    return (
        <div
            className="context-menu__layer"
            onMouseDown={props.onClose}
            onContextMenu={(event) => {
                event.preventDefault()
                props.onClose()
            }}
        >
            <div
                ref={ref}
                role="menu"
                aria-label={submenu?.label ?? t('Context menu')}
                tabIndex={-1}
                className="context-menu"
                style={position ?? { opacity: 0 }}
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                    if (event.key === 'Escape' || event.key === 'Tab') {
                        event.preventDefault()
                        event.stopPropagation()
                        if (submenu && event.key === 'Escape') goBack()
                        else props.onClose()

                        return
                    }
                    if (submenu && event.key === 'ArrowLeft') {
                        event.preventDefault()
                        goBack()

                        return
                    }
                    if (!submenu && event.key === 'ArrowRight') {
                        const active = event.target
                        if (
                            active instanceof HTMLButtonElement &&
                            active.getAttribute('aria-haspopup') === 'menu'
                        ) {
                            event.preventDefault()
                            active.click()
                        }

                        return
                    }
                    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    const buttons = Array.from(
                        ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
                            [],
                    )
                    if (!buttons.length) return
                    const active = buttons.findIndex((button) => button === document.activeElement)
                    const index =
                        event.key === 'Home'
                            ? 0
                            : event.key === 'End'
                              ? buttons.length - 1
                              : (active + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) %
                                buttons.length
                    buttons[index]?.focus()
                }}
            >
                {submenu && (
                    <button
                        type="button"
                        role="menuitem"
                        className="context-menu__item context-menu__back"
                        aria-label={t('Back')}
                        onClick={goBack}
                    >
                        <span aria-hidden="true">‹</span>
                        <span>{submenu.label}</span>
                    </button>
                )}
                {items.map((item, index) => (
                    <button
                        key={`${index}-${item.label}`}
                        type="button"
                        role="menuitem"
                        data-item-label={item.label}
                        aria-haspopup={item.submenu ? 'menu' : undefined}
                        className={`context-menu__item${item.separated ? ' context-menu__item--separated' : ''}`}
                        disabled={item.disabled}
                        onClick={() => {
                            if (item.submenu && props.menu) {
                                setExpanded({ menu: props.menu, item })
                            } else {
                                props.onClose()
                                void item.run?.()
                            }
                        }}
                    >
                        <span>{item.label}</span>
                        {item.submenu && (
                            <span className="context-menu__chevron" aria-hidden="true">
                                ›
                            </span>
                        )}
                        {item.hint && (
                            <span className="palette__hint" aria-hidden="true">
                                {item.hint}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        </div>
    )
}
