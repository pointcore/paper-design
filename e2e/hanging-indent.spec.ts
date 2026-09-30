/**
 * Hanging indent, end to end through the live text controller.
 *
 * The indent is not just a stored number: it changes how the paragraph is
 * wrapped, because the body of the paragraph is narrower than its first line
 * and the wrapper has to know that. These cases read the rendered content, so
 * a break in that chain fails here.
 */
import { test, check } from './fixtures'
import type { Page } from '@playwright/test'

const PROSE = 'A paragraph long enough that the hanging indent has to wrap it onto several lines'

/** Create an area text, apply paragraph settings and report the content. */
async function layoutWith(
  page: Page,
  settings: { firstLineIndent?: number; hangingIndent?: number; spaceBefore?: number; spaceAfter?: number },
  width = 200,
  height = 400
) {
  return page.evaluate(
    (opts) => {
      const E = window.__engine__
      const S = E.scope
      const tc = E.getController('type') as any
      const c = S.view.viewToProject(S.view.center)
      const item = new S.PointText({
        point: new S.Point(c.x - opts.width / 2, c.y),
        content: opts.text,
        fontSize: 16,
      })
      item.fillColor = new S.Color('#111111')
      item.data.id = E.genId()
      item.data.isUserItem = true
      ;(item.data as any).textMode = 'area'
      ;(item.data as any).raw = opts.text
      ;(item.data as any).frame = { x: c.x - opts.width / 2, y: c.y, width: opts.width, height: opts.height }
      E.getActiveLayer().addChild(item)
      E.selectByIds([item.data.id])
      tc.setParagraphSettings(item, {
        firstLineIndent: opts.firstLineIndent ?? 0,
        hangingIndent: opts.hangingIndent ?? 0,
        spaceBefore: opts.spaceBefore ?? 0,
        spaceAfter: opts.spaceAfter ?? 0,
      })
      E.scope.view.update()
      return {
        content: String((E.getSelection()[0] as any).content),
        stored: { ...((E.getSelection()[0] as any).data.paragraphs ?? {}) },
      }
    },
    {
      width,
      height,
      text: PROSE,
      firstLineIndent: settings.firstLineIndent,
      hangingIndent: settings.hangingIndent,
      spaceBefore: settings.spaceBefore,
      spaceAfter: settings.spaceAfter,
    },
  )
}

