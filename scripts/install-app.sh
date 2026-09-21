#!/usr/bin/env bash
#
# Сборка и установка приложения в /Applications.
#
# Замена работающего приложения оставила бы запущенным старый образ, а новый
# получил бы повреждённый бандл, поэтому запущенный экземпляр закрывается заранее.
set -euo pipefail

# Имена переменных всегда в фигурных скобках: bash 3.2 из macOS присоединяет
# идущий следом многобайтовый символ (например «…») к имени переменной.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUNDLE="$ROOT/apps/desktop/src-tauri/target/release/bundle/macos/Resolvr.app"
TARGET="/Applications/Resolvr.app"

export PATH="$HOME/.cargo/bin:$PATH"

# Ключ подписи обновлений: с включённым `createUpdaterArtifacts` сборка без
# него не проходит. Локальный ключ лежит вне репозитория.
SIGNING_KEY="$HOME/.tauri/resolvr.key"
if [ -f "${SIGNING_KEY}" ]; then
    TAURI_SIGNING_PRIVATE_KEY="$(cat "${SIGNING_KEY}")"
    export TAURI_SIGNING_PRIVATE_KEY
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
else
    echo "✗ Нет ключа подписи ${SIGNING_KEY}: создайте его командой" >&2
    echo "  pnpm --filter @resolvr/desktop exec tauri signer generate -w ${SIGNING_KEY}" >&2
    exit 1
fi

# MCP собирается вместе с приложением: иначе агент продолжает работать со
# старой сборкой сервера, и новые возможности до него просто не доезжают.
echo "→ Сборка MCP-сервера…"
pnpm --filter @resolvr/mcp build

echo "→ Сборка релизной версии…"
pnpm --filter @resolvr/desktop build

if [ ! -d "$BUNDLE" ]; then
    echo "✗ Сборка не создала $BUNDLE" >&2
    exit 1
fi

if pgrep -f "$TARGET/Contents/MacOS/resolvr" > /dev/null 2>&1; then
    echo "→ Закрываю запущенное приложение…"
    osascript -e 'quit app "Resolvr"' || true

    # Ждём завершения: копирование поверх живого процесса даёт битый бандл.
    for _ in $(seq 1 20); do
        pgrep -f "$TARGET/Contents/MacOS/resolvr" > /dev/null 2>&1 || break
        sleep 0.5
    done
fi

echo "→ Установка в ${TARGET}…"
rm -rf "$TARGET"

# ditto, а не cp: копирование бандла обычными средствами теряет метаданные
# подписи, и проверка `codesign -v` начинает считать её нарушенной.
ditto "$BUNDLE" "$TARGET"

# Постоянная идентичность, если она создана скриптом create-signing-identity.sh.
# Ad-hoc подпись меняется при каждой сборке, из-за чего macOS видит новое
# приложение и заново спрашивает пароль от Keychain, забывая «Всегда разрешать».
IDENTITY="Resolvr Dev"
if security find-identity -v -p codesigning 2> /dev/null | grep -q "${IDENTITY}"; then
    echo "→ Подписываю постоянной идентичностью «${IDENTITY}»…"
    codesign --force --deep --sign "${IDENTITY}" "$TARGET"
else
    codesign --verify --deep "$TARGET" 2> /dev/null || {
        echo "→ Подпись нарушена копированием, подписываю заново (ad-hoc)…"
        codesign --force --deep --sign - "$TARGET"
    }
    echo "  Совет: scripts/create-signing-identity.sh — постоянная подпись,"
    echo "  чтобы macOS не спрашивал пароль от Keychain после каждой установки."
fi

SIZE="$(du -sh "$TARGET" | cut -f1)"

echo "✓ Готово: $SIZE"
echo "  Запуск: open -a Resolvr"
