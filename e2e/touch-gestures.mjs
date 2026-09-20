/**
 * Real-browser acceptance for touch gestures (D10), driven through the
 * dev-only `__engine__` / `__store__` hooks that CanvasHost exposes in DEV
 * builds. Touch input goes through CDP dispatchTouchEvent so the native
 * touchstart/move/end listeners run exactly as on a device.
 *
 * Usage: start `npm run dev` (default http://localhost:5173), then
 * `E2E_CHANNEL=chrome node e2e/touch-gestures.mjs`
 * (any Playwright-chromium channel with touch support works).
 */
import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch(
  process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}
)
const page = await browser.newPage({
  viewport: { width: 1500, height: 900 },
  hasTouch: true,
})
page.setDefaultTimeout(15000)

await page.goto(BASE)
await page.waitForFunction(() => window.__engine__ && window.__store__)

// Let the dock/panels settle so canvas coords stay put for the gestures.
{
  let prev = ''
  for (let i = 0; i < 30; i++) {
    const cur = await page.evaluate(() => {
      const r = window.__engine__.canvas.getBoundingClientRect()
      return [r.left, r.top, r.width, r.height].join(',')
    })
    if (cur === prev && cur !== '') break
    prev = cur
    await page.waitForTimeout(100)
  }
}

const session = await page.context().newCDPSession(page)

async function canvasCenter() {
  return page.evaluate(() => {
    const r = window.__engine__.canvas.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
}

async function storeZoom() {
  return page.evaluate(() => window.__store__.view.zoom)
}

async function touch(type, points) {
  await session.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1 })),
  })
}

async function pinch(fromSpread, toSpread, steps = 6) {
  const c = await canvasCenter()
  const at = (spread) => [
    [c.x - spread, c.y],
    [c.x + spread, c.y],
  ]
  await touch('touchStart', at(fromSpread))
  for (let i = 1; i <= steps; i++) {
    const s = fromSpread + ((toSpread - fromSpread) * i) / steps
    await touch('touchMove', at(s))
    await page.waitForTimeout(30)
  }
  await touch('touchEnd', [])
}

const menu = page.locator('.context-menu')

/* ---------- pinch-out zooms in ---------- */
const z0 = await storeZoom()
await pinch(60, 120)
const z1 = await storeZoom()
check('pinch-out zooms in', z1 > z0 * 1.2, `${z0} → ${z1}`)

/* ---------- pinch-in zooms out ---------- */
await pinch(120, 60)
const z2 = await storeZoom()
check('pinch-in zooms out', z2 < z1 / 1.2, `${z1} → ${z2}`)

/* ---------- long-press opens the canvas menu ---------- */
{
  const c = await canvasCenter()
  await touch('touchStart', [[c.x, c.y]])
  await page.waitForTimeout(700)
  const visibleDuringHold = await menu.isVisible()
  await touch('touchEnd', [])
  await page.waitForTimeout(200)
  const visibleAfterLift = await menu.isVisible()
  check('long-press opens the menu during the hold', visibleDuringHold)
  check('menu survives the lift tap', visibleAfterLift)
  await page.keyboard.press('Escape')
}

/* ---------- desktop right-click still opens the menu ---------- */
{
  const c = await canvasCenter()
  await page.mouse.click(c.x, c.y, { button: 'right' })
  check('right-click opens the menu', await menu.isVisible())
  await page.keyboard.press('Escape')
  check('Escape closes the menu', await menu.isHidden())
}

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
