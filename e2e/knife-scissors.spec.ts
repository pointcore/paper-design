/**
 * Real-browser acceptance for the Knife tool and the scissors closed-path
 * fix, driven through the dev-only `__engine__` / `__store__` hooks that
 * CanvasHost exposes in DEV builds. Geometry is asserted through the paper
 * project, while the cut gestures themselves are real mouse drags on the
 * canvas so the controller's tool handlers run exactly as a user's would.
 *
 * One test per scenario rather than one long script: these cases mutate the
 * same document, so a single early failure used to abort the remaining 40
 * checks and hide which regressions were real.
 */
import { test, check } from './fixtures'

interface Pt {
  x: number
  y: number
}

interface PathInfo {
  layer: string
  inGroup: boolean
  closed: boolean
  sel: boolean
  grad: boolean
  x: number
  y: number
  w: number
  h: number
}

interface DocSnapshot {
  paths: PathInfo[]
  compounds: number
  texts: number
}

type ArtKind =
  | 'rect'
  | 'zigzag'
  | 'ellipseInGroup'
  | 'ellipse2'
  | 'compound'
  | 'text'
  | 'clipGroup'
  | 'gradientRect'
  | 'lockedLayerRect'
  | 'hiddenLayerRect'
  | 'circle'
  | 'line'

/** Wait for the canvas box to settle; it keeps resizing after mount. */
async function waitForCanvasSettled(page: any) {
  let prev = ''
  for (let i = 0; i < 30; i++) {
    const cur = await page.evaluate(() => {
      const r = window.__engine__.canvas.getBoundingClientRect()
      return [r.left, r.top, r.width, r.height].join(',')
    })
    if (cur === prev && cur !== '') return
    prev = cur
    await page.waitForTimeout(100)
  }
}

/** Paper project coords -> page coords, using the view's own matrix. */
async function projToPage(page: any, pt: Pt) {
  return page.evaluate(({ x, y }: Pt) => {
    const E = window.__engine__
    const v = E.scope.view.projectToView(new E.scope.Point(x, y))
    const r = E.canvas.getBoundingClientRect()
    return { x: r.left + v.x, y: r.top + v.y }
  }, { x: pt.x, y: pt.y })
}

async function dragLine(page: any, p1: Pt, p2: Pt, steps = 10) {
  const a = await projToPage(page, p1)
  const b = await projToPage(page, p2)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps)
  }
  await page.mouse.up()
}

async function clickAt(page: any, pt: Pt) {
  const a = await projToPage(page, pt)
  await page.mouse.click(a.x, a.y)
}

/** Fresh canvas: strip user artwork and extra user layers, keep "Layer 1". */
async function clearDoc(page: any, tool: 'knife' | 'scissors' = 'knife') {
  await page.evaluate((t: 'knife' | 'scissors') => {
    const E = window.__engine__
    const keep = E.project.layers.find((l: any) => l.data?.isUserLayer)
    for (const layer of [...E.project.layers]) {
      if (!layer.data?.isUserLayer) continue
      if (layer !== keep) E.deleteLayer(layer.data.layerId)
      for (const child of [...layer.children]) child.remove()
    }
    if (keep) keep.activate()
    E.clearSelection()
    E.setTool(t)
  }, tool)
}

const histLen = (page: any) => page.evaluate(() => window.__engine__.history.length)
const lastHist = (page: any) =>
  page.evaluate(() => {
    const E = window.__engine__
    const last = E.history[E.history.length - 1]
    return last ? last.name : null
  })
const statusMsg = (page: any) => page.evaluate(() => window.__store__.statusMessage)
const overlayCount = (page: any) =>
  page.evaluate(() => window.__engine__.getOverlayLayer().children.length)
const viewCenter = (page: any) =>
  page.evaluate(() => {
    const v = window.__engine__.scope.view
    return v.viewToProject(v.center)
  })

/**
 * Every plain path on user layers (recursing into plain groups), plus the
 * counts of non-path user items (compound paths, text) that must not change.
 */
