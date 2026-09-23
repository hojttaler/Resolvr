import { Component, type ErrorInfo, type ReactNode } from 'react'

import { useT } from '../i18n/index.js'
import { logError, openLogDir } from '../platform/logger.js'

interface IErrorBoundaryProps {
    children: ReactNode
}

interface IErrorBoundaryState {
    error?: Error
}

/**
 * Последний рубеж для ошибок рендера.
 *
 * Без него исключение в любом компоненте оставляет пустое окно без
 * объяснений. Ошибка со стеком компонентов пишется в журнал, а экран
 * предлагает открыть журнал и перезагрузить интерфейс; черновики к этому
 * моменту уже сохранены в сессию и восстановятся после перезагрузки.
 */
export class ErrorBoundary extends Component<IErrorBoundaryProps, IErrorBoundaryState> {
    override state: IErrorBoundaryState = {}

    static getDerivedStateFromError(error: Error): IErrorBoundaryState {
        return { error }
    }

    override componentDidCatch(error: Error, info: ErrorInfo): void {
        logError(`Ошибка рендера${info.componentStack ?? ''}`, error)
    }

    override render(): ReactNode {
        if (this.state.error) return <ErrorScreen error={this.state.error} />

        return this.props.children
    }
}

function ErrorScreen(props: { error: Error }): React.JSX.Element {
    const t = useT()

    return (
        <div className="app">
            <div className="crash">
                <div className="crash__title">{t('Something went wrong')}</div>
                <div className="crash__message selectable">{props.error.message}</div>
                <div className="crash__actions">
                    <button
                        type="button"
                        className="btn"
                        onClick={() =>
                            void openLogDir().catch((error: unknown) =>
                                logError('Не удалось открыть журнал', error),
                            )
                        }
                    >
                        {t('Open logs')}
                    </button>
                    <button
                        type="button"
                        className="btn btn--primary"
                        onClick={() => window.location.reload()}
                    >
                        {t('Reload')}
                    </button>
                </div>
            </div>
        </div>
    )
}
