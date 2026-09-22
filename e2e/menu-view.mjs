/**
 * ViewMenu acceptance (C2 menu slice): the extracted View menu wires
 * exactly like the inlined version — zoom/grid toggles, Guides dialog,
 * Canvas Settings dialog and Preflight dialog.
 *
 * Usage: start `npm run dev` (default http://localhost:5173), then
 * `E2E_CHANNEL=chrome node e2e/menu-view.mjs`
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
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
page.setDefaultTimeout(15000)

await page.goto(BASE)
await page.waitForFunction(() => window.__engine__ && window.__store__)

async function clickMenuItem(name) {
  await page.locator('.top-bar').getByText('View', { exact: true }).click()
  await page.getByRole('menuitem', { name }).click()
}

/* ---------- Zoom In via the menu ---------- */
const z0 = await page.evaluate(() => window.__store__.view.zoom)
await clickMenuItem('Zoom In')
await page.waitForFunction((prev) => window.__store__.view.zoom > prev, z0)
check('menu zoom in steps up', true, `zoom=${z0}`)

/* ---------- Grid toggle via the menu ---------- */
const g0 = await page.evaluate(() => window.__store__.view.showGrid)
await clickMenuItem('Grid')
await page.waitForFunction((prev) => window.__store__.view.showGrid !== prev, g0)
check('menu grid toggles', true)
await clickMenuItem('Grid')
await page.waitForFunction((prev) => window.__store__.view.showGrid === prev, g0)
check('menu grid toggles back', true)

/* ---------- Guides dialog via the menu ---------- */
await clickMenuItem('Guides...')
const guides = page.locator('.el-dialog', { hasText: 'Guides' })
await guides.waitFor({ state: 'visible' })
check('guides dialog opens from menu', await guides.isVisible())
await guides.getByText('Close', { exact: true }).click()

/* ---------- Canvas Settings dialog via the menu ---------- */
await clickMenuItem('Canvas Settings...')
const settings = page.locator('.el-dialog', { hasText: 'Canvas Settings' })
await settings.waitFor({ state: 'visible' })
check('settings dialog opens from menu', await settings.isVisible())
// Flip the grid switch inside the dialog: store follows.
const gridBefore = await page.evaluate(() => window.__store__.view.showGrid)
await settings.locator('.setting-row', { hasText: 'Show a grid on the canvas' }).locator('.el-switch').click()
await page.waitForFunction((prev) => window.__store__.view.showGrid !== prev, gridBefore)
check('settings grid switch applies live', true)
await settings.getByText('Close', { exact: true }).click()

/* ---------- Preflight dialog via the menu ---------- */
await clickMenuItem('Preflight...')
const preflight = page.locator('.el-dialog', { hasText: 'Preflight' })
await preflight.waitFor({ state: 'visible' })
check('preflight opens from menu', await preflight.isVisible())

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\n${results.length}/${results.length} passed` : `\n${failed.length} FAILED`)
await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
