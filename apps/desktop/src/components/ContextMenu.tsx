import { useEffect, useRef, useState } from 'react'

export interface IContextMenuItem {
    label: string
    hint?: string
    run: () => void | Promise<void>
    /** Разделитель рисуется перед пунктом. */
    separated?: boolean
    /** Пункт виден, но неприменим — например, «закрыть слева» у первой вкладки. */
    disabled?: boolean
}

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

/**
 * Контекстное меню.
 *
 * В webview системное меню недоступно, а копирование значений из дерева ответа
 * нужно по правой кнопке — как в любом инспекторе. Позиция ограничивается
 * границами окна, чтобы меню у нижнего края не уезжало за экран.
 */
export function ContextMenu(props: IContextMenuProps): React.JSX.Element | null {
    const ref = useRef<HTMLDivElement>(null)
    const [position, setPosition] = useState<{ left: number; top: number } | undefined>()

    useEffect(() => {
        if (!props.menu) {
            setPosition(undefined)

            return
        }

        const element = ref.current
        const width = element?.offsetWidth ?? 200
        const height = element?.offsetHeight ?? 120

        setPosition({
            left: Math.min(props.menu.x, window.innerWidth - width - EDGE_PADDING),
            top: Math.min(props.menu.y, window.innerHeight - height - EDGE_PADDING),
        })
    }, [props.menu])

    useEffect(() => {
        if (!props.menu) return

        function onKeyDown(event: KeyboardEvent): void {
            if (event.key === 'Escape') props.onClose()
        }

        window.addEventListener('keydown', onKeyDown)
        window.addEventListener('resize', props.onClose)

        return () => {
            window.removeEventListener('keydown', onKeyDown)
            window.removeEventListener('resize', props.onClose)
        }
    }, [props])

    if (!props.menu) return null

    return (
        <div className="context-menu__layer" onMouseDown={props.onClose} onContextMenu={(event) => {
            event.preventDefault()
            props.onClose()
        }}>
            <div
                ref={ref}
                className="context-menu"
                style={position ? { left: position.left, top: position.top } : { opacity: 0 }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {props.menu.items.map((item, index) => (
                    <button
                        key={`${index}-${item.label}`}
                        type="button"
                        className={`context-menu__item${
                            item.separated ? ' context-menu__item--separated' : ''
                        }`}
                        disabled={item.disabled}
                        onClick={() => {
                            props.onClose()
                            void item.run()
                        }}
                    >
                        <span>{item.label}</span>
                        {item.hint && <span className="palette__hint">{item.hint}</span>}
                    </button>
                ))}
            </div>
        </div>
    )
}
