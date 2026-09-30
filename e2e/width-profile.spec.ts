/**
 * Width profiles end to end: the panel, the library and the release.
 *
 * The Width tool used to expand a stroke into a filled outline and throw the
 * width away, so there was nothing left to adjust, save or reuse. These cases
 * go through the panel the user actually touches, and read the canvas to prove
 * the shape really is variable rather than merely tagged.
 */
import { test, check } from './fixtures'
import type { Page } from '@playwright/test'

/** A red stroked line across the view centre, selected. */
async function seedStrokedLine(page: Page) {
  return page.evaluate(() => {
    const E = window.__engine__
    const S = E.scope
    const c = S.view.viewToProject(S.view.center)
    const line = new S.Path({
      segments: [
        new S.Segment(new S.Point(c.x - 150, c.y)),
        new S.Segment(new S.Point(c.x + 150, c.y)),
      ],
    })
    ;(line as any).strokeColor = new S.Color('#ff0000')
    ;(line as any).strokeWidth = 8
    line.data.id = E.genId()
    line.data.isUserItem = true
    E.getActiveLayer().addChild(line)
    E.selectByIds([line.data.id])
    E.scope.view.update()
    return { id: String(line.data.id) }
  })
}

/**
/** Wait for the canvas to finish painting, so a pixel read cannot race
 * the repaint and report the previous frame. */
async function nextPaint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

/** The selection's paper item, read back as plain data. */
async function selectedInfo(page: Page) {
  return page.evaluate(() => {
    const E = window.__engine__
    const item = E.getSelection()[0] as any
    if (!item) return null
    const profile = E.getWidthProfile(item)
    return {
      id: item.data?.id,
      isPath: item instanceof E.scope.Path,
      strokeWidth: Number(item.strokeWidth) || 0,
      strokeColor: item.strokeColor?.toCSS?.() ?? null,
      fillColor: item.fillColor?.toCSS?.() ?? null,
      hasSource: !!item.data?.widthSource,
      profile: profile
        ? { name: profile.name, baseWidth: profile.baseWidth, stops: profile.stops }
        : null,
      height: item.bounds?.height ?? 0,
      width: item.bounds?.width ?? 0,
    }
  })
}

/** The Stroke section's width-profile row. */
function widthRow(page: Page) {
  return page.locator('.prop-row').filter({ has: page.locator('span', { hasText: /^Width$/ }) })
}

/** Pick a profile from the Stroke section of the property panel. */
async function pickProfile(page: Page, label: string) {
  await widthRow(page).locator('.el-select').first().click()
  const option = page.locator('.el-select-dropdown__item', { hasText: label }).first()
  await option.waitFor({ state: 'visible' })
  await option.click()
  await nextPaint(page)
  await page.waitForTimeout(120)
}

