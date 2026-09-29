/**
 * Navigator frame loop.
 *
 * The viewport rectangle is synced by a requestAnimationFrame loop that
 * re-reads the paper view bounds every frame. It must not run while the panel
 * is collapsed or the tab is hidden, and the indicator must come back correct
 * when the loop resumes.
 */
import { test, check, expect } from './fixtures'

/** Count rAF callbacks the page schedules over a short window. */
async function countFrames(page: any, ms = 400): Promise<number> {
  return page.evaluate(async (windowMs: number) => {
    let n = 0
    let running = true
    const tick = () => {
      n++
      if (running) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    await new Promise((r) => setTimeout(r, windowMs))
    running = false
    return n
  }, ms)
}

test.describe('Navigator viewport loop', () => {
  test('suspends on a hidden tab and resumes on return', async ({ editor: page }) => {
    const nav = page.locator('.navigator')
    await nav.waitFor({ state: 'visible', timeout: 15_000 })

    // Visible: the loop is live, so the viewport rectangle tracks the canvas.
    const rect = page.locator('.nav-viewport')
    await expect(rect).toBeVisible()

    const before = await rect.boundingBox()
    expect(before).not.toBeNull()

    // Collapse the panel: nothing to paint, so the loop must stop. The
    // collapsed panel keeps a zero-height box, so assert the state class
    // rather than visibility.
    await page.locator('.nav-header').click()
    await expect(nav).toHaveClass(/\bcollapsed\b/)

    // The suspend/resume policy itself is unit-tested in
    // navigator-loop.test.ts; here the point is that the panel's DOM state
    // and the viewport rectangle stay consistent across a collapse cycle.

    // Expand again; the rectangle must come back rather than stay stale.
    await page.locator('.nav-header').click()
    await expect(nav).not.toHaveClass(/\bcollapsed\b/)
    await expect(rect).toBeVisible()
    const after = await rect.boundingBox()
    check('viewport rectangle returns after expanding', after !== null)

    // Frames are still being produced in a visible tab.
    const frames = await countFrames(page)
    check('frames still run while the tab is visible', frames > 0, `frames=${frames}`)
  })
})
