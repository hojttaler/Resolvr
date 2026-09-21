/**
 * Знак Resolvr: узлы, сходящиеся в одну точку — упрощённая версия иконки
 * приложения для шапки. Рисуется SVG с брендовым градиентом, чтобы не
 * зависеть от растровых размеров и одинаково выглядеть в обеих темах.
 */
export function LogoMark({ size = 14 }: { size?: number }): React.JSX.Element {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <defs>
                <linearGradient id="resolvr-brand" x1="0" y1="0" x2="24" y2="24">
                    <stop offset="0" stopColor="#6366f1" />
                    <stop offset="1" stopColor="#2ee6c5" />
                </linearGradient>
            </defs>
            <g stroke="url(#resolvr-brand)" strokeWidth="1.6" strokeLinecap="round">
                <path d="M3 12h18" />
                <path d="M9 12L4.5 6.5M9 12L4.5 17.5" />
                <path d="M15 12L10.5 6.5M15 12L10.5 17.5" />
            </g>
            <g fill="url(#resolvr-brand)">
                <circle cx="3" cy="12" r="1.6" />
                <circle cx="9" cy="12" r="1.6" />
                <circle cx="15" cy="12" r="1.6" />
                <circle cx="21" cy="12" r="1.8" />
                <circle cx="4.5" cy="6.5" r="1.4" />
                <circle cx="4.5" cy="17.5" r="1.4" />
                <circle cx="10.5" cy="6.5" r="1.4" />
                <circle cx="10.5" cy="17.5" r="1.4" />
            </g>
        </svg>
    )
}

/** Инициалы workspace для бейджа: до двух букв из первых слов названия. */
export function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean)
    const letters = words.slice(0, 2).map((word) => word.charAt(0).toUpperCase())

    return letters.join('') || '·'
}