test.describe('Width profile', () => {
  test('a built-in profile expands the stroke to a variable shape', async ({ editor: page }) => {
    const seeded = await seedStrokedLine(page)
    const before = await selectedInfo(page)
    check('a stroked path is selected', before?.strokeWidth === 8, JSON.stringify(before))

    await pickProfile(page, 'Taper')
    const after = await selectedInfo(page)
    check('the object keeps its id', after?.id === seeded.id, JSON.stringify(after))
    check('it carries a width profile', after?.profile?.name === 'Taper', JSON.stringify(after))
    // Taper pinches both ends: the outline is taller than the 8pt stroke at the
    // middle, and the stroke paint moved to the fill.
    check('the stroke became the fill', after?.strokeColor === null && !!after?.fillColor, JSON.stringify(after))
    check('the shape grew at the middle', (after?.height ?? 0) > 7, JSON.stringify(after))
    check('the source path is kept for release', after?.hasSource === true, JSON.stringify(after))
  })

  test('the width profile is editable after the fact', async ({ editor: page }) => {
    await seedStrokedLine(page)
    await pickProfile(page, 'Taper')
    const tapered = await selectedInfo(page)

    // The same object, re-expanded with a different profile: this is what the
    // destructive expand could never do.
    const reexpanded = await page.evaluate(() => {
      const E = window.__engine__
      const item = E.getSelection()[0]
      const current = E.getWidthProfile(item)!
      return E.updateWidthProfile(item, {
        ...current,
        name: 'Wide',
        baseWidth: current.baseWidth * 2,
      })
    })
    check('the profile was re-applied', reexpanded === true, '')
    const after = await selectedInfo(page)
    check('it is the same object', after?.id === tapered?.id, JSON.stringify(after))
    check('the profile changed', after?.profile?.name === 'Wide', JSON.stringify(after))
    check('and so did the shape', (after?.height ?? 0) > (tapered?.height ?? 0), JSON.stringify({ tapered, after }))
  })

  test('releasing a profile brings the stroke back', async ({ editor: page }) => {
    const seeded = await seedStrokedLine(page)
    await pickProfile(page, 'Taper')
    await widthRow(page).getByTitle('Release the width profile back to the stroked path').click()
    await page.waitForTimeout(120)

    const back = await selectedInfo(page)
    check('the object is the same one', back?.id === seeded.id, JSON.stringify(back))
    check('the stroke is back', back?.strokeWidth === 8, JSON.stringify(back))
    check('with its own paint', back?.strokeColor === 'rgb(255,0,0)', JSON.stringify(back))
    check('and the profile is gone', back?.profile === null, JSON.stringify(back))
  })

  test('a profile can be saved to the library and reused', async ({ editor: page }) => {
    await seedStrokedLine(page)
    await pickProfile(page, 'Spike')
    const saved = await page.evaluate(() => {
      const E = window.__engine__
      const id = E.saveWidthProfile(E.getSelection()[0], 'My spike')
      return { id, names: E.store.widthProfiles.map((p: any) => p.name) }
    })
    check('the profile was saved', !!saved.id, JSON.stringify(saved))
    check('it is in the library', saved.names.includes('My spike'), JSON.stringify(saved))

    // Reuse it on a second stroke.
    const reused = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const second = new S.Path({
        segments: [
          new S.Segment(new S.Point(c.x - 150, c.y + 120)),
          new S.Segment(new S.Point(c.x + 150, c.y + 120)),
        ],
      })
      ;(second as any).strokeColor = new S.Color('#0000ff')
      ;(second as any).strokeWidth = 8
      second.data.id = E.genId()
      second.data.isUserItem = true
      E.getActiveLayer().addChild(second)
      E.selectByIds([second.data.id])
      const profile = E.store.widthProfiles.find((p: any) => p.name === 'My spike')
      return { done: E.applyWidthProfileToSelection(profile), width: Number(second.strokeWidth) }
    })
    check('the profile applied to the second stroke', reused.done === 1, JSON.stringify(reused))
    const after = await selectedInfo(page)
    check('which now carries it too', after?.profile?.name === 'My spike', JSON.stringify(after))
  })

  test('an unstroked path is refused rather than turned into a shape', async ({ editor: page }) => {
    const done = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const line = new S.Path({
        segments: [
          new S.Segment(new S.Point(c.x - 100, c.y)),
          new S.Segment(new S.Point(c.x + 100, c.y)),
        ],
      })
      line.data.id = E.genId()
      line.data.isUserItem = true
      E.getActiveLayer().addChild(line)
      E.selectByIds([line.data.id])
      const profile = E.store.widthProfiles.find((p: any) => p.name === 'Taper')
      return E.applyWidthProfileToSelection(profile)
    })
    check('nothing was expanded', done === 0, String(done))
  })

  test('the library ships usable built-ins in a fresh document', async ({ editor: page }) => {
    const info = await page.evaluate(() => {
      const E = window.__engine__
      return {
        count: E.store.widthProfiles.length,
        names: E.store.widthProfiles.map((p: any) => p.name),
        allValid: E.store.widthProfiles.every(
          (p: any) => p.baseWidth > 0 && Array.isArray(p.stops) && p.stops.length >= 2,
        ),
      }
    })
    check('there are profiles to pick', info.count >= 3, JSON.stringify(info))
    check('with names', info.names.every((n: string) => !!n), JSON.stringify(info))
    check('and all of them are drawable', info.allValid === true, JSON.stringify(info))
  })
})
