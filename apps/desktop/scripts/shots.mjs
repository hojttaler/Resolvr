/**
 * Снимает экраны интерфейса из витрины.
 *
 * Скриншоты нужны для проверки вёрстки: оформление меняется часто, а глазами
 * каждое состояние в собранном приложении не переберёшь.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.SHOWCASE_URL ?? 'http://localhost:5273/showcase.html'
const OUT = process.env.SHOTS_DIR ?? '/tmp/gqlai-shots'

const SCREENS = [
    { name: 'main-dark', query: '?theme=dark' },
    { name: 'main-light', query: '?theme=light' },
    { name: 'search', query: '?screen=search&theme=dark' },
    { name: 'search-light', query: '?screen=search&theme=light' },
    { name: 'palette', query: '?screen=palette&theme=dark' },
    { name: 'settings', query: '?screen=settings&theme=dark' },
    { name: 'workspace', query: '?screen=workspace&theme=dark' },
    { name: 'activity', query: '?screen=activity&theme=dark' },
    { name: 'flow', query: '?screen=flow&theme=dark' },
    { name: 'report', query: '?screen=report&theme=dark' },
    { name: 'save', query: '?screen=save&theme=dark' },
]

mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
})

const page = await context.newPage()
page.on('pageerror', (error) => console.error('ОШИБКА СТРАНИЦЫ:', error.message))
page.on('console', (message) => {
    if (message.type() === 'error') console.error('КОНСОЛЬ:', message.text())
})

for (const screen of SCREENS) {
    await page.goto(`${BASE}${screen.query}`, { waitUntil: 'networkidle' })
    // Редакторы и панели доводят раскладку после первого кадра.
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${OUT}/${screen.name}.png` })
    console.log('снято:', screen.name)
}

/**
 * Проверка тем.
 *
 * Светлая тема однажды уже ломалась: системная тёмная схема перекрывала явный
 * выбор, и текст становился белым на белом. Ошибка видна только глазами,
 * поэтому контраст проверяется здесь автоматически.
 */
async function readPalette(theme) {
    await page.goto(`${BASE}?theme=${theme}`, { waitUntil: 'networkidle' })

    return page.evaluate(() => {
        // Цвета читаются через реальный элемент: браузер сам приводит hex и
        // rgba к одной форме `rgb(r, g, b[, a])`.
        const probe = document.createElement('span')
        document.body.append(probe)
        const resolve = (name) => {
            probe.style.color = `var(${name})`
            const [r, g, b] = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(Number)
            return [r, g, b]
        }
        const result = { text: resolve('--text-primary'), base: resolve('--window-base') }
        probe.remove()

        return result
    })
}

const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b

const light = await readPalette('light')
const dark = await readPalette('dark')

// В светлой теме основной текст тёмный на светлом фоне, в тёмной — наоборот.
const lightOk = luminance(light.text) < 100 && luminance(light.base) > 200
const darkOk = luminance(dark.text) > 180 && luminance(dark.base) < 60

console.log('светлая тема:', lightOk ? 'ок' : 'СЛОМАНА', light)
console.log('тёмная тема:', darkOk ? 'ок' : 'СЛОМАНА', dark)

await browser.close()
console.log('готово:', OUT)

if (!lightOk || !darkOk) process.exit(1)
