/**
 * FileMenu acceptance (C2 menu slice): the extracted File menu wires exactly
 * like the inlined version — New Document (with dirty confirm), Save As /
 * Export Boards / Export Raster dialog openings, and the Open picker's
 * accept list.
 */
import { test, check, seedSelectedRect, countArtwork, clickMenuItem } from './fixtures'

test.describe('File menu', () => {
  test('new document and the export dialogs are wired', async ({ editor: page }) => {
    // Seeded rect makes the document dirty, so New asks to confirm.
    await seedSelectedRect(page)
    page.on('dialog', (d) => void d.accept())

    /* New Document with the dirty confirm accepted */
    await clickMenuItem(page, 'File', 'New Document')
    await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'New Document')
    check('menu new resets the document', (await countArtwork(page)) === 0)

    /* Save As */
    await clickMenuItem(page, 'File', 'Save As...')
    const saveAs = page.locator('.el-dialog', { hasText: 'Save As' })
    await saveAs.waitFor({ state: 'visible' })
    const fileName = await saveAs.locator('input').inputValue()
    check('save-as opens with a name', (await saveAs.isVisible()) && fileName.length > 0, fileName)
    await saveAs.getByText('Cancel', { exact: true }).click()

    /* Export Boards lists every board */
    await clickMenuItem(page, 'File', 'Export Boards...')
    const boards = page.locator('.el-dialog', { hasText: 'Export Boards' })
    await boards.waitFor({ state: 'visible' })
    const boxes = await boards.locator('.el-checkbox').count()
    const boardCount = await page.evaluate(() => window.__store__.artboards.length)
    check('boards dialog lists every board', boxes === boardCount, `${boxes}/${boardCount}`)
    await boards.getByText('Cancel', { exact: true }).click()

    /* Export Raster */
    await clickMenuItem(page, 'File', 'Export Raster...')
    const raster = page.locator('.el-dialog', { hasText: 'Export Raster' })
    await raster.waitFor({ state: 'visible' })
    check('raster dialog opens from menu', await raster.isVisible())
  })

  test('the Open picker offers every format its handler can route', async ({ editor: page }) => {
    // The picker is a detached <input type=file> created on demand, so the
    // only way to read what it offers is to intercept the click that would
    // open it. The list and the onchange branch chain drift apart easily:
    // .svg used to be importable by drag-drop and by Import SVG, but File >
    // Open neither listed nor handled it.
    await page.evaluate(() => {
      const w = window as unknown as { __accepts: string[] }
      w.__accepts = []
      HTMLInputElement.prototype.click = function patched(this: HTMLInputElement) {
        w.__accepts.push(this.accept)
      }
    })

    await clickMenuItem(page, 'File', 'Open...')
    const accepts = await page.evaluate(
      () => (window as unknown as { __accepts: string[] }).__accepts
    )
    check('Open opened exactly one file picker', accepts.length === 1, JSON.stringify(accepts))

    const offered = (accepts[0] ?? '').toLowerCase()
    for (const ext of ['.json', '.vec.json', '.cdr', '.ai', '.pdf', '.svg']) {
      check(`Open accepts ${ext}`, offered.includes(ext), offered)
    }
  })
})
