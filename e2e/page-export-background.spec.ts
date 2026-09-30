/**
 * Page-area raster export must include the artboard sheet.
 *
 * `withCapturedView` hides every non-user layer, artboards included, which
 * is right for artwork and selection exports and wrong for the page: the
 * exported page came out transparent with the artwork floating on it. JPEG
 * papered over it (the encoder fills white first), so PNG page exports, the
 * per-board PNG download and the raster PDF pages all shipped a transparent
 * background.
 */
import { test, check, seedSelectedRect } from './fixtures'

/** Corner and top-edge pixels of a PNG page export, decoded in the page. */
async function pageExportPixels(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const url = window.__engine__.exportRaster({ format: 'png', scale: 1, area: 'page' }) ?? ''
    const img = new Image()
    return new Promise<{ size: string; corner: number[]; edge: number[] } | string>((resolve) => {
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        resolve({
          size: `${img.width}x${img.height}`,
          corner: Array.from(ctx.getImageData(2, 2, 1, 1).data),
          edge: Array.from(ctx.getImageData(Math.floor(img.width / 2), 3, 1, 1).data),
        })
      }
      img.onerror = () => resolve('decode failed')
      img.src = url
    })
  })
}

test.describe('Page-area raster export', () => {
  test('keeps the artboard sheet, so the page is opaque white', async ({ editor: page }) => {
    await seedSelectedRect(page, '#3366cc')
    const probe = await pageExportPixels(page)
    check('the export decodes', typeof probe !== 'string', String(probe))
    if (typeof probe === 'string') return

    const pageSize = await page.evaluate(() => window.__store__.pageSize)
    check('the export is page-sized', probe.size === `${pageSize.width}x${pageSize.height}`, probe.size)
    // Alpha 255 everywhere is the actual regression: before the fix these
    // were 0 and the sheet was missing from the render.
    check('the page corner is opaque', probe.corner[3] === 255, probe.corner.join(','))
    check('the top edge is opaque', probe.edge[3] === 255, probe.edge.join(','))
    check(
      'the sheet is white, not the transparent checkerboard',
      probe.corner[0] > 240 && probe.corner[1] > 240 && probe.corner[2] > 240,
      probe.corner.join(','),
    )
  })
})
