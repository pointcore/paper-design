/**
 * Real-browser main-flow acceptance (C3): shape → text → boolean → mask →
 * undo/redo → save → reopen → export, driven through the dev-only
 * `__engine__` / `__store__` hooks that CanvasHost exposes in DEV builds.
 * Every step runs the real Paper.js project (no mocks): geometry, history,
 * project-file serialization and SVG export are asserted end to end.
 *
 * Usage: start `npm run dev` (default http://localhost:5173), then
 * `E2E_CHANNEL=chrome node e2e/main-flow.mjs`
 * (any Playwright-chromium channel works).
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

// Counts of live user artwork plus mask states (serializable for compare).
async function snapshot() {
  return page.evaluate(() => {
    const E = window.__engine__
    const S = E.scope
    let paths = 0
    let compounds = 0
    let texts = 0
    let masked = 0
    const walk = (it) => {
      if (it instanceof S.Group && !(it instanceof S.Layer)) {
        for (const c of it.children) walk(c)
        return
      }
      if (it instanceof S.CompoundPath) {
        compounds++
        return
      }
      if (it instanceof S.Path) {
        paths++
        if (it.data?.opacityMask?.enabled) masked++
        return
      }
      if (it instanceof S.PointText) texts++
    }
    for (const layer of E.project.layers) {
      if (!layer.data?.isUserLayer) continue
      for (const child of layer.children) walk(child)
    }
    return { paths, compounds, texts, masked }
  })
}

/* ---------- 1. shape: overlapping rect + ellipse ---------- */
const ids = await page.evaluate(() => {
  const E = window.__engine__
  const S = E.scope
  const c = S.view.viewToProject(S.view.center)
  const tag = (item, fill) => {
    item.data.id = E.genId()
    item.data.isUserItem = true
    item.fillColor = new S.Color(fill)
    return item
  }
  const L = E.getActiveLayer()
  const rect = tag(
    new S.Path.Rectangle({ from: new S.Point(c.x - 100, c.y - 100), to: new S.Point(c.x + 100, c.y + 100) }),
    '#3366cc'
  )
  const ellipse = tag(
    new S.Path.Ellipse({ center: new S.Point(c.x + 80, c.y), size: new S.Size(160, 160) }),
    '#cc6633'
  )
  L.addChild(rect)
  L.addChild(ellipse)
  return [rect.data.id, ellipse.data.id]
})
let snap = await snapshot()
check('shape: two paths land on the user layer', snap.paths === 2, JSON.stringify(snap))

/* ---------- 2. text ---------- */
await page.evaluate(() => {
  const E = window.__engine__
  const S = E.scope
  const c = S.view.viewToProject(S.view.center)
  const text = new S.PointText({
    point: new S.Point(c.x - 100, c.y + 160),
    content: 'Flow',
    fontSize: 48,
  })
  text.fillColor = new S.Color('#111111')
  text.data.id = E.genId()
  text.data.isUserItem = true
  E.getActiveLayer().addChild(text)
  // Fixtures bypass tool handlers, so record them: without a history entry
  // the construction baseline (empty) would be the undo target below.
  E.pushHistory('Setup')
})
snap = await snapshot()
check('text: one text item joins the artwork', snap.paths === 2 && snap.texts === 1, JSON.stringify(snap))

/* ---------- 3. boolean: unite the pair ---------- */
const united = await page.evaluate((pair) => {
  const E = window.__engine__
  E.selectByIds(pair)
  const ok = E.booleanOperation('unite')
  const last = E.history[E.history.length - 1]
  return { ok, history: last ? last.name : null }
}, ids)
snap = await snapshot()
check(
  'boolean: unite merges into one selected path',
  united.ok && united.history === 'Unite' && snap.paths === 1 && snap.compounds === 0,
  `${united.history} ${JSON.stringify(snap)}`
)

