/**
 * GradientSection acceptance (C2 template slice): the extracted gradient
 * editor wires exactly like the inlined version — the kind switch paints the
 * selection + records history, Add Stop grows the rows, reverse keeps a
 * separate entry, switching back to solid hides the section.
 */
import { test, check, seedSelectedRect } from './fixtures'

test.describe('Gradient section', () => {
  test('kind switch, add stop, reverse and solid are wired', async ({ editor: page }) => {
    await seedSelectedRect(page)

    const panel = page.locator('.property-panel')
    await panel.waitFor({ state: 'visible' })
    const section = panel.locator('.gradient-section')

    check('gradient section hidden while solid', !(await section.isVisible()))

    /* Fill -> Gradient */
    await panel.getByText('Gradient', { exact: true }).first().click()
    await page.waitForFunction(() => !!window.__store__.style.gradient)
    check('gradient section visible after switch', await section.isVisible())

    const gradInfo = await page.evaluate(() => {
      const S = window.__store__.style.gradient
      const E = window.__engine__
      return {
        type: S?.type ?? null,
        stops: S?.stops.length ?? 0,
        history: E.history[E.history.length - 1]?.name ?? null,
      }
    })
    check(
      'switch paints a default linear gradient + history',
      gradInfo.type === 'linear' && gradInfo.stops === 2 && gradInfo.history === 'Change Gradient',
      JSON.stringify(gradInfo),
    )

    // Two stop rows + type/angle/add rows = 5 prop-rows.
    check('two stop rows rendered', (await section.locator('.prop-row').count()) === 5)

    /* Add Stop grows the rows */
    await section.getByText('Add Stop', { exact: true }).click()
    await page.waitForFunction(() => (window.__store__.style.gradient?.stops.length ?? 0) === 3)
    check('add stop grows rows', (await section.locator('.prop-row').count()) === 6)

    /* Reverse keeps its own history entry (different label, no coalescing) */
    await section.getByTitle('Reverse gradient direction').click()
    const lastTwo = await page.evaluate(() =>
      window.__engine__.history.slice(-2).map((h: any) => h.name),
    )
    check(
      'reverse records its entry',
      JSON.stringify(lastTwo) === '["Change Gradient","Reverse Gradient"]',
      lastTwo.join(','),
    )

    /* Back to solid hides the section and clears the gradient */
    await panel.getByText('Fill', { exact: true }).first().click()
    await page.waitForFunction(() => !window.__store__.style.gradient)
    check('solid hides section again', !(await section.isVisible()))
  })
})
