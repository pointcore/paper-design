/**
 * Opacity-mask composition, measured on the canvas.
 *
 * The old preview drew a translucent white copy of the mask *over* the
 * artwork, so it hid the very thing the mask was supposed to reveal. These
 * cases read the live canvas: inside the mask the artwork must be there, and
 * outside it the artwork must be gone with nothing painted in its place.
 */
import { test, check } from './fixtures'
import type { Page } from '@playwright/test'

/** A blue rectangle masked by a smaller white circle at the same centre. */
async function seedMaskedRect(page: Page) {
  return page.evaluate(() => {
    const E = window.__engine__
    const S = E.scope
    const c = S.view.viewToProject(S.view.center)
    const layer = E.getActiveLayer()

    const content = new S.Path.Rectangle({
      from: new S.Point(c.x - 200, c.y - 200),
      to: new S.Point(c.x + 200, c.y + 200),
    })
    content.fillColor = new S.Color('#0000ff')
    content.data.id = E.genId()
    content.data.isUserItem = true
    layer.addChild(content)

    const mask = new S.Path.Circle(new S.Point(c.x, c.y), 60)
    mask.fillColor = new S.Color('#ffffff')
    mask.data.id = E.genId()
    mask.data.isUserItem = true
    layer.addChild(mask)

    const applied = E.applyOpacityMask(content, mask)
    E.scope.view.update()
    return { applied: applied === undefined, contentId: String(content.data.id) }
  })
}

/**
 * Wait for the canvas to finish painting.
 *
 * `view.update()` only marks the canvas dirty; the pixels a following
 * `getImageData` reads are from whichever frame has actually been drawn, so a
 * read that races the repaint sees the *previous* state and reports a
 * regression that is not there.
 */
async function nextPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

/** The live canvas pixel at a document offset from the view centre. */
async function pixelNearCenter(page: Page, dx: number, dy: number) {
  await nextPaint(page)
  return page.evaluate(
    ({ x, y }) => {
      const E = window.__engine__
      const c = E.scope.view.center
      const p = E.canvasToScreen(new E.scope.Point(c.x + x, c.y + y))
      const ctx = E.canvas.getContext('2d')
      if (!ctx) return null
      const d = ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data
      return [d[0], d[1], d[2], d[3]]
    },
    { x: dx, y: dy },
  )
}

/** The seeded artwork is a blue rectangle: strong blue, no red or green. */
function isArtwork(px: number[] | null): boolean {
  return !!px && px[2] > 200 && px[0] < 60 && px[1] < 60
}

/** The artboard sheet is white, so an empty spot reads as near-white. */
function isPage(px: number[] | null): boolean {
  return !!px && px[0] > 200 && px[1] > 200 && px[2] > 200
}

