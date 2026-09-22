/**
 * ObjectMenu acceptance (C2 menu slice): the extracted Object menu wires
 * exactly like the inlined version — group, offset dialog, lock cycle and
 * the envelope preset mapping (Fisheye vs Squeeze must distort
 * differently: a past hand-edit dropped two mapping lines).
 *
 * Usage: start `npm run dev` (default http://localhost:5173), then
 * `E2E_CHANNEL=chrome node e2e/menu-object.mjs`
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

async function makeTwoRects() {
  return page.evaluate(() => {
    const E = window.__engine__
    const S = E.scope
    const c = S.view.viewToProject(S.view.center)
    E.project.getItems({ recursive: true }).forEach((it) => {
      if (it.data?.isUserItem) it.remove()
    })
    const mk = (x0, y0, x1, y1, fill) => {
      const r = new S.Path.Rectangle({
        from: new S.Point(c.x + x0, c.y + y0),
        to: new S.Point(c.x + x1, c.y + y1),
      })
      r.fillColor = new S.Color(fill)
      r.data.id = E.genId()
      r.data.isUserItem = true
      E.getActiveLayer().addChild(r)
      return r.data.id
    }
    const ids = [mk(-100, -100, 100, 100, '#3366cc'), mk(0, -100, 200, 100, '#cc6633')]
    E.selectByIds(ids)
    E.pushHistory('Setup')
    return ids
  })
}

async function clickMenuItem(name) {
  await page.locator('.top-bar').getByText('Object', { exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}

async function boundsOfSelection() {
  return page.evaluate(() => {
    const b = window.__engine__.getSelectionBounds()
    return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null
  })
}

/** Rounded anchor positions of the single selected path. */
async function anchorsOfSelection() {
  return page.evaluate(() => {
    const sel = window.__engine__.getSelection()[0]
    const segs = sel?.segments ?? []
    return segs.map((s) => [Math.round(s.point.x * 100) / 100, Math.round(s.point.y * 100) / 100])
  })
}

/* ---------- Group via the menu ---------- */
await makeTwoRects()
await clickMenuItem('Group')
await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Group')
const grouped = await page.evaluate(() => {
  const E = window.__engine__
  const S = E.scope
  const sel = E.getSelection()
  return sel.length === 1 && sel[0] instanceof S.Group
})
check('menu group groups + records', grouped)

/* ---------- Offset dialog applies ---------- */
await makeTwoRects()
await clickMenuItem('Offset Path...')
const offset = page.locator('.el-dialog', { hasText: 'Offset Path' })
await offset.waitFor({ state: 'visible' })
await offset.getByText('Apply', { exact: true }).click()
await page.waitForFunction(() =>
  window.__engine__.history.some((h) => h.name.includes('Offset'))
)
check('offset dialog applies + records', true)

/* ---------- Envelope mapping: Fisheye !== Squeeze ---------- */
async function applyEnvelope(presetLabel, historyName) {
  // Octagon fixture: mid-edge anchors move under both presets (rect
  // corners are fixed points of fisheye/squeeze, so a plain rect cannot
  // tell them apart).
  await page.evaluate(() => {
    const E = window.__engine__
    const S = E.scope
    const c = S.view.viewToProject(S.view.center)
    E.project.getItems({ recursive: true }).forEach((it) => {
      if (it.data?.isUserItem) it.remove()
    })
    const pts = []
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      pts.push(new S.Point(c.x + Math.cos(a) * 80, c.y + Math.sin(a) * 80))
    }
    const poly = new S.Path(pts)
    poly.closed = true
    poly.fillColor = new S.Color('#3366cc')
    poly.data.id = E.genId()
    poly.data.isUserItem = true
    E.getActiveLayer().addChild(poly)
    E.selectByIds([poly.data.id])
    E.pushHistory('Setup')
  })
  await clickMenuItem(presetLabel)
  await page.waitForFunction(
    (name) => window.__engine__.history.at(-1)?.name === name,
    historyName
  )
  return anchorsOfSelection()
}
// Exact history names: a mapping slip (fisheye->squeeze) fails here.
const fish = await applyEnvelope('Envelope: Fisheye', 'Envelope Fisheye')
const fishAnchors = await anchorsOfSelection()
const squeeze = await applyEnvelope('Envelope: Squeeze', 'Envelope Squeeze')
const squeezeAnchors = await anchorsOfSelection()
check(
  'fisheye and squeeze distort differently',
  !!fish && !!squeeze && JSON.stringify(fishAnchors) !== JSON.stringify(squeezeAnchors),
  `fish=${JSON.stringify(fishAnchors)} squeeze=${JSON.stringify(squeezeAnchors)}`
)

/* ---------- Lock cycle via the menu ---------- */
await makeTwoRects()
await clickMenuItem('Lock')
const locked = await page.evaluate(() =>
  window.__engine__.getSelection().every((it) => it.locked)
)
check('menu lock locks', locked)
await clickMenuItem('Unlock All')
const unlocked = await page.evaluate(() =>
  window.__engine__.getSelection().every((it) => !it.locked)
)
check('menu unlock-all restores', unlocked)

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\n${results.length}/${results.length} passed` : `\n${failed.length} FAILED`)
await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
