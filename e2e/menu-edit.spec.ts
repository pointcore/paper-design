/**
 * EditMenu acceptance (C2 menu slice): the extracted Edit menu wires exactly
 * like the inlined version — undo/redo/delete via dropdown clicks, Find &
 * Replace dialog search, plus computed-style pins proving the dialog CSS move
 * (TopBar scoped -> AppDialog global) renders identically.
 */
import { test, check, seedSelectedRect, countArtwork, waitForArtwork } from './fixtures'

async function clickEditItem(page: any, name: string) {
  await page.locator('.top-bar').getByText('Edit', { exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}

test.describe('Edit menu', () => {
  test('delete, undo, redo and find & replace are wired', async ({ editor: page }) => {
    await seedSelectedRect(page)

    /* Delete / Undo / Redo */
    await clickEditItem(page, 'Delete')
    await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Delete')
    check('menu delete removes + records', (await countArtwork(page)) === 0)

    await clickEditItem(page, 'Undo')
    await page.waitForFunction(() => window.__store__.canRedo === true)
    check('menu undo restores', (await countArtwork(page)) === 1)

    await clickEditItem(page, 'Redo')
    await page.waitForFunction(() => window.__store__.canUndo === true)
    check('menu redo replays', (await countArtwork(page)) === 0)

    await clickEditItem(page, 'Undo')
    await waitForArtwork(page, 1)

    /* Find & Replace */
    await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const text = new S.PointText({
        point: new S.Point(c.x - 100, c.y),
        content: 'Hello',
        fontSize: 48,
      })
      text.fillColor = new S.Color('#111111')
      text.data.id = E.genId()
      text.data.isUserItem = true
      E.getActiveLayer().addChild(text)
      E.pushHistory('Setup')
    })
    await clickEditItem(page, 'Find & Replace...')
    const dialog = page.locator('.el-dialog', { hasText: 'Find & Replace' })
    await dialog.waitFor({ state: 'visible' })
    check('find dialog opens from menu', await dialog.isVisible())

    await dialog.getByPlaceholder('Text to find').fill('Hello')
    await page.waitForFunction(() => {
      const dlg = [...document.querySelectorAll('.el-dialog')].find((d) =>
        d.textContent.includes('Find & Replace'),
      )
      return dlg && dlg.textContent.includes('1 match')
    })
    check('search counts the match', true)

    await dialog.getByText('Find Next', { exact: true }).click()
    const selIsText = await page.evaluate(() => {
      const E = window.__engine__
      const sel = E.getSelection()
      return sel.length === 1 && sel[0] instanceof E.scope.PointText
    })
    check('find next selects the text', selIsText)

    /* Dialog CSS pins: the scoped -> global move must not change rendering. */
    const css = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('.el-dialog')].find((d) =>
        d.textContent.includes('Find & Replace'),
      )
      const name = dlg?.querySelector('.setting-name')
      const wrapper = dlg?.querySelector('.app-settings .el-input__wrapper')
      const cs = (el: Element | null, prop: string) =>
        el ? getComputedStyle(el).getPropertyValue(prop) : 'missing'
      return {
        nameColor: cs(name ?? null, 'color'),
        inputBg: cs(wrapper ?? null, 'background-color'),
        inputBorder: cs(wrapper ?? null, 'border-top-color'),
      }
    })
    check(
      'dialog CSS pins hold',
      css.nameColor === 'rgb(213, 213, 213)' &&
        css.inputBg === 'rgb(17, 17, 17)' &&
        css.inputBorder === 'rgb(61, 61, 61)',
      JSON.stringify(css),
    )
  })
})
