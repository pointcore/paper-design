/**
 * CJK line-break prohibition (避头尾).
 *
 * Fixed 10px-per-character measuring keeps the expectations readable: a
 * `maxWidth` of 50 admits exactly five characters, so every assertion below
 * is about *where* the cut lands, not about font metrics. The invariant
 * cases (no line head or tail off-limits) are asserted alongside the exact
 * ones, because they are the property that actually matters for CJK text.
 *
 * The membership lists use `\u` escapes for the same reason the module does:
 * CJK punctuation look-alikes are one codepoint apart, and a mistyped
 * literal would quietly test the wrong character.
 */
import { describe, expect, it } from 'vitest'
import { canEndLine, canStartLine, wrapParagraph, wrapText } from './line-break'

/** 10px per character, like the other text unit tests. */
const measure = (line: string) => line.length * 10
const FIVE = 50

/**
 * Line heads that must be forbidden, by code point. Listed as code points
 * for the same reason the module does: a literal that silently becomes a
 * look-alike tests the wrong character and the suite still goes green.
 *
 * 3002 full stop, 3001 comma, ff0c fullwidth comma, ff01 ff1f ff1a ff1b
 * fullwidth ! ? : ;, ff09 fullwidth ), 3015 〕, ff3d ］, ff5d ｝, 3009 〉,
 * 300b 》, 300d corner close, 300e white corner close, 3011 】, 2026 …,
 * 2030 per mille, b0 degree, 2032 prime, 2033 double prime, 2103 Celsius,
 * 30fb katakana middle dot, 30fc prolonged sound, 3005 iteration, 30fd ヽ.
 */
const HEADS = [
  0x3002, 0x3001, 0xff0c, 0xff01, 0xff1f, 0xff1a, 0xff1b, 0xff09, 0x3015, 0xff3d,
  0xff5d, 0x3009, 0x300b, 0x300d, 0x300e, 0x3011, 0x2026, 0x2030, 0xb0, 0x2032,
  0x2033, 0x2103, 0x30fb, 0x30fc, 0x3005, 0x30fd,
]
/**
 * Line tails that must be forbidden: ff08 fullwidth (, 3014 〔, ff3b ［,
 * ff5b ｛, 3008 〈, 300a 《, 300c 「, 300e 『, 3010 【, 2018 ‘, 201c “,
 * then the currency and number signs.
 */
const TAILS = [
  0xff08, 0x3014, 0xff3b, 0xff5b, 0x3008, 0x300a, 0x300c, 0x300e, 0x3010,
  0x2018, 0x201c, 0x24, 0xffe5, 0xa5, 0x23,
]

/** Every line respects both prohibition rules. */
function expectLegalLines(lines: string[]) {
  for (const line of lines) {
    if (line.length === 0) continue
    expect(canStartLine(line[0]), `head of "${line}"`).toBe(true)
    expect(canEndLine(line[line.length - 1]), `tail of "${line}"`).toBe(true)
  }
}

describe('prohibition sets', () => {
  it('forbids the usual line heads', () => {
    for (const code of HEADS) {
      expect(canStartLine(String.fromCharCode(code)), code.toString(16)).toBe(false)
    }
  })

  it('forbids the usual line tails', () => {
    for (const code of TAILS) {
      expect(canEndLine(String.fromCharCode(code)), code.toString(16)).toBe(false)
    }
  })

  it('leaves ordinary characters alone', () => {
    for (const ch of 'abzAZ09 ') {
      expect(canStartLine(ch), ch.codePointAt(0)!.toString(16)).toBe(true)
      expect(canEndLine(ch), ch.codePointAt(0)!.toString(16)).toBe(true)
    }
  })
})

describe('wrapParagraph', () => {
  it('breaks CJK per character and latin at the last space', () => {
    expect(wrapParagraph('中文文字测试', FIVE, measure)).toEqual(['中文文字测', '试'])
    expect(wrapParagraph('hello world', FIVE, measure)).toEqual(['hello', 'world'])
  })

  it('drops the space that caused the break', () => {
    expect(wrapParagraph('aaa bbb ccc', FIVE, measure)).toEqual(['aaa', 'bbb', 'ccc'])
    // The break lands on the space with no later breakAt to fall back on,
    // which used to leave the next line starting with a space.
    expect(wrapParagraph('hi there', FIVE, measure)).toEqual(['hi', 'there'])
  })

  it('keeps a full stop off the next line', () => {
    // The greedy cut would strand 下一句。 的 "。" at the head of line 2.
    const lines = wrapParagraph('中文文字测试。下一句开始', FIVE, measure)
    expect(lines).toEqual(['中文文字测', '试。下一句', '开始'])
    expectLegalLines(lines)
  })

  it('keeps an opening bracket off the end of a line', () => {
    // Greedy would fill the first line to "中文文字（"; the bracket has to be
    // pushed down, which leaves room for the closing bracket to rejoin it.
    const lines = wrapParagraph('中文文字（括号内）', FIVE, measure)
    expect(lines).toEqual(['中文文字', '（括号内）'])
    expectLegalLines(lines)
  })

  it('pushes a closing pair down as one unbreakable unit', () => {
    const lines = wrapParagraph('中文文字测试），后面', FIVE, measure)
    expect(lines).toEqual(['中文文字测', '试），后面'])
    expectLegalLines(lines)
  })

  it('never returns an empty line for an unbreakable unit', () => {
    // One character wider than the frame: the greedy path has no legal cut,
    // so the line must overflow rather than vanish.
    expect(wrapParagraph('中', 5, measure)).toEqual(['中'])
  })

  it('applies the rules to a mixed latin / CJK sentence', () => {
    const lines = wrapParagraph('AI 与 CDR 都能打开。', FIVE, measure)
    expect(lines).toEqual(['AI 与', 'CDR', '都能打开。'])
    expectLegalLines(lines)
  })

  it('is a no-op when everything fits', () => {
    expect(wrapParagraph('短句', 500, measure)).toEqual(['短句'])
  })

  it('keeps the text it was given', () => {
    // Nothing may be dropped except the spaces that caused a break.
    const src = 'AI 与 CDR 都能打开，中文不换行。'
    const rejoined = wrapParagraph(src, FIVE, measure).join('')
    expect(rejoined.replace(/\s+/g, '')).toBe(src.replace(/\s+/g, ''))
  })
})

describe('wrapText', () => {
  it('keeps explicit newlines as paragraph boundaries', () => {
    expect(wrapText('中文文字\nabc', FIVE, measure)).toEqual(['中文文字', 'abc'])
  })

  it('wraps each paragraph independently', () => {
    expect(wrapText('中文文字测\n试。', FIVE, measure)).toEqual(['中文文字测', '试。'])
  })
})
