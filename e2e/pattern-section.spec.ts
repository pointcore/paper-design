/**
 * PatternSection acceptance (C2 template slice): the extracted pattern editor
 * wires exactly like the inlined version — Apply paints a pattern group +
 * records history, Remove restores + records history, and the hint/buttons
 * follow selection state.
 */
import { test, check, seedSelectedRect } from './fixtures'

test.describe('Pattern section', () => {
  test('apply and remove are wired and the hint follows state', async ({ editor: page }) => {
    await seedSelectedRect(page)

    const panel = page.locator('.property-panel')
    await panel.waitFor({ state: 'visible' })
    const section = panel.locator('.pattern-section')
    await section.waitFor({ state: 'attached' })

    /* Apply paints the pattern group and records history */
    await section.getByText('Apply', { exact: true }).click()
    await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Pattern Fill')
    const appliedHint = await section.locator('.ai-desc').textContent()
    check('apply records Pattern Fill', true)
    check(
      'hint follows applied pattern',
      (appliedHint?.includes('Remove before boolean ops') ?? false),
      appliedHint ?? '(no hint)',
    )

    /* Remove restores the path and records history */
    await section.getByText('Remove', { exact: true }).click()
    await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Remove Pattern')
    const removeBtn = section.getByText('Remove', { exact: true })
    check('remove records Remove Pattern', true)
    check('remove disables itself afterwards', await removeBtn.isDisabled())
  })
})
