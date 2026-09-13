/**
 * Real-browser acceptance for the Knife tool and the scissors closed-path
 * fix, driven through the dev-only `__engine__` / `__store__` hooks that
 * CanvasHost exposes in DEV builds. Geometry is asserted through the paper
 * project, while the cut gestures themselves are real mouse drags on the
 * canvas so the controller's tool handlers run exactly as a user's would.
 *
 * Usage: start `npm run dev` (default http://localhost:5173), then
 * `node e2e/knife-scissors.mjs`.
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
await page.waitForFunction(() => (window).__engine__ && (window).__store__)

// The dock/panels keep resizing the canvas for a moment after mount; wait
// for the canvas box to settle or every measured drag coordinate drifts.
{
  let prev = ''
  for (let i = 0; i < 30; i++) {
    const cur = await page.evaluate(() => {
      const r = (window).__engine__.canvas.getBoundingClientRect()
      return [r.left, r.top, r.width, r.height].join(',')
    })
    if (cur === prev && cur !== '') break
    prev = cur
    await page.waitForTimeout(100)
  }
}

/* ---------- page-side helpers ---------- */

// Paper project coords → page coords, using the view's own matrix.
async function projToPage(pt) {
  return page.evaluate(([x, y]) => {
    const E = (window).__engine__
    const v = E.scope.view.projectToView(new E.scope.Point(x, y))
    const r = E.canvas.getBoundingClientRect()
    return { x: r.left + v.x, y: r.top + v.y }
  }, [pt.x, pt.y])
}

async function dragLine(p1, p2, steps = 10) {
  const a = await projToPage(p1)
  const b = await projToPage(p2)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps)
  }
  await page.mouse.up()
}

async function clickAt(pt) {
  const a = await projToPage(pt)
  await page.mouse.click(a.x, a.y)
}

// Fresh canvas: strip user artwork and extra user layers, keep "Layer 1".
async function clearDoc() {
  await page.evaluate(() => {
    const E = (window).__engine__
    const keep = E.project.layers.find((l) => l.data?.isUserLayer)
    for (const layer of [...E.project.layers]) {
      if (!layer.data?.isUserLayer) continue
      if (layer !== keep) E.deleteLayer(layer.data.layerId)
      for (const child of [...layer.children]) child.remove()
    }
    if (keep) keep.activate()
    E.clearSelection()
    E.setTool('knife')
  })
}

async function histLen() {
  return page.evaluate(() => (window).__engine__.history.length)
}
async function lastHist() {
  return page.evaluate(() => {
    const E = (window).__engine__
    const last = E.history[E.history.length - 1]
    return last ? last.name : null
  })
}
async function statusMsg() {
  return page.evaluate(() => (window).__store__.statusMessage)
}
async function overlayCount() {
  return page.evaluate(() => (window).__engine__.getOverlayLayer().children.length)
}

// Every plain path on user layers (recursing into plain groups), plus the
// counts of non-path user items (compound paths, text) that must not change.
async function snapshot() {
  return page.evaluate(() => {
    const E = (window).__engine__
    const S = E.scope
    const paths = []
    let compounds = 0
    let texts = 0
    const walk = (it, layerName, nested = false) => {
      if (it instanceof S.Group) {
        // paper Layers extend Group; only mark real sub-groups as nested.
        const nested = !(it instanceof S.Layer)
        for (const c of it.children) walk(c, layerName, nested)
        return
      }
      if (it instanceof S.CompoundPath) {
        compounds++
        return
      }
      if (it instanceof S.Path) {
        paths.push({
          layer: layerName,
          inGroup: nested,
          closed: it.closed,
          sel: it.selected,
          grad: !!(it.fillColor && it.fillColor.gradient),
          x: Math.round(it.bounds.x),
          y: Math.round(it.bounds.y),
          w: Math.round(it.bounds.width),
          h: Math.round(it.bounds.height),
        })
        return
      }
      if (it instanceof S.PointText) texts++
    }
    for (const layer of E.project.layers) {
      if (!layer.data?.isUserLayer) continue
      for (const child of layer.children) walk(child, layer.name)
    }
    return { paths, compounds, texts }
  })
}