async function snapshot(page: any): Promise<DocSnapshot> {
  return page.evaluate(() => {
    const E = window.__engine__
    const S = E.scope
    const paths: unknown[] = []
    let compounds = 0
    let texts = 0
    const walk = (it: any, layerName: string, nested = false) => {
      if (it instanceof S.Group) {
        // paper Layers extend Group; only real sub-groups count as nested.
        for (const c of it.children) walk(c, layerName, !(it instanceof S.Layer))
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
    return { paths, compounds, texts } as never
  })
}

/** Add tagged test artwork, mirroring real user content (painted, one history entry). */
async function addArt(page: any, kind: ArtKind, opts: Record<string, number> = {}) {
  await page.evaluate(
    ({ kind, opts }: { kind: ArtKind; opts: Record<string, number> }) => {
      const E = window.__engine__
      const S = E.scope
      const c = E.scope.view.viewToProject(E.scope.view.center)
      const tag = (item: any) => {
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
      const put = (item: any) => {
        L.addChild(item)
        return item
      }
      switch (kind) {
        case 'rect':
          return put(
            tag(
              new S.Path.Rectangle({
                from: new S.Point(c.x - 100, c.y - 100),
                to: new S.Point(c.x + 100, c.y + 100),
              }),
            ),
          )
        case 'zigzag':
          // Open path crossing the horizontal line through c twice.
          return put(
            tag(
              new S.Path({
                segments: [
                  [c.x - 160, c.y - 100],
                  [c.x - 60, c.y - 100],
                  [c.x - 60, c.y + 100],
                  [c.x + 60, c.y + 100],
                  [c.x + 60, c.y - 100],
                ],
                closed: false,
              }),
            ),
          )
        case 'ellipseInGroup': {
          const el = tag(
            new S.Path.Ellipse({
              center: new S.Point(c.x + 250, c.y),
              size: new S.Size(160, 120),
            }),
          )
          const g = tag(new S.Group({ children: [el] }))
          L.addChild(g)
          return g
        }
        case 'ellipse2':
          return put(
            tag(
              new S.Path.Ellipse({
                center: new S.Point(c.x - 250, c.y),
                size: new S.Size(160, 120),
              }),
            ),
          )
        case 'compound': {
          const cp = tag(
            new S.CompoundPath({
              children: [
                new S.Path.Circle({ center: new S.Point(c.x + 450, c.y), radius: 70 }),
                new S.Path.Circle({ center: new S.Point(c.x + 450, c.y), radius: 35 }),
              ],
            }),
          )
          L.addChild(cp)
          return cp
        }
        case 'text': {
          const t = tag(
            new S.PointText({
              point: new S.Point(c.x - 460, c.y - 120),
              content: 'KNIFE',
              fontFamily: 'sans-serif',
              fontSize: 32,
              fillColor: 'black',
            }),
          )
          t.data.textMode = 'point'
          L.addChild(t)
          return t
        }
        case 'clipGroup': {
          const clip = new S.Path.Circle({ center: new S.Point(c.x - 450, c.y + 150), radius: 60 })
          const art = tag(
            new S.Path.Rectangle({
              from: new S.Point(c.x - 520, c.y + 80),
              to: new S.Point(c.x - 380, c.y + 220),
            }),
          )
          const g = tag(new S.Group({ children: [clip, art] }))
          g.clipped = true
          L.addChild(g)
          return g
        }
        case 'gradientRect': {
          const r = tag(
            new S.Path.Rectangle({
              from: new S.Point(c.x + 150, c.y - 260),
              to: new S.Point(c.x + 350, c.y - 100),
            }),
          )
          r.fillColor = {
            gradient: { stops: [new S.Color('red'), new S.Color('blue')] },
            origin: r.bounds.topLeft,
            destination: r.bounds.bottomRight,
          }
          return put(r)
        }
        case 'lockedLayerRect': {
          const layer = E.createLayer('E2E Locked')
          const r = tag(
            new S.Path.Rectangle({
              from: new S.Point(c.x - 200, c.y + 120),
              to: new S.Point(c.x - 40, c.y + 240),
            }),
          )
          layer.addChild(r)
          E.setUserLayerLocked(layer.data.layerId, true)
          L.activate()
          return r
        }
        case 'hiddenLayerRect': {
          const layer = E.createLayer('E2E Hidden')
          const r = tag(
            new S.Path.Rectangle({
              from: new S.Point(c.x + 40, c.y + 120),
              to: new S.Point(c.x + 200, c.y + 240),
            }),
          )
          layer.addChild(r)
          E.setUserLayerVisible(layer.data.layerId, false)
          L.activate()
          return r
        }
        case 'circle':
          return put(
            tag(new S.Path.Circle({ center: new S.Point(c.x, c.y), radius: opts.radius ?? 90 })),
          )
        case 'line':
          return put(
            tag(
              new S.Path({
                segments: [
                  [c.x - 120, c.y + 260],
                  [c.x + 120, c.y + 260],
                ],
                closed: false,
              }),
            ),
          )
        default:
          throw new Error('unknown kind ' + kind)
      }
    },
    { kind, opts },
  )
  // Mirror real usage: drawing a shape commits one history entry, so undoing
  // a later cut lands on the intact artwork instead of an empty document.
  await page.evaluate(() => window.__engine__.pushHistory('Add Test Art'))
}

test.describe('Knife tool', () => {
  test.beforeEach(async ({ editor: page }) => {
    await waitForCanvasSettled(page)
    await clearDoc(page, 'knife')
  })

  test('a closed rect with one crossing splits into exactly two open pieces', async ({ editor: page }) => {
    await addArt(page, 'rect')
    const before = await snapshot(page)
    check('setup: one closed rect', before.paths.length === 1 && before.paths[0].closed)

    const c = await viewCenter(page)
    const h0 = await histLen(page)
    await dragLine(page, { x: c.x - 160, y: c.y }, { x: c.x + 160, y: c.y })

    const after = await snapshot(page)
    check('knife rect: 2 pieces, no duplicate', after.paths.length === 2, JSON.stringify(after.paths.length))
    check('knife rect: pieces open', after.paths.every((p) => !p.closed))
    check('knife rect: both selected', after.paths.every((p) => p.sel))
    check('knife rect: one Knife history entry', (await histLen(page)) === h0 + 1 && (await lastHist(page)) === 'Knife')

    await page.evaluate(() => window.__engine__.undo())
    const undone = await snapshot(page)
    check(
      'knife rect: undo restores closed rect',
      undone.paths.length === 1 && undone.paths[0].closed,
      JSON.stringify(undone.paths),
    )
    await page.evaluate(() => window.__engine__.redo())
    check('knife rect: redo re-splits', (await snapshot(page)).paths.length === 2)
  })

  test('an open path crossed twice yields three pieces', async ({ editor: page }) => {
    await addArt(page, 'zigzag')
    const c = await viewCenter(page)
    await dragLine(page, { x: c.x - 200, y: c.y }, { x: c.x + 200, y: c.y })
    const after = await snapshot(page)
    check('knife zigzag: 2 crossings -> 3 pieces', after.paths.length === 3, JSON.stringify(after.paths.length))
  })

  test('one line slices several shapes, including one inside a group', async ({ editor: page }) => {
    await addArt(page, 'rect')
    await addArt(page, 'ellipseInGroup')
    await addArt(page, 'ellipse2')
    const c = await viewCenter(page)
    // 30px above center so the line crosses the rect mid-side and both
    // ellipses on non-cardinal chords (a center-height line would hit the
    // ellipses' 0/180 anchors, which the seam guard correctly refuses).
    await dragLine(page, { x: c.x - 450, y: c.y - 30 }, { x: c.x + 450, y: c.y - 30 })
    const after = await snapshot(page)
    check('knife multi: 6 pieces across 3 shapes', after.paths.length === 6, JSON.stringify(after.paths.length))
    check(
      'knife multi: grouped ellipse cut inside its group',
      after.paths.filter((p) => p.inGroup).length === 2,
    )
  })

  test('re-cutting along an existing seam is a no-op', async ({ editor: page }) => {
    await addArt(page, 'rect')
    const c = await viewCenter(page)
    await dragLine(page, { x: c.x, y: c.y - 160 }, { x: c.x, y: c.y + 160 })
    const once = await snapshot(page)
    const h = await histLen(page)
    await dragLine(page, { x: c.x, y: c.y - 160 }, { x: c.x, y: c.y + 160 })
    const twice = await snapshot(page)
    check(
      'knife seam: second cut adds no pieces',
      twice.paths.length === once.paths.length,
      JSON.stringify(twice.paths.length),
    )
    check('knife seam: second cut adds no history', (await histLen(page)) === h)
    check('knife seam: status hints at the gesture', (await statusMsg(page)).length > 0, await statusMsg(page))
  })

  test('compound paths, text and clip-mask contents are skipped', async ({ editor: page }) => {
    await addArt(page, 'compound')
    await addArt(page, 'text')
    await addArt(page, 'clipGroup')
    await addArt(page, 'rect')
    const before = await snapshot(page)
    const c = await viewCenter(page)
    await dragLine(page, { x: c.x - 550, y: c.y - 60 }, { x: c.x + 550, y: c.y - 60 })
    const after = await snapshot(page)
    check('knife skip: compound not torn apart', after.compounds === before.compounds)
    check('knife skip: text untouched', after.texts === before.texts)
    // Only the plain rect is crossed: 1 -> 2. Clip-group art stays whole.
    check(
      'knife skip: only the plain rect was cut',
      after.paths.length === before.paths.length + 1,
      JSON.stringify({ b: before.paths.length, a: after.paths.length }),
    )
  })

  test('locked and hidden layers are skipped', async ({ editor: page }) => {
    await addArt(page, 'lockedLayerRect')
    await addArt(page, 'hiddenLayerRect')
    await addArt(page, 'rect')
    const c = await viewCenter(page)
    await dragLine(page, { x: c.x - 550, y: c.y + 180 }, { x: c.x + 550, y: c.y + 180 })
    // That line misses the center rect; a second pass covers everything.
    await dragLine(page, { x: c.x - 550, y: c.y }, { x: c.x + 550, y: c.y })
    const after = await snapshot(page)
    const locked = after.paths.filter((p) => p.layer === 'E2E Locked')
    const hidden = after.paths.filter((p) => p.layer === 'E2E Hidden')
    const main = after.paths.filter((p) => p.layer === 'Layer 1')
    check('knife skip: locked layer untouched', locked.length === 1 && locked[0].closed)
    check('knife skip: hidden layer untouched', hidden.length === 1 && hidden[0].closed)
    check('knife skip: main rect still cut', main.length === 2)
  })

  test('Escape mid-drag drops the preview and changes nothing', async ({ editor: page }) => {
    await addArt(page, 'rect')
    const before = await snapshot(page)
    const c = await viewCenter(page)
    const h = await histLen(page)
    const a = await projToPage(page, { x: c.x - 160, y: c.y })
    const b = await projToPage(page, { x: c.x + 160, y: c.y })

    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
    check('knife escape: preview line visible', (await overlayCount(page)) === 1)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    check('knife escape: preview removed', (await overlayCount(page)) === 0)
    check('knife escape: no history entry', (await histLen(page)) === h)
    const after = await snapshot(page)
    check(
      'knife escape: artwork unchanged',
      after.paths.length === before.paths.length && after.paths[0].closed,
    )
  })

  test('switching tools mid-drag cleans up via deactivate()', async ({ editor: page }) => {
    await addArt(page, 'rect')
    const c = await viewCenter(page)
    const h = await histLen(page)
    const a = await projToPage(page, { x: c.x - 160, y: c.y })
    const b = await projToPage(page, { x: c.x + 160, y: c.y })

    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 })
    await page.evaluate(() => window.__engine__.setTool('select'))
    await page.mouse.up()
    check('knife deactivate: preview removed', (await overlayCount(page)) === 0)
    check('knife deactivate: no history entry', (await histLen(page)) === h)
  })

  test('right-button drags are no-ops and a plain click only hints', async ({ editor: page }) => {
    await addArt(page, 'rect')
    const before = await snapshot(page)
    const c = await viewCenter(page)
    const h = await histLen(page)
    const a = await projToPage(page, { x: c.x - 160, y: c.y })
    const b = await projToPage(page, { x: c.x + 160, y: c.y })

    await page.mouse.move(a.x, a.y)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(b.x, b.y, { steps: 5 })
    await page.mouse.up({ button: 'right' })
    check('knife right-drag: no history', (await histLen(page)) === h)
    check(
      'knife right-drag: artwork unchanged',
      (await snapshot(page)).paths.length === before.paths.length,
    )

    await clickAt(page, { x: c.x, y: c.y - 250 })
    check('knife click: status hint shown', /drag/i.test(await statusMsg(page)), await statusMsg(page))
    check('knife click: no history', (await histLen(page)) === h)
    check('knife click: no leftover preview', (await overlayCount(page)) === 0)
  })

  test('gradient fills follow their pieces', async ({ editor: page }) => {
    await addArt(page, 'gradientRect')
    const c = await viewCenter(page)
    await dragLine(page, { x: c.x + 250, y: c.y - 300 }, { x: c.x + 250, y: c.y + 50 })
    const after = await snapshot(page)
    check('knife gradient: cut into 2', after.paths.length === 2, JSON.stringify(after.paths.length))
    check('knife gradient: both pieces keep a gradient', after.paths.length === 2 && after.paths.every((p) => p.grad))
  })
})

test.describe('Scissors tool', () => {
  test.beforeEach(async ({ editor: page }) => {
    await waitForCanvasSettled(page)
    await clearDoc(page, 'scissors')
  })

  test('clicking away from anchors opens a closed path in place', async ({ editor: page }) => {
    await addArt(page, 'circle', { radius: 90 })
    const before = await snapshot(page)
    check('scissors setup: one closed circle', before.paths.length === 1 && before.paths[0].closed)

    const c = await viewCenter(page)
    const h = await histLen(page)
    // 45-degree point on the circumference: between two of the four anchors.
    const d = 90 * Math.SQRT1_2
    await clickAt(page, { x: c.x + d, y: c.y - d })

    const after = await snapshot(page)
    check('scissors closed: still exactly one path', after.paths.length === 1, await statusMsg(page))
    check('scissors closed: path opened', !!after.paths[0] && !after.paths[0].closed, await statusMsg(page))
    check('scissors closed: opened path selected', !!after.paths[0] && after.paths[0].sel)
    check(
      'scissors closed: Cut Path history',
      (await histLen(page)) === h + 1 && (await lastHist(page)) === 'Cut Path',
    )
    await page.evaluate(() => window.__engine__.undo())
    const undone = await snapshot(page)
    check('scissors closed: undo closes it again', undone.paths.length === 1 && undone.paths[0].closed)
  })

  test("clicking a closed path's anchor only hints", async ({ editor: page }) => {
    await addArt(page, 'circle', { radius: 90 })
    const c = await viewCenter(page)
    const h = await histLen(page)
    await clickAt(page, { x: c.x, y: c.y - 90 }) // top anchor
    check('scissors anchor: hint shown', /anchor/i.test(await statusMsg(page)), await statusMsg(page))
    check('scissors anchor: no history', (await histLen(page)) === h)
    const after = await snapshot(page)
    check('scissors anchor: still closed', after.paths.length === 1 && after.paths[0].closed)
  })

  test('a mid-stroke click splits an open path in two', async ({ editor: page }) => {
    await addArt(page, 'line')
    const c = await viewCenter(page)
    const h = await histLen(page)
    await clickAt(page, { x: c.x, y: c.y + 260 })
    const after = await snapshot(page)
    check('scissors open: split into two', after.paths.length === 2, await statusMsg(page))
    check('scissors open: both selected', after.paths.every((p) => p.sel))
    check(
      'scissors open: Cut Path history',
      (await histLen(page)) === h + 1 && (await lastHist(page)) === 'Cut Path',
      await statusMsg(page),
    )
  })
})
