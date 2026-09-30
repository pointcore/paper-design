/**
 * Threaded area text, end to end: two-way reflow across frames.
 *
 * Threading used to be a one-way split — the first frame's text was truncated
 * to the lines it kept and the overflow became an independent item — so
 * resizing the *second* frame could not pull text back, and the author's text
 * was gone from the first frame for good. These cases go through the live
 * controller, because the fix is only real if the frames hold a character
 * range of one shared text rather than a copy each.
 */
import { test, check } from './fixtures'
import type { Page } from '@playwright/test'

const PROSE =
  'The quick brown fox jumps over the lazy dog while the printer waits for a page that never arrives at all.'

/** Create an area-text item with a frame and some prose, and select it. */
async function seedAreaText(page: Page, width: number, height: number, raw = PROSE) {
  return page.evaluate(
    ({ w, h, text }) => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const item = new S.PointText({
        point: new S.Point(c.x - w / 2, c.y - h / 2),
        content: text,
        fontSize: 18,
      })
      item.fillColor = new S.Color('#111111')
      item.data.id = E.genId()
      item.data.isUserItem = true
      ;(item.data as any).textMode = 'area'
      ;(item.data as any).raw = text
      ;(item.data as any).frame = { x: c.x - w / 2, y: c.y - h / 2, width: w, height: h }
      E.getActiveLayer().addChild(item)
      E.selectByIds([item.data.id])
      E.scope.view.update()
      return { id: String(item.data.id) }
    },
    { w: width, h: height, text: raw },
  )
}

/**
 * Read the thread rooted at a known id.
 *
 * The root is addressed by id rather than searched for: a document can hold
 * several area-text items, and picking "the first one without a threadPrev"
 * is exactly the kind of guess that makes a test pass for the wrong reason.
 */
async function readThread(page: Page, rootId: string) {
  return page.evaluate((id) => {
    const E = window.__engine__
    const tc = E.getController('type') as any
    const root = E.getItemById(id) as any
    if (!root || !tc?.threadFrames) return null
    const frames = tc.threadFrames(root) as any[]
    return {
      raw: String(root.data.raw ?? ''),
      frames: frames.map((f) => ({
        id: String(f.data.id ?? ''),
        content: String(f.content ?? ''),
        raw: String(f.data.raw ?? ''),
        start: Number(f.data.threadStart ?? -1),
        end: Number(f.data.threadEnd ?? -1),
        next: String(f.data.threadNext ?? ''),
        prev: String(f.data.threadPrev ?? ''),
        lines: String(f.content ?? '').split('\n').length,
      })),
    }
  }, rootId)
}

