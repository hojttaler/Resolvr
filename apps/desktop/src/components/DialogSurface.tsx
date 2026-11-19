import { useEffect, useRef, type KeyboardEventHandler, type ReactNode } from 'react'

interface IDialogSurfaceProps {
    label: string
    className?: string
    children: ReactNode
    onClose: () => void
    onKeyDown?: KeyboardEventHandler<HTMLDialogElement>
}

/** Общая поверхность диалогов с возвратом фокуса и закрытием по Escape. */
export function DialogSurface(props: IDialogSurfaceProps): React.JSX.Element {
    const ref = useRef<HTMLDialogElement>(null)

    useEffect(() => {
        const dialog = ref.current
        dialog?.showModal()

        return () => dialog?.close()
    }, [])

    return (
        <dialog
            ref={ref}
            className={props.className ? `dialog ${props.className}` : 'dialog'}
            aria-label={props.label}
            onCancel={(event) => {
                event.preventDefault()
                props.onClose()
            }}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) props.onClose()
            }}
            onKeyDown={props.onKeyDown}
        >
            {props.children}
        </dialog>
    )
}
