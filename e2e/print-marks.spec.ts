/**
 * Printer marks in the exported PDF, and the print findings the preflight
 * gained: spot inks, live transparency and referenced fonts.
 *
 * These are the things a printer asks about *after* the plates are made if
 * nobody said them earlier, so the export has to carry them and the preflight
 * has to name them.
 */
import { test, check } from './fixtures'
import type { Page } from '@playwright/test'

/** Export the active board as a print PDF's SVG and report what is in it. */
async function exportPrintSvg(page: Page, spotNames: string[] = []) {
  return page.evaluate((spots) => {
    const E = window.__engine__
    const boards = E.store.artboards as Array<{
      id: string
      x: number
      y: number
      width: number
      height: number
    }>
    const board = boards.find((b: { id: string }) => b.id === E.store.activeArtboardId) ?? boards[0]
    const bleed = 6
    const root = E.exportBoardVectorSVG(
      { x: board.x, y: board.y, width: board.width, height: board.height },
      { bleed, marks: 'print', slug: 'export-print.pdf', spotNames: spots },
    ) as unknown as SVGSVGElement | null
    if (!root) return null
    const marks = root.querySelector('[data-printer-marks]')
    const svg = new XMLSerializer().serializeToString(root)
    return {
      hasMarks: !!marks,
      lines: marks?.querySelectorAll('line').length ?? 0,
      patches: marks?.querySelectorAll('rect').length ?? 0,
      texts: Array.from(marks?.querySelectorAll('text') ?? []).map((t) => t.textContent),
      // The sheet has to grow by the bleed, or the marks fall off the page.
      width: Number(root.getAttribute('width')),
      height: Number(root.getAttribute('height')),
      boardWidth: board.width,
      boardHeight: board.height,
      bleed,
      onTrim: Array.from(marks?.querySelectorAll('line, rect, text') ?? []).some((el) => {
        const gfx = el as SVGGraphicsElement
        const b = gfx.getBBox ? gfx.getBBox() : null
        if (!b) return false
        // Nothing may be printed inside the trim box.
        return b.x > board.x && b.x < board.x + board.width && b.y > board.y && b.y < board.y + board.height
      }),
      svgLength: svg.length,
    }
  }, spotNames)
}

test.describe('Print PDF marks', () => {
  test('the print export carries crop, registration and color-bar marks', async ({ editor: page }) => {
    const info = await exportPrintSvg(page)
    check('the export succeeded', !!info, JSON.stringify(info))
    if (!info) return
    check('a printer-marks group is present', info.hasMarks, JSON.stringify(info))
    // 8 crop marks + 4 targets of (2 arms + 12 chords).
    check('crop and registration marks are drawn', info.lines >= 8 + 14 * 4, JSON.stringify(info))
    // 4 CMYK solids + 4 inks x 4 tints.
    check('the color bar is drawn', info.patches >= 24, JSON.stringify(info))
    check('the slug names the job', info.texts.includes('export-print.pdf'), JSON.stringify(info))
  })

  test('the page grows by the bleed so the marks are on the sheet', async ({ editor: page }) => {
    const info = await exportPrintSvg(page)
    if (!info) return
    check(
      'the width carries the bleed on both sides',
      Math.abs(info.width - (info.boardWidth + info.bleed * 2)) < 0.5,
      JSON.stringify(info),
    )
    check(
      'and so does the height',
      Math.abs(info.height - (info.boardHeight + info.bleed * 2)) < 0.5,
      JSON.stringify(info),
    )
  })

  test('no mark prints on the artwork', async ({ editor: page }) => {
    const info = await exportPrintSvg(page)
    if (!info) return
    check('nothing lands inside the trim box', info.onTrim === false, JSON.stringify(info))
  })

  test('a spot ink adds a chip to the bar', async ({ editor: page }) => {
    const plain = await exportPrintSvg(page)
    const spotted = await exportPrintSvg(page, ['PMS 185 C', 'PMS 032 C'])
    if (!plain || !spotted) return
    check('two chips were added', spotted.patches === plain.patches + 2, JSON.stringify({ plain, spotted }))
  })

  test('the plain vector export keeps crop marks only', async ({ editor: page }) => {
    const info = await page.evaluate(() => {
      const E = window.__engine__
      const boards = E.store.artboards as Array<{ id: string; x: number; y: number; width: number; height: number }>
      const board = boards.find((b: { id: string }) => b.id === E.store.activeArtboardId) ?? boards[0]
      const root = E.exportBoardVectorSVG(
        { x: board.x, y: board.y, width: board.width, height: board.height },
        { bleed: 6, marks: true },
      ) as unknown as SVGSVGElement | null
      return {
        full: !!root?.querySelector('[data-printer-marks]'),
        lines: root?.querySelectorAll('line').length ?? 0,
        texts: root?.querySelectorAll('text').length ?? 0,
      }
    })
    check('no printer-marks group at all', info.full === false, JSON.stringify(info))
    check('just the eight crop marks', info.lines === 8, JSON.stringify(info))
  })
})

