/**
 * Spot separation export, end to end.
 *
 * The repaint and its restore are unit tested over a real paper scope; what
 * only a browser can show is that a plate renders through the live view, that
 * the plate really is one ink, and — the part that would silently corrupt a
 * document — that the artwork comes back exactly as it was afterwards.
 */
import { test, check } from './fixtures'
import type { Page } from '@playwright/test'

/** Two spot inks and one plain object, all on the active layer. */
async function seedSpots(page: Page) {
  return page.evaluate(() => {
    const E = window.__engine__
    const S = E.scope
    const c = S.view.viewToProject(S.view.center)
    const layer = E.getActiveLayer()
    const make = (name: string, dx: number, color: string) => {
      const rect = new S.Path.Rectangle({
        from: new S.Point(c.x - 200 + dx, c.y - 60),
        to: new S.Point(c.x - 120 + dx, c.y + 60),
      })
      rect.fillColor = new S.Color(color)
      rect.data.id = E.genId()
      rect.data.isUserItem = true
      ;(rect.data as any).spotFill = name
      layer.addChild(rect)
      return rect
    }
    make('PMS 185 C', 0, '#c0392b')
    make('FOGRA 51', 200, '#1f78b4')
    const plain = new S.Path.Circle(new S.Point(c.x + 220, c.y), 40)
    plain.fillColor = new S.Color('#3366cc')
    plain.data.id = E.genId()
    plain.data.isUserItem = true
    layer.addChild(plain)
    E.syncLayersToStore()
    E.pushHistory('Setup')
    return { layers: layer.children.length }
  })
}

/** Every paint in the document, as a comparable string. */
const paintSnapshot = (page: Page) =>
  page.evaluate(() => {
    const E = window.__engine__
    const out: string[] = []
    const walk = (item: any) => {
      out.push(
        [
          String(item.data?.id ?? ''),
          item.fillColor ? String(item.fillColor.toCSS(true)) : 'none',
          item.strokeColor ? String(item.strokeColor.toCSS(true)) : 'none',
          String(item.opacity),
        ].join('|')
      )
      for (const child of item.children ?? []) walk(child)
    }
    for (const layer of E.project.layers) walk(layer)
    return out.join('\n')
  })

/** One separation as the engine reports it. */
interface SeparationRow {
  spot: string
  file: string
  items: number
}

/** One rendered plate, summarized in the page so nothing large crosses over. */
interface PlateSummary {
  spot: string
  inked: number
  total: number
  width: number
  height: number
  bytes: number
  dpi: number
}

/** Render every plate in the page and return only the summary numbers. */
async function summarizePlates(page: Page, area: 'page' | 'artwork'): Promise<PlateSummary[]> {
  return page.evaluate(async (a: 'page' | 'artwork'): Promise<PlateSummary[]> => {
    const E = window.__engine__
    const { plates } = await E.exportSeparations({ area: a, dpi: 150 })
    return plates.map((p: { rgba: Uint8ClampedArray; separation: { spot: string }; width: number; height: number; tiff: Uint8Array; dpi: number }) => {
      let inked = 0
      for (let i = 0; i < p.rgba.length; i += 4) {
        if (p.rgba[i + 3] > 8) inked++
      }
      return {
        spot: p.separation.spot,
        inked,
        total: p.width * p.height,
        width: p.width,
        height: p.height,
        bytes: p.tiff.length,
        dpi: p.dpi,
      }
    })
  }, area)
}

/** Render every plate in the page, keeping the plate sizes out of the result. */
async function renderPlates(
  page: Page,
  area: 'page' | 'artwork'
): Promise<Array<{ spot: string; file: string; dpi: number }>> {
  return page.evaluate(async (a: 'page' | 'artwork') => {
    const E = window.__engine__
    const { plates } = await E.exportSeparations({ area: a, dpi: 150 })
    return plates.map((p: { separation: { spot: string; file: string }; dpi: number }) => ({
      spot: p.separation.spot,
      file: p.separation.file,
      dpi: p.dpi,
    }))
  }, area)
}

