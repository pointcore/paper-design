import { test, expect } from '@playwright/test'

test.describe('Vue Vector Editor smoke tests', () => {
  test('loads the editor canvas', async ({ page }) => {
    await page.goto('/')
    // Wait for the Paper.js canvas to appear
    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible({ timeout: 15_000 })
  })

  test('toolbar is visible', async ({ page }) => {
    await page.goto('/')
    // Check that the tool rail renders
    const toolRail = page.locator('.tool-rail, .tool-rail-wrapper, [class*="tool-rail"]')
    await expect(toolRail.first()).toBeVisible({ timeout: 15_000 })
  })

  test('can switch right panel tabs', async ({ page }) => {
    await page.goto('/')
    // Wait for the right panel tabs to appear
    const tabs = page.locator('.rp-tab')
    await expect(tabs.first()).toBeVisible({ timeout: 15_000 })

    // Click on different tabs
    const tabCount = await tabs.count()
    expect(tabCount).toBeGreaterThan(1)

    // Click the second tab
    await tabs.nth(1).click()
    await expect(tabs.nth(1)).toHaveClass(/active/)
  })
})
