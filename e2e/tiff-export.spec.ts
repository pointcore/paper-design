/**
 * TIFF export, end to end through the live engine.
 *
 * The unit test proves the encoder against an independent reader; what this
 * adds is that the export path actually calls it and hands back bytes a
 * reader can parse — the wiring between the canvas pixels, the encoder and
 * the download URL is where a format gets lost.
 *
 * The reader here is a trimmed copy of the one in `tiff.test.ts`: parsing
 * with the writer's own idea of the layout would prove nothing. It runs
 * inside the page and returns only the tag values, because a 2x page export
 * is tens of megabytes and shipping the file across the CDP boundary to
 * assert four numbers is how you get an out-of-memory crash.
 */
import { test, check, seedSelectedRect } from './fixtures'

/**
 * Export a TIFF in the page, parse its header + IFD there, and return the
 * handful of values worth asserting plus the file size.
 */
async function exportAndRead(page: import('@playwright/test').Page, scale: number) {
  return page.evaluate((s: number) => {
    const E = window.__engine__
    const url = E.exportRaster({ format: 'tiff', scale: s, area: 'page' })
    if (!url) return { ok: false as const }
    const binary = atob(url.slice(url.indexOf(',') + 1))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    const view = new DataView(bytes.buffer)
    const ifdAt = view.getUint32(4, true)
    const count = view.getUint16(ifdAt, true)
    const sizeOf: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }
    const readValues = (type: number, n: number, at: number): number[] => {
      const out: number[] = []
      for (let i = 0; i < n; i++) {
        const offset = at + i * sizeOf[type]
        if (type === 3) out.push(view.getUint16(offset, true))
        else if (type === 4) out.push(view.getUint32(offset, true))
        else if (type === 5) {
          const num = view.getUint32(offset, true)
          const den = view.getUint32(offset + 4, true)
          out.push(den === 0 ? 0 : num / den)
        } else out.push(bytes[offset])
      }
      return out
    }
    const tags = new Map<number, number[]>()
    for (let i = 0; i < count; i++) {
      const at = ifdAt + 2 + i * 12
      const tag = view.getUint16(at, true)
      const type = view.getUint16(at + 2, true)
      const n = view.getUint32(at + 4, true)
      const valueAt = sizeOf[type] * n <= 4 ? at + 8 : view.getUint32(at + 8, true)
      tags.set(tag, readValues(type, n, valueAt))
    }
    const imgWidth = tags.get(256)?.[0] ?? 0
    const imgHeight = tags.get(257)?.[0] ?? 0
    const channelCount = tags.get(277)?.[0] ?? 0
    // Pixel data starts right after the 8-byte header, in channel order.
    const dataAt = 8
    let transparent = 0
    for (let p = 0; p < imgWidth * imgHeight; p++) {
      const at = dataAt + p * channelCount + (channelCount === 4 ? 3 : 0)
      if (channelCount === 4 && bytes[at] !== 255) transparent++
    }
    return {
      ok: true as const,
      prefix: url.slice(0, url.indexOf(',')),
      size: binary.length,
      width: imgWidth,
      height: imgHeight,
      samples: channelCount,
      dpi: Math.round(tags.get(282)?.[0] ?? 0),
      compression: tags.get(259)?.[0] ?? -1,
      transparent,
      pixels: imgWidth * imgHeight,
    }
  }, scale)
}

test.describe('TIFF export', () => {
  test('the export path produces a readable TIFF for the page area', async ({ editor: page }) => {
    await seedSelectedRect(page, '#3366cc')
    const file = await exportAndRead(page, 1)
    check('the export returned a TIFF data url', file.ok && file.prefix === 'data:image/tiff;base64', file.prefix)
    if (!file.ok) return
    check('the file has a plausible size', file.size > 1000, String(file.size))

    const pageSize = await page.evaluate(() => window.__store__.pageSize)
    check('the file is uncompressed', file.compression === 1, String(file.compression))
    check(
      'the page size is the image size',
      file.width === pageSize.width && file.height === pageSize.height,
      `${file.width}x${file.height} vs ${pageSize.width}x${pageSize.height}`,
    )
    // 1x of a 96dpi document is a 96dpi page.
    check('the resolution is recorded', file.dpi === 96, String(file.dpi))
    // The artboard sheet is part of the page, so a page export is opaque.
    check('a page export is opaque', file.samples === 3 && file.transparent === 0, `${file.samples} samples, ${file.transparent}/${file.pixels} transparent`)
  })

  test('a 2x export doubles the pixels per side and the resolution', async ({ editor: page }) => {
    await seedSelectedRect(page, '#3366cc')
    const one = await exportAndRead(page, 1)
    const two = await exportAndRead(page, 2)
    check('both exports parsed', one.ok && two.ok)
    if (!one.ok || !two.ok) return
    check('2x doubles the width', two.width === one.width * 2, `${two.width} vs ${one.width}`)
    check('2x doubles the height', two.height === one.height * 2, `${two.height} vs ${one.height}`)
    check('2x is about four times the bytes', two.size > one.size * 3.5, `${two.size} vs ${one.size}`)
    check('2x records 192 dpi', two.dpi === 192, String(two.dpi))
  })
})
