/**
 * ObjectMenu acceptance (C2 menu slice): the extracted Object menu wires
 * exactly like the inlined version — group, offset dialog, lock cycle and
 * the envelope preset mapping (Fisheye vs Squeeze must distort
 * differently: a past hand-edit dropped two mapping lines).
 */
import { test, check, clickMenuItem } from './fixtures'

async function makeTwoRects(page: any) {
  return page.evaluate(() => {
    const E = window.__engine__
    const S = E.scope
    const c = S.view.viewToProject(S.view.center)
    E.project.getItems({ recursive: true }).forEach((it: any) => {
      if (it.data?.isUserItem) it.remove()
    })
    const mk = (x0: number, y0: number, x1: number, y1: number, fill: string) => {
      const r = new S.Path.Rectangle({
        from: new S.Point(c.x + x0, c.y + y0),
        to: new S.Point(c.x + x1, c.y + y1),
      })
      r.fillColor = new S.Color(fill)
      r.data.id = E.genId()
      r.data.isUserItem = true
      E.getActiveLayer().addChild(r)
      return r.data.id
    }
    const ids = [mk(-100, -100, 100, 100, '#3366cc'), mk(0, -100, 200, 100, '#cc6633')]
    E.selectByIds(ids)
    E.pushHistory('Setup')
    return ids
  })
}

/** Rounded anchor positions of the single selected path. */
async function anchorsOfSelection(page: any) {
  return page.evaluate(() => {
    const sel = window.__engine__.getSelection()[0]
    const segs = sel?.segments ?? []
    return segs.map((s: any) => [
      Math.round(s.point.x * 100) / 100,
      Math.round(s.point.y * 100) / 100,
    ])
  })
}

test.describe('Object menu', () => {
  test('group, offset, envelope presets and the lock cycle are wired', async ({ editor: page }) => {
    /* Group */
    await makeTwoRects(page)
    await clickMenuItem(page, 'Object', 'Group')
    await page.waitForFunction(() => window.__engine__.history.at(-1)?.name === 'Group')
    const grouped = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const sel = E.getSelection()
      return sel.length === 1 && sel[0] instanceof S.Group
    })
    check('menu group groups + records', grouped)

    /* Offset dialog */
    await makeTwoRects(page)
    await clickMenuItem(page, 'Object', 'Offset Path...')
    const offset = page.locator('.el-dialog', { hasText: 'Offset Path' })
    await offset.waitFor({ state: 'visible' })
    await offset.getByText('Apply', { exact: true }).click()
    await page.waitForFunction(() => window.__engine__.history.some((h: any) => h.name.includes('Offset')))
    check('offset dialog applies + records', true)

    /* Envelope presets must map to different history names and different
       geometry. The fixture is an octagon: a rect's corners are fixed points
       of both fisheye and squeeze, so it cannot tell them apart. */
    const applyEnvelope = async (presetLabel: string, historyName: string) => {
      await page.evaluate(() => {
        const E = window.__engine__
        const S = E.scope
        const c = S.view.viewToProject(S.view.center)
        E.project.getItems({ recursive: true }).forEach((it: any) => {
          if (it.data?.isUserItem) it.remove()
        })
        const pts = []
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          pts.push(new S.Point(c.x + Math.cos(a) * 80, c.y + Math.sin(a) * 80))
        }
        const poly = new S.Path(pts)
        poly.closed = true
        poly.fillColor = new S.Color('#3366cc')
        poly.data.id = E.genId()
        poly.data.isUserItem = true
        E.getActiveLayer().addChild(poly)
        E.selectByIds([poly.data.id])
        E.pushHistory('Setup')
      })
      await clickMenuItem(page, 'Object', presetLabel)
      await page.waitForFunction(
        (name) => window.__engine__.history.at(-1)?.name === name,
        historyName,
      )
      return anchorsOfSelection(page)
    }
    const fish = await applyEnvelope('Envelope: Fisheye', 'Envelope Fisheye')
    const fishAnchors = await anchorsOfSelection(page)
    const squeeze = await applyEnvelope('Envelope: Squeeze', 'Envelope Squeeze')
    const squeezeAnchors = await anchorsOfSelection(page)
    check(
      'fisheye and squeeze distort differently',
      JSON.stringify(fishAnchors) !== JSON.stringify(squeezeAnchors),
      `fish=${JSON.stringify(fishAnchors)} squeeze=${JSON.stringify(squeezeAnchors)}`,
    )

    /* Lock cycle */
    await makeTwoRects(page)
    await clickMenuItem(page, 'Object', 'Lock')
    const locked = await page.evaluate(() => window.__engine__.getSelection().every((it: any) => it.locked))
    check('menu lock locks', locked)
    await clickMenuItem(page, 'Object', 'Unlock All')
    const unlocked = await page.evaluate(() =>
      window.__engine__.getSelection().every((it: any) => !it.locked),
    )
    check('menu unlock-all restores', unlocked)
  })
})
