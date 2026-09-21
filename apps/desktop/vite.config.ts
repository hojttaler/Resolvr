import { fileURLToPath } from 'node:url'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const HOST = process.env.TAURI_DEV_HOST

// Ядро подключается исходниками, а не сборкой: правка в `packages/core`
// подхватывается тем же HMR, что и код интерфейса.
const CORE_ENTRY = fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url))

// Порт фиксирован: Tauri в dev-режиме открывает именно его и падает, если Vite
// уйдёт на соседний свободный порт.
export default defineConfig({
    plugins: [react()],
    clearScreen: false,
    resolve: {
        alias: { '@resolvr/core': CORE_ENTRY },
    },
    server: {
        port: 5273,
        strictPort: true,
        host: HOST ?? false,
        hmr: HOST ? { protocol: 'ws', host: HOST, port: 5274 } : undefined,
        watch: { ignored: ['**/src-tauri/**'] },
    },
    build: {
        target: 'safari18',
        minify: 'esbuild',
        sourcemap: true,
    },
})
