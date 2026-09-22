import { describe, expect, it } from 'vitest'
import {
  charIndexAt,
  charRects,
  toVisibleIndex,
  type CharMeasureStyle,
} from './char-measure'

/** Fixed 10px advance per character: deterministic without canvas metrics. */
const measure = (text: string): number => text.length * 10

const left: CharMeasureStyle = { justification: 'left', leading: 14, anchorX: 0, anchorY: 0 }

describe('charIndexAt', () => {
  it('returns 0 for empty content', () => {
    expect(charIndexAt('', left, { x: 50, y: 50 }, measure)).toBe(0)
  })

  it('picks the closest offset on a left-aligned line', () => {
    // Advances: 0, 10, 20, 30, 40. x=25 ties 20/30: strict less keeps 2.
    expect(charIndexAt('abcd', left, { x: 25, y: 0 }, measure)).toBe(2)
    expect(charIndexAt('abcd', left, { x: 0, y: 0 }, measure)).toBe(0)
    // Past the end lands on the line length.
    expect(charIndexAt('abcd', left, { x: 100, y: 0 }, measure)).toBe(4)
  })

  it('offsets by justification', () => {
    const center: CharMeasureStyle = { ...left, anchorX: 100, justification: 'center' }
    // Line width 40, centered: slots at 80, 90, 100, 110, 120.
    expect(charIndexAt('abcd', center, { x: 85, y: 0 }, measure)).toBe(0)
    expect(charIndexAt('abcd', center, { x: 95, y: 0 }, measure)).toBe(1)
    const right: CharMeasureStyle = { ...left, anchorX: 100, justification: 'right' }
    // Right-aligned: slots at 60, 70, 80, 90, 100.
    expect(charIndexAt('abcd', right, { x: 95, y: 0 }, measure)).toBe(3)
  })

  it('treats justify like left', () => {
    const justify: CharMeasureStyle = { ...left, justification: 'justify' }
    expect(charIndexAt('abcd', justify, { x: 25, y: 0 }, measure)).toBe(2)
  })

  it('counts newlines in the global index', () => {
    // "ab\ncde": line 1 starts at global 3. y=20 -> round(20/14)=1.
    expect(charIndexAt('ab\ncde', left, { x: 5, y: 20 }, measure)).toBe(3)
    expect(charIndexAt('ab\ncde', left, { x: 25, y: 20 }, measure)).toBe(5)
    expect(charIndexAt('ab\ncde', left, { x: 5, y: 0 }, measure)).toBe(0)
  })

  it('clamps the line pick to the first/last line', () => {
    expect(charIndexAt('ab\ncde', left, { x: 5, y: -100 }, measure)).toBe(0)
    expect(charIndexAt('ab\ncde', left, { x: 5, y: 1000 }, measure)).toBe(3)
  })
})

describe('charRects', () => {
  it('returns no boxes for empty content', () => {
    expect(charRects('', left, measure)).toEqual([])
  })

  it('lays left-aligned boxes from the anchor', () => {
    const style: CharMeasureStyle = { justification: 'left', leading: 14, anchorX: 10, anchorY: 20 }
    expect(charRects('ab\nc', style, measure)).toEqual([
      { x: 10, y: 20, width: 10, height: 14 },
      { x: 20, y: 20, width: 10, height: 14 },
      { x: 10, y: 34, width: 10, height: 14 },
    ])
  })

  it('shifts boxes by justification', () => {
    const center: CharMeasureStyle = { justification: 'center', leading: 14, anchorX: 100, anchorY: 0 }
    const centered = charRects('ab', center, measure)
    expect(centered.map((r) => r.x)).toEqual([90, 100])
    const right: CharMeasureStyle = { justification: 'right', leading: 14, anchorX: 100, anchorY: 0 }
    expect(charRects('ab', right, measure).map((r) => r.x)).toEqual([80, 90])
  })

  it('emits one box per visible character (newlines produce none)', () => {
    expect(charRects('a\nb\nc', left, measure)).toHaveLength(3)
  })
})

describe('toVisibleIndex', () => {
  it('is the identity when there are no newlines', () => {
    expect(toVisibleIndex('abcd', 0)).toBe(0)
    expect(toVisibleIndex('abcd', 2)).toBe(2)
    expect(toVisibleIndex('abcd', 4)).toBe(4)
  })

  it('subtracts one per preceding newline', () => {
    // "ab\ncde": raw 3 is the 'c', the third visible box.
    expect(toVisibleIndex('ab\ncde', 3)).toBe(2)
    expect(toVisibleIndex('ab\ncde', 5)).toBe(4)
    expect(toVisibleIndex('a\nb\nc', 4)).toBe(2)
  })

  it('clamps out-of-range input', () => {
    expect(toVisibleIndex('ab\ncde', -5)).toBe(0)
    expect(toVisibleIndex('ab\ncde', 99)).toBe(5)
    expect(toVisibleIndex('', 3)).toBe(0)
  })

  it('round-trips the highlight range for multi-line text', () => {
    // Selecting "cde" (raw 3..6) must highlight boxes 2..5.
    const content = 'ab\ncde'
    expect(toVisibleIndex(content, 3)).toBe(2)
    expect(toVisibleIndex(content, 6)).toBe(5)
    expect(charRects(content, left, measure)).toHaveLength(5)
  })
})
