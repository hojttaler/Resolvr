import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App.js'
import { ErrorBoundary } from './components/ErrorBoundary.js'
import { applyPlatformAttribute } from './platform/about.js'
import { installLogger } from './platform/logger.js'
import './styles/global.css'

// Журнал подключается до первого рендера, чтобы в него попали и ошибки старта.
installLogger()
applyPlatformAttribute()

const container = document.getElementById('root')
if (!container) throw new Error('Не найден корневой элемент #root')

createRoot(container).render(
    <StrictMode>
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    </StrictMode>,
)