// Item factories, all tagged like real user artwork.
async function addArt(kind, opts = {}) {
  await page.evaluate(({ kind, opts }) => {
    const E = (window).__engine__
    const S = E.scope
    const c = E.scope.view.viewToProject(E.scope.view.center)
    const tag = (item) => {
      item.data.id = E.genId()
      item.data.isUserItem = true
      // Real user artwork always carries the current style, and paper's
      // hitTest (used by the scissors tool) ignores unpainted items.
      if (item instanceof S.Path || item instanceof S.CompoundPath) {
        item.fillColor = new S.Color('#3366cc')
        item.strokeColor = new S.Color('#223344')
        item.strokeWidth = 2
      }
      return item
    }
    const L = E.getActiveLayer()
    const put = (item) => {
      L.addChild(item)
      return item
    }
    switch (kind) {
      case 'rect':
        return put(tag(new S.Path.Rectangle({
          from: new S.Point(c.x - 100, c.y - 100),
          to: new S.Point(c.x + 100, c.y + 100),
        })))
      case 'zigzag':
        // Open path crossing the horizontal line through c twice.
        return put(tag(new S.Path({
          segments: [
            [c.x - 160, c.y - 100], [c.x - 60, c.y - 100],
            [c.x - 60, c.y + 100], [c.x + 60, c.y + 100],
            [c.x + 60, c.y - 100],
          ],
          closed: false,
        })))
      case 'ellipseInGroup': {
        const el = tag(new S.Path.Ellipse({
          center: new S.Point(c.x + 250, c.y),
          size: new S.Size(160, 120),
        }))
        const g = tag(new S.Group({ children: [el] }))
        L.addChild(g)
        return g
      }
      case 'ellipse2':
        return put(tag(new S.Path.Ellipse({
          center: new S.Point(c.x - 250, c.y),
          size: new S.Size(160, 120),
        })))
      case 'compound': {
        const cp = tag(new S.CompoundPath({
          children: [
            new S.Path.Circle({ center: new S.Point(c.x + 450, c.y), radius: 70 }),
            new S.Path.Circle({ center: new S.Point(c.x + 450, c.y), radius: 35 }),
          ],
        }))
        L.addChild(cp)
        return cp
      }
      case 'text': {
        const t = tag(new S.PointText({
          point: new S.Point(c.x - 460, c.y - 120),
          content: 'KNIFE',
          fontFamily: 'sans-serif',
          fontSize: 32,
          fillColor: 'black',
        }))
        t.data.textMode = 'point'
        L.addChild(t)
        return t
      }
      case 'clipGroup': {
        const clip = new S.Path.Circle({ center: new S.Point(c.x - 450, c.y + 150), radius: 60 })
        const art = tag(new S.Path.Rectangle({
          from: new S.Point(c.x - 520, c.y + 80),
          to: new S.Point(c.x - 380, c.y + 220),
        }))
        const g = tag(new S.Group({ children: [clip, art] }))
        g.clipped = true
        L.addChild(g)
        return g
      }
      case 'gradientRect': {
        const r = tag(new S.Path.Rectangle({
          from: new S.Point(c.x + 150, c.y - 260),
          to: new S.Point(c.x + 350, c.y - 100),
        }))
        r.fillColor = {
          gradient: { stops: [new S.Color('red'), new S.Color('blue')] },
          origin: r.bounds.topLeft,
          destination: r.bounds.bottomRight,
        }
        return put(r)
      }
      case 'lockedLayerRect': {
        const layer = E.createLayer('E2E Locked')
        const r = tag(new S.Path.Rectangle({
          from: new S.Point(c.x - 200, c.y + 120),
          to: new S.Point(c.x - 40, c.y + 240),
        }))
        layer.addChild(r)
        E.setUserLayerLocked(layer.data.layerId, true)
        L.activate()
        return r
      }
      case 'hiddenLayerRect': {
        const layer = E.createLayer('E2E Hidden')
        const r = tag(new S.Path.Rectangle({
          from: new S.Point(c.x + 40, c.y + 120),
          to: new S.Point(c.x + 200, c.y + 240),
        }))
        layer.addChild(r)
        E.setUserLayerVisible(layer.data.layerId, false)
        L.activate()
        return r
      }
      case 'circle':
        return put(tag(new S.Path.Circle({
          center: new S.Point(c.x, c.y),
          radius: opts.radius ?? 90,
        })))
      case 'line':
        return put(tag(new S.Path({
          segments: [[c.x - 120, c.y + 260], [c.x + 120, c.y + 260]],
          closed: false,
        })))
      default:
        throw new Error('unknown kind ' + kind)
    }
  }, { kind, opts })
  // Mirror real usage: drawing a shape commits one history entry, so undoing
  // a later cut lands on the intact artwork instead of an empty document.
  await page.evaluate(() => (window).__engine__.pushHistory('Add Test Art'))
}

