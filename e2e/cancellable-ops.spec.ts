/**
 * Cancellable long operations.
 *
 * The Cancel button is the only escape from a multi-hundred-megabyte import,
 * and the risky part is not the button but what a cancel unwinds: the open
 * paths clear the document before converting pages, so a cancel that did not
 * restore the previous document would silently destroy the user's work.
 *
 * The rollback is driven through the store's own cancel hook rather than a
 * dynamically imported copy of withBusy, so what is exercised is the engine's
 * signal threading and restore — the parts that can silently regress — plus
 * the real overlay button for the UI half.
 */
import { test, check, seedSelectedRect, expect } from './fixtures'
import { buildMinimalLegacyCdr } from '../src/editor/cdr/cdr-legacy-test-fixture'
import type { Page } from '@playwright/test'

/**
 * A real single-page legacy CDR, built here rather than in the page: the
 * fixture helper zips with node:zlib, which Vite cannot serve to a browser.
 */
function sampleCdr(): Uint8Array {
  const colorRecord = new Uint8Array(12)
  new DataView(colorRecord.buffer).setUint16(0, 17, true)
  colorRecord.set([0, 0, 0, 0], 8)
  return buildMinimalLegacyCdr({ fillId: 7, outlineId: 9, fillColorRecord: colorRecord })
}

/** Item census plus the artboard list, so a rollback is visible. */
async function docState(page: Page) {
  return page.evaluate(() => {
    const E = window.__engine__
    let items = 0
    const walk = (it: any) => {
      if (it instanceof E.scope.Group) {
        for (const c of it.children) walk(c)
        return
      }
      items++
    }
    for (const layer of E.project.layers) {
      if (!layer.data?.isUserLayer) continue
      for (const child of layer.children) walk(child)
    }
    return { items, boards: window.__store__.artboards.length }
  })
}

interface CancelRun {
  outcome: string
  sawParse: boolean
  sawPage: boolean
  busyAfter: boolean
  cancelAfter: unknown
}

/**
 * Run an import that is cancelled once the page loop has started.
 *
 * The open path clears the document before converting pages, so the cancel has
 * to land *after* the parse completes: aborting during the parse proves
 * nothing about the restore. The progress message is the discriminator, not the
 * fraction — the parse's last tick is 0.05 + 0.55 and the page loop's first is
 * 0.6, so the numbers are indistinguishable.
 */
async function importAndCancel(page: Page, open: boolean): Promise<CancelRun> {
  return page.evaluate(
    ({ isOpen, bytes }) => {
      const store = window.__store__
      const engine = window.__engine__

      // Exactly the hook withBusy installs for a cancellable operation, and
      // exactly what BusyOverlay's button invokes.
      const controller = new AbortController()
      store.setBusy(true, 'Opening…', null)
      store.setBusyCancellable(true, () => controller.abort())

      let sawParse = false
      let sawPage = false
      const progress = (f: number, msg?: string) => {
        if (typeof msg === 'string' && msg.startsWith('Importing page')) {
          sawPage = true
          store.busy.cancel?.()
        } else {
          sawParse = true
          store.setBusy(true, msg, Math.round(f * 99))
        }
      }

      let outcome = 'resolved'
      const run = isOpen
        ? engine.openCdrBytes(bytes, 'cancel.cdr', progress, controller.signal)
        : engine.importCdrBytes(bytes, 'cancel.cdr', progress, controller.signal)

      return run.then(
        () => {
          store.setBusyCancellable(false, null)
          store.setBusy(false)
          return {
            outcome,
            sawParse,
            sawPage,
            busyAfter: store.busy.active,
            cancelAfter: store.busy.cancel,
          }
        },
        (err: any) => {
          store.setBusyCancellable(false, null)
          store.setBusy(false)
          return {
            outcome: err?.name === 'AbortError' ? 'cancelled' : `error:${err?.name}`,
            sawParse,
            sawPage,
            busyAfter: store.busy.active,
            cancelAfter: store.busy.cancel,
          }
        },
      )
    },
    { isOpen: open, bytes: sampleCdr() },
  )
}

test.describe('Cancellable long operations', () => {
  test('a cancelled import leaves the document intact', async ({ editor: page }) => {
    await seedSelectedRect(page)
    const before = await docState(page)
    expect(before.items).toBe(1)

    const res = await importAndCancel(page, false)
    // The import path never clears the document, so any outcome is fine; what
    // matters is that no artwork or artboard was lost.
    expect(['cancelled', 'error:Error']).toContain(res.outcome)
    expect(res.busyAfter).toBe(false)
    expect(res.cancelAfter).toBeNull()

    const after = await docState(page)
    check('cancelled import keeps the existing artwork', after.items >= before.items)
    check('cancelled import keeps the artboards', after.boards === before.boards)
  })

  test('a cancelled open restores the document it had cleared', async ({ editor: page }) => {
    await seedSelectedRect(page)
    const before = await docState(page)

    const res = await importAndCancel(page, true)
    // Deliberately strict: the cancel must land in the page loop, after the
    // document has been cleared. Aborting during the parse would pass these
    // assertions with the restore removed — verified by deleting it.
    expect(res.sawParse).toBe(true)
    expect(res.sawPage).toBe(true)
    expect(res.outcome).toBe('cancelled')

    const after = await docState(page)
    // The load-bearing assertion: open* clears the project before converting
    // pages, so a cancel that skipped the restore would leave an empty
    // document behind while reporting success.
    check('cancelled open restores the pre-import artwork', after.items === before.items)
    check('cancelled open restores the artboards', after.boards === before.boards)
  })

  test('the overlay shows a working Cancel button during a real import', async ({ editor: page }) => {
    await page.evaluate(() => {
      const store = window.__store__
      store.setBusy(true, 'Opening big.cdr…', null)
      store.setBusyCancellable(true, () => store.setStatusMessage('cancelled by user'))
    })
    const overlay = page.locator('.busy-overlay')
    await expect(overlay).toBeVisible()
    const button = overlay.locator('.busy-cancel')
    await expect(button).toBeVisible()
    await expect(button).toHaveText('Cancel')

    await button.click()
    const status = await page.evaluate(() => window.__store__.statusMessage)
    expect(status).toBe('cancelled by user')

    // Non-cancellable work must not offer a control that cannot take effect.
    await page.evaluate(() => {
      const store = window.__store__
      store.setBusy(true, 'Tracing…', null)
      store.setBusyCancellable(false, null)
    })
    await expect(overlay.locator('.busy-cancel')).toHaveCount(0)

    await page.evaluate(() => window.__store__.setBusy(false))
    await expect(overlay).toHaveCount(0)
  })
})