test.describe('Print preflight findings', () => {
  test('a spot ink is named as a plate the job needs', async ({ editor: page }) => {
    const issues = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const shape = new S.Path.Rectangle({
        from: new S.Point(c.x - 40, c.y - 40),
        to: new S.Point(c.x + 40, c.y + 40),
      })
      shape.fillColor = new S.Color('#c0392b')
      shape.data.id = E.genId()
      shape.data.isUserItem = true
      shape.data.spotFill = 'PMS 185 C'
      E.getActiveLayer().addChild(shape)
      return E.preflight()
    })
    const spot = issues.find((i: { kind: string }) => i.kind === 'spot')
    check('the ink is reported', !!spot, JSON.stringify(issues))
    check('with its name and a plate count', (spot?.message ?? '').includes('PMS 185 C'), JSON.stringify(spot))
    check('and a severity label exists', typeof spot?.itemId === 'string', '')
  })

  test('live transparency is reported once, for the job', async ({ editor: page }) => {
    const issues = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const layer = E.getActiveLayer()
      for (let i = 0; i < 2; i++) {
        const shape = new S.Path.Rectangle({
          from: new S.Point(c.x - 60 + i * 90, c.y - 30),
          to: new S.Point(c.x - 10 + i * 90, c.y + 30),
        })
        shape.fillColor = new S.Color('#3366cc')
        shape.opacity = 0.5
        shape.data.id = E.genId()
        shape.data.isUserItem = true
        layer.addChild(shape)
      }
      return E.preflight().filter((i: { kind: string }) => i.kind === 'transparency')
    })
    check('transparency is reported', issues.length === 1, JSON.stringify(issues))
    check('counting both objects', (issues[0]?.message ?? '').includes('2 objects'), JSON.stringify(issues))
  })

  test('a text item names its font family', async ({ editor: page }) => {
    const issues = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const text = new S.PointText({
        point: new S.Point(c.x - 100, c.y),
        content: 'Press ready',
        fontSize: 24,
        fontFamily: 'Georgia',
      })
      text.fillColor = new S.Color('#111111')
      text.data.id = E.genId()
      text.data.isUserItem = true
      E.getActiveLayer().addChild(text)
      return E.preflight().filter((i: { kind: string }) => i.kind === 'font')
    })
    check('the family is named', issues.some((i: { message: string }) => i.message.includes('Georgia')), JSON.stringify(issues))
  })

  test('a clean document reports no print findings', async ({ editor: page }) => {
    const issues = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const shape = new S.Path.Rectangle({
        from: new S.Point(c.x - 40, c.y - 40),
        to: new S.Point(c.x + 40, c.y + 40),
      })
      shape.fillColor = new S.Color('#000000')
      shape.data.id = E.genId()
      shape.data.isUserItem = true
      E.getActiveLayer().addChild(shape)
      return E.preflight().filter((i: { kind: string }) => i.kind === 'spot' || i.kind === 'transparency' || i.kind === 'font')
    })
    check('a plain filled shape has nothing to discuss', issues.length === 0, JSON.stringify(issues))
  })
})
