import { isTauri } from '@tauri-apps/api/core'
import { getVersion } from '@tauri-apps/api/app'
import { resolveResource } from '@tauri-apps/api/path'
import { arch, platform, version as osVersion } from '@tauri-apps/plugin-os'

import { getAppContext } from './context.js'

/** Сведения для «О программе» и для баг-репорта. */
export interface IAboutInfo {
    appVersion: string
    platform: string
    osVersion: string
    arch: string
    libraryRoot: string
    /** Команда регистрации MCP-сервера, вложенного в приложение. */
    mcpCommand: string
}

export async function readAboutInfo(): Promise<IAboutInfo> {
    if (!isTauri()) {
        return {
            appVersion: 'dev',
            platform: 'macos',
            osVersion: '—',
            arch: '—',
            libraryRoot: '~/Resolvr',
            mcpCommand: 'claude mcp add resolvr -- node <путь>/mcp/index.js',
        }
    }

    const context = await getAppContext()
    const mcpPath = await resolveResource('mcp/index.js').catch(() => 'mcp/index.js')

    return {
        appVersion: await getVersion(),
        platform: platform(),
        osVersion: osVersion(),
        arch: arch(),
        libraryRoot: context.paths.root,
        mcpCommand: `claude mcp add resolvr -- node "${mcpPath}"`,
    }
}

/**
 * Текст диагностики — то, что просят приложить к сообщению о проблеме.
 * Секретов здесь нет: только версии, платформа и настройки хранилища.
 */
export function formatDiagnostics(
    info: IAboutInfo,
    extra: { secretStorage: string; workspaces: number; lastError?: string },
): string {
    return [
        `Resolvr ${info.appVersion}`,
        `${info.platform} ${info.osVersion} (${info.arch})`,
        `Библиотека: ${info.libraryRoot}`,
        `Секреты: ${extra.secretStorage}`,
        `Workspace: ${extra.workspaces}`,
        extra.lastError ? `Последняя ошибка: ${extra.lastError}` : undefined,
    ]
        .filter((line): line is string => Boolean(line))
        .join('\n')
}

/** Платформа для CSS: отступ под traffic lights нужен только на macOS. */
export function applyPlatformAttribute(): void {
    const current = isTauri() ? platform() : 'macos'
    document.documentElement.setAttribute('data-platform', current)
}
