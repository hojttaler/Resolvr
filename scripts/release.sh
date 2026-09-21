#!/usr/bin/env bash
#
# Сборка DMG для раздачи коллегам: universal-бинарник (Apple Silicon + Intel).
#
# Подпись ad-hoc: без аккаунта Apple Developer нотаризация невозможна, поэтому
# при первом запуске macOS покажет предупреждение Gatekeeper. Как его пройти,
# написано в docs/INSTALL.md — ссылка на него печатается в конце.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${ROOT}/dist"
VERSION="$(node -p "require('${ROOT}/apps/desktop/package.json').version")"

export PATH="$HOME/.cargo/bin:$PATH"

echo "→ Цели Rust для universal-сборки…"
rustup target add aarch64-apple-darwin x86_64-apple-darwin > /dev/null

echo "→ Сборка MCP-сервера…"
pnpm --filter @resolvr/mcp build

echo "→ Universal-сборка приложения (занимает вдвое дольше обычной)…"
pnpm --filter @resolvr/desktop build:universal

BUNDLE_DIR="${ROOT}/apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle"
DMG="$(find "${BUNDLE_DIR}/dmg" -name '*.dmg' | head -n 1)"

if [ -z "${DMG}" ]; then
    echo "✗ DMG не найден в ${BUNDLE_DIR}/dmg" >&2
    exit 1
fi

mkdir -p "${OUT}"
cp "${DMG}" "${OUT}/Resolvr-${VERSION}-universal.dmg"

echo "✓ Готово: ${OUT}/Resolvr-${VERSION}-universal.dmg"
echo "  Инструкция для получателей: docs/INSTALL.md"
