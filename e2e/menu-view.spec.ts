/**
 * ViewMenu acceptance (C2 menu slice): the extracted View menu wires exactly
 * like the inlined version — zoom/grid toggles, Guides dialog, Canvas
 * Settings dialog and Preflight dialog.
 */
import { test, check, clickMenuItem } from './fixtures'

test.describe('View menu', () => {
  test('zoom, grid and the dialogs are wired to the store', async ({ editor: page }) => {
    /* Zoom In */
    const z0 = await page.evaluate(() => window.__store__.view.zoom)
    await clickMenuItem(page, 'View', 'Zoom In')
    await page.waitForFunction((prev) => window.__store__.view.zoom > prev, z0)
    check('menu zoom in steps up', true, `zoom=${z0}`)

    /* Grid toggle, both directions */
    const g0 = await page.evaluate(() => window.__store__.view.showGrid)
    await clickMenuItem(page, 'View', 'Grid')
    await page.waitForFunction((prev) => window.__store__.view.showGrid !== prev, g0)
    check('menu grid toggles', true)
    await clickMenuItem(page, 'View', 'Grid')
    await page.waitForFunction((prev) => window.__store__.view.showGrid === prev, g0)
    check('menu grid toggles back', true)

    /* Guides dialog */
    await clickMenuItem(page, 'View', 'Guides...')
    const guides = page.locator('.el-dialog', { hasText: 'Guides' })
    await guides.waitFor({ state: 'visible' })
    check('guides dialog opens from menu', await guides.isVisible())
    await guides.getByText('Close', { exact: true }).click()

    /* Canvas Settings dialog, including a live switch */
    await clickMenuItem(page, 'View', 'Canvas Settings...')
    const settings = page.locator('.el-dialog', { hasText: 'Canvas Settings' })
    await settings.waitFor({ state: 'visible' })
    check('settings dialog opens from menu', await settings.isVisible())
    const gridBefore = await page.evaluate(() => window.__store__.view.showGrid)
    await settings.locator('.setting-row', { hasText: 'Show a grid on the canvas' }).locator('.el-switch').click()
    await page.waitForFunction((prev) => window.__store__.view.showGrid !== prev, gridBefore)
    check('settings grid switch applies live', true)
    await settings.getByText('Close', { exact: true }).click()

    /* Preflight dialog */
    await clickMenuItem(page, 'View', 'Preflight...')
    const preflight = page.locator('.el-dialog', { hasText: 'Preflight' })
    await preflight.waitFor({ state: 'visible' })
    check('preflight opens from menu', await preflight.isVisible())
  })
})