/* ---------- Knife ---------- */

await clearDoc()

// 1. Closed rect: one crossing → exactly two pieces (never a duplicate).
{
  await addArt('rect')
  const before = await snapshot()
  check('setup: one closed rect', before.paths.length === 1 && before.paths[0].closed)
  const c = await page.evaluate(() => {
    const v = (window).__engine__.scope.view
    return v.viewToProject(v.center)
  })
  const h0 = await histLen()
  await dragLine({ x: c.x - 160, y: c.y }, { x: c.x + 160, y: c.y })
  const after = await snapshot()
  check('knife rect: 2 pieces, no duplicate', after.paths.length === 2, JSON.stringify(after.paths.length))
  check('knife rect: pieces open', after.paths.every((p) => !p.closed))
  check('knife rect: both selected', after.paths.every((p) => p.sel))
  check('knife rect: one Knife history entry', (await histLen()) === h0 + 1 && (await lastHist()) === 'Knife')
  await page.evaluate(() => (window).__engine__.undo())
  const undone = await snapshot()
  const raw = await page.evaluate(() => {
    const E = (window).__engine__
    return E.project.layers.map((l) => ({
      name: l.name,
      user: !!(l.data && l.data.isUserLayer),
      kids: l.children.length,
      kidTypes: l.children.map((k) => k.constructor.name),
    }))
  })
  check('knife rect: undo restores closed rect',
    undone.paths.length === 1 && undone.paths[0].closed,
    JSON.stringify({ snapped: undone.paths, raw }))
  await page.evaluate(() => (window).__engine__.redo())
  const redone = await snapshot()
  check('knife rect: redo re-splits', redone.paths.length === 2)
}

await clearDoc()

// 2. Open path crossed twice by one line → three pieces.
{
  await addArt('zigzag')
  const c = await page.evaluate(() => {
    const v = (window).__engine__.scope.view
    return v.viewToProject(v.center)
  })
  await dragLine({ x: c.x - 200, y: c.y }, { x: c.x + 200, y: c.y })
  const after = await snapshot()
  check('knife zigzag: 2 crossings → 3 pieces', after.paths.length === 3, JSON.stringify(after.paths.length))
}

await clearDoc()

// 3. One line slices several shapes, including one inside a group.
{
  await addArt('rect')
  await addArt('ellipseInGroup')
  await addArt('ellipse2')
  const c = await page.evaluate(() => {
    const v = (window).__engine__.scope.view
    return v.viewToProject(v.center)
  })
  // Horizontal line 30px above center: it crosses the rect mid-side and
  // both ellipses on non-cardinal chords (a center-height line would hit
  // the ellipses' 0°/180° anchors, which the seam guard correctly refuses).
  await dragLine({ x: c.x - 450, y: c.y - 30 }, { x: c.x + 450, y: c.y - 30 })
  const after = await snapshot()
  // rect → 2, grouped ellipse → 2, standalone ellipse → 2.
  check('knife multi: 6 pieces across 3 shapes', after.paths.length === 6, JSON.stringify(after.paths.length))
  const grouped = after.paths.filter((p) => p.inGroup)
  check('knife multi: grouped ellipse cut inside its group', grouped.length === 2, JSON.stringify(grouped.length))
}

await clearDoc()

// 4. Re-cutting along a fresh seam is a no-op (crossings sit on anchors).
{
  await addArt('rect')
  const c = await page.evaluate(() => {
    const v = (window).__engine__.scope.view
    return v.viewToProject(v.center)
  })
  await dragLine({ x: c.x, y: c.y - 160 }, { x: c.x, y: c.y + 160 })
  const once = await snapshot()
  const h = await histLen()
  await dragLine({ x: c.x, y: c.y - 160 }, { x: c.x, y: c.y + 160 })
  const twice = await snapshot()
  check('knife seam: second cut adds no pieces', twice.paths.length === once.paths.length, JSON.stringify(twice.paths.length))
  check('knife seam: second cut adds no history', (await histLen()) === h)
  check('knife seam: status hints at the gesture', (await statusMsg()).length > 0, await statusMsg())
}