test.describe('Threaded area text', () => {
  test('threading keeps the whole text in the first frame', async ({ editor: page }) => {
    const { id: rootId } = await seedAreaText(page, 140, 60)
    const linked = await page.evaluate(() => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      const item = E.getSelection()[0]
      return tc.flowOverflowToNewFrame(item)
    })
    check('a continuation frame was created', linked === true, String(linked))
    const thread = await readThread(page, rootId)
    check('the thread has two frames', thread?.frames.length === 2, JSON.stringify(thread))
    // The first frame keeps the author's text; it only *shows* what fits.
    check('the whole text is still in the first frame', thread?.raw === PROSE, JSON.stringify(thread?.raw))
    check('the frames are linked both ways', thread?.frames[0].next === thread?.frames[1].id && thread?.frames[1].prev === thread?.frames[0].id, JSON.stringify(thread?.frames))
    const shown = (thread?.frames ?? []).map((f) => f.content).join(' ')
    check('every word is on the canvas somewhere', shown.replace(/\s+/g, ' ').includes('printer waits'), JSON.stringify(thread?.frames))
  })

  test('growing a frame pulls its text back from the frame after it', async ({ editor: page }) => {
    const { id: rootId } = await seedAreaText(page, 140, 60)
    await page.evaluate(() => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      tc.flowOverflowToNewFrame(E.getSelection()[0])
    })
    const before = await readThread(page, rootId)
    const firstBefore = before?.frames[0].content ?? ''
    const secondBefore = before?.frames[1].content ?? ''
    check('the text starts split across the two frames', secondBefore.length > 0, JSON.stringify(before))

    // Shrink the first frame: the text it can no longer hold has to move on.
    const shrunk = await page.evaluate((id) => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      const root = E.getItemById(id) as any
      return tc.resizeAreaItem(root, 70, 24)
    }, rootId)
    check('the first frame was shrunk', shrunk === true, String(shrunk))
    const narrow = await readThread(page, rootId)
    check('it gave text to the next frame', (narrow?.frames[1].content ?? '').length > secondBefore.length, JSON.stringify(narrow?.frames))
    check('and kept less itself', (narrow?.frames[0].content ?? '').length < firstBefore.length, JSON.stringify(narrow?.frames))

    // Grow it again: the text comes *back* out of the second frame. The old
    // one-way split could not do this — the first frame had already thrown its
    // text away, and the second held a private copy.
    const grown = await page.evaluate((id) => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      const root = E.getItemById(id) as any
      return tc.resizeAreaItem(root, 140, 200)
    }, rootId)
    check('the first frame was grown', grown === true, String(grown))
    const after = await readThread(page, rootId)
    check('the text came back from the second frame', (after?.frames[0].content ?? '').length > (narrow?.frames[0].content ?? '').length, JSON.stringify(after?.frames))
    check('and the second frame gave it up', (after?.frames[1].content ?? '').length < (narrow?.frames[1].content ?? '').length, JSON.stringify(after?.frames))
    check('the text is still whole', after?.raw === PROSE, JSON.stringify(after?.raw))
    // Nothing was lost or duplicated in the round trip through the chain.
    const shown = (after?.frames ?? []).map((f) => f.content).join(' ').replace(/\s+/g, ' ')
    for (const word of ['quick', 'printer', 'arrives']) {
      check(`"${word}" is still there`, shown.includes(word), shown)
    }
  })

  test('shrinking the first frame pushes text downstream', async ({ editor: page }) => {
    // A frame that genuinely overflows, so there is something to push on.
    const { id: rootId } = await seedAreaText(page, 200, 40)
    await page.evaluate(() => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      tc.flowOverflowToNewFrame(E.getSelection()[0])
    })
    const before = await readThread(page, rootId)
    const secondBefore = before?.frames[1].lines ?? 0

    const narrowed = await page.evaluate((id) => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      const root = E.getItemById(id) as any
      return tc.resizeAreaItem(root, 80, 40)
    }, rootId)
    check('the first frame was narrowed', narrowed === true, String(narrowed))
    const after = await readThread(page, rootId)
    check('the second frame grew', (after?.frames[1].lines ?? 0) > secondBefore, JSON.stringify({ secondBefore, after: after?.frames }))
    check('the text never changed', after?.raw === PROSE, JSON.stringify(after?.raw))
  })

  test('a frame records the character range it owns', async ({ editor: page }) => {
    const { id: rootId } = await seedAreaText(page, 140, 60)
    await page.evaluate(() => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      tc.flowOverflowToNewFrame(E.getSelection()[0])
    })
    const thread = await readThread(page, rootId)
    const first = thread?.frames[0]
    const second = thread?.frames[1]
    check('the first frame starts at the beginning', first?.start === 0, JSON.stringify(thread))
    // Each frame owns a half-open range of the thread text, and the ranges
    // tile it: that is what lets an edit in one frame be spliced back in.
    check('the second frame starts where the first stopped', second?.start === first?.end, JSON.stringify({ first, second }))
    check('and its raw text is exactly the slice it shows', second?.raw === PROSE.slice(second?.start ?? 0, second?.end ?? 0), JSON.stringify(second))
    check('the ranges cover the text with no gap', first?.end === second?.start && second?.end === PROSE.length, JSON.stringify({ first, second }))
  })

  test('a three-frame thread reflows as one', async ({ editor: page }) => {
    const { id: rootId } = await seedAreaText(page, 120, 40)
    await page.evaluate(() => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      tc.flowOverflowToNewFrame(E.getSelection()[0])
    })
    // Thread the *second* frame: the chain is built by flowing whichever frame
    // is selected, which is how a user keeps a long article going.
    const grew = await page.evaluate((id) => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      const second = (tc.threadFrames(E.getItemById(id)) as any[])[1]
      return tc.flowOverflowToNewFrame(second)
    }, rootId)
    check('a third frame was created', grew === true, String(grew))
    const thread = await readThread(page, rootId)
    check('the thread has three frames', thread?.frames.length === 3, JSON.stringify(thread?.frames.length))
    check('the first frame still owns the text', thread?.raw === PROSE, JSON.stringify(thread?.raw))
    const ids = (thread?.frames ?? []).map((f) => f.id)
    check('the chain is linked end to end', thread?.frames.every((f, i) => f.next === (ids[i + 1] ?? '')), JSON.stringify(thread?.frames))
  })

  test('the thread survives a save and reopen with its links', async ({ editor: page }) => {
    const { id: rootId } = await seedAreaText(page, 140, 60)
    await page.evaluate(() => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      tc.flowOverflowToNewFrame(E.getSelection()[0])
    })
    const info = await page.evaluate((id) => {
      const E = window.__engine__
      const tc = E.getController('type') as any
      const json = E.exportProjectFile() as unknown as string
      const before = (() => {
        const root = E.getItemById(id) as any
        return { raw: String((root as any).data.raw ?? ''), frames: (tc.threadFrames(root) as any[]).length }
      })()
      E.newDocument(800, 600)
      E.importProjectFile(json)
      const after = (() => {
        const root = E.getItemById(id) as any
        if (!root) return { raw: '', frames: 0 }
        return { raw: String((root as any).data.raw ?? ''), frames: (tc.threadFrames(root) as any[]).length }
      })()
      return { before, after, hasJson: json.length > 0 }
    }, rootId)
    check('a project file was produced', info.hasJson, JSON.stringify(info))
    check('the text survives the round trip', info.after.raw === PROSE, JSON.stringify(info))
    check('and so do both frames', info.after.frames === info.before.frames && info.after.frames === 2, JSON.stringify(info))
  })
})
