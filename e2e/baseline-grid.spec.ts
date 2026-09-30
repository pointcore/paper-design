/**
 * Baseline grid, end to end: the panel, the drawn lines, the two behaviours
 * and the save/open round trip.
 *
 * The grid is only worth setting because of what it does to type, so the
 * cases here are about a text block's baseline landing on a line, not about
 * the lines existing.
 */
import { test, check } from './fixtures'
import type { Page } from '@playwright/test'

/** Set the baseline grid from the store and redraw. */
async function setGrid(
  page: Page,
  grid: Record<string, unknown>
) {
  return page.evaluate((g) => {
    const E = window.__engine__
    E.store.setBaselineGrid(g)
    E.refreshGrid()
    return { ...E.store.baselineGrid }
  }, grid)
}

/** The grid layer's horizontal lines, as their y positions. */
async function gridLineYs(page: Page) {
  return page.evaluate(() => {
    const E = window.__engine__
    const layer = E.project.layers.find((l: any) => (l.data as any)?.isGridLayer) as any
    if (!layer || !layer.visible) return null
    const ys = new Set<number>()
    for (const child of layer.children ?? []) {
      if (!(child instanceof E.scope.Path)) continue
      const b = child.bounds
      // A horizontal line: much wider than it is tall, and drawn at one y.
      if (b.height < 0.01 && b.width > 1 && child.data?.isBaselineItem) {
        ys.add(Math.round(b.y * 1000) / 1000)
      }
    }
    return Array.from(ys).sort((a, b) => a - b)
  })
}

/** Create a text item at a y, optionally aligning it to the grid. */
async function seedText(page: Page, y: number, fontSize = 20) {
  return page.evaluate(
    ({ at, size }) => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const item = new S.PointText({
        point: new S.Point(c.x - 80, at),
        content: 'Baseline sample',
        fontSize: size,
      })
      item.fillColor = new S.Color('#111111')
      item.data.id = E.genId()
      item.data.isUserItem = true
      E.getActiveLayer().addChild(item)
      const moved = E.alignTextToBaselineGrid(item as any)
      E.scope.view.update()
      return { y: (item as any).point.y, moved, fontSize: size }
    },
    { at: y, size: fontSize },
  )
}

/** The first baseline of a text item, as the grid sees it. */
function baselineOf(y: number, fontSize: number): number {
  return y + fontSize * 0.9
}

