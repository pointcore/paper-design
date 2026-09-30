/**
 * Tool rail icons and per-tool canvas cursors.
 *
 * Both are pure presentation, which is exactly why they rot silently: a tool
 * that falls back to an emoji glyph, or a cursor that degrades to a plain
 * crosshair, still "works" — the tool still draws — so no unit test of the
 * controllers ever notices. The assertions here read the live DOM and the
 * canvas element's inline cursor, which is the only place either value ends
 * up.
 *
 * The cursor expectations are AI/CDR conventions, not taste: the shape tools
 * get a plain crosshair there, the size-based paint tools get a precision
 * ring sized to their footprint, and everything that has a recognizable
 * silhouette (scissors, knife, wand, lasso, eyedropper, gradient, ...) gets
 * that silhouette as its cursor.
 */
import { test, check, expect } from './fixtures'

/** How a tool's cursor is expected to arrive on the canvas. */
type CursorKind = 'default' | 'text' | 'grab' | 'crosshair' | 'svg'

/** tool -> how to reach it: a keyboard shortcut, or a rail flyout label. */
const TOOLS: Record<string, { key?: string; label?: string; kind: CursorKind }> = {
  select: { key: 'v', kind: 'default' },
  'direct-select': { key: 'a', kind: 'svg' },
  lasso: { key: 'q', kind: 'svg' },
  wand: { key: 'y', kind: 'svg' },
  'free-transform': { key: 'Shift+f', kind: 'svg' },

  pen: { key: 'p', kind: 'svg' },
  curvature: { key: '~', kind: 'svg' },
  'add-anchor': { key: '+', kind: 'svg' },
  'delete-anchor': { key: '-', kind: 'svg' },
  'convert-anchor': { key: 'Shift+c', kind: 'svg' },

  type: { key: 't', kind: 'text' },

  line: { key: '\\', kind: 'crosshair' },
  rect: { key: 'r', kind: 'crosshair' },
  ellipse: { key: 'l', kind: 'crosshair' },

  pencil: { key: 'n', kind: 'svg' },
  'blob-brush': { key: 'Shift+b', kind: 'svg' },
  brush: { key: 'b', kind: 'svg' },
  eraser: { key: 'Shift+E', kind: 'svg' },
  spray: { label: 'spray', kind: 'svg' },

  scissors: { key: 'c', kind: 'svg' },
  knife: { key: 'k', kind: 'svg' },
  'shape-builder': { key: 'Shift+m', kind: 'svg' },
  width: { key: 'Shift+w', kind: 'svg' },
  reshape: { label: 'reshape', kind: 'svg' },
  smooth: { label: 'smooth', kind: 'svg' },
  gradient: { key: 'g', kind: 'svg' },
  eyedropper: { key: 'i', kind: 'svg' },
  'perspective-grid': { key: 'Shift+p', kind: 'svg' },

  rotate: { key: 'Shift+r', kind: 'svg' },
  scale: { key: 'Shift+s', kind: 'svg' },
  mirror: { key: 'Shift+o', kind: 'svg' },

  callout: { label: 'callout', kind: 'crosshair' },
  measure: { label: 'measure', kind: 'crosshair' },

  'view-hand': { key: 'h', kind: 'grab' },
  zoom: { key: 'z', kind: 'svg' },
}

const isSvgCursor = (v: string) => v.startsWith('url("data:image/svg+xml,')

