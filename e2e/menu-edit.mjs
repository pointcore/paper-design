/**
 * EditMenu acceptance (C2 menu slice): the extracted Edit menu wires
 * exactly like the inlined version — undo/redo/delete via dropdown clicks,
 * Find & Replace dialog search, plus computed-style pins proving the dialog
 * CSS move (TopBar scoped -> AppDialog global) renders identically.
 *
 * Usage: start `npm run dev` (default http://localhost:5173), then
 * `E2E_CHANNEL=chrome node e2e/menu-edit.mjs`
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
      if (it instanceof S.Path || it instanceof S.CompoundPath || it instanceof S.PointText) n++
    }
    for (const layer of E.project.layers) {
      if (!layer.data?.isUserLayer) continue
      for (const child of layer.children) walk(child)
    }
    return n
  })
}

async function openEdit() {
  await page.locator('.top-bar').getByText('Edit', { exact: true }).click()
}

async function clickMenuItem(name) {
  await openEdit()
  await page.getByRole('menuitem', { name }).click()
}

// Fixture: one selected rect.
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

/* ---------- Delete / Undo / Redo via the menu ---------- */
await clickMenuItem('Delete')
await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Delete')
check('menu delete removes + records', (await artCount()) === 0)

await clickMenuItem('Undo')
await page.waitForFunction(() => window.__store__.canRedo === true)
check('menu undo restores', (await artCount()) === 1)

await clickMenuItem('Redo')
await page.waitForFunction(() => window.__store__.canUndo === true)
check('menu redo replays', (await artCount()) === 0)

await clickMenuItem('Undo')
await page.waitForFunction(() => {
  const E = window.__engine__
  const S = E.scope
  let n = 0
  for (const layer of E.project.layers) {
    if (!layer.data?.isUserLayer) continue
    for (const child of layer.children) {
      if (child instanceof S.Path || child instanceof S.CompoundPath) n++
    }
  }
  return n === 1
})

/* ---------- Find & Replace via the menu ---------- */
await page.evaluate(() => {
  const E = window.__engine__
  const S = E.scope
  const c = S.view.viewToProject(S.view.center)
  const text = new S.PointText({ point: new S.Point(c.x - 100, c.y), content: 'Hello', fontSize: 48 })
  text.fillColor = new S.Color('#111111')
  text.data.id = E.genId()
  text.data.isUserItem = true
  E.getActiveLayer().addChild(text)
  E.pushHistory('Setup')
})
await clickMenuItem('Find & Replace...')
const dialog = page.locator('.el-dialog', { hasText: 'Find & Replace' })
await dialog.waitFor({ state: 'visible' })
check('find dialog opens from menu', await dialog.isVisible())

await dialog.getByPlaceholder('Text to find').fill('Hello')
await page.waitForFunction(() => {
  const dlg = [...document.querySelectorAll('.el-dialog')].find((d) => d.textContent.includes('Find & Replace'))
  return dlg && dlg.textContent.includes('1 match')
})
check('search counts the match', true)

await dialog.getByText('Find Next', { exact: true }).click()
const selIsText = await page.evaluate(() => {
  const E = window.__engine__
  const sel = E.getSelection()
  return sel.length === 1 && sel[0] instanceof E.scope.PointText
})
check('find next selects the text', selIsText)

/* ---------- Dialog CSS pins (global move renders identically) ---------- */
const css = await page.evaluate(() => {
  const dlg = [...document.querySelectorAll('.el-dialog')].find((d) => d.textContent.includes('Find & Replace'))
  const name = dlg.querySelector('.setting-name')
  const wrapper = dlg.querySelector('.app-settings .el-input__wrapper')
  const cs = (el, prop) => (el ? getComputedStyle(el)[prop] : 'missing');
  return {
    nameColor: cs(name, 'color'),
    inputBg: cs(wrapper, 'backgroundColor'),
    inputBorder: cs(wrapper, 'borderTopColor'),
  }
})
check(
  'dialog CSS pins hold',
  css.nameColor === 'rgb(213, 213, 213)' &&
    css.inputBg === 'rgb(17, 17, 17)' &&
    css.inputBorder === 'rgb(61, 61, 61)',
  JSON.stringify(css)
)

const failed = results.filter((r) => !r.ok)
console.log(failed.length === 0 ? `\n${results.length}/${results.length} passed` : `\n${failed.length} FAILED`)
await browser.close()
process.exit(failed.length === 0 ? 0 : 1)
