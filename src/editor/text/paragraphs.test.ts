/**
 * Paragraph layout: first-line indent and vertical spacing.
 *
 * The two things worth being sure about are the units and the ordering: the
 * indent is measured against the font (so it is right at any size) and it
 * exists only in the rendered content (so the author's text stays clean), and
 * the vertical gap goes *above* a paragraph and never above the first one.
 */
import { describe, expect, it } from 'vitest'
import {
  defaultParagraphSettings,
  indentSpaces,
  layoutParagraphs,
  layoutToContent,
  normalizeParagraphSettings,
} from './paragraphs'
import { wrapTextWithParagraphs } from './line-break'

/** A space is 4 units wide and a character 10, so indents are readable. */
const measure = (line: string) => {
  let width = 0
  for (const ch of line) width += ch === ' ' ? 4 : 10
  return width
}

const wrapped = (raw: string, width = 50) => wrapTextWithParagraphs(raw, width, measure)

describe('normalizeParagraphSettings', () => {
  it('fills in the defaults for anything unusable', () => {
    expect(normalizeParagraphSettings(undefined)).toEqual(defaultParagraphSettings())
    expect(normalizeParagraphSettings('nonsense')).toEqual(defaultParagraphSettings())
    expect(normalizeParagraphSettings({ firstLineIndent: 'x' })).toEqual(defaultParagraphSettings())
  })

  it('clamps to a sane range and rounds the line counts', () => {
    const clean = normalizeParagraphSettings({
      firstLineIndent: -50,
      spaceBefore: 2.6,
      spaceAfter: 1e9,
    })
    expect(clean.firstLineIndent).toBe(0)
    expect(clean.spaceBefore).toBe(3)
    expect(clean.spaceAfter).toBe(20)
  })
})

describe('indentSpaces', () => {
  it('measures against the font rather than assuming', () => {
    // A space is 4 units, so 20 units of indent is 5 spaces.
    expect(indentSpaces(20, measure)).toBe(5)
    expect(indentSpaces(21, measure)).toBe(6)
  })

  it('never rounds an indent down to nothing', () => {
    expect(indentSpaces(0.2, measure)).toBe(1)
    expect(indentSpaces(0, measure)).toBe(0)
    expect(indentSpaces(-10, measure)).toBe(0)
  })

  it('falls back to one space when the font cannot be measured', () => {
    expect(indentSpaces(50, () => 0)).toBe(1)
  })
})

describe('layoutParagraphs', () => {
  const settings = (over: Partial<ReturnType<typeof defaultParagraphSettings>> = {}) => ({
    ...defaultParagraphSettings(),
    ...over,
  })

  it('indents the first line of every paragraph and no other line', () => {
    const lines = layoutParagraphs(wrapped('abcde\nfghij'), settings({ firstLineIndent: 20 }), measure)
    expect(lines.map((l) => l.text)).toEqual(['     abcde', '     fghij'])
  })

  it('leaves the wrapped continuation lines flush', () => {
    // 12 characters at 10 units wrap after 5 in a 50-unit frame.
    const lines = layoutParagraphs(wrapped('abcdefghijkl'), settings({ firstLineIndent: 20 }), measure)
    expect(lines.map((l) => l.text)).toEqual(['     abcde', 'fghij', 'kl'])
  })

  it('puts the gap above each paragraph except the first', () => {
    const lines = layoutParagraphs(
      wrapped('one\ntwo\nthree'),
      settings({ spaceBefore: 1 }),
      measure
    )
    expect(lines.map((l) => l.text)).toEqual(['one', '', 'two', '', 'three'])
    // The spacers are marked, so a caller can tell them from an empty
    // paragraph the author typed.
    expect(lines.filter((l) => l.spacer).length).toBe(2)
  })

  it('never puts a gap above the first paragraph', () => {
    const lines = layoutParagraphs(wrapped('only'), settings({ spaceBefore: 3 }), measure)
    expect(lines.map((l) => l.text)).toEqual(['only'])
  })

  it('appends the space after at the very end', () => {
    const lines = layoutParagraphs(wrapped('one\ntwo'), settings({ spaceAfter: 2 }), measure)
    expect(lines.map((l) => l.text)).toEqual(['one', 'two', '', ''])
  })

  it('handles an empty paragraph without inventing content', () => {
    const lines = layoutParagraphs(wrapped('a\n\nb'), settings({ firstLineIndent: 8 }), measure)
    expect(lines.map((l) => l.text)).toEqual(['  a', '  ', '  b'])
  })

  it('is the identity at the defaults', () => {
    const input = wrapped('one\ntwo\nthree')
    expect(layoutToContent(input, defaultParagraphSettings(), measure)).toBe('one\ntwo\nthree')
  })

  it('combines indent and spacing', () => {
    const lines = layoutParagraphs(
      wrapped('one\ntwo'),
      settings({ firstLineIndent: 8, spaceBefore: 1, spaceAfter: 1 }),
      measure
    )
    expect(lines.map((l) => l.text)).toEqual(['  one', '', '  two', ''])
  })
})

describe('layoutToContent', () => {
  it('produces the string a PointText takes', () => {
    expect(
      layoutToContent(wrapped('abcde\nfghij'), { ...defaultParagraphSettings(), firstLineIndent: 20 }, measure)
    ).toBe('     abcde\n     fghij')
  })
})