test.describe('Tool rail', () => {
  test('every tool button draws the shared SVG icon set, not an emoji glyph', async ({ editor: page }) => {
    const rail = page.locator('.tool-rail')
    await expect(rail).toBeVisible()

    // Walk every group: its collapsed main button, then its flyout.
    const groups = rail.locator('.group-main')
    const groupCount = await groups.count()
    check('the rail has tool groups', groupCount > 5, String(groupCount))

    const glyphFallbacks: string[] = []
    const emptyIcons: string[] = []
    for (let i = 0; i < groupCount; i++) {
      const name = (await groups.nth(i).getAttribute('title')) ?? `#${i}`
      const icon = groups.nth(i).locator('svg.tool-icon-svg')
      if ((await icon.count()) === 0) glyphFallbacks.push(name)
      // An <svg> with no geometry renders as a blank button.
      else if (((await icon.innerHTML()) ?? '').trim() === '') emptyIcons.push(name)

      await groups.nth(i).click({ button: 'right' })
      // The flyout is teleported to <body> (the rail is a scroll container and
      // would clip it), so it is not a descendant of the rail.
      const flyout = page.locator('body > .flyout')
      await expect(flyout).toBeVisible()
      const items = flyout.locator('.flyout-item')
      const itemCount = await items.count()
      check(`group ${name} opens a flyout`, itemCount > 0, String(itemCount))
      for (let k = 0; k < itemCount; k++) {
        const label = ((await items.nth(k).textContent()) ?? '').trim()
        const itemIcon = items.nth(k).locator('svg.tool-icon-svg')
        if ((await itemIcon.count()) === 0) glyphFallbacks.push(`${name} > ${label}`)
        else if (((await itemIcon.innerHTML()) ?? '').trim() === '') emptyIcons.push(`${name} > ${label}`)
      }
      await page.keyboard.press('Escape')
    }

    check('no tool falls back to an emoji glyph', glyphFallbacks.length === 0, glyphFallbacks.join(', '))
    check('no tool icon is empty geometry', emptyIcons.length === 0, emptyIcons.join(', '))
  })

  test('the search box expands on focus instead of collapsing to nothing', async ({ editor: page }) => {
    // The 48px rail leaves the el-input about 39px, which fits neither the
    // magnifier prefix nor a typed query, so the filter was unusable. It now
    // shows the icon at rest and floats open on focus.
    const input = page.locator('.rail-search .el-input')
    await expect(input).toBeVisible()

    const restWidth = (await input.boundingBox())?.width ?? 0
    await input.click()
    await page.waitForTimeout(250) // the 0.15s width transition
    const focusWidth = (await input.boundingBox())?.width ?? 0
    check('the search box widens on focus', focusWidth > restWidth + 40, `${restWidth} -> ${focusWidth}`)

    // And it actually filters: "grid" matches the two grid tools plus the
    // Perspective Grid tool. The two rail utilities (density, settings) are
    // not tools, so they are counted out.
    await page.keyboard.type('grid')
    await page.waitForTimeout(200)
    const shown = await page
      .locator('.tool-rail .tool-item:not([title*="column"]):not([title="Canvas Settings"])')
      .allTextContents()
    check('typing filters the rail', shown.length === 3, JSON.stringify(shown))
  })
})

test.describe('Per-tool cursors', () => {
  test('each tool puts its own cursor on the canvas', async ({ editor: page }) => {
    const canvas = page.locator('canvas.main-canvas').first()
    await expect(canvas).toBeVisible()

    const wrong: string[] = []
    for (const [tool, spec] of Object.entries(TOOLS)) {
      if (spec.key) {
        await page.keyboard.press(spec.key)
      } else {
        // Flyout-only tool: right-click each group until the one holding it
        // opens, then click the item by its label.
        const groups = page.locator('.tool-rail .group-main')
        const groupCount = await groups.count()
        let picked = false
        for (let i = 0; i < groupCount && !picked; i++) {
          await groups.nth(i).click({ button: 'right' })
          const item = page.locator('.flyout-item', { hasText: spec.label! }).first()
          if (await item.count()) {
            await item.click()
            picked = true
          } else {
            await page.keyboard.press('Escape')
          }
        }
        if (!picked) {
          wrong.push(`${tool}: no flyout item`)
          continue
        }
      }
      await page.waitForTimeout(120)

      const cursor = await canvas.evaluate((el) => el.style.cursor)
      const native = ['default', 'text', 'grab', 'crosshair'].includes(cursor)
      const actual = isSvgCursor(cursor) ? 'svg' : native ? cursor : 'other'
      if (actual !== spec.kind) wrong.push(`${tool}: expected ${spec.kind}, got ${cursor.slice(0, 40)}`)

      const active = await page.evaluate(() => window.__store__.tool)
      if (active !== tool) wrong.push(`${tool}: shortcut activated "${active}" instead`)
    }
    check('every tool shows its documented cursor', wrong.length === 0, wrong.join(' | '))
  })

  test('the zoom cursor flips to a minus badge while Alt is held', async ({ editor: page }) => {
    const canvas = page.locator('canvas.main-canvas').first()
    await page.keyboard.press('z')
    await page.waitForTimeout(150)
    const zoomIn = await canvas.evaluate((el) => el.style.cursor)

    await page.keyboard.down('Alt')
    await canvas.hover({ position: { x: 400, y: 300 } })
    await page.waitForTimeout(200)
    const zoomOut = await canvas.evaluate((el) => el.style.cursor)
    await page.keyboard.up('Alt')

    check('zoom-in is a drawn magnifier', isSvgCursor(zoomIn), zoomIn.slice(0, 40))
    check('Alt swaps it for the minus variant', isSvgCursor(zoomOut) && zoomOut !== zoomIn)
  })
})
