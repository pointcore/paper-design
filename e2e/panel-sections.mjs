/**
 * Panel-section acceptance (C2 template slices): the extracted Align, Path
 * and Transform editors wire exactly like the inlined versions.
 *
 * Usage: start `npm run dev` (default http://localhost:5173), then
 * `E2E_CHANNEL=chrome node e2e/panel-sections.mjs`
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

// Fixture: two selected rects, offset in x.
const ids = await page.evaluate(() => {
  const E = window.__engine__
  const S = E.scope
  const c = S.view.viewToProject(S.view.center)
  const tag = (item, fill) => {
    item.fillColor = new S.Color(fill)
    item.data.id = E.genId()
    item.data.isUserItem = true
    E.getActiveLayer().addChild(item)
    return item.data.id
  }
  const a = tag(
    new S.Path.Rectangle({ from: new S.Point(c.x - 100, c.y - 100), to: new S.Point(c.x + 100, c.y + 100) }),
    '#3366cc'
  )
  const b = tag(
    new S.Path.Rectangle({ from: new S.Point(c.x, c.y - 100), to: new S.Point(c.x + 200, c.y + 100) }),
    '#cc6633'
  )
  E.selectByIds([a, b])
  E.pushHistory('Setup')
  return [a, b]
})

const panel = page.locator('.property-panel')
await panel.waitFor({ state: 'visible' })

/* ---------- Transform: W input scales + records ---------- */
const tsec = panel.locator('.transform-section')
await tsec.waitFor({ state: 'visible' })
const wInput = tsec.locator('.el-input-number input').nth(1)
await wInput.fill('400')
await wInput.press('Enter')
await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Transform')
const w = await page.evaluate(() => window.__engine__.getSelectionBounds()?.width ?? 0)
check('transform W scales + records', Math.abs(w - 400) < 2, `width=${Math.round(w)}`)

/* ---------- Align: Left aligns + records ---------- */
await page.evaluate((pair) => {
  window.__engine__.selectByIds(pair)
}, ids)
// The Align section starts collapsed: expand it via its header first.
const alignHead = panel.locator('.prop-head', { hasText: 'Align' })
await alignHead.click()
await panel.locator('.align-section').waitFor({ state: 'visible' })
check('align header expands', true)
await panel.locator('.align-section').getByText('Left', { exact: true }).click()
await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Align Left')
const aligned = await page.evaluate(() => {
  const E = window.__engine__
  const xs = E.getSelection().map((it) => Math.round(it.bounds.x))
  return xs
})
check('align left unites x + records', aligned[0] === aligned[1], aligned.join(','))

/* ---------- Path: Unite merges + records ---------- */
const pathHead = panel.locator('.prop-head', { hasText: 'Path' })
await pathHead.click()
await panel.locator('.path-section').waitFor({ state: 'visible' })
await panel.locator('.path-section').getByText('Unite', { exact: true }).click()
await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Unite')
const paths = await page.evaluate(() => {
  const E = window.__engine__
  const S = E.scope
  let n = 0
  const walk = (it) => {
    if (it instanceof S.Group && !(it instanceof S.Layer)) {
      for (const c of it.children) walk(c)
      return
    }
    if (it instanceof S.Path || it instanceof S.CompoundPath) n++
  }
  for (const layer of E.project.layers) {
    if (!layer.data?.isUserLayer) continue
    for (const child of layer.children) walk(child)
  }
  return n
})
check('unite merges into one path', paths === 1, `paths=${paths}`)

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\n${results.length}/${results.length} passed` : `\n${failed.length} FAILED`)
await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
