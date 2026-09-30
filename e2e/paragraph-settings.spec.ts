/**
 * Paragraph settings on a real area-text frame.
 *
 * The pure layout is unit tested in paragraphs.test.ts; what this adds is
 * that the editor stores the settings, re-lays the frame when they change,
 * reserves the indent out of the frame width instead of overflowing it, and
 * carries the settings into a threaded continuation frame.
 */
import { test, check } from './fixtures'
import type { Page } from '@playwright/test'

/** Seed an area frame with two paragraphs and select it. */
async function seedAreaText(page: Page, raw = 'first paragraph\nsecond paragraph') {
  return page.evaluate((text: string) => {
    const E = window.__engine__
    const S = E.scope
    const c = S.view.viewToProject(S.view.center)
    const item = new S.PointText({
      point: new S.Point(c.x - 150, c.y - 100),
      content: text,
      fontSize: 16,
    })
    item.data.id = E.genId()
    item.data.isUserItem = true
    item.data.textMode = 'area'
    item.data.raw = text
    item.data.align = 'left'
    // What createTextItem writes, so this fixture matches a real frame.
    ;(item.data as any).paragraphs = { firstLineIndent: 0, spaceBefore: 0, spaceAfter: 0 }
    ;(item.data as any).frame = { x: c.x - 150, y: c.y - 100, width: 300, height: 400 }
    E.getActiveLayer().addChild(item)
    E.selectByIds([item.data.id])
    E.pushHistory('Setup')
    return String(item.data.id)
  }, raw)
}

const contentOf = (page: Page) =>
  page.evaluate(() => String(window.__engine__.getSelection()[0]?.content ?? ''))

const paragraphsOf = (page: Page) =>
  page.evaluate(() => JSON.parse(JSON.stringify((window.__engine__.getSelection()[0] as any)?.data?.paragraphs ?? null)))

/** The text controller's view of the frame's paragraph settings. */
const settingsOf = (page: Page) =>
  page.evaluate(() => {
    const E = window.__engine__
    const tc = E.getController('type')
    return tc.paragraphSettings(E.getSelection()[0])
  })