test.describe('Hanging indent', () => {
  test('the body is indented and the first line is flush', async ({ editor: page }) => {
    const out = await layoutWith(page, { hangingIndent: 24 })
    const lines = out.content.split('\n')
    check('the paragraph wrapped', lines.length > 1, JSON.stringify(out))
    check('the first line starts flush', lines[0].startsWith(' ') === false, JSON.stringify(lines))
    check('the body lines are indented', lines.slice(1).every((l) => l.startsWith('  ')), JSON.stringify(lines))
    check('and the setting is stored', out.stored.hangingIndent === 24, JSON.stringify(out.stored))
  })

  test('without it, every line is flush', async ({ editor: page }) => {
    const out = await layoutWith(page, {})
    check('no line is indented', out.content.split('\n').every((l) => !l.startsWith(' ')), JSON.stringify(out.content))
  })

  test('the indented body still fits the frame', async ({ editor: page }) => {
    const out = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const tc = E.getController('type') as any
      const c = S.view.viewToProject(S.view.center)
      const width = 200
      const text = 'A paragraph long enough that the hanging indent has to wrap it onto several lines'
      const item = new S.PointText({
        point: new S.Point(c.x - width / 2, c.y),
        content: text,
        fontSize: 16,
      })
      item.data.id = E.genId()
      item.data.isUserItem = true
      ;(item.data as any).textMode = 'area'
      ;(item.data as any).raw = text
      ;(item.data as any).frame = { x: c.x - width / 2, y: c.y, width, height: 400 }
      E.getActiveLayer().addChild(item)
      E.selectByIds([item.data.id])
      tc.setParagraphSettings(item, {
        firstLineIndent: 0,
        hangingIndent: 24,
        spaceBefore: 0,
        spaceAfter: 0,
      })
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.font = `${item.fontStyle} ${item.fontWeight} ${item.fontSize}px ${item.fontFamily}`
      const lines = String((E.getSelection()[0] as any).content).split('\n')
      return { width, widths: lines.map((l: string) => ctx.measureText(l).width) }
    })
    const over = out.widths.filter((w: number) => w > out.width + 0.5)
    check('no line runs past the frame', over.length === 0, JSON.stringify(out))
  })

  test('a first-line indent and a hanging indent combine', async ({ editor: page }) => {
    const out = await layoutWith(page, { firstLineIndent: 40, hangingIndent: 24 })
    const lines = out.content.split('\n')
    const spaces = (line: string) => line.length - line.replace(/^ +/, '').length
    // A 40 first-line indent with a 24 hanging indent: the first line is out
    // by the difference, the body by the full hanging indent.
    check('the first line is indented less than the body', spaces(lines[0]) < spaces(lines[1] ?? ''), JSON.stringify(lines))
    check('and both are indented', spaces(lines[0]) > 0 && spaces(lines[1] ?? '') > 0, JSON.stringify(lines))
  })

  test('every paragraph starts flush, not just the first', async ({ editor: page }) => {
    const out = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const tc = E.getController('type') as any
      const c = S.view.viewToProject(S.view.center)
      const text = 'First paragraph runs long enough to wrap onto a second line here\nSecond paragraph also runs long enough to wrap'
      const item = new S.PointText({
        point: new S.Point(c.x - 100, c.y),
        content: text,
        fontSize: 16,
      })
      item.data.id = E.genId()
      item.data.isUserItem = true
      ;(item.data as any).textMode = 'area'
      ;(item.data as any).raw = text
      ;(item.data as any).frame = { x: c.x - 100, y: c.y, width: 200, height: 400 }
      E.getActiveLayer().addChild(item)
      E.selectByIds([item.data.id])
      tc.setParagraphSettings(item, {
        firstLineIndent: 0,
        hangingIndent: 24,
        spaceBefore: 0,
        spaceAfter: 0,
      })
      return String((E.getSelection()[0] as any).content)
    })
    const lines = out.split('\n')
    // The line after the break is the second paragraph's first line: flush.
    const secondStart = lines.findIndex((l, i) => i > 0 && l.startsWith('Second'))
    check('the second paragraph starts flush', secondStart > 0 && !lines[secondStart].startsWith(' '), JSON.stringify(lines))
  })

  test('a threaded frame keeps the hanging indent', async ({ editor: page }) => {
    const out = await page.evaluate(() => {
      const E = window.__engine__
      const S = E.scope
      const tc = E.getController('type') as any
      const c = S.view.viewToProject(S.view.center)
      const text = 'A paragraph long enough that the hanging indent has to wrap it onto several lines'
      const item = new S.PointText({
        point: new S.Point(c.x - 80, c.y),
        content: text,
        fontSize: 16,
      })
      item.data.id = E.genId()
      item.data.isUserItem = true
      ;(item.data as any).textMode = 'area'
      ;(item.data as any).raw = text
      ;(item.data as any).frame = { x: c.x - 80, y: c.y, width: 160, height: 30 }
      E.getActiveLayer().addChild(item)
      E.selectByIds([item.data.id])
      tc.setParagraphSettings(item, {
        firstLineIndent: 0,
        hangingIndent: 24,
        spaceBefore: 0,
        spaceAfter: 0,
      })
      tc.flowOverflowToNewFrame(item)
      const root = E.getItemById(String(item.data.id)) as any
      const frames = tc.threadFrames(root) as any[]
      return {
        frames: frames.length,
        settings: frames.map((f) => f.data.paragraphs?.hangingIndent ?? null),
        bodies: frames.map((f) =>
          String(f.content).split('\n').slice(1).map((l: string) => l.startsWith('  ')),
        ),
      }
    })
    check('a continuation frame was created', out.frames === 2, JSON.stringify(out))
    check('both frames keep the indent', out.settings.every((s: number | null) => s === 24), JSON.stringify(out))
    check('and both indent their body lines', out.bodies.every((b: boolean[]) => b.every(Boolean)), JSON.stringify(out))
  })
})