test.describe('Opacity mask', () => {
  test('composites the artwork to the mask silhouette on canvas', async ({ editor: page }) => {
    const seeded = await seedMaskedRect(page)
    check('the mask was applied', seeded.applied === true, JSON.stringify(seeded))

    const inside = await pixelNearCenter(page, 0, 0)
    const outside = await pixelNearCenter(page, 150, 0)
    check('inside the mask the artwork is visible', isArtwork(inside), JSON.stringify(inside))
    // Outside the mask the artwork is clipped away and the page shows through:
    // the old preview painted a translucent white copy of the mask *over* the
    // artwork, which is what made the masked result unreadable.
    check('outside the mask the artwork is gone', !isArtwork(outside), JSON.stringify(outside))
    check('and nothing is painted in its place', isPage(outside), JSON.stringify(outside))
  })

  test('the mask shape itself is not painted', async ({ editor: page }) => {
    await seedMaskedRect(page)
    // A circle mask over a bigger rect: the clip keeps only the disc, and the
    // mask has no paint of its own, so the disc shows the artwork and the
    // corners show the page.
    const state = await page.evaluate(() => {
      const E = window.__engine__
      const group = E.getUserItems()[0] as any
      const kids = (group.children ?? []) as any[]
      const shape = kids.find((k) => k.data?.isOpacityMaskShape)
      const content = kids.find((k) => k.data?.isOpacityMaskContent)
      return {
        isGroup: !!group.data?.isOpacityMaskGroup,
        kids: kids.length,
        shapeHasPaint: !!shape?.fillColor || !!shape?.strokeColor,
        shapeIsClipMask: shape?.clipMask === true,
        contentIsClipped: content?.clipped === true,
      }
    })
    check('the masked content lives in a mask group', state.isGroup, JSON.stringify(state))
    check('the group holds the shape and the content', state.kids === 2, JSON.stringify(state))
    check('the mask shape has no paint of its own', state.shapeHasPaint === false, JSON.stringify(state))
    check('the shape is the clip mask', state.shapeIsClipMask, JSON.stringify(state))
  })

  test('the exported SVG clips the artwork to the same silhouette', async ({ editor: page }) => {
    await seedMaskedRect(page)
    // Through the engine's own export, which is what ships to SVG/PDF.
    const info = await page.evaluate(() => {
      const E = window.__engine__
      const boards = E.store.artboards as Array<{ id: string }>
      const board = boards.find((b: { id: string }) => b.id === E.store.activeArtboardId) ?? boards[0]
      const root = (E.exportBoardVectorSVG?.(board) ?? null) as SVGSVGElement | null
      const clip = root?.querySelector('clipPath') ?? null
      const clipPaths: Element[] = Array.from(root?.querySelectorAll('clipPath path') ?? [])
      const clipD = clip?.querySelector('path')?.getAttribute('d') ?? null
      // Every `d` in the export, so "the mask is drawn as artwork too" is
      // measurable: the mask geometry must appear once, inside the clipPath.
      const allD: Array<string | null> = Array.from(root?.querySelectorAll('[d]') ?? []).map(
        (n: Element) => n.getAttribute('d'),
      )
      return {
        clipId: clip?.getAttribute('id') ?? null,
        clipD,
        clipShapes: clipPaths.length,
        uses: Array.from(root?.querySelectorAll('[clip-path]') ?? []).map(
          (n: Element) => n.getAttribute('clip-path'),
        ),
        maskDrawnElsewhere: allD.filter((d) => d === clipD).length,
      }
    })
    check('the export carries a clip path', !!info.clipId, JSON.stringify(info))
    check('the clip is the mask geometry', (info.clipD ?? '').includes('c'), JSON.stringify(info))
    check('the artwork is clipped by it', info.uses.includes(`url(#${info.clipId})`), JSON.stringify(info))
    check('the clip holds exactly the mask shape', info.clipShapes === 1, JSON.stringify(info))
    // The mask is geometry, not a second shape lying on top of the artwork: its
    // outline may only appear once in the export, inside the clipPath.
    check('the mask is not also exported as artwork', info.maskDrawnElsewhere === 1, JSON.stringify(info))
  })

  test('turning the mask off shows the artwork again', async ({ editor: page }) => {
    await seedMaskedRect(page)
    const read = async () => await pixelNearCenter(page, 150, 0)
    check('the artwork starts masked out', isPage(await read()), '')
    const setEnabled = (enabled: boolean) =>
      page.evaluate((on) => {
        const E = window.__engine__
        const group = E.getUserItems()[0] as any
        const content = (group.children ?? []).find((k: any) => k.data?.isOpacityMaskContent)
        E.toggleOpacityMask(content, on)
        E.scope.view.update()
        return true
      }, enabled)
    check('the toggle was applied', (await setEnabled(false)) === true, '')
    check('the artwork is back', isArtwork(await read()), '')
    check('the toggle back was applied', (await setEnabled(true)) === true, '')
    check('the mask clips again', isPage(await read()), '')
  })

  test('removing the mask puts the artwork back', async ({ editor: page }) => {
    await seedMaskedRect(page)
    const restored = await page.evaluate(() => {
      const E = window.__engine__
      const group = E.getUserItems()[0]
      E.removeOpacityMask(group)
      E.scope.view.update()
      const pixel: number[] = (() => {
        const c = E.scope.view.center
        const p = E.canvasToScreen(new E.scope.Point(c.x + 150, c.y))
        const ctx = E.canvas.getContext('2d')!
        return Array.from(ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data)
      })()
      return { items: E.getUserItems().length, pixel }
    })
    check('one item is left', restored.items === 1, JSON.stringify(restored))
    // Unmasked, the whole rectangle paints again.
    check('the artwork is back', isArtwork(restored.pixel), JSON.stringify(restored.pixel))
  })
})