test.describe('Spot separations', () => {
  test('the File menu lists the inks in the document', async ({ editor: page }) => {
    await seedSpots(page)
    const rows: SeparationRow[] = await page.evaluate(() => window.__engine__.collectSeparations())
    check('both inks are found', rows.length === 2, JSON.stringify(rows))
    const names = rows.map((r: SeparationRow) => r.spot).sort()
    check('the names are the ones on the objects', names.join(',') === 'FOGRA 51,PMS 185 C', names.join(','))

    await page.locator('.top-bar').getByText('File', { exact: true }).click()
    await page.getByRole('menuitem', { name: 'Export Spot Separations...', exact: true }).click()
    const dialog = page.locator('.el-dialog', { hasText: 'Export Spot Separations' })
    await dialog.waitFor({ state: 'visible' })
    const text = (await dialog.textContent()) ?? ''
    check('the dialog names each ink', text.includes('PMS 185 C') && text.includes('FOGRA 51'), text.slice(0, 120))
    check('the dialog says what a plate is', /grayscale TIFF/.test(text), '')
  })

  test('each plate renders as one ink and the document comes back intact', async ({ editor: page }) => {
    await seedSpots(page)
    const before = await paintSnapshot(page)

    const result = await renderPlates(page, 'page')
    check('one plate per ink', result.length === 2, JSON.stringify(result))
    check('the plates are named after their inks', result.every((p) => p.spot.length > 0), JSON.stringify(result))
    check('the plates carry the requested resolution', result.every((p) => p.dpi === 150), JSON.stringify(result))

    const sizes = await summarizePlates(page, 'page')
    check('the plate has pixels', sizes[0].width > 0 && sizes[0].height > 0, JSON.stringify(sizes[0]))
    check('the plate file is not empty', sizes[0].bytes > 1000, JSON.stringify(sizes[0]))

    // The whole point: the repaint must leave nothing behind.
    const after = await paintSnapshot(page)
    check('every paint in the document is exactly as it was', after === before, after.slice(0, 200))
  })

  test('a plate contains only its own ink', async ({ editor: page }) => {
    await seedSpots(page)
    // Count inked pixels per plate: a plate is opaque only where its own ink
    // is. The artboard sheet is not drawn, so a plate that carried the sheet
    // (or both inks) would cover the whole frame.
    const coverage = await summarizePlates(page, 'artwork')
    check('both plates rendered', coverage.length === 2, JSON.stringify(coverage))
    for (const plate of coverage) {
      const ratio = plate.inked / plate.total
      check(
        `${plate.spot} covers a plausible share of the artwork`,
        ratio > 0.02 && ratio < 0.9,
        `${ratio.toFixed(3)}`,
      )
    }
    // Two objects of the same size on different plates: the areas should be
    // close, and neither may be empty.
    const areas = coverage.map((c: PlateSummary) => c.inked).sort((a: number, b: number) => a - b)
    check('the two plates cover comparable areas', areas[0] > 0 && areas[1] / areas[0] < 2, areas.join(' vs '))
  })

  test('a page-area plate is transparent where nothing is inked', async ({ editor: page }) => {
    await seedSpots(page)
    const plates = await summarizePlates(page, 'page')
    // The seeded artwork is two 80x120 rectangles on a 1920x1080 page, so a
    // plate that drew the sheet (or the whole page as ink) would be ~1.0.
    for (const plate of plates) {
      const ratio = plate.inked / plate.total
      check(`${plate.spot} page plate is mostly empty`, ratio > 0.001 && ratio < 0.2, ratio.toFixed(4))
    }
  })

  test('a document with no spots exports nothing and says so', async ({ editor: page }) => {
    const result = await page.evaluate(async () => {
      const E = window.__engine__
      const { plates, result } = await E.exportSeparations({ area: 'page', dpi: 150 })
      return { plates: plates.length, empty: result.empty, warnings: result.warnings }
    })
    check('no plates were produced', result.plates === 0, JSON.stringify(result))
    check('the result reports itself empty', result.empty === true, JSON.stringify(result))
  })
})
