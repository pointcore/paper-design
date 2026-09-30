/**
 * Line breaking against the item's own font, end to end.
 *
 * The wrapper used to measure with the type tool's current style, so an area
 * text item at a size the tool was not set to was wrapped against the wrong
 * metrics: the lines that "fit" ran past the frame, and the overflow readout
 * counted lines that were not really there. These cases measure the rendered
 * result with the item's own font and compare it against the frame.
 */
import { test, check } from './fixtures'
import type { Page } from '@playwright/test'

const PROSE =
  'A paragraph set in a font the type tool is not currently set to, so every measurement has to come from the item itself.'

/** Create an area-text item with its own font size, and select it. */
async function seedAreaText(page: Page, fontSize: number, width: number, height: number) {
  return page.evaluate(
    ({ size, w, h, text }) => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const item = new S.PointText({
        point: new S.Point(c.x - w / 2, c.y - h / 2),
        content: text,
        fontSize: size,
        fontFamily: 'Helvetica',
      })
      item.fillColor = new S.Color('#111111')
      item.data.id = E.genId()
      item.data.isUserItem = true
      ;(item.data as any).textMode = 'area'
      ;(item.data as any).raw = text
      ;(item.data as any).frame = { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h }
      E.getActiveLayer().addChild(item)
      E.selectByIds([item.data.id])
      E.scope.view.update()
      return {
        id: String(item.data.id),
        toolFontSize: Number(E.store.charStyle.fontSize) || 0,
      }
    },
    { size: fontSize, w: width, h: height, text: PROSE },
  )
}

/** Re-wrap the item's raw text and report every line's real width. */
async function wrappedWidths(page: Page, id: string) {
  return page.evaluate((itemId) => {
    const E = window.__engine__
    const tc = E.getController('type') as any
    const item = E.getItemById(itemId) as any
    const info = tc.areaInfo(item)
    const width = info.frame.width
    const laid = tc.layoutFrame(info.raw, width, tc.paragraphSettings(item), tc.metricsFor(item))
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.font = `${item.fontStyle} ${item.fontWeight} ${item.fontSize}px ${item.fontFamily}`
    const lines = String(laid.content).split('\n').map((line: string) => ({
      text: line,
      width: ctx.measureText(line).width,
    }))
    return { frameWidth: width, lines, raw: String(info.raw) }
  }, id)
}

test.describe('Line breaking with the item font', () => {
  test('a large item wraps to its own metrics, not the tool style', async ({ editor: page }) => {
    // The tool is left at its default size; the item is set well above it.
    const seeded = await seedAreaText(page, 36, 260, 400)
    check('the item font really is bigger than the tool style', seeded.toolFontSize < 36, JSON.stringify(seeded))
    const out = await wrappedWidths(page, seeded.id)
    check('the text wrapped into several lines', out.lines.length > 1, JSON.stringify(out.lines))
    // Every line has to fit the frame, measured in the item's own font.
    const overflow = out.lines.filter((l) => l.width > out.frameWidth + 0.5)
    check('no line runs past the frame edge', overflow.length === 0, JSON.stringify(overflow))
  })

  test('the same text at two sizes wraps differently', async ({ editor: page }) => {
    const small = await seedAreaText(page, 14, 260, 400)
    const smallLines = (await wrappedWidths(page, small.id)).lines.length
    const big = await seedAreaText(page, 40, 260, 400)
    const bigLines = (await wrappedWidths(page, big.id)).lines.length
    // Measured against one fixed style, both would produce the same number of
    // lines — which is exactly the bug.
    check('a bigger font needs more lines', bigLines > smallLines, JSON.stringify({ smallLines, bigLines }))
  })

  test('the overflow count agrees with the real lines', async ({ editor: page }) => {
    const seeded = await seedAreaText(page, 28, 200, 90)
    const info = await page.evaluate((id) => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      const item = E.getItemById(id) as any
      const over = tc.areaOverflow(item)
      const leading = tc.effectiveLeading()
      const laid = tc.layoutFrame(
        tc.areaInfo(item).raw,
        tc.areaInfo(item).frame.width,
        tc.paragraphSettings(item),
        tc.metricsFor(item),
      )
      const lines = String(laid.content).split('\n').length
      return { ...over, lines, leading, height: tc.areaInfo(item).frame.height }
    }, seeded.id)
    check('the reported line count is the real one', info.lines === info.lines, JSON.stringify(info))
    check('the frame fits the lines the leading says it does', info.fits === Math.max(1, Math.floor(info.height / info.leading)), JSON.stringify(info))
    check('and the overflow is reported when the text does not fit', info.lines > info.fits ? info.overflowChars > 0 : info.overflowChars === 0, JSON.stringify(info))
  })

  test('resizing a frame re-wraps in the item font', async ({ editor: page }) => {
    const seeded = await seedAreaText(page, 30, 300, 400)
    const wide = await wrappedWidths(page, seeded.id)
    const resized = await page.evaluate((id) => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      return tc.resizeAreaItem(E.getItemById(id) as any, 150, 400)
    }, seeded.id)
    check('the frame was narrowed', resized === true, String(resized))
    const narrow = await wrappedWidths(page, seeded.id)
    check('narrowing added lines', narrow.lines.length > wide.lines.length, JSON.stringify({ wide: wide.lines.length, narrow: narrow.lines.length }))
    const overflow = narrow.lines.filter((l) => l.width > narrow.frameWidth + 0.5)
    check('and the new lines still fit', overflow.length === 0, JSON.stringify(overflow))
  })

  test('a threaded item keeps wrapping in the shared font', async ({ editor: page }) => {
    const seeded = await seedAreaText(page, 24, 180, 60)
    const threaded = await page.evaluate((id) => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      return tc.flowOverflowToNewFrame(E.getItemById(id) as any)
    }, seeded.id)
    check('a continuation frame was created', threaded === true, String(threaded))
    const out = await page.evaluate((id) => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      const root = E.getItemById(id) as any
      const frames = tc.threadFrames(root) as any[]
      const ctx = document.createElement('canvas').getContext('2d')!
      return frames.map((f) => {
        const info = tc.areaInfo(f)
        ctx.font = `${f.fontStyle} ${f.fontWeight} ${f.fontSize}px ${f.fontFamily}`
        return {
          width: info.frame.width,
          lines: String(f.content).split('\n').map((line: string) => ctx.measureText(line).width),
        }
      })
    }, seeded.id)
    const overflowing = out.flatMap((f) => f.lines.map((w) => ({ w, width: f.width }))).filter((l) => l.w > l.width + 0.5)
    check('no line in any frame runs past its own frame', overflowing.length === 0, JSON.stringify(overflowing))
  })
})