test.describe('Paragraph settings', () => {
  test('default to nothing, and a frame saved without them still reads back clean', async ({ editor: page }) => {
    await seedAreaText(page)
    const stored = await paragraphsOf(page)
    check('a frame carries the paragraph fields', stored !== null, JSON.stringify(stored))
    check('the defaults are zero', stored && stored.firstLineIndent === 0 && stored.spaceBefore === 0, JSON.stringify(stored))
    const viaController = await settingsOf(page)
    check('the controller reads the same values', viaController.firstLineIndent === 0, JSON.stringify(viaController))

    // A document saved before paragraph settings existed has no field at all.
    const legacy = await page.evaluate(() => {
      const E = window.__engine__
      const item = E.getSelection()[0] as any
      delete item.data.paragraphs
      return E.getController('type').paragraphSettings(item)
    })
    check(
      'a frame without the field reads as the defaults',
      legacy.firstLineIndent === 0 && legacy.spaceBefore === 0 && legacy.spaceAfter === 0,
      JSON.stringify(legacy),
    )
  })

  test('an indent re-lays every paragraph without touching the raw text', async ({ editor: page }) => {
    await seedAreaText(page)
    const before = await contentOf(page)
    await page.evaluate(() => {
      const E = window.__engine__
      E.getController('type').setParagraphSettings(E.getSelection()[0], { firstLineIndent: 24, spaceBefore: 0, spaceAfter: 0 })
      E.pushHistory('Paragraph Settings')
    })
    const after = await contentOf(page)
    const lines = after.split('\n')

    check('the rendered content changed', after !== before, JSON.stringify(lines.slice(0, 3)))
    check('both first lines are indented', lines[0].startsWith(' ') && lines[1].startsWith(' '), JSON.stringify(lines))
    // The author's text is untouched: the stored raw has no indent in it.
    const raw = await page.evaluate(() => String((window.__engine__.getSelection()[0] as any).data.raw))
    check('the stored raw keeps no indent spaces', !raw.startsWith(' '), raw)
    // Indenting must not push a line past the frame edge.
    const overflow = await page.evaluate(() => {
      const E = window.__engine__
      return E.getController('type').areaOverflow(E.getSelection()[0])
    })
    check('the indent fits inside the frame', overflow.overflowChars === 0, JSON.stringify(overflow))
  })

  test('paragraph spacing inserts blank lines and is counted as overflow', async ({ editor: page }) => {
    await seedAreaText(page)
    const fits = await page.evaluate(() => {
      const E = window.__engine__
      return E.getController('type').areaOverflow(E.getSelection()[0]).fits
    })
    await page.evaluate(() => {
      const E = window.__engine__
      E.getController('type').setParagraphSettings(E.getSelection()[0], {
        firstLineIndent: 0,
        spaceBefore: 4,
        spaceAfter: 0,
      })
      E.pushHistory('Paragraph Settings')
    })
    const lines = (await contentOf(page)).split('\n')
    check('a blank line precedes the second paragraph', lines[1] === '', JSON.stringify(lines))
    const after = await page.evaluate(() => {
      const E = window.__engine__
      return E.getController('type').areaOverflow(E.getSelection()[0])
    })
    // The spacer line consumes frame space, so the line count grows.
    check('the spacer counts against the frame', after.lines > 2, JSON.stringify(after))
    check('the readout knows how many fit', after.fits === fits, `${after.fits} vs ${fits}`)
  })

  test('the Text panel edits them and records one history entry', async ({ editor: page }) => {
    await seedAreaText(page)
    await page.getByRole('tab', { name: 'Props' }).click()
    const section = page.locator('.property-panel .text-section')
    await section.waitFor({ state: 'visible' })

    const paraRow = section.locator('.prop-row', { hasText: 'Para' }).first()
    const fields = paraRow.locator('input')
    // First-line indent, hanging indent, space before, space after.
    check('the paragraph row has four fields', (await fields.count()) === 4, String(await fields.count()))

    // Type an indent into the first field and commit with Enter.
    await fields.first().fill('24')
    await fields.first().press('Enter')
    await page.waitForFunction(
      () => (window.__engine__.getSelection()[0] as any)?.data?.paragraphs?.firstLineIndent === 24
    )
    const stored = await paragraphsOf(page)
    check('the panel wrote the setting to the item', stored.firstLineIndent === 24, JSON.stringify(stored))
    const history = await page.evaluate(() => window.__engine__.history.at(-1)?.name)
    check('one history entry per change', history === 'Paragraph Settings', String(history))
  })

  test('a threaded continuation frame keeps the settings', async ({ editor: page }) => {
    // A short frame with two paragraphs, so the second overflows. The
    // controller computes the leading from the store's character style, not
    // from the item, so the fixture has to set that too or `fits` comes out
    // larger than the frame really is.
    await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      E.store.updateCharStyle({ fontSize: 16 })
      const c = S.view.viewToProject(S.view.center)
      const text = 'alpha beta\n\ngamma delta epsilon zeta'
      const item = new S.PointText({
        point: new S.Point(c.x - 150, c.y - 100),
        content: text,
        fontSize: 16,
      })
      item.data.id = E.genId()
      item.data.isUserItem = true
      item.data.textMode = 'area'
      item.data.raw = text
      ;(item.data as any).frame = { x: c.x - 150, y: c.y - 100, width: 200, height: 45 }
      E.getActiveLayer().addChild(item)
      E.selectByIds([item.data.id])
      E.pushHistory('Setup')
    })
    await page.evaluate(() => {
      const E = window.__engine__
      E.getController('type').setParagraphSettings(E.getSelection()[0], {
        firstLineIndent: 16,
        spaceBefore: 0,
        spaceAfter: 0,
      })
      E.pushHistory('Paragraph Settings')
    })
    const flowed = await page.evaluate(() => {
      const E = window.__engine__
      const tc = E.getController('type')
      return tc.flowOverflowToNewFrame(E.getSelection()[0])
    })
    check('the overflow flowed to a new frame', flowed === true)

    const both = await page.evaluate(() => {
      const E = window.__engine__
      const tc = E.getController('type')
      const items: any[] = []
      const walk = (it: any) => {
        if (it.data?.textMode === 'area') items.push(it)
        for (const child of it.children ?? []) walk(child)
      }
      for (const layer of E.project.layers) walk(layer)
      return items.map((it) => tc.paragraphSettings(it))
    })
    check('both frames exist', both.length === 2, JSON.stringify(both))
    check('the continuation keeps the indent', both.every((s) => s.firstLineIndent === 16), JSON.stringify(both))
  })
})
