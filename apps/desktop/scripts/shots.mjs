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
    { name: 'main-ru', query: '?theme=dark&lang=ru' },
    { name: 'main-windows', query: '?theme=dark&platform=windows' },
    { name: 'search', query: '?screen=search&theme=dark' },
    { name: 'search-light', query: '?screen=search&theme=light' },
    { name: 'palette', query: '?screen=palette&theme=dark' },
    { name: 'settings', query: '?screen=settings&theme=dark' },
    { name: 'workspace', query: '?screen=workspace&theme=dark' },
    { name: 'activity', query: '?screen=activity&theme=dark' },
    { name: 'flow', query: '?screen=flow&theme=dark' },
    { name: 'report', query: '?screen=report&theme=dark' },
    { name: 'schema-user', query: '?screen=schema&type=User&theme=dark' },
    { name: 'schema-query', query: '?screen=schema&type=Query&theme=light' },
    { name: 'schema-sidebar', query: '?screen=schema-sidebar&theme=dark' },
    { name: 'big-response', query: '?screen=big&theme=dark' },
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
    if (screen.name === 'big-response') {
        // Массив свёрнут автоматически (больше 100 элементов): раскрываем и
        // проверяем, что в DOM попало лишь окно, а не все 20 000 объектов.
        await page.locator('.json-row--clickable', { hasText: 'users' }).first().click()
        await page.waitForTimeout(200)
        const rows = await page.locator('.json-row').count()
        console.log(`виртуализация: ${rows} строк в DOM после раскрытия 20 000 элементов`)
        if (rows > 1000) console.error('ВИРТУАЛИЗАЦИЯ НЕ РАБОТАЕТ: слишком много строк в DOM')
        if (rows < 30) console.error('ВИРТУАЛИЗАЦИЯ: массив не раскрылся — проверка не состоялась')

        // Прокрутка в конец: последняя строка дерева должна оказаться на экране
        // внутри панели — иначе смещение списка посчитано неверно.
        const panel = page.locator('.panel__content').last()
        await panel.evaluate((element) => {
            element.scrollTop = element.scrollHeight
        })
        await page.waitForTimeout(300)
        const closing = page.locator('.json-viewer .json-row').last()
        const box = await closing.boundingBox()
        const panelBox = await panel.boundingBox()
        const text = (await closing.textContent())?.trim()
        const inside = box && panelBox && box.y >= panelBox.y - 1 && box.y + box.height <= panelBox.y + panelBox.height + 1
        console.log(`конец дерева: «${text}» ${inside ? 'виден в панели' : 'ВНЕ ПАНЕЛИ'} (y=${Math.round(box?.y ?? -1)})`)
        if (!inside || text !== '}') console.error('ВИРТУАЛИЗАЦИЯ: конец дерева не на месте')
        await page.screenshot({ path: `${OUT}/big-response-end.png` })
    }
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
