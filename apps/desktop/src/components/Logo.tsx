/** Контурный знак Resolvr для поверхностей обеих тем. */
export function LogoMark({ size = 14 }: { size?: number }): React.JSX.Element {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
                d="M12 1.75 21.5 7v10L12 22.25 2.5 17V7L12 1.75Zm0 0-6.25 9.5L12 22.25l6.25-11L12 1.75ZM2.5 7l3.25 4.25L2.5 17l9.5 5.25 9.5-5.25-3.25-5.75L21.5 7m-15.75 4.25h12.5"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
                strokeLinecap="round"
            />
        </svg>
    )
}

/** Инициалы workspace для бейджа: до двух букв из первых слов названия. */
export function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean)
    const letters = words.slice(0, 2).map((word) => word.charAt(0).toUpperCase())

    return letters.join('') || '·'
}