test.describe('Baseline grid', () => {
  test('the panel turns it on and draws the lines', async ({ editor: page }) => {
    const before = await gridLineYs(page)
    check('nothing is drawn before it is switched on', before === null, JSON.stringify(before))
    const settings = await setGrid(page, { visible: true, interval: 20, origin: 0 })
    check('the settings took', settings.visible === true && settings.interval === 20, JSON.stringify(settings))
    await page.waitForTimeout(80)
    const ys = await gridLineYs(page)
    check('lines are on the canvas', !!ys && ys.length > 2, JSON.stringify(ys))
    // Every drawn line is a real baseline, and they are all the interval apart.
    const gaps = new Set((ys ?? []).slice(1).map((y, i) => Math.round((y - (ys ?? [])[i]) * 1000) / 1000))
    check('spaced by the interval', gaps.size === 1 && gaps.has(20), JSON.stringify(gaps))
    check('and starting from the origin', (ys ?? [])[0] === 0, JSON.stringify(ys))
  })

  test('changing the interval redraws the lines', async ({ editor: page }) => {
    await setGrid(page, { visible: true, interval: 40, origin: 0 })
    await page.waitForTimeout(80)
    const coarse = await gridLineYs(page)
    await setGrid(page, { visible: true, interval: 10, origin: 0 })
    await page.waitForTimeout(80)
    const fine = await gridLineYs(page)
    check('the coarse grid is drawn', (coarse ?? []).length > 0, JSON.stringify(coarse))
    check('the fine grid has more lines', (fine ?? []).length > (coarse ?? []).length, JSON.stringify({ coarse, fine }))
    for (const y of fine ?? []) expect_ok(y % 10 === 0)
  })

  test('the origin moves the whole grid', async ({ editor: page }) => {
    await setGrid(page, { visible: true, interval: 15, origin: 25 })
    await page.waitForTimeout(80)
    const ys = await gridLineYs(page)
    // The grid runs both ways from the origin, so the first line *in view* is
    // usually below it (25 - 15 = 10 when the viewport starts at 0).
    check('the origin is one of the lines', (ys ?? []).includes(25), JSON.stringify(ys))
    check('and every line sits on the interval from it', (ys ?? []).every((y) => (y - 25) % 15 === 0), JSON.stringify(ys))
  })

  test('align-text puts a text block on the grid', async ({ editor: page }) => {
    await setGrid(page, { visible: true, interval: 16, origin: 0, alignText: true })
    const text = await seedText(page, 100, 20)
    const baseline = baselineOf(text.y, text.fontSize)
    // The block had to move, and its baseline is now on a line.
    check('the text was moved', Math.abs(text.moved) > 0, JSON.stringify(text))
    const offByLine = Math.abs(baseline / 16 - Math.round(baseline / 16)) * 16
    check('its baseline sits on a grid line', offByLine < 0.001, JSON.stringify({ text, baseline, offByLine }))
  })

  test('align-text is off by default, so nothing moves', async ({ editor: page }) => {
    await setGrid(page, { visible: true, interval: 16, origin: 0, alignText: false })
    const text = await seedText(page, 100, 20)
    check('the text stays where it was put', text.moved === 0 && text.y === 100, JSON.stringify(text))
  })

  test('a dragged baseline snaps to the grid', async ({ editor: page }) => {
    await setGrid(page, { visible: false, interval: 10, origin: 0, snap: true })
    const snapped = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const item = new S.PointText({
        point: new S.Point(c.x, c.y + 13),
        content: 'Dragged',
        fontSize: 20,
      })
      item.data.id = E.genId()
      item.data.isUserItem = true
      E.getActiveLayer().addChild(item)
      const svc = (E.getController('select') as any).snapService
      // The grid runs from the origin in 10pt steps, so the placement has to be
      // computed from a real line — the view centre is on no line at all.
      const line = Math.ceil(c.y / 10) * 10
      const offsetForBaseline = (baseline: number) => new S.Point(c.x, baseline - 20 * 0.9)
      // A baseline 1 unit off the line: inside the snap tolerance.
      item.point = offsetForBaseline(line + 1)
      const near = svc.snapTextBaseline(item)
      const nearBaseline = (item as any).point.y + 20 * 0.9 + near.dy
      item.remove()
      // Halfway between two lines is the farthest a position can ever be, and
      // with a 10pt grid the tolerance is capped at half the interval, so this
      // has to be refused rather than always snapping.
      item.point = offsetForBaseline(line + 5)
      const far = svc.snapTextBaseline(item)
      item.remove()
      return { near, nearBaseline, line, far }
    })
    check('a near baseline snaps', snapped.near?.snapped === true, JSON.stringify(snapped))
    check('and the shift lands it exactly on the line', Math.abs(snapped.nearBaseline - snapped.line) < 1e-6, JSON.stringify(snapped))
    check('a far one is left alone', snapped.far?.snapped === false && snapped.far?.dy === 0, JSON.stringify(snapped))
  })

  test('geometry is not pulled onto a typographic grid', async ({ editor: page }) => {
    await setGrid(page, { visible: false, interval: 10, origin: 0, snap: true })
    const out = await page.evaluate(() => {
      const E = window.__engine__
      const svc = (E.getController('select') as any).snapService
      const shape = new E.scope.Path.Rectangle({ from: [0, 0], to: [10, 10] })
      return svc.snapTextBaseline(shape as any)
    })
    check('a shape gets no baseline snap', out?.snapped === false && out?.dy === 0, JSON.stringify(out))
  })

  test('the grid survives save and open', async ({ editor: page }) => {
    await setGrid(page, { visible: true, interval: 13, origin: 7, color: '#ff8800', alignText: true, snap: true })
    const out = await page.evaluate(() => {
      const E = window.__engine__
      const json = E.exportProjectFile() as unknown as string
      // The project file records it, and not as a default.
      const parsed = JSON.parse(json)
      E.store.setBaselineGrid({})
      E.importProjectFile(json)
      return { stored: parsed.baselineGrid, restored: { ...E.store.baselineGrid } }
    })
    check('it is written into the project file', !!out.stored, JSON.stringify(out))
    check('with the values that were set', out.stored?.interval === 13 && out.stored?.origin === 7 && out.stored?.color === '#ff8800', JSON.stringify(out.stored))
    check('and it comes back on open', out.restored.interval === 13 && out.restored.alignText === true && out.restored.snap === true, JSON.stringify(out.restored))
  })

  test('a document that never used the grid does not grow the field', async ({ editor: page }) => {
    const out = await page.evaluate(() => {
      const E = window.__engine__
      E.store.setBaselineGrid({})
      const parsed = JSON.parse(E.exportProjectFile() as unknown as string)
      return { hasField: 'baselineGrid' in parsed && parsed.baselineGrid !== undefined }
    })
    check('the field is omitted when it is the default', out.hasField === false, JSON.stringify(out))
  })

  test('new text lands on the grid when align-text is on', async ({ editor: page }) => {
    await setGrid(page, { visible: true, interval: 12, origin: 0, alignText: true })
    const created = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const tc = E.getController('type') as any
      const c = S.view.viewToProject(S.view.center)
      const item = tc.createTextItem('Created on the grid', new S.Point(c.x, c.y + 37), {
        textMode: 'point',
        raw: 'Created on the grid',
      }, 'Add Text', false)
      return { y: (item as any).point.y, fontSize: (item as any).fontSize }
    })
    const baseline = baselineOf(created.y, created.fontSize)
    const off = Math.abs(baseline / 12 - Math.round(baseline / 12)) * 12
    check('a new text block starts on a baseline', off < 0.001, JSON.stringify({ created, baseline, off }))
  })
})

/** Assert inside a loop without pulling in another import. */
function expect_ok(condition: boolean) {
  if (!condition) throw new Error('a drawn line was off the grid')
}