/* ---------- 4. undo / redo around the boolean ---------- */
// NOTE: undo()/redo() return void; the snapshots below are the assertions.
await page.evaluate(() => {
  const E = window.__engine__
  E.undo()
})
const snapUndo = await snapshot()
await page.evaluate(() => {
  const E = window.__engine__
  E.redo()
})
const snapRedo = await snapshot()
check(
  'history: undo restores the operands',
  snapUndo.paths === 2 && snapUndo.texts === 1,
  JSON.stringify(snapUndo)
)
check(
  'history: redo replays the unite',
  snapRedo.paths === 1 && snapRedo.texts === 1,
  JSON.stringify(snapRedo)
)

/* ---------- 5. mask: circle luminance mask on the union ---------- */
// Paper snapshots do not serialize selection, so re-select after the redo.
const masked = await page.evaluate(() => {
  const E = window.__engine__
  const S = E.scope
  const ids = []
  const walk = (it) => {
    if (it instanceof S.Group && !(it instanceof S.Layer)) {
      for (const c of it.children) walk(c)
      return
    }
    if ((it instanceof S.Path || it instanceof S.CompoundPath) && it.data?.isUserItem) {
      ids.push(it.data.id)
    }
  }
  for (const layer of E.project.layers) {
    if (!layer.data?.isUserLayer) continue
    for (const child of layer.children) walk(child)
  }
  E.selectByIds(ids)
  const sel = E.getSelection()
  if (sel.length !== 1) return { applied: false, reason: 'selection' }
  const target = sel[0]
  const c = target.bounds.center
  // Detached content: the apply path clones, so no project node is needed.
  const content = new S.Path.Circle({ center: c, radius: 60 })
  E.applyOpacityMask(target, content)
  content.remove()
  return { applied: !!target.data?.opacityMask?.enabled }
})
snap = await snapshot()
check('mask: luminance mask sticks to the union', masked.applied && snap.masked >= 1, JSON.stringify(snap))

/* ---------- 6. save → reopen keeps everything ---------- */
const roundtrip = await page.evaluate(() => {
  const E = window.__engine__
  const fileText = E.exportProjectFile()
  E.newDocument(1920, 1080)
  E.importProjectFile(fileText)
  return { bytes: fileText.length }
})
snap = await snapshot()
check(
  'save/reopen: masked union + text survive',
  roundtrip.bytes > 1000 && snap.paths === 2 && snap.texts === 1 && snap.masked >= 1,
  `${roundtrip.bytes}B ${JSON.stringify(snap)}`
)

/* ---------- 7. export the reopened artwork ---------- */
const exported = await page.evaluate(() => {
  const E = window.__engine__
  E.selectAllArtwork()
  const svg = E.exportSelectionSVG()
  return { chars: svg ? svg.length : 0, svg: !!svg && svg.startsWith('<svg') }
})
check(
  'export: reopened selection serializes to SVG',
  exported.chars > 100 && exported.svg,
  `${exported.chars} chars`
)

/* ---------- 8. compound: make keeps leaves, release restores them ---------- */
const compound = await page.evaluate(() => {
  const E = window.__engine__
  const S = E.scope
  const L = E.getActiveLayer()
  const c = S.view.viewToProject(S.view.center)
  const ids = []
  for (const dx of [-60, 60]) {
    const p = new S.Path.Rectangle({
      from: new S.Point(c.x + dx - 40, c.y - 40),
      to: new S.Point(c.x + dx + 40, c.y + 40),
    })
    p.fillColor = new S.Color('#3366cc')
    p.data.id = E.genId()
    p.data.isUserItem = true
    L.addChild(p)
    ids.push(p.data.id)
  }
  E.selectByIds(ids)
  const made = E.makeCompoundPath()
  const sel = E.getSelection()
  const kids = sel.length === 1 && sel[0] instanceof S.CompoundPath ? sel[0].children.length : -1
  const released = E.releaseCompoundPath()
  return { made, kids, released }
})
snap = await snapshot()
check('compound: make keeps both leaves', compound.made && compound.kids === 2, JSON.stringify(compound))
check(
  'compound: release restores plain paths',
  compound.released && snap.paths === 4 && snap.texts === 1,
  JSON.stringify(snap)
)

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
process.exit(failed.length === 0 ? 0 : 1)
