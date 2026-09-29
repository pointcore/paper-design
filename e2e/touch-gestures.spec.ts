/**
 * Real-browser acceptance for touch gestures (D10), driven through the
 * dev-only `__engine__` / `__store__` hooks that CanvasHost exposes in DEV
 * builds. Touch input goes through CDP dispatchTouchEvent so the native
 * touchstart/move/end listeners run exactly as on a device.
 */
import { test, check, expect } from './fixtures'

test.use({ hasTouch: true })

async function canvasCenter(page: any) {
  return page.evaluate(() => {
    const r = window.__engine__.canvas.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
}

function touchSender(session: any) {
  return async (type: string, points: number[][]) => {
    await session.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1 })),
    })
  }
}

test.describe('Touch gestures', () => {
  test('pinch zoom, long-press menu and the in-flight gesture hand-off', async ({
    editor: page,
    browser,
  }) => {
    // Let the dock/panels settle so canvas coords stay put for the gestures.
    let prev = ''
    for (let i = 0; i < 30; i++) {
      const cur = await page.evaluate(() => {
        const r = window.__engine__.canvas.getBoundingClientRect()
        return [r.left, r.top, r.width, r.height].join(',')
      })
      if (cur === prev && cur !== '') break
      prev = cur
      await page.waitForTimeout(100)
    }

    const cdp = await page.context().newCDPSession(page)
    const touch = touchSender(cdp)
    const storeZoom = () => page.evaluate(() => window.__store__.view.zoom)

    const pinch = async (fromSpread: number, toSpread: number, steps = 6) => {
      const c = await canvasCenter(page)
      const at = (spread: number) => [
        [c.x - spread, c.y],
        [c.x + spread, c.y],
      ]
      await touch('touchStart', at(fromSpread))
      for (let i = 1; i <= steps; i++) {
        await touch('touchMove', at(fromSpread + ((toSpread - fromSpread) * i) / steps))
        await page.waitForTimeout(30)
      }
      await touch('touchEnd', [])
    }

    const menu = page.locator('.context-menu')

    /* Pinch out zooms in */
    const z0 = await storeZoom()
    await pinch(60, 120)
    const z1 = await storeZoom()
    check('pinch-out zooms in', z1 > z0 * 1.2, `${z0} -> ${z1}`)

    /* Pinch in zooms out */
    await pinch(120, 60)
    const z2 = await storeZoom()
    check('pinch-in zooms out', z2 < z1 / 1.2, `${z1} -> ${z2}`)

    /* Long press opens the canvas menu and it survives the lift tap */
    {
      const c = await canvasCenter(page)
      await touch('touchStart', [[c.x, c.y]])
      await page.waitForTimeout(700)
      const duringHold = await menu.isVisible()
      await touch('touchEnd', [])
      await page.waitForTimeout(200)
      check('long-press opens the menu during the hold', duringHold)
      check('menu survives the lift tap', await menu.isVisible())
      await page.keyboard.press('Escape')
    }

    /* Desktop right-click still opens it, Escape closes it */
    {
      const c = await canvasCenter(page)
      await page.mouse.click(c.x, c.y, { button: 'right' })
      check('right-click opens the menu', await menu.isVisible())
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
    }

    /* Second finger commits the in-flight tool gesture.
       A mouse-driven drag starts a shape preview; when the second finger
       lands the pinch's preventDefault suppresses the rest of the compat
       mouse stream, so a synthesized mouseup must commit the shape. CDP
       touches carry no compat mouse events, so the in-flight gesture starts
       via the real mouse path — the same state a finger's mousedown leaves. */
    {
      await page.evaluate(() => {
        window.__store__.setTool('rect')
        window.__engine__.setTool('rect')
      })
      const c = await canvasCenter(page)
      const b = [c.x + 120, c.y + 80]
      await page.mouse.move(c.x - 120, c.y - 80)
      await page.mouse.down()
      await page.mouse.move(c.x - 20, c.y - 10, { steps: 2 })
      await touch('touchStart', [
        [c.x - 20, c.y - 10],
        b,
      ])
      await page.waitForTimeout(80)
      const committed = await page.evaluate(() => window.__store__.history.at(-1)?.name ?? '')
      check('second finger commits the in-flight rectangle', committed === 'Draw Shape', committed)

      /* Pinch keeps working after the commit */
      const z3 = await storeZoom()
      await touch('touchMove', [
        [c.x - 150, c.y - 100],
        b,
      ])
      await page.waitForTimeout(50)
      await touch('touchEnd', [])
      const z4 = await storeZoom()
      check('pinch still zooms after the commit', z4 > z3 * 1.05, `${z3} -> ${z4}`)
      await page.mouse.up()
    }

    /* Mobile-UA single-finger drawing (P1 regression).
       Touch-driven ToolEvents carry a TouchEvent without `button`; an exact
       `native.button !== 0` guard used to reject every touch, leaving all
       tools dead on touch devices. Paper binds only touch listeners under a
       mobile UA, so this needs its own emulated context. */
    {
      const mctx = await browser.newContext({
        viewport: { width: 900, height: 700 },
        hasTouch: true,
        isMobile: true,
        userAgent:
          'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36',
      })
      const mpage = await mctx.newPage()
      await mpage.goto('/')
      await mpage.waitForFunction(() => window.__engine__ && window.__store__)
      await mpage.waitForTimeout(400)
      const mtouch = touchSender(await mctx.newCDPSession(mpage))
      await mpage.evaluate(() => {
        window.__store__.setTool('rect')
        window.__engine__.setTool('rect')
      })
      const mc = await canvasCenter(mpage)
      await mtouch('touchStart', [[mc.x - 80, mc.y - 50]])
      await mtouch('touchMove', [[mc.x + 20, mc.y + 30]])
      await mtouch('touchEnd', [[mc.x + 20, mc.y + 30]])
      await mpage.waitForTimeout(150)
      const mHist = await mpage.evaluate(() => window.__store__.history.at(-1)?.name ?? '')
      check('mobile single-finger finger-draws a rectangle', mHist === 'Draw Shape', mHist)
      await mctx.close()
    }
  })
})
