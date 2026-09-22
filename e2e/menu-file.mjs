/**
 * FileMenu acceptance (C2 menu slice): the extracted File menu wires
 * exactly like the inlined version — New Document (with dirty confirm),
 * Save As / Boards / Raster dialog openings.
 *
 * Usage: start `npm run dev` (default http://localhost:5173), then
 * `E2E_CHANNEL=chrome node e2e/menu-file.mjs`
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

// Fixture: one rect (dirty document, so New asks to confirm).
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

async function artCount() {
  return page.evaluate(() => {
    const E = window.__engine__
    const S = E.scope
    let n = 0
    const walk = (it) => {
      if (it instanceof S.Group && !(it instanceof S.Layer)) {
        for (const c of it.children) walk(c)
        return
      }
      if (it instanceof S.Path || it instanceof S.CompoundPath) n++
    }
    for (const layer of E.project.layers) {
      if (!layer.data?.isUserLayer) continue
      for (const child of layer.children) walk(child)
    }
    return n
  })
}

async function clickMenuItem(name) {
  await page.locator('.top-bar').getByText('File', { exact: true }).click()
  await page.getByRole('menuitem', { name }).click()
}

/* ---------- New Document with dirty confirm accepted ---------- */
page.on('dialog', (d) => void d.accept())
await clickMenuItem('New Document')
await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'New Document')
check('menu new resets the document', (await artCount()) === 0)

/* ---------- Save As dialog opens with a seeded name ---------- */
await clickMenuItem('Save As...')
const saveAs = page.locator('.el-dialog', { hasText: 'Save As' })
await saveAs.waitFor({ state: 'visible' })
const fileName = await saveAs.locator('input').inputValue()
check('save-as opens with a name', await saveAs.isVisible() && fileName.length > 0, fileName)
await saveAs.getByText('Cancel', { exact: true }).click()

/* ---------- Export Boards dialog lists the boards ---------- */
await clickMenuItem('Export Boards...')
const boards = page.locator('.el-dialog', { hasText: 'Export Boards' })
await boards.waitFor({ state: 'visible' })
const boxes = await boards.locator('.el-checkbox').count()
const boardCount = await page.evaluate(() => window.__store__.artboards.length)
check('boards dialog lists every board', boxes === boardCount, `${boxes}/${boardCount}`)
await boards.getByText('Cancel', { exact: true }).click()

/* ---------- Export Raster dialog opens ---------- */
await clickMenuItem('Export Raster...')
const raster = page.locator('.el-dialog', { hasText: 'Export Raster' })
await raster.waitFor({ state: 'visible' })
check('raster dialog opens from menu', await raster.isVisible())

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\n${results.length}/${results.length} passed` : `\n${failed.length} FAILED`)
await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
