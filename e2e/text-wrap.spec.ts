/**
 * Area-text line breaking, end to end through the live text controller.
 *
 * The prohibition rules are unit tested in `text/line-break.test.ts`; what
 * this pins is that the *editor* uses them. The wrapper reached the frame
 * through a private method with its own inline greedy loop, so a refactor
 * there would have quietly dropped the CJK rules with nothing failing.
 *
 * Chinese text is written as code points because a literal that gets
 * mangled into a look-alike would make the assertions meaningless.
 */
import { test, check } from './fixtures'

/** A run of CJK prose with a full stop and a closing bracket in it. */
const CJK_PROSE =
  '\u4e2d\u6587\u6587\u5b57\u6d4b\u8bd5\u3002' + // 中文文字测试。
  '\u4e0b\u4e00\u53e5\u5f00\u59cb\uff0c' + // 下一句开始，
  '\u5e26\u62ec\u53f7\uff09\u5185\u5bb9\u3002' // 带括号）内容。

/** Characters that may not begin a line. */
const FORBIDDEN_HEADS = new Set([
  '\u3002', '\uff0c', '\uff09', '\u3001', '\uff01', '\uff1f', // 。，）、！？
  '\uff1a', '\uff1b', '\u2026', '\uff5c', // ：；…｜
])

test.describe('Area text line breaking', () => {
  test('no wrapped line starts with CJK closing punctuation', async ({ editor: page }) => {
    const result = await page.evaluate((prose) => {
      const E = window.__engine__
      const S = E.scope
      const c = S.view.viewToProject(S.view.center)
      const item = new S.PointText({
        point: new S.Point(c.x - 60, c.y),
        content: prose,
        fontSize: 24,
      })
      item.data.id = E.genId()
      item.data.isUserItem = true
      ;(item.data as any).frame = { x: c.x - 60, y: c.y, width: 60, height: 600 }
      ;(item.data as any).raw = prose
      E.getActiveLayer().addChild(item)

      // The public rewrap path the Text panel's width field drives.
      const ctrl = E.getController('area-type')
      const ok = ctrl.resizeAreaItem(item, 60, 600)
      return { ok, lines: String(item.content).split('\n') }
    }, CJK_PROSE)

    check('the frame rewrapped', result.ok)
    check('the text wrapped onto several lines', result.lines.length > 1, JSON.stringify(result.lines))
    const bad = result.lines.filter((l) => l.length > 0 && FORBIDDEN_HEADS.has(l[0]))
    check('no line starts with closing punctuation', bad.length === 0, JSON.stringify(bad))
    // Nothing may be lost: the wrapper only drops the space that broke a line.
    const rejoined = result.lines.join('').replace(/\s+/g, '')
    check(
      'the text survived the wrap',
      rejoined === CJK_PROSE.replace(/\s+/g, ''),
      `${rejoined.length} vs ${CJK_PROSE.length}`,
    )
  })

  test('a wider frame produces fewer lines', async ({ editor: page }) => {
    const wrap = (width: number) =>
      page.evaluate(
        ({ prose, w }) => {
          const E = window.__engine__
          const S = E.scope
          const c = S.view.viewToProject(S.view.center)
          const item = new S.PointText({
            point: new S.Point(c.x - 60, c.y),
            content: prose,
            fontSize: 24,
          })
          item.data.id = E.genId()
          item.data.isUserItem = true
          ;(item.data as any).frame = { x: c.x - 60, y: c.y, width: w, height: 600 }
          ;(item.data as any).raw = prose
          E.getActiveLayer().addChild(item)
          E.getController('area-type').resizeAreaItem(item, w, 600)
          return String(item.content).split('\n').length
        },
        { prose: CJK_PROSE, w: width },
      )

    const narrow = await wrap(70)
    const wide = await wrap(600)
    check('a wider frame wraps onto fewer lines', wide < narrow, `${wide} vs ${narrow}`)
  })
})
