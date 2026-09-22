/**
 * Transform-drag acceptance (C2 controller slice): real mouse drags on the
 * selection bbox handles drive the extracted kernels — a corner drag
 * scales the artwork + records history, an outside-corner drag rotates it.
 *
 * Usage: start `npm run dev` (default http://localhost:5173), then
 * `E2E_CHANNEL=chrome node e2e/transform-drag.mjs`
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

// Fixture: one selected 200x200 rect.
await page.evaluate(() => {
  const E = window.__engine__
  const S = E.scope
  const c = S.view.viewToProject(S.view.center)
  const rect = new S.Path.Rectangle({
    from: new S.Point(c.x - 100, c.y - 100),
    to: new S.Point(c.x + 100, c.y + 100),
  })
  rect.fillColor = new S.Color('#3366cc')
  rect.data.id = E.genId()
  rect.data.isUserItem = true
  E.getActiveLayer().addChild(rect)
  E.selectByIds([rect.data.id])
  E.pushHistory('Setup')
})

/** Project point -> client (screen) coordinates for mouse driving. */
async function toScreen(x, y) {
  return page.evaluate(
    ([px, py]) => {
      const E = window.__engine__
      const r = E.canvas.getBoundingClientRect()
      const v = E.scope.view.projectToView(new E.scope.Point(px, py))
      return { x: r.left + v.x, y: r.top + v.y }
    },
    [x, y]
  )
}

async function selectionBounds() {
  return page.evaluate(() => {
    const b = window.__engine__.getSelectionBounds()
    return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null
  })
}

/* ---------- 1. corner drag scales ---------- */
const before = await selectionBounds()
const br = { x: before.x + before.width, y: before.y + before.height }
const brScreen = await toScreen(br.x, br.y)
await page.mouse.move(brScreen.x, brScreen.y)
await page.mouse.down()
await page.mouse.move(brScreen.x + 60, brScreen.y + 60, { steps: 8 })
await page.mouse.up()

await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Scale')
const after = await selectionBounds()
check(
  'corner drag scales the artwork + records history',
  after.width > before.width + 10 && after.height > before.height + 10,
  `${Math.round(before.width)}x${Math.round(before.height)} -> ${Math.round(after.width)}x${Math.round(after.height)}`
)

/* ---------- 2. outside-corner drag rotates ---------- */
// Fresh small rect so the rotate sweep is unambiguous.
await page.evaluate(() => {
  const E = window.__engine__
  const S = E.scope
  const c = S.view.viewToProject(S.view.center)
  E.project.getItems({ recursive: true }).forEach((it) => {
    if (it.data?.isUserItem) it.remove()
  })
  const rect = new S.Path.Rectangle({
    from: new S.Point(c.x - 50, c.y - 50),
    to: new S.Point(c.x + 50, c.y + 50),
  })
  rect.fillColor = new S.Color('#cc6633')
  rect.data.id = E.genId()
  rect.data.isUserItem = true
  E.getActiveLayer().addChild(rect)
  E.selectByIds([rect.data.id])
  E.pushHistory('Setup')
})
const bounds2 = await selectionBounds()
const tr = { x: bounds2.x + bounds2.width, y: bounds2.y }
// Just outside the top-right corner (rotate band: outside quad, <14px).
const rotScreen = await toScreen(tr.x + 8, tr.y - 8)
await page.mouse.move(rotScreen.x, rotScreen.y)
await page.mouse.down()
await page.mouse.move(rotScreen.x + 50, rotScreen.y + 10, { steps: 8 })
await page.mouse.up()

await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Rotate')
const rotatedBounds = await selectionBounds()
check(
  'outside-corner drag rotates + records history',
  Math.abs(rotatedBounds.width - bounds2.width) > 1 || Math.abs(rotatedBounds.height - bounds2.height) > 1,
  `${Math.round(bounds2.width)}x${Math.round(bounds2.height)} -> ${Math.round(rotatedBounds.width)}x${Math.round(rotatedBounds.height)}`
)

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\n${results.length}/${results.length} passed` : `\n${failed.length} FAILED`)
await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
