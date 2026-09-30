/**
 * Diagonal guides, end to end.
 *
 * The math is unit tested and the domain is covered over a real paper scope;
 * what only a browser can show is that a diagonal guide is grabbable where it
 * is drawn, that dragging it slides it along its own normal instead of
 * chasing the pointer, and that snapping actually lands points on the line.
 */
import { test, check, clickMenuItem, seedSelectedRect } from './fixtures'
import type { Page } from '@playwright/test'

/** Canvas pixel -> document point, through the live view. */
async function docPoint(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ px, py }) => {
      const E = window.__engine__
      const p = E.canvasToScreen(new E.scope.Point(px, py))
      const r = E.canvas.getBoundingClientRect()
      return { x: r.left + p.x, y: r.top + p.y }
    },
    { px: x, py: y },
  )
}

/** Geometry of every guide on the layer, read from the engine. */
interface GuideRow {
  id: string
  orientation: string
  position: number
  cross: number
  angle: number
}

const guideGeometries = (page: Page): Promise<GuideRow[]> =>
  page.evaluate(() => window.__engine__.listGuides())

/** Add a diagonal guide at `angle` degrees through (x, y). */
async function addDiagonal(page: Page, angle: number, x = 0, y = 0) {
  return page.evaluate(
    ({ deg, gx, gy }) => {
      const E = window.__engine__
      const guide = E.createGuide(gx, 'diagonal', { angle: deg, y: gy })
      E.pushHistory('Add Guide')
      return guide ? String(guide.data.guideId) : ''
    },
    { deg: angle, gx: x, gy: y },
  )
}

