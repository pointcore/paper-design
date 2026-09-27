/**
 * Real-browser direct-select acceptance (F20 prerequisite): anchor hit +
 * drag, anchor marquee, and the endpoint join (Ctrl+J) through the real
 * select controller — the highest-risk gesture layer that had no e2e
 * cover, gating any future select-controller decomposition.
 *
 * Usage: start `npm run dev` (default http://localhost:5173), then
 * `E2E_CHANNEL=chrome node e2e/direct-select.mjs`.
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

// Document coordinates -> page coordinates through the live view.
async function pagePoint(docX, docY) {
  return page.evaluate(([x, y]) => {
    const E = window.__engine__
    const p = E.canvasToScreen(new E.scope.Point(x, y))
    const r = E.canvas.getBoundingClientRect()
    return { x: r.left + p.x, y: r.top + p.y }
  }, [docX, docY])
}

async function liveZoom() {
  return page.evaluate(() => window.__engine__.scope.view.zoom)
}

// Seed one zigzag open path centered on the current view; returns the
// anchor document coordinates.
const zig = await page.evaluate(() => {
  const E = window.__engine__
  const S = E.scope
  const c = S.view.viewToProject(S.view.center)
  // insert:false + explicit user-layer insert: the bare activeLayer can be
  // a chrome layer (guides) at boot time.
  const path = new S.Path({
    segments: [
      [c.x - 150, c.y - 80],
      [c.x, c.y],
      [c.x + 150, c.y + 80],
    ],
    insert: false,
  })
  E.getActiveLayer().addChild(path)
  path.data.id = E.genId()
  path.data.isUserItem = true
  path.strokeColor = '#3366cc'
  path.strokeWidth = 2
  window.__zigId = path.data.id
  return {
    id: path.data.id,
    a: { x: c.x - 150, y: c.y - 80 },
    b: { x: c.x, y: c.y },
    z: { x: c.x + 150, y: c.y + 80 },
  }
})

await page.evaluate(() => {
  const s = window.__store__
  const e = window.__engine__
  s.setTool('direct-select')
  e.setTool('direct-select')
})

/* ---------- 1. anchor click + drag moves the anchor ---------- */
{
  const at = await pagePoint(zig.b.x, zig.b.y)
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + 40, at.y + 25, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(100)
  const state = await page.evaluate((id) => {
    const E = window.__engine__
    const path = E.project.getItem({ data: { id } })
    const seg = path?.segments[1]
    return seg ? { x: seg.point.x, y: seg.point.y } : null
  }, zig.id)
  const zoom = await liveZoom()
  const expectedX = zig.b.x + 40 / zoom
  const expectedY = zig.b.y + 25 / zoom
  check(
    'anchor drag moves the middle anchor',
    !!state && Math.abs(state.x - expectedX) < 2 && Math.abs(state.y - expectedY) < 2,
    state ? `got (${state.x.toFixed(1)}, ${state.y.toFixed(1)})` : 'path missing',
  )
}

/* ---------- 2. marquee over an anchor sub-selects it ---------- */
{
  // Drag an empty-area marquee around the path's end anchor.
  const z = await pagePoint(zig.z.x, zig.z.y)
  await page.mouse.move(z.x - 30, z.y - 30)
  await page.mouse.down()
  await page.mouse.move(z.x + 30, z.y + 30, { steps: 3 })
  await page.mouse.up()
  await page.waitForTimeout(100)
  // Dragging from empty space near only the end anchor, then moving the
  // pointer must translate that anchor (proves it is sub-selected).
  await page.mouse.move(z.x, z.y)
  await page.mouse.down()
  await page.mouse.move(z.x + 35, z.y - 20, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(100)
  const state = await page.evaluate(() => {
    const E = window.__engine__
    const path = E.project.getItem({ data: { id: window.__zigId } })
    const seg = path?.segments[2]
    return seg ? { x: seg.point.x, y: seg.point.y } : null
  })
  const zoom = await liveZoom()
  const expectedX = zig.z.x + 35 / zoom
  const expectedY = zig.z.y - 20 / zoom
  check(
    'marquee sub-selects the end anchor and drags it',
    !!state && Math.abs(state.x - expectedX) < 2 && Math.abs(state.y - expectedY) < 2,
    state ? `got (${state.x.toFixed(1)}, ${state.y.toFixed(1)})` : 'path missing',
  )
}

/* ---------- 3. endpoint join via Ctrl+J ---------- */
{
  // Two open paths whose near ends coincide at the view center.
  await page.evaluate(() => {
    const E = window.__engine__
    const S = E.scope
    const c = S.view.viewToProject(S.view.center)
    const mk = (pts) => {
      const p = new S.Path({ segments: pts, insert: false })
      E.getActiveLayer().addChild(p)
      p.data.id = E.genId()
      p.data.isUserItem = true
      p.strokeColor = '#cc5533'
      p.strokeWidth = 2
      return p
    }
    // Start points sit 10px apart so each anchor click is unambiguous
    // (the join itself bridges the gap).
    window.__ja = mk([
      [c.x - 200, c.y + 150],
      [c.x, c.y + 150],
    ])
    window.__jb = mk([
      [c.x + 10, c.y + 150],
      [c.x + 120, c.y + 210],
    ])
  })
  // Sub-select A's last anchor, then shift-click B's first anchor.
  const jaEnd = await page.evaluate(() => {
    const E = window.__engine__
    const p = window.__ja
    return { x: p.segments[1].point.x, y: p.segments[1].point.y }
  })
  const jbStart = await page.evaluate(() => {
    const E = window.__engine__
    const p = window.__jb
    return { x: p.segments[0].point.x, y: p.segments[0].point.y }
  })
  const hitA = await pagePoint(jaEnd.x, jaEnd.y)
  await page.mouse.click(hitA.x, hitA.y)
  const hitB = await pagePoint(jbStart.x, jbStart.y)
  await page.keyboard.down('Shift')
  await page.mouse.click(hitB.x, hitB.y)
  await page.keyboard.up('Shift')
  const before = await page.evaluate(() => window.__store__.history.at(-1)?.name ?? '')
  await page.keyboard.press('Control+j')
  await page.waitForTimeout(150)
  const after = await page.evaluate(() => {
    const E = window.__engine__
    const hist = window.__store__.history.at(-1)?.name ?? ''
    const a = !!window.__ja.parent
    const b = !!window.__jb.parent
    return { hist, bothGone: !a && !b }
  })
  check(
    'Ctrl+J merges the two sub-selected endpoints',
    after.hist === 'Join Paths' && after.bothGone && before !== 'Join Paths',
    `history: ${after.hist}`,
  )
}

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
