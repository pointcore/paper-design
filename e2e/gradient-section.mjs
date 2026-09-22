/**
 * GradientSection acceptance (C2 template slice): the extracted gradient
 * editor wires exactly like the inlined version — kind switch paints the
 * selection + records history, Add Stop grows the rows, reverse keeps a
 * separate entry, switching back to solid hides the section.
 *
 * Usage: start `npm run dev` (default http://localhost:5173), then
 * `E2E_CHANNEL=chrome node e2e/gradient-section.mjs`
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

// Fixture: one selected rect, like main-flow.mjs.
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
const section = panel.locator('.gradient-section')

// Starts hidden (store default is solid).
check('gradient section hidden while solid', !(await section.isVisible()))

// Switch Fill -> Gradient via the segmented control.
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
  JSON.stringify(gradInfo)
)

// Two stop rows + type/angle/add rows = 5 prop-rows.
check('two stop rows rendered', (await section.locator('.prop-row').count()) === 5)

// Add Stop grows the rows and records (coalesced or new) history.
await section.getByText('Add Stop', { exact: true }).click()
await page.waitForFunction(() => (window.__store__.style.gradient?.stops.length ?? 0) === 3)
check('add stop grows rows', (await section.locator('.prop-row').count()) === 6)

// Reverse keeps its own history entry (different label, no coalescing).
await section.getByTitle('Reverse gradient direction').click()
const lastTwo = await page.evaluate(() => {
  const H = window.__engine__.history
  return H.slice(-2).map((h) => h.name)
})
check('reverse records its entry', JSON.stringify(lastTwo) === '["Change Gradient","Reverse Gradient"]', lastTwo.join(','))

// Back to solid hides the section and clears the gradient.
await panel.getByText('Fill', { exact: true }).first().click()
await page.waitForFunction(() => !window.__store__.style.gradient)
check('solid hides section again', !(await section.isVisible()))

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\n${results.length}/${results.length} passed` : `\n${failed.length} FAILED`)
await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