test.describe('Diagonal guides', () => {
  test('are created at an angle, listed, and can be re-angled', async ({ editor: page }) => {
    const id = await addDiagonal(page, 30)
    check('the guide was created', id !== '')

    const listed = await guideGeometries(page)
    const row = listed.find((g) => g.id === id)
    check('the guide is listed as diagonal', row?.orientation === 'diagonal', JSON.stringify(listed))
    // 30 degrees is stored canonically as 30.
    check('the angle survived creation', Math.abs((row?.angle ?? 0) - 30) < 0.01, String(row?.angle))
    check('the anchor is where it was created', row?.position === 0 && row?.cross === 0, JSON.stringify(row))

    await page.evaluate((guideId) => {
      window.__engine__.updateGuideById(guideId, { angle: -45 })
      window.__engine__.pushHistory('Move Guide')
    }, id)
    const after = (await guideGeometries(page)).find((g) => g.id === id)
    // -45 canonicalizes to 135.
    check('re-angling the guide takes', Math.abs((after?.angle ?? 0) - 135) < 0.01, String(after?.angle))
  })

  test('dragging artwork snaps the pointer onto the diagonal', async ({ editor: page }) => {
    await page.evaluate(() => {
      const S = window.__store__
      S.updateView({ showGuides: true })
      // Only the guide may win: grid, anchors and smart alignment all off, or
      // a grid crossing can take the same pixel and the assertion below would
      // pass for the wrong reason.
      S.updateSnap({ enable: true, guides: true, grid: false, point: false, smartGuides: false })
    })
    await seedSelectedRect(page, '#3366cc')
    // A 45-degree guide through the middle of the rect, not through the
    // document origin: the seeded artwork sits at the view center, and a
    // guide through (0, 0) can be hundreds of units away from it.
    const center = await page.evaluate(() => {
      const b = window.__engine__.getSelection()[0].bounds
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    })
    await addDiagonal(page, 45, center.x, center.y)

    // Grab the middle of the rect and drop it a few units off the line.
    const before = await page.evaluate(() => {
      const b = window.__engine__.getSelection()[0].bounds
      return { x: b.x, y: b.y, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }
    })
    const from = await docPoint(page, before.cx, before.cy)
    const to = await docPoint(page, before.cx + 6, before.cy)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 6 })
    await page.mouse.up()

    // The drag moves the item by (snapped pointer - pointer at grab), so the
    // snapped pointer can be recovered from the item's new position.
    const after = await page.evaluate(() => {
      const b = window.__engine__.getSelection()[0].bounds
      return { x: b.x, y: b.y }
    })
    const snapped = {
      x: after.x - before.x + before.cx,
      y: after.y - before.y + before.cy,
    }
    // A 45-degree line through the rect's centre: x - y is constant on it,
    // and equal to the centre's own x - y.
    const lineOffset = center.x - center.y
    check(
      'the pointer was pulled onto the guide',
      Math.abs(snapped.x - snapped.y - lineOffset) < 0.001,
      `snapped pointer (${snapped.x}, ${snapped.y}), line at ${lineOffset}`,
    )
    // And it was not already there: the raw drop was 6 units off the line.
    check(
      'the snap actually moved the artwork',
      Math.abs(snapped.x - before.cx - 6) > 1,
      JSON.stringify(snapped),
    )
  })

  test('a diagonal guide drags along its own normal', async ({ editor: page }) => {
    await page.evaluate(() => {
      const S = window.__store__
      S.updateView({ showGuides: true, guidesLocked: false })
      S.updateSnap({ enable: false })
    })
    await addDiagonal(page, 45)

    // Grab the guide where it crosses the visible area and drag straight
    // down the screen: for a 45-degree line that is along its normal.
    const start = await docPoint(page, 200, 200)
    const end = await docPoint(page, 200, 300)

    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 8 })
    await page.mouse.up()

    const guides = await guideGeometries(page)
    const guide = guides[guides.length - 1]
    check('the guide is still one guide', guides.length === 1, JSON.stringify(guides))
    // Slid along (-1, 1) by the drag, so the anchor keeps x + y == 0.
    check(
      'the anchor moved along the normal only',
      Math.abs((guide?.position ?? 0) + (guide?.cross ?? 0)) < 1e-6,
      JSON.stringify(guide),
    )
    check('the guide actually moved', (guide?.cross ?? 0) > 1, JSON.stringify(guide))
    const history = await page.evaluate(() => window.__engine__.history.at(-1)?.name)
    check('the drag is one history entry', history === 'Move Guide', String(history))
  })

  test('the Guides dialog creates one from an angle', async ({ editor: page }) => {
    // Guides ship locked, and a locked layer refuses new guides.
    await page.evaluate(() => window.__store__.updateView({ showGuides: true, guidesLocked: false }))
    await clickMenuItem(page, 'View', 'Guides...')
    const dialog = page.locator('.el-dialog', { hasText: 'Guides' })
    await dialog.waitFor({ state: 'visible' })

    await dialog.locator('.setting-row', { hasText: 'Diagonal' }).getByText('Add', { exact: true }).click()
    await page.waitForTimeout(150)

    const guides = await guideGeometries(page)
    check('the dialog added a diagonal guide', guides.some((g) => g.orientation === 'diagonal'), JSON.stringify(guides))
    const diagonal = guides.find((g) => g.orientation === 'diagonal')
    // Added at the default 45 degrees through the active board's center.
    check('the angle is the dialog default', Math.abs((diagonal?.angle ?? 0) - 45) < 0.01, String(diagonal?.angle))
    const history = await page.evaluate(() => window.__engine__.history.at(-1)?.name)
    check('adding a guide is one history entry', history === 'Add Guide', String(history))
  })

  test('a locked guide layer refuses new guides', async ({ editor: page }) => {
    await page.evaluate(() => window.__store__.updateView({ showGuides: true, guidesLocked: true }))
    await clickMenuItem(page, 'View', 'Guides...')
    const dialog = page.locator('.el-dialog', { hasText: 'Guides' })
    await dialog.waitFor({ state: 'visible' })
    await dialog.locator('.setting-row', { hasText: 'Diagonal' }).getByText('Add', { exact: true }).click()
    await page.waitForTimeout(150)
    const guides = await guideGeometries(page)
    check('nothing was added while locked', guides.length === 0, JSON.stringify(guides))
    const message = await page.evaluate(() => window.__store__.statusMessage)
    check('the user is told why', String(message).includes('locked'), String(message))
  })
})
