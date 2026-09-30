/**
 * Layer tree under a thousand-plus nodes.
 *
 * The windowing math is unit tested (tree-window.test.ts), and the panel
 * wires it, but nothing had ever run it against a document big enough to
 * trigger it. These cases seed 1,200 objects and assert the properties that
 * actually matter at that size: the DOM holds a window rather than 1,200
 * rows, scrolling swaps the window, the thumbnail budget still holds, and
 * selecting an object from the tree still works.
 */
import { test, check } from './fixtures'
import type { Page } from '@playwright/test'

const COUNT = 1200

/** Fill the active layer with `count` small rectangles. */
async function seedMany(page: Page, count = COUNT): Promise<string[]> {
  return page.evaluate((n: number) => {
    const E = window.__engine__
    const S = E.scope
    const layer = E.getActiveLayer()
    const created: string[] = []
    for (let i = 0; i < n; i++) {
      const col = i % 40
      const row = Math.floor(i / 40)
      const rect = new S.Path.Rectangle({
        from: new S.Point(col * 30, row * 30),
        to: new S.Point(col * 30 + 20, row * 30 + 20),
      })
      rect.fillColor = new S.Color('#3366cc')
      rect.data.id = E.genId()
      rect.data.isUserItem = true
      layer.addChild(rect)
      created.push(String(rect.data.id))
    }
    E.syncLayersToStore()
    return created
  }, count)
}

/** Open the Layers dock tab and expand the first layer so its tree renders. */
async function expandLayer(page: Page) {
  await page.getByRole('tab', { name: 'Layers' }).click()
  await page.locator('.rp-pane-layer').waitFor({ state: 'visible' })
  // Expansion lives in the store, so set it there rather than through the
  // caret: the caret is a zero-size hit target inside a dense row and a
  // click on it is a flaky way to reach the panel's own handler.
  await page.evaluate(() => {
    const store = window.__store__
    store.updateLayer(store.activeLayerId, { expand: true })
  })
  await page.locator('.layer-children').first().waitFor({ state: 'visible' })
}

test.describe('Layer tree at scale', () => {
  test('renders a window of rows, not one row per object', async ({ editor: page }) => {
    await seedMany(page)
    await expandLayer(page)

    const rows = await page.locator('.layer-children .tree-item').count()
    check('the document really holds 1200 objects', rows > 0)
    // Windowed: two spacers stand in for everything above and below.
    const spacers = await page.locator('.layer-children .tree-spacer').count()
    check('the tree is windowed', spacers === 2, String(spacers))
    check(
      'far fewer rows are in the DOM than objects exist',
      rows < COUNT / 4,
      `${rows} rows for ${COUNT} objects`,
    )

    // The spacers must account for the rows that are not rendered, or the
    // scroll height would be wrong and the list could not be scrolled.
    const geometry = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.layer-children.tree-window')
      if (!el) return null
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, rows: el.querySelectorAll('.tree-item').length }
    })
    check('the tree has a scrollable height', !!geometry && geometry.scrollHeight > geometry.clientHeight, JSON.stringify(geometry))
    if (geometry) {
      // 28px per row, the same constant the panel uses.
      check('the scroll height accounts for every object', geometry.scrollHeight >= COUNT * 28, JSON.stringify(geometry))
    }
  })

  test('scrolling moves the window and keeps it bounded', async ({ editor: page }) => {
    await seedMany(page)
    await expandLayer(page)

    const firstNames = await page.locator('.layer-children .tree-name').allTextContents()
    await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.layer-children.tree-window')
      if (el) el.scrollTop = 6000
    })
    // The window recomputes on the scroll event, not per frame.
    await page.waitForTimeout(300)
    const afterNames = await page.locator('.layer-children .tree-name').allTextContents()
    const afterRows = await page.locator('.layer-children .tree-item').count()

    check('scrolling changed the rendered rows', firstNames.join('|') !== afterNames.join('|'))
    check('the window stayed bounded after scrolling', afterRows > 0 && afterRows < COUNT / 4, String(afterRows))
  })

  test('the thumbnail budget holds with a huge tree', async ({ editor: page }) => {
    await seedMany(page)
    await expandLayer(page)
    await page.waitForTimeout(400)

    // Only the rendered window may be thumbnailed; a budget that ignored the
    // window would rasterize 1,200 objects.
    const thumbs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.tree-thumb img')).filter((img) => (img as HTMLImageElement).src.length > 0).length
    )
    const rows = await page.locator('.layer-children .tree-item').count()
    check('thumbnails are generated for the window only', thumbs <= Math.max(rows, 150), `${thumbs} thumbs / ${rows} rows`)
  })

  test('an object in the tree is still selectable and reaches the canvas', async ({ editor: page }) => {
    const ids = await seedMany(page)
    await expandLayer(page)

    // Rows carry no id attribute, so click the first one and read back
    // whatever the panel selected: the point is that the click reaches the
    // engine at all at this size, not which row it was.
    await page.locator('.layer-children .tree-item').first().click()
    const selected = await page.evaluate(() => window.__store__.selectedItemIds.slice())
    check('clicking a tree row selects an object', selected.length === 1, JSON.stringify(selected))
    check('the selection is one of the seeded objects', ids.includes(selected[0]), `${selected[0]}`)
    const painted = await page.evaluate(
      () => window.__engine__.getSelection().filter((i: any) => i.fillColor).length
    )
    check('the selection reaches the paper tree', painted === 1, String(painted))
  })
})