await clearDoc()

// 5. Compound paths, text and clip-mask contents are untouched.
{
  await addArt('compound')
  await addArt('text')
  await addArt('clipGroup')
  await addArt('rect')
  const before = await snapshot()
  const c = await page.evaluate(() => {
    const v = (window).__engine__.scope.view
    return v.viewToProject(v.center)
  })
  await dragLine({ x: c.x - 550, y: c.y - 60 }, { x: c.x + 550, y: c.y - 60 })
  const after = await snapshot()
  check('knife skip: compound not torn apart', after.compounds === before.compounds)
  check('knife skip: text untouched', after.texts === before.texts)
  // Only the rect (crossed at y = c.y - 60? no — rect spans cy±100, so it IS
  // crossed) splits: 1 → 2. Clip-group art must stay whole.
  check('knife skip: only the plain rect was cut', after.paths.length === before.paths.length + 1, JSON.stringify({ b: before.paths.length, a: after.paths.length }))
}

await clearDoc()

// 6. Locked and hidden layers (and their descendants) are skipped.
{
  await addArt('lockedLayerRect')
  await addArt('hiddenLayerRect')
  await addArt('rect')
  const c = await page.evaluate(() => {
    const v = (window).__engine__.scope.view
    return v.viewToProject(v.center)
  })
  // Horizontal line through both off-to-the-side rects and the center rect.
  await dragLine({ x: c.x - 550, y: c.y + 180 }, { x: c.x + 550, y: c.y + 180 })
  // That line misses the center rect; make a second pass across everything.
  await dragLine({ x: c.x - 550, y: c.y }, { x: c.x + 550, y: c.y })
  const after = await snapshot()
  const locked = after.paths.filter((p) => p.layer === 'E2E Locked')
  const hidden = after.paths.filter((p) => p.layer === 'E2E Hidden')
  const main = after.paths.filter((p) => p.layer === 'Layer 1')
  check('knife skip: locked layer untouched', locked.length === 1 && locked[0].closed)
  check('knife skip: hidden layer untouched', hidden.length === 1 && hidden[0].closed)
  check('knife skip: main rect still cut', main.length === 2)
}

await clearDoc()

// 7. Escape mid-drag drops the preview and changes nothing.
{
  await addArt('rect')
  const before = await snapshot()
  const c = await page.evaluate(() => {
    const v = (window).__engine__.scope.view
    return v.viewToProject(v.center)
  })
  const h = await histLen()
  const a = await projToPage({ x: c.x - 160, y: c.y })
  const b = await projToPage({ x: c.x + 160, y: c.y })
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
  check('knife escape: preview line visible', (await overlayCount()) === 1)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  check('knife escape: preview removed', (await overlayCount()) === 0)
  check('knife escape: no history entry', (await histLen()) === h)
  const after = await snapshot()
  check('knife escape: artwork unchanged', after.paths.length === before.paths.length && after.paths[0].closed)
}

await clearDoc()

// 8. Switching tools mid-drag cleans up via deactivate().
{
  await addArt('rect')
  const c = await page.evaluate(() => {
    const v = (window).__engine__.scope.view
    return v.viewToProject(v.center)
  })
  const h = await histLen()
  const a = await projToPage({ x: c.x - 160, y: c.y })
  const b = await projToPage({ x: c.x + 160, y: c.y })
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
  await page.evaluate(() => (window).__engine__.setTool('select'))
  await page.mouse.up()
  check('knife deactivate: preview removed', (await overlayCount()) === 0)
  check('knife deactivate: no history entry', (await histLen()) === h)
}

await clearDoc()

