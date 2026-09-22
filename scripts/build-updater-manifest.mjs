/**
 * Собирает `latest.json` для встроенного updater из ассетов релиза.
 *
 * Раньше манифест писал `tauri-action` внутри каждой сборки: три платформы
 * параллельно дописывали один файл в релизе, и при повторном прогоне на тот
 * же тег он собирался из смеси подписей разных прогонов — архив новый,
 * подпись старая, обновление падало с «Signature Verification Failed».
 * Здесь манифест собирается один раз, после всех сборок, строго из тех
 * `.sig`, что лежат рядом с загруженными файлами.
 *
 * Использование: node scripts/build-updater-manifest.mjs <tag>
 * Требуется GITHUB_TOKEN и GITHUB_REPOSITORY.
 */
const tag = process.argv[2]
const repo = process.env.GITHUB_REPOSITORY
const token = process.env.GITHUB_TOKEN

if (!tag || !repo || !token) {
    console.error('Нужны аргумент <tag> и переменные GITHUB_REPOSITORY, GITHUB_TOKEN')
    process.exit(1)
}

/** Какие платформы updater обслуживает каждым файлом. */
const PLATFORMS = [
    { match: /_universal\.app\.tar\.gz$/, keys: ['darwin-aarch64', 'darwin-x86_64', 'darwin-aarch64-app', 'darwin-x86_64-app'] },
    { match: /_aarch64\.app\.tar\.gz$/, keys: ['darwin-aarch64', 'darwin-aarch64-app'] },
    { match: /_x64\.app\.tar\.gz$/, keys: ['darwin-x86_64', 'darwin-x86_64-app'] },
    { match: /\.AppImage$/, keys: ['linux-x86_64', 'linux-x86_64-appimage'] },
    { match: /\.deb$/, keys: ['linux-x86_64-deb'] },
    { match: /\.rpm$/, keys: ['linux-x86_64-rpm'] },
    { match: /-setup\.exe$/, keys: ['windows-x86_64', 'windows-x86_64-nsis'] },
    { match: /\.msi$/, keys: ['windows-x86_64-msi'] },
]

const api = async (path, init = {}) => {
    const response = await fetch(`https://api.github.com${path}`, {
        ...init,
        headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/vnd.github+json',
            ...init.headers,
        },
    })
    if (!response.ok) throw new Error(`${path} → ${response.status} ${await response.text()}`)

    return response.status === 204 ? undefined : response.json()
}

const release = await api(`/repos/${repo}/releases/tags/${tag}`)
const assets = release.assets

const platforms = {}
for (const asset of assets) {
    if (asset.name.endsWith('.sig') || asset.name === 'latest.json') continue

    const rule = PLATFORMS.find((item) => item.match.test(asset.name))
    if (!rule) continue

    const signatureAsset = assets.find((item) => item.name === `${asset.name}.sig`)
    if (!signatureAsset) {
        console.error(`✗ нет подписи для ${asset.name}`)
        process.exit(1)
    }

    const signature = await fetch(signatureAsset.browser_download_url).then((response) => response.text())
    for (const key of rule.keys) {
        platforms[key] = { signature: signature.trim(), url: asset.browser_download_url }
    }
    console.log(`✓ ${asset.name} → ${rule.keys.join(', ')}`)
}

if (Object.keys(platforms).length === 0) {
    console.error('✗ не найдено ни одного файла обновления')
    process.exit(1)
}

const manifest = {
    version: tag.replace(/^v/, ''),
    notes: '',
    pub_date: new Date().toISOString(),
    platforms,
}

// Старый манифест удаляется: GitHub не заменяет ассет с тем же именем.
const existing = assets.find((asset) => asset.name === 'latest.json')
if (existing) await api(`/repos/${repo}/releases/assets/${existing.id}`, { method: 'DELETE' })

const upload = await fetch(
    `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=latest.json`,
    {
        method: 'POST',
        headers: {
            authorization: `Bearer ${token}`,
            accept: 'application/vnd.github+json',
            'content-type': 'application/json',
        },
        body: JSON.stringify(manifest, null, 2),
    },
)
if (!upload.ok) throw new Error(`upload → ${upload.status} ${await upload.text()}`)

console.log(`latest.json обновлён: ${Object.keys(platforms).length} платформ`)
