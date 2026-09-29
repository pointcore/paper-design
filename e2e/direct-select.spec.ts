/**
 * Real-browser direct-select acceptance (F20 prerequisite): anchor hit +
 * drag, anchor marquee, and the endpoint join (Ctrl+J) through the real
 * select controller — the highest-risk gesture layer that had no e2e cover,
 * gating any future select-controller decomposition.
 */
import { test, check, pagePoint, liveZoom } from './fixtures'

test.describe('Direct select gestures', () => {
  test('anchor drag, anchor marquee and the endpoint join are wired', async ({ editor: page }) => {
    // One zigzag open path centered on the current view.
    const zig = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      // insert:false + explicit addChild: the bare active layer can be a
      // chrome layer (guides) at boot time.
      const path = new S.Path({
        segments: [
          [c.x - 150, c.y - 80],
          [c.x, c.y],
          [c.x + 150, c.y + 80],
        ],
        insert: false,
      })
      E.getActiveLayer().addChild(path)
      path.data.id = E.genId()
      path.data.isUserItem = true
      path.strokeColor = '#3366cc'
      path.strokeWidth = 2
      return {
        id: path.data.id,
        b: { x: c.x, y: c.y },
        z: { x: c.x + 150, y: c.y + 80 },
      }
    })

    await page.evaluate(() => {
      window.__store__.setTool('direct-select')
      window.__engine__.setTool('direct-select')
    })

    /* 1. anchor click + drag moves the anchor */
    const at = await pagePoint(page, zig.b.x, zig.b.y)
    await page.mouse.move(at.x, at.y)
    await page.mouse.down()
    await page.mouse.move(at.x + 40, at.y + 25, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(100)
    const state1 = await page.evaluate((id) => {
      const path = window.__engine__.project.getItem({ data: { id } })
      const seg = path?.segments[1]
      return seg ? { x: seg.point.x, y: seg.point.y } : null
    }, zig.id)
    const zoom1 = await liveZoom(page)
    check(
      'anchor drag moves the middle anchor',
      !!state1 &&
        Math.abs(state1.x - (zig.b.x + 40 / zoom1)) < 2 &&
        Math.abs(state1.y - (zig.b.y + 25 / zoom1)) < 2,
      state1 ? `got (${state1.x.toFixed(1)}, ${state1.y.toFixed(1)})` : 'path missing',
    )

    /* 2. marquee over an anchor sub-selects it */
    // Drag an empty-area marquee around the path's end anchor, then move the
    // pointer: only a sub-selected anchor translates.
    const z = await pagePoint(page, zig.z.x, zig.z.y)
    await page.mouse.move(z.x - 30, z.y - 30)
    await page.mouse.down()
    await page.mouse.move(z.x + 30, z.y + 30, { steps: 3 })
    await page.mouse.up()
    await page.waitForTimeout(100)
    await page.mouse.move(z.x, z.y)
    await page.mouse.down()
    await page.mouse.move(z.x + 35, z.y - 20, { steps: 4 })
    await page.mouse.up()
    await page.waitForTimeout(100)
    const state2 = await page.evaluate((id) => {
      const path = window.__engine__.project.getItem({ data: { id } })
      const seg = path?.segments[2]
      return seg ? { x: seg.point.x, y: seg.point.y } : null
    }, zig.id)
    const zoom2 = await liveZoom(page)
    check(
      'marquee sub-selects the end anchor and drags it',
      !!state2 &&
        Math.abs(state2.x - (zig.z.x + 35 / zoom2)) < 2 &&
        Math.abs(state2.y - (zig.z.y - 20 / zoom2)) < 2,
      state2 ? `got (${state2.x.toFixed(1)}, ${state2.y.toFixed(1)})` : 'path missing',
    )

    /* 3. endpoint join via Ctrl+J */
    // Two open paths whose near ends sit 10px apart, so each anchor click is
    // unambiguous (the join itself bridges the gap).
    const ends = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const mk = (pts: number[][]) => {
        const p = new S.Path({ segments: pts, insert: false })
        E.getActiveLayer().addChild(p)
        p.data.id = E.genId()
        p.data.isUserItem = true
        p.strokeColor = '#cc5533'
        p.strokeWidth = 2
        return p
      }
      const a = mk([
        [c.x - 200, c.y + 150],
        [c.x, c.y + 150],
      ])
      const b = mk([
        [c.x + 10, c.y + 150],
        [c.x + 120, c.y + 210],
      ])
      return {
        aEnd: { x: a.segments[1].point.x, y: a.segments[1].point.y },
        bStart: { x: b.segments[0].point.x, y: b.segments[0].point.y },
        aId: a.data.id,
        bId: b.data.id,
      }
    })

    const hitA = await pagePoint(page, ends.aEnd.x, ends.aEnd.y)
    await page.mouse.click(hitA.x, hitA.y)
    const hitB = await pagePoint(page, ends.bStart.x, ends.bStart.y)
    await page.keyboard.down('Shift')
    await page.mouse.click(hitB.x, hitB.y)
    await page.keyboard.up('Shift')

    const before = await page.evaluate(() => window.__store__.history.at(-1)?.name ?? '')
    await page.keyboard.press('Control+j')
    await page.waitForTimeout(150)
    const after = await page.evaluate(
      ({ aId, bId }) => {
        const E = window.__engine__
        const hist = window.__store__.history.at(-1)?.name ?? ''
        const stillThere = [aId, bId].some((id) => !!E.project.getItem({ data: { id } }))
        return { hist, bothGone: !stillThere }
      },
      { aId: ends.aId, bId: ends.bId },
    )
    check(
      'Ctrl+J merges the two sub-selected endpoints',
      after.hist === 'Join Paths' && after.bothGone && before !== 'Join Paths',
      `history: ${after.hist}`,
    )
  })
})
