import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { useT } from '../i18n/index.js'
import { copyText, readClipboardText } from '../lib/clipboard.js'
import { kbd } from '../lib/keys.js'
import { ContextMenu, type IContextMenuState } from './ContextMenu.js'

/** Команды буфера обмена для обычных текстовых полей и форм. */
export function TextFieldContextMenu(): React.JSX.Element | null {
    const [open, setOpen] = useState<{ menu: IContextMenuState; parent: Element }>()
    const t = useT()

    useEffect(() => {
        function onContextMenu(event: MouseEvent): void {
            const field = event.target
            if (
                event.defaultPrevented ||
                !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)
            )
                return
            if (field.disabled || field.selectionStart === null || field.selectionEnd === null)
                return

            event.preventDefault()
            field.focus({ preventScroll: true })
            const { selectionStart: from, selectionEnd: to, value } = field
            const selected =
                field instanceof HTMLInputElement && field.type === 'password'
                    ? ''
                    : value.slice(from, to)

            function replace(text: string): void {
                if (
                    !(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) ||
                    !field.isConnected ||
                    field.value !== value ||
                    field.readOnly
                )
                    return
                field.setRangeText(text, from, to, 'end')
                field.dispatchEvent(new Event('input', { bubbles: true }))
            }

            setOpen({
                parent: field.closest('dialog') ?? document.body,
                menu: {
                    x: event.clientX,
                    y: event.clientY,
                    items: [
                        {
                            label: t('Cut'),
                            hint: kbd('X'),
                            disabled: !selected || field.readOnly,
                            run: async () => {
                                if (await copyText(selected)) replace('')
                            },
                        },
                        {
                            label: t('Copy'),
                            hint: kbd('C'),
                            disabled: !selected,
                            run: () => copyText(selected),
                        },
                        {
                            label: t('Paste'),
                            hint: kbd('V'),
                            disabled: field.readOnly,
                            run: async () => {
                                const text = await readClipboardText()
                                if (text !== undefined) replace(text)
                            },
                        },
                        {
                            label: t('Select all'),
                            hint: kbd('A'),
                            disabled: !value,
                            separated: true,
                            run: () => field.select(),
                        },
                    ],
                },
            })
        }
        document.addEventListener('contextmenu', onContextMenu)

        return () => document.removeEventListener('contextmenu', onContextMenu)
    }, [t])

    return open
        ? createPortal(
              <ContextMenu menu={open.menu} onClose={() => setOpen(undefined)} />,
              open.parent,
          )
        : null
}
