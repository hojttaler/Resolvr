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
        const styles = getComputedStyle(document.documentElement)
        const parse = (name) =>
            (styles.getPropertyValue(name).match(/[\d.]+/g) ?? []).map(Number)

        return {
            text: parse('--text-primary'),
            base: styles.getPropertyValue('--window-base').trim(),
        }
    })
}

const light = await readPalette('light')
const dark = await readPalette('dark')

// В светлой теме основной текст тёмный, в тёмной — светлый.
const lightOk = light.text[0] < 128 && light.base === '#ffffff'
const darkOk = dark.text[0] > 128 && dark.base !== '#ffffff'

console.log('светлая тема:', lightOk ? 'ок' : 'СЛОМАНА', light)
console.log('тёмная тема:', darkOk ? 'ок' : 'СЛОМАНА', dark)

await browser.close()
console.log('готово:', OUT)

if (!lightOk || !darkOk) process.exit(1)
