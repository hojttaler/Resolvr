#!/usr/bin/env bash
#
# Создание постоянной самоподписанной идентичности для подписи приложения.
#
# Ad-hoc подпись (`codesign -s -`) меняется при каждой сборке, поэтому macOS
# считает каждую новую версию другим приложением и повторно спрашивает пароль
# от Keychain, даже если раньше было выбрано «Всегда разрешать». Постоянный
# сертификат делает подпись стабильной, и разрешение сохраняется между сборками.
#
# Скрипт запускается один раз; при выполнении система один раз спросит пароль
# для добавления сертификата в связку ключей.
set -euo pipefail

IDENTITY="Resolvr Dev"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-identity -v -p codesigning | grep -q "${IDENTITY}"; then
    echo "✓ Идентичность «${IDENTITY}» уже существует"
    exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo "→ Создаю сертификат…"
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
    -keyout "${WORK}/key.pem" -out "${WORK}/cert.pem" \
    -subj "/CN=${IDENTITY}" \
    -addext 'basicConstraints=critical,CA:false' \
    -addext 'keyUsage=critical,digitalSignature' \
    -addext 'extendedKeyUsage=critical,codeSigning' 2> /dev/null

openssl pkcs12 -export -out "${WORK}/identity.p12" \
    -inkey "${WORK}/key.pem" -in "${WORK}/cert.pem" -passout pass:

echo "→ Добавляю в связку ключей (потребуется пароль)…"
# -T /usr/bin/codesign — доступ к закрытому ключу без отдельного запроса при
# каждой подписи; -A был бы шире необходимого.
security import "${WORK}/identity.p12" -k "${KEYCHAIN}" -P '' -T /usr/bin/codesign

# Без пользовательского доверия codesign отвергает сертификат как непригодный.
security add-trusted-cert -r trustRoot -p codeSign -k "${KEYCHAIN}" "${WORK}/cert.pem"

echo "✓ Готово. Следующий «pnpm install:app» подпишет приложение этой идентичностью."
