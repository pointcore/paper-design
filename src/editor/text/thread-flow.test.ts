/**
 * Threaded text: how one text is distributed across frames, and how an edit
 * in a continuation frame goes back into the whole.
 *
 * The offsets are the contract that matters: each frame has to own an exact
 * range of the thread text, because that range is what an edit in a
 * continuation frame splices into. A frame that claims the wrong range shows
 * the wrong text after a resize.
 */
import { describe, expect, it } from 'vitest'
import { flowTextThroughFrames, spliceThreadedText } from './thread-flow'

/** Fixed-width measure: 10 units per character. */
const measure = (line: string) => line.length * 10
const leading = 20

const frames = (count: number, width: number, height: number) =>
  Array.from({ length: count }, () => ({ width, height }))

describe('flowTextThroughFrames', () => {
  it('gives a short text to the first frame and nothing to the rest', () => {
    const out = flowTextThroughFrames('hello world', frames(3, 200, 100), { leading, measure })
    expect(out[0].content).toBe('hello world')
    expect(out[0].start).toBe(0)
    expect(out[1].content).toBe('')
    expect(out[2].content).toBe('')
    expect(out[0].overflowChars).toBe(0)
  })

  it('flows the tail into the next frame', () => {
    const text = 'aaaa bbbb cccc dddd'
    const out = flowTextThroughFrames(text, frames(2, 50, 20), { leading, measure })
    // Five characters per line at 10 units each, one line fits per frame, so
    // the first frame takes a line and hands the rest on.
    expect(out[0].content).toBe('aaaa')
    // The last frame takes everything that is left: there is nowhere else for
    // the text to go, and its `fits` says out loud that it does not all fit.
    expect(out[1].content).toBe('bbbb\ncccc\ndddd')
    expect(out[1].fits).toBe(1)
    // The frames tile the text: each starts where the last one stopped.
    expect(out[0].end).toBe(out[1].start)
    expect(out[1].end).toBe(text.length)
  })

  it('reports what does not fit anywhere', () => {
    const text = 'aaaa bbbb'
    const out = flowTextThroughFrames(text, frames(1, 50, 20), { leading, measure })
    expect(out[0].content).toBe('aaaa\nbbbb')
    expect(out[0].fits).toBe(1)
    expect(out[0].lines).toBe(2)
    expect(out[0].overflowChars).toBe(0)
  })

  it('counts spacer lines against the frame height', () => {
    // Two paragraphs with a blank line of paragraph spacing between them:
    // three rendered lines, so a frame holding two lines keeps only the first
    // paragraph — the blank in front of "two" belongs to the next frame.
    const out = flowTextThroughFrames('one\ntwo', frames(2, 100, 40), {
      leading,
      measure,
      settings: { firstLineIndent: 0, spaceBefore: 1, spaceAfter: 0 },
    })
    expect(out[0].fits).toBe(2)
    expect(out[0].content).toBe('one')
    expect(out[1].content).toBe('two')
  })

  it("keeps the author's own blank line", () => {
    // An empty paragraph is content, not spacing: it is a line like any other,
    // so it lands in whichever frame still has room for it.
    const out = flowTextThroughFrames('one\n\ntwo', frames(2, 100, 40), { leading, measure })
    expect(out[0].content).toBe('one\n')
    expect(out[1].content).toBe('two')
  })

  it('does not spend a frame line on a trailing blank', () => {
    const out = flowTextThroughFrames('one\ntwo', frames(2, 100, 40), {
      leading,
      measure,
      settings: { firstLineIndent: 0, spaceBefore: 1, spaceAfter: 0 },
    })
    expect(out[0].content.split('\n')).toEqual(['one'])
  })

  it('keeps every character exactly once across the frames', () => {
    const text = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do'
    const out = flowTextThroughFrames(text, frames(4, 70, 40), { leading, measure })
    // The wrapper drops the space it breaks at and may split a word that does
    // not fit, so the invariant is on the letters and on the offsets.
    const letters = out
      .map((w) => w.content)
      .join('')
      .replace(/\s+/g, '')
    expect(letters).toBe(text.replace(/\s+/g, ''))
    for (let i = 1; i < out.length; i++) {
      expect(out[i].start).toBe(out[i - 1].end)
    }
    expect(out[out.length - 1].end).toBe(text.length)
  })

  it('reflows both ways when the frames change size', () => {
    const text = 'aaaa bbbb cccc dddd eeee'
    // A tall first frame swallows more, a short one less.
    const tall = flowTextThroughFrames(text, frames(2, 50, 60), { leading, measure })
    const short = flowTextThroughFrames(text, frames(2, 50, 20), { leading, measure })
    expect(tall[0].content.split('\n').length).toBeGreaterThan(short[0].content.split('\n').length)
    // Both layouts still hand the text on, so the whole stays whole.
    expect(tall[1].end).toBe(text.length)
    expect(short[1].end).toBe(text.length)
  })

  it('re-wraps a first line narrower when the indent would overflow it', () => {
    const out = flowTextThroughFrames('abcdefgh', frames(1, 50, 40), {
      leading,
      measure,
      settings: { firstLineIndent: 20, spaceBefore: 0, spaceAfter: 0 },
    })
    // Five characters fit 50 units, but the indent (20) would push the first
    // line over, so it is wrapped at 30 units: three characters per line.
    expect(out[0].content).toBe('  abc\ndef\ngh')
  })

  it('never loops on a degenerate frame', () => {
    const out = flowTextThroughFrames('aaaa', frames(2, 0, 0), { leading, measure })
    // A zero frame still consumes a line's worth and then stops: the thread
    // ends where the text ends.
    expect(out[0].content.length).toBeGreaterThan(0)
    expect(out[out.length - 1].end).toBe('aaaa'.length)
  })

  it('handles an empty text without inventing lines', () => {
    const out = flowTextThroughFrames('', frames(2, 100, 100), { leading, measure })
    expect(out[0].content).toBe('')
    expect(out[1].content).toBe('')
    expect(out[0].overflowChars).toBe(0)
  })
})

describe('spliceThreadedText', () => {
  it('replaces exactly the frame\'s own range', () => {
    expect(spliceThreadedText('hello world', 6, 11, 'there')).toBe('hello there')
  })

  it('inserts when the range is empty', () => {
    expect(spliceThreadedText('abcd', 2, 2, 'XY')).toBe('abXYcd')
  })

  it('deletes when the replacement is empty', () => {
    expect(spliceThreadedText('hello world', 5, 11, '')).toBe('hello')
  })

  it('clamps a range that points outside the text', () => {
    expect(spliceThreadedText('abc', -5, 99, 'X')).toBe('X')
    // A reversed range is treated as empty rather than corrupting the text.
    expect(spliceThreadedText('abc', 3, 1, 'X')).toBe('abcX')
  })

  it('leaves the text alone for a no-op edit', () => {
    expect(spliceThreadedText('abc', 0, 3, 'abc')).toBe('abc')
  })
})
