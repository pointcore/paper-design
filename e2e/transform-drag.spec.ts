/**
 * Transform-drag acceptance (C2 controller slice): real mouse drags on the
 * selection bbox handles drive the extracted kernels — a corner drag scales
 * the artwork + records history, an outside-corner drag rotates it.
 */
import { test, check, seedSelectedRect } from './fixtures'

/** Project point -> client (screen) coordinates for mouse driving. */
async function toScreen(page: any, x: number, y: number) {
  return page.evaluate(({ px, py }: { px: number; py: number }) => {
    const E = window.__engine__
    const r = E.canvas.getBoundingClientRect()
    const v = E.scope.view.projectToView(new E.scope.Point(px, py))
    return { x: r.left + v.x, y: r.top + v.y }
  }, { px: x, py: y })
}

async function selectionBounds(page: any) {
  return page.evaluate(() => {
    const b = window.__engine__.getSelectionBounds()
    return b ? { x: b.x, y: b.y, width: b.width, height: b.height } : null
  })
}

test.describe('Transform drag', () => {
  test('corner drag scales and outside-corner drag rotates', async ({ editor: page }) => {
    await seedSelectedRect(page)

    /* 1. corner drag scales */
    const before = await selectionBounds(page)
    const br = await toScreen(page, before.x + before.width, before.y + before.height)
    await page.mouse.move(br.x, br.y)
    await page.mouse.down()
    await page.mouse.move(br.x + 60, br.y + 60, { steps: 8 })
    await page.mouse.up()

    await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Scale')
    const after = await selectionBounds(page)
    check(
      'corner drag scales the artwork + records history',
      after.width > before.width + 10 && after.height > before.height + 10,
      `${Math.round(before.width)}x${Math.round(before.height)} -> ${Math.round(after.width)}x${Math.round(after.height)}`,
    )

    /* 2. outside-corner drag rotates.
       Fresh small rect so the rotate sweep is unambiguous. */
    await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      E.project.getItems({ recursive: true }).forEach((it: any) => {
        if (it.data?.isUserItem) it.remove()
      })
      const rect = new S.Path.Rectangle({
        from: new S.Point(c.x - 50, c.y - 50),
        to: new S.Point(c.x + 50, c.y + 50),
      })
      rect.fillColor = new S.Color('#cc6633')
      rect.data.id = E.genId()
      rect.data.isUserItem = true
      E.getActiveLayer().addChild(rect)
      E.selectByIds([rect.data.id])
      E.pushHistory('Setup')
    })
    const bounds2 = await selectionBounds(page)
    // Just outside the top-right corner (rotate band: outside quad, <14px).
    const rot = await toScreen(page, bounds2.x + bounds2.width + 8, bounds2.y - 8)
    await page.mouse.move(rot.x, rot.y)
    await page.mouse.down()
    await page.mouse.move(rot.x + 50, rot.y + 10, { steps: 8 })
    await page.mouse.up()

    await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Rotate')
    const rotated = await selectionBounds(page)
    check(
      'outside-corner drag rotates + records history',
      Math.abs(rotated.width - bounds2.width) > 1 || Math.abs(rotated.height - bounds2.height) > 1,
      `${Math.round(bounds2.width)}x${Math.round(bounds2.height)} -> ${Math.round(rotated.width)}x${Math.round(rotated.height)}`,
    )
  })
})