// 9. Right-button drags are no-ops; a plain click only hints.
{
  await addArt('rect')
  const before = await snapshot()
  const c = await page.evaluate(() => {
    const v = (window).__engine__.scope.view
    return v.viewToProject(v.center)
  })
  const h = await histLen()
  const a = await projToPage({ x: c.x - 160, y: c.y })
  const b = await projToPage({ x: c.x + 160, y: c.y })
  await page.mouse.move(a.x, a.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(b.x, b.y, { steps: 5 })
  await page.mouse.up({ button: 'right' })
  check('knife right-drag: no history', (await histLen()) === h)
  check('knife right-drag: artwork unchanged', (await snapshot()).paths.length === before.paths.length)
  await clickAt({ x: c.x, y: c.y - 250 })
  check('knife click: status hint shown', /drag/i.test(await statusMsg()), await statusMsg())
  check('knife click: no history', (await histLen()) === h)
  check('knife click: no leftover preview', (await overlayCount()) === 0)
}

await clearDoc()

// 10. Gradient fills follow their pieces.
{
  await addArt('gradientRect')
  const c = await page.evaluate(() => {
    const v = (window).__engine__.scope.view
    return v.viewToProject(v.center)
  })
  await dragLine({ x: c.x + 250, y: c.y - 300 }, { x: c.x + 250, y: c.y + 50 })
  const after = await snapshot()
  check('knife gradient: cut into 2', after.paths.length === 2, JSON.stringify(after.paths.length))
  check('knife gradient: both pieces keep a gradient', after.paths.length === 2 && after.paths.every((p) => p.grad))
}

/* ---------- Scissors ---------- */

// clearDoc re-activates the knife; every scissors test switches back.
async function clearDocScissors() {
  await clearDoc()
  await page.evaluate(() => (window).__engine__.setTool('scissors'))
}

await clearDocScissors()

// 11. Closed path: click away from anchors opens it in place — no duplicate.
{
  await addArt('circle', { radius: 90 })
  const before = await snapshot()
  check('scissors setup: one closed circle', before.paths.length === 1 && before.paths[0].closed)
  const c = await page.evaluate(() => {
    const v = (window).__engine__.scope.view
    return v.viewToProject(v.center)
  })
  const h = await histLen()
  // 45° point on the circumference: between two of the four anchors.
  const d = 90 * Math.SQRT1_2
  await clickAt({ x: c.x + d, y: c.y - d })
  const after = await snapshot()
  check('scissors closed: still exactly one path', after.paths.length === 1, JSON.stringify({ n: after.paths.length, msg: await statusMsg() }))
  check('scissors closed: path opened', after.paths[0] && !after.paths[0].closed, await statusMsg())
  check('scissors closed: opened path selected', after.paths[0] && after.paths[0].sel)
  check('scissors closed: Cut Path history', (await histLen()) === h + 1 && (await lastHist()) === 'Cut Path')
  await page.evaluate(() => (window).__engine__.undo())
  const undone = await snapshot()
  check('scissors closed: undo closes it again', undone.paths.length === 1 && undone.paths[0].closed)
}

await clearDocScissors()

// 12. Clicking a closed path's anchor only hints.
{
  await addArt('circle', { radius: 90 })
  const c = await page.evaluate(() => {
    const v = (window).__engine__.scope.view
    return v.viewToProject(v.center)
  })
  const h = await histLen()
  await clickAt({ x: c.x, y: c.y - 90 }) // top anchor
  check('scissors anchor: hint shown', /anchor/i.test(await statusMsg()), await statusMsg())
  check('scissors anchor: no history', (await histLen()) === h)
  const after = await snapshot()
  check('scissors anchor: still closed', after.paths.length === 1 && after.paths[0].closed)
}

await clearDocScissors()

// 13. Open path: a mid-stroke click splits it in two (regression).
{
  await addArt('line')
  const c = await page.evaluate(() => {
    const v = (window).__engine__.scope.view
    return v.viewToProject(v.center)
  })
  const h = await histLen()
  await clickAt({ x: c.x, y: c.y + 260 })
  const after = await snapshot()
  check('scissors open: split into two', after.paths.length === 2, JSON.stringify({ n: after.paths.length, msg: await statusMsg() }))
  check('scissors open: both selected', after.paths.every((p) => p.sel))
  check('scissors open: Cut Path history', (await histLen()) === h + 1 && (await lastHist()) === 'Cut Path', JSON.stringify({ msg: await statusMsg() }))
}

/* ---------- summary ---------- */

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) {
  console.log('FAILED:')
  for (const f of failed) console.log('  - ' + f.name)
  process.exit(1)
}
