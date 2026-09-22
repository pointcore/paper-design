/**
 * TextSection acceptance (C2 template slice): the extracted text editor
 * wires exactly like the inlined version — size/bold/align edits repaint
 * the selected text and record history, and the section self-gates on a
 * selected text item.
 *
 * Usage: start `npm run dev` (default http://localhost:5173), then
 * `E2E_CHANNEL=chrome node e2e/text-section.mjs`
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

// Fixture: one selected point text.
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
  E.selectByIds([text.data.id])
  E.pushHistory('Setup')
})

const panel = page.locator('.property-panel')
await panel.waitFor({ state: 'visible' })
const section = panel.locator('.text-section')
await section.waitFor({ state: 'visible' })
check('text section shows for a text selection', await section.isVisible())

// Bold toggle repaints + records history.
await section.getByText('B', { exact: true }).click()
await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Change Font Weight')
const bold = await page.evaluate(() => {
  const E = window.__engine__
  const item = E.getSelection()[0]
  return { weight: String(item.fontWeight), history: E.history.at(-1)?.name }
})
check('bold repaints + records', bold.weight === 'bold' && bold.history === 'Change Font Weight', JSON.stringify(bold))

// Align center switches justification + records history.
await section.getByText('Center', { exact: true }).click()
await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Change Text Alignment')
const align = await page.evaluate(() => {
  const E = window.__engine__
  return E.getSelection()[0].justification
})
check('align center applies', align === 'center', String(align))

// Size input commits on Enter + records history.
const sizeInput = section.locator('.el-input-number input').first()
await sizeInput.fill('24')
await sizeInput.press('Enter')
await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Change Font Size')
const size = await page.evaluate(() => window.__engine__.getSelection()[0].fontSize)
check('size commits', Number(size) === 24, String(size))

// Selecting a non-text item hides the section again.
await page.evaluate(() => {
  const E = window.__engine__
  const S = E.scope
  const c = S.view.viewToProject(S.view.center)
  const rect = new S.Path.Rectangle({
    from: new S.Point(c.x - 50, c.y + 150),
    to: new S.Point(c.x + 50, c.y + 250),
  })
  rect.fillColor = new S.Color('#3366cc')
  rect.data.id = E.genId()
  rect.data.isUserItem = true
  E.getActiveLayer().addChild(rect)
  E.selectByIds([rect.data.id])
})
await page.waitForFunction(() => {
  const E = window.__engine__
  return E.getSelection()[0] instanceof E.scope.Path
})
check('section hides for non-text', !(await section.isVisible()))

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\n${results.length}/${results.length} passed` : `\n${failed.length} FAILED`)
await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
