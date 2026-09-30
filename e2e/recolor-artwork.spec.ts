/**
 * Recolor Artwork through the Object menu.
 *
 * The dialog is mostly preview, so what matters is that the preview and the
 * applied result cannot disagree: both read the same mapping. The mapping
 * itself is unit tested in `recolor.test.ts`.
 */
import { test, check, clickMenuItem, seedSelectedRect } from './fixtures'
import type { Page } from '@playwright/test'

/** A second object in a different hue, so there is something to group. */
async function seedTwoHues(page: Page) {
  await seedSelectedRect(page, '#c0392b')
  await page.evaluate(() => {
    const E = window.__engine__
    const S = E.scope
    const c = S.view.viewToProject(S.view.center)
    const rect = new S.Path.Rectangle({
      from: new S.Point(c.x - 40, c.y + 140),
      to: new S.Point(c.x + 40, c.y + 220),
    })
    rect.fillColor = new S.Color('#1f78b4')
    rect.data.id = E.genId()
    rect.data.isUserItem = true
    E.getActiveLayer().addChild(rect)
    E.selectByIds([rect.data.id, E.getSelection()[0].data.id])
    // Close the baseline: seedSelectedRect pushed "Setup" before this rect
    // existed, so without this the undo assertion would restore a snapshot
    // that has one object instead of two.
    E.pushHistory('Setup')
  })
}

/** Selection fills keyed by object id, so comparisons survive reordering. */
const fills = (page: Page) =>
  page.evaluate(() => {
    const out: Record<string, string> = {}
    for (const item of window.__engine__.getSelection()) {
      out[String((item as any).data.id)] = String((item as any).fillColor?.toCSS?.(true) ?? '')
    }
    return out
  })

/**
 * Fills of the given ids, found anywhere in the document. A history restore
 * rebuilds the paper tree and re-selects, so the undo assertion cannot rely
 * on the selection still holding the same two objects.
 */
const fillsByIds = (page: Page, ids: string[]) =>
  page.evaluate((wanted: string[]) => {
    const out: Record<string, string> = {}
    const walk = (item: any) => {
      const id = String(item.data?.id ?? '')
      if (wanted.includes(id)) out[id] = String(item.fillColor?.toCSS?.(true) ?? '')
      for (const child of item.children ?? []) walk(child)
    }
    for (const layer of window.__engine__.project.layers) walk(layer)
    return out
  }, ids)

/** Hue in degrees, or -1 for a gray / unparseable color. */
function hueOf(css: string): number {
  const hex = /^#([0-9a-f]{6})$/i.exec(css.trim())
  let r = 0
  let g = 0
  let b = 0
  if (hex) {
    r = parseInt(hex[1].slice(0, 2), 16)
    g = parseInt(hex[1].slice(2, 4), 16)
    b = parseInt(hex[1].slice(4, 6), 16)
  } else {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css)
    if (!m) return -1
    r = Number(m[1])
    g = Number(m[2])
    b = Number(m[3])
  }
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return -1
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return ((h * 60) + 360) % 360
}

/** The recolored value for the object that started out red. */
const redTarget = (before: Record<string, string>, after: Record<string, string>): string => {
  const redId = Object.keys(before).find((id) => hueOf(before[id]) < 30 && hueOf(before[id]) >= 0) ?? ''
  return after[redId] ?? ''
}

test.describe('Recolor Artwork', () => {
  test('groups the selection colors and applies the theme', async ({ editor: page }) => {
    await seedTwoHues(page)
    const before = await fills(page)
    check('two painted objects to start', Object.keys(before).length === 2, JSON.stringify(before))

    await clickMenuItem(page, 'Object', 'Recolor Artwork...')
    const dialog = page.locator('.el-dialog', { hasText: 'Recolor Artwork' })
    await dialog.waitFor({ state: 'visible' })

    // The preview lists one row per group, each with a source and a target.
    const rows = dialog.locator('.recolor-row')
    check('the preview lists both hue groups', (await rows.count()) === 2, String(await rows.count()))
    const targets = await dialog.locator('.recolor-target').evaluateAll((els) =>
      els.map((e) => getComputedStyle(e).backgroundColor)
    )
    check(
      'every group previews a real target color',
      targets.length === 2 && targets.every((t) => t && t !== 'rgba(0, 0, 0, 0)'),
      JSON.stringify(targets),
    )

    await dialog.getByText('Apply', { exact: true }).click()
    await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Recolor Artwork')

    const after = await fills(page)
    const red = redTarget(before, after)
    // The default theme is Cool, so the red has to land in the blue-green
    // family. The blue is allowed to stay put: that theme color already is
    // the blue, and the mapping keeps each color's own lightness.
    check('the red object was recolored', hueOf(red) > 140 && hueOf(red) < 260, `${red} hue ${hueOf(red)}`)
    check(
      'the blue object kept its own lightness, not a flat theme swatch',
      Object.keys(after).every((id) => after[id] !== ''),
      JSON.stringify(after),
    )
  })

  test('recoloring is one undoable history entry', async ({ editor: page }) => {
    await seedTwoHues(page)
    const ids = Object.keys(await fills(page))
    const before = await fillsByIds(page, ids)

    await clickMenuItem(page, 'Object', 'Recolor Artwork...')
    const dialog = page.locator('.el-dialog', { hasText: 'Recolor Artwork' })
    await dialog.waitFor({ state: 'visible' })
    await dialog.getByText('Apply', { exact: true }).click()
    await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Recolor Artwork')
    check('the artwork actually changed', JSON.stringify(await fillsByIds(page, ids)) !== JSON.stringify(before))

    // Undo walks historyIndex back; the array itself keeps every entry so
    // redo can return to it.
    const index = await page.evaluate(() => window.__engine__.historyIndex)
    await page.evaluate(() => window.__engine__.undo())
    await page.waitForFunction((i) => window.__engine__.historyIndex === i - 1, index)
    const after = await fillsByIds(page, ids)
    check('one undo restores every color', JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after))
  })
})
