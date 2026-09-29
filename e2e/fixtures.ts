/**
 * Shared e2e fixture.
 *
 * The acceptance scripts used to live as standalone `e2e/*.mjs` files driven
 * by the bare `playwright` library. That meant `npm run test:e2e` only picked
 * up `*.spec.ts` (three smoke checks), so every real acceptance script had to
 * be run by hand and CI never saw them. These helpers let the same checks be
 * written as first-class specs: the dev server is managed by Playwright, each
 * failure retries, and a failing run leaves a trace and screenshots.
 */
import { test as base, expect, type Page } from '@playwright/test'

export const test = base.extend<{ editor: Page }>({
  editor: async ({ page }, use) => {
    await page.goto('/')
    // The dev-only window hooks are how every script pokes at the engine;
    // CanvasHost assigns them once the Paper.js scope exists.
    await page.waitForFunction(() => window.__engine__ && window.__store__)
    await use(page)
  },
})

export { expect }

/** Artwork census used by the end-to-end flow specs. */
export interface Snapshot {
  paths: number
  compounds: number
  texts: number
  masked: number
}

/**
 * Assert an acceptance condition without aborting the rest of the script.
 *
 * The `.mjs` versions pushed every result and reported the failures at the
 * end, which is what you want when a single regression breaks a dozen
 * downstream assumptions: `expect.soft` keeps the same "run everything, then
 * report" behavior while still producing standard Playwright output.
 */
export function check(name: string, condition: unknown, detail = '') {
  expect.soft(condition, detail ? `${name} — ${detail}` : name).toBeTruthy()
}

/**
 * Create a selected, styled rectangle at the current view center — the
 * fixture nearly every panel/section spec starts from.
 */
export async function seedSelectedRect(page: Page, fill = '#3366cc') {
  await page.evaluate((color) => {
    const E = window.__engine__
    const S = E.scope
    const c = S.view.viewToProject(S.view.center)
    const rect = new S.Path.Rectangle({
      from: new S.Point(c.x - 100, c.y - 100),
      to: new S.Point(c.x + 100, c.y + 100),
    })
    rect.fillColor = new S.Color(color)
    rect.data.id = E.genId()
    rect.data.isUserItem = true
    E.getActiveLayer().addChild(rect)
    E.selectByIds([rect.data.id])
    E.pushHistory('Setup')
  }, fill)
}

/** Create a selected, styled point-text item at the current view center. */
export async function seedSelectedText(page: Page, content = 'Hello') {
  await page.evaluate((text) => {
    const E = window.__engine__
    const S = E.scope
    const c = S.view.viewToProject(S.view.center)
    const item = new S.PointText({
      point: new S.Point(c.x - 100, c.y),
      content: text,
      fontSize: 48,
    })
    item.fillColor = new S.Color('#111111')
    item.data.id = E.genId()
    item.data.isUserItem = true
    E.getActiveLayer().addChild(item)
    E.selectByIds([item.data.id])
    E.pushHistory('Setup')
  }, content)
}

/**
 * Map document coordinates to page coordinates through the live view.
 *
 * Gesture specs must not hardcode a zoom: the expected document-space delta
 * of a 40px mouse move is 40 / zoom, so both the input and the assertion go
 * through the same conversion.
 */
export async function pagePoint(page: Page, docX: number, docY: number) {
  return page.evaluate(({ x, y }) => {
    const E = window.__engine__
    const p = E.canvasToScreen(new E.scope.Point(x, y))
    const r = E.canvas.getBoundingClientRect()
    return { x: r.left + p.x, y: r.top + p.y }
  }, { x: docX, y: docY })
}

/** Current view zoom, as the live paper.js view reports it. */
export async function liveZoom(page: Page) {
  return page.evaluate(() => window.__engine__.scope.view.zoom)
}

/** Open a top-bar menu by its visible label and click an item by name. */
export async function clickMenuItem(page: Page, menu: string, item: string) {
  await page.locator('.top-bar').getByText(menu, { exact: true }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

/**
 * Count drawable user items, descending through groups.
 *
 * Used instead of `history.length` / selection size because several specs
 * assert on real document contents after undo, redo and delete, where the
 * id set and the paper tree can legitimately disagree.
 */
export async function countArtwork(page: Page): Promise<number> {
  return page.evaluate(() => {
    const E = window.__engine__
    const S = E.scope
    let n = 0
    const walk = (it: any) => {
      if (it instanceof S.Group && !(it instanceof S.Layer)) {
        for (const c of it.children) walk(c)
        return
      }
      if (it instanceof S.Path || it instanceof S.CompoundPath || it instanceof S.PointText) n++
    }
    for (const layer of E.project.layers) {
      if (!layer.data?.isUserLayer) continue
      for (const child of layer.children) walk(child)
    }
    return n
  })
}

/** Wait until the document holds exactly `n` drawable user items. */
export async function waitForArtwork(page: Page, n: number) {
  await page.waitForFunction(
    (target) => {
      const E = window.__engine__
      const S = E.scope
      let count = 0
      const walk = (it: any) => {
        if (it instanceof S.Group && !(it instanceof S.Layer)) {
          for (const c of it.children) walk(c)
          return
        }
        if (it instanceof S.Path || it instanceof S.CompoundPath) count++
      }
      for (const layer of E.project.layers) {
        if (!layer.data?.isUserLayer) continue
        for (const child of layer.children) walk(child)
      }
      return count === target
    },
    n,
  )
}

/** Last `n` history entry names, newest last. */
export async function lastHistoryNames(page: Page, n = 2): Promise<string[]> {
  return page.evaluate((count) => window.__engine__.history.slice(-count).map((h: { name: string }) => h.name), n)
}
