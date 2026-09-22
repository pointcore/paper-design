/**
 * PatternSection acceptance (C2 template slice): the extracted pattern
 * editor wires exactly like the inlined version — Apply paints a pattern
 * group + records history, Remove restores + records history, and the
 * hint/buttons follow selection state.
 *
 * Usage: start `npm run dev` (default http://localhost:5173), then
 * `E2E_CHANNEL=chrome node e2e/pattern-section.mjs`
 */
import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173'

const results = []
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch(
  process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}
)
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
page.setDefaultTimeout(15000)

await page.goto(BASE)
await page.waitForFunction(() => window.__engine__ && window.__store__)

// Fixture: one selected path.
await page.evaluate(() => {
  const E = window.__engine__
  const S = E.scope
  const c = S.view.viewToProject(S.view.center)
  const rect = new S.Path.Rectangle({
    from: new S.Point(c.x - 100, c.y - 100),
    to: new S.Point(c.x + 100, c.y + 100),
  })
  rect.fillColor = new S.Color('#3366cc')
  rect.data.id = E.genId()
  rect.data.isUserItem = true
  E.getActiveLayer().addChild(rect)
  E.selectByIds([rect.data.id])
  E.pushHistory('Setup')
})

const panel = page.locator('.property-panel')
await panel.waitFor({ state: 'visible' })
const section = panel.locator('.pattern-section')
await section.waitFor({ state: 'attached' })

// Apply paints the pattern group and records history.
await section.getByText('Apply', { exact: true }).click()
await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Pattern Fill')
const appliedHint = await section.locator('.ai-desc').textContent()
check('apply records Pattern Fill', true)
check(
  'hint follows applied pattern',
  appliedHint?.includes('Remove before boolean ops') ?? false,
  appliedHint ?? '(no hint)'
)

// Remove restores the path and records history.
await section.getByText('Remove', { exact: true }).click()
await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Remove Pattern')
const removeBtn = section.getByText('Remove', { exact: true })
check('remove records Remove Pattern', true)
check('remove disables itself afterwards', await removeBtn.isDisabled())

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\n${results.length}/${results.length} passed` : `\n${failed.length} FAILED`)
await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
