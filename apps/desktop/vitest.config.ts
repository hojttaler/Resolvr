import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const CORE_ENTRY = fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))

/**
 * Тесты интерфейса выполняются в happy-dom, а не серверным рендером: только так
 * проверяются эффекты, фокус полей и реакция на изменение состояния — то есть
 * ровно те места, где ломается ввод.
 */
export default defineConfig({
    plugins: [react()],
    resolve: { alias: { '@resolvr/core': CORE_ENTRY } },
    test: {
        environment: 'happy-dom',
        globals: false,
        restoreMocks: true,
    },
})
