/**
 * Line breaking for area-text frames, including CJK line-break prohibition
 * (kinsoku: line-head and line-tail character classes).
 *
 * Greedy wrapping alone is wrong for Chinese and Japanese: a line may not
 * begin with closing punctuation (the ideographic full stop, the comma, a
 * closing bracket, an ellipsis) and may not end with an opening bracket or a
 * currency sign. The browser's own line breaker knows these rules; our
 * wrapper measures on a 2d canvas and cuts the string itself, so it has to
 * apply them too.
 *
 * The rule is implemented as push-out (odashi), the same strategy the CSS
 * Text Level 3 `line-break` property prescribes: when a break would strand
 * a forbidden character, the character before it is pushed down as well
 * rather than hanging the punctuation into the margin. Hanging punctuation
 * (burasagari) would need a per-glyph negative offset the canvas renderer
 * cannot express, and squeezing the pair onto the line is what the CSS
 * `text-spacing` property exists to avoid.
 */

/**
 * Build a character set from code points, so this file stays pure ASCII.
 *
 * The members are code points rather than literals on purpose. CJK
 * punctuation is a forest of look-alikes one codepoint apart - 3002 beside
 * FF61, 30FB beside 00B7 beside the unassigned 3015 that turns up in real
 * files - and a literal that has to survive every editor, terminal and
 * copy-paste intact is not something to rely on when a silently mangled
 * member drops a rule without any test noticing. Which look-alikes to admit
 * is a policy choice, so the sets err towards including them.
 */
function charSet(...groups: number[][]): Set<string> {
  const out = new Set<string>()
  for (const group of groups) {
    for (const code of group) out.add(String.fromCharCode(code))
  }
  return out
}

/**
 * Characters that may not start a line: closing punctuation and brackets,
 * small kana, the prolonged sound mark, iteration marks, and the units and
 * primes that bind to the number on their left.
 */
const NO_LINE_START = charSet(
  // Terminators, fullwidth and halfwidth
  [0x3002, 0x3001, 0xff0c, 0xff0e, 0xff61, 0xff01, 0xff1f, 0xff1a, 0xff1b],
  [0x2c, 0x2e, 0x21, 0x3f, 0x3a, 0x3b],
  // Closing brackets
  [0x29, 0xff09, 0xff3d, 0x5d, 0xff5d, 0x7d, 0x3009, 0x300b, 0x300d, 0x300e, 0x300f, 0x3011],
  [0x3019, 0x3017, 0x301f, 0xff20, 0xbb, 0xff63],
  // Quotes that follow the text they belong to
  [0x2019, 0x201d, 0x301e],
  // Middle dots: katakana, latin, and the look-alikes seen in the wild
  [0x30fb, 0xb7, 0x2027, 0x3015],
  // Small kana cannot begin a line
  [0x3041, 0x3043, 0x3045, 0x3047, 0x3049, 0x3063, 0x3083, 0x3085, 0x3087],
  [0x308e, 0x3095, 0x3096, 0x309b, 0x309c],
  [0x30a1, 0x30a3, 0x30a5, 0x30a7, 0x30a9, 0x30c3, 0x30e3, 0x30e5, 0x30e7, 0x30ee, 0x30f5, 0x30f6],
  // Prolonged sound mark, wave dashes, iteration marks
  [0x30fc, 0x301c, 0xff5e, 0x309d, 0x309e, 0x30fd, 0x30fe, 0x3005, 0x303b],
  // Ellipsis and the vertical repetition marks
  [0x2026, 0x2025, 0x3033, 0x3034, 0x3035],
  // Units, primes and marks that bind left
  [0xff05, 0x2030, 0xb0, 0x2032, 0x2033, 0x2103, 0xa2, 0xa8, 0x3003],
  [0x339c, 0x339d, 0x339e, 0x33a1]
)

/**
 * Characters that may not end a line: opening brackets and quotes, plus the
 * currency and number signs that bind to the digits that follow them.
 */
const NO_LINE_END = charSet(
  [0x28, 0xff08, 0x3014, 0xff3b, 0x3010, 0xff5b, 0x7b, 0x3008, 0x300a, 0x300c, 0x300e],
  [0x3018, 0x3016, 0x301d, 0xff5f, 0xab, 0xff62],
  [0x2018, 0x201c],
  // Currency and number signs
  [0x24, 0xffe4, 0xffe5, 0xa5, 0xa3, 0x20ac, 0x20a9, 0x23, 0xff03, 0x40, 0xff20]
)

/** True when a line may begin with this character. */
export function canStartLine(ch: string): boolean {
  return !NO_LINE_START.has(ch)
}

/** True when a line may end with this character. */
export function canEndLine(ch: string): boolean {
  return !NO_LINE_END.has(ch)
}

/**
 * Pull a break point back until it is legal.
 *
 * `index` is the position the line would be cut at and `nextChar` is what
 * would open the following line, so the caller states the head it is about
 * to produce. Two rules have to hold at the cut, and satisfying one can
 * break the other - pulling a character down may strand a different one at
 * the head - so this iterates to a fixed point. It never returns below 1:
 * one over-long line beats an empty one.
 */
function legalBreakAt(text: string, index: number, nextChar: string): number {
  let i = Math.min(index, text.length)
  let moved = true
  while (moved && i > 1) {
    moved = false
    const head = i < text.length ? text[i] : nextChar
    if (!canStartLine(head)) {
      i--
      moved = true
      continue
    }
    if (!canEndLine(text[i - 1])) {
      i--
      moved = true
    }
  }
  return Math.max(1, i)
}

/**
 * Break one paragraph into lines no wider than `maxWidth`.
 *
 * `measure` returns the advance width of a candidate line in document units
 * (the caller injects its canvas probe, so this stays pure and testable
 * without a DOM). Breaks happen at the last space when there is one, and per
 * character for scripts that do not use spaces. The space that caused a break
 * is dropped, and no returned line starts or ends with a prohibited
 * character unless the paragraph offers no legal alternative.
 */
export function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  measure: (line: string) => number
): string[] {
  const lines: string[] = []
  let line = ''
  let breakAt = -1
  for (const ch of paragraph) {
    if (measure(line + ch) <= maxWidth || line.length === 0) {
      line += ch
      if (ch === ' ' || ch === '\t') breakAt = line.length
    } else if (breakAt > 0) {
      // Break at the last space; the head of the next line is whatever
      // follows it, since leading spaces are dropped.
      const head = line.slice(breakAt).replace(/^\s+/, '')[0] ?? ch
      const cut = legalBreakAt(line, breakAt, head)
      lines.push(line.slice(0, cut).replace(/\s+$/, ''))
      line = line.slice(cut).replace(/^\s+/, '') + ch
      breakAt = -1
    } else {
      // No space to break at: cut between characters, still respecting both
      // prohibition rules. A cut that lands on a space drops it, as the
      // space branch does, so "hello world" is two lines rather than
      // "hello" and " world".
      const cut = legalBreakAt(line, line.length, ch)
      lines.push(line.slice(0, cut))
      line = ch === ' ' ? '' : line.slice(cut) + ch
      breakAt = -1
    }
  }
  lines.push(line)
  return lines
}

/**
 * Wrap a whole text block, keeping explicit newlines as paragraph breaks.
 */
export function wrapText(raw: string, maxWidth: number, measure: (line: string) => number): string[] {
  const out: string[] = []
  for (const paragraph of raw.split('\n')) {
    out.push(...wrapParagraph(paragraph, maxWidth, measure))
  }
  return out
}
