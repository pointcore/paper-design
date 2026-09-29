/**
 * TextSection acceptance (C2 template slice): the extracted text editor
 * wires exactly like the inlined version — size/bold/align edits repaint the
 * selected text and record history, and the section self-gates on a selected
 * text item.
 */
import { test, check, seedSelectedText } from './fixtures'

test.describe('Text section', () => {
  test('bold, align, size commit and the selection gate are wired', async ({ editor: page }) => {
    await seedSelectedText(page)

    const panel = page.locator('.property-panel')
    await panel.waitFor({ state: 'visible' })
    const section = panel.locator('.text-section')
    await section.waitFor({ state: 'visible' })
    check('text section shows for a text selection', await section.isVisible())

    /* Bold repaints + records */
    await section.getByText('B', { exact: true }).click()
    await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Change Font Weight')
    const bold = await page.evaluate(() => {
      const E = window.__engine__
      const item = E.getSelection()[0]
      return { weight: String(item.fontWeight), history: E.history.at(-1)?.name }
    })
    check(
      'bold repaints + records',
      bold.weight === 'bold' && bold.history === 'Change Font Weight',
      JSON.stringify(bold),
    )

    /* Align center */
    await section.getByText('Center', { exact: true }).click()
    await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Change Text Alignment')
    const align = await page.evaluate(() => window.__engine__.getSelection()[0].justification)
    check('align center applies', align === 'center', String(align))

    /* Size commits on Enter */
    const sizeInput = section.locator('.el-input-number input').first()
    await sizeInput.fill('24')
    await sizeInput.press('Enter')
    await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Change Font Size')
    const size = await page.evaluate(() => window.__engine__.getSelection()[0].fontSize)
    check('size commits', Number(size) === 24, String(size))

    /* Selecting a non-text item hides the section again */
    await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const rect = new S.Path.Rectangle({
        from: new S.Point(c.x - 50, c.y + 150),
        to: new S.Point(c.x + 50, c.y + 250),
      })
      rect.fillColor = new S.Color('#3366cc')
      rect.data.id = E.genId()
      rect.data.isUserItem = true
      E.getActiveLayer().addChild(rect)
      E.selectByIds([rect.data.id])
    })
    await page.waitForFunction(() => window.__engine__.getSelection()[0] instanceof window.__engine__.scope.Path)
    check('section hides for non-text', !(await section.isVisible()))
  })
})
