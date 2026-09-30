/**
 * Paragraph layout for text frames.
 *
 * A frame's text is one Paper.js PointText whose content is the wrapped
 * lines joined by newlines, which means the renderer has exactly one leading
 * for the whole item and no per-line object to hang spacing on. That
 * constraint decides the units, so it is worth stating plainly:
 *
 * - **First-line indent** is in document units and is applied as leading
 *   spaces on the first line of each paragraph, measured against the current
 *   font so the visual indent is right at any size. The stored text stays
 *   clean: the spaces exist only in the rendered content, so copy, Find and
 *   Replace and per-character selection all still see the author's text.
 * - **Space before / after** is in *lines*, applied as blank lines. A
 *   sub-line value is not expressible with one leading for the item, and
 *   faking it with a thin space would put a real space character into the
 *   text. Lines are the honest unit here, and they are what a designer
 *   setting paragraph spacing in a fixed-leading frame actually wants.
 *
 * A paragraph model proper (per-line items, per-paragraph alignment and
 * spacing in points) is the real fix and is out of scope here; see
 * docs/FEATURE-GAPS-AI-CDR.md.
 */

/** Per-frame paragraph settings, stored on the text item's data. */
export interface ParagraphSettings {
  /** First-line indent in document units (0 = flush left). */
  firstLineIndent: number
  /** Blank lines inserted before each paragraph except the first. */
  spaceBefore: number
  /** Blank lines inserted after the last paragraph. */
  spaceAfter: number
}

export function defaultParagraphSettings(): ParagraphSettings {
  return { firstLineIndent: 0, spaceBefore: 0, spaceAfter: 0 }
}

/** Coerce anything (a saved file, a hand-edited project) into valid settings. */
export function normalizeParagraphSettings(raw: unknown): ParagraphSettings {
  const fallback = defaultParagraphSettings()
  if (!raw || typeof raw !== 'object') return fallback
  const value = raw as Partial<ParagraphSettings>
  const num = (v: unknown, max: number): number => {
    const n = Number(v)
    if (!Number.isFinite(n)) return 0
    return Math.min(max, Math.max(0, n))
  }
  return {
    firstLineIndent: num(value.firstLineIndent, 1e5),
    spaceBefore: Math.round(num(value.spaceBefore, 20)),
    spaceAfter: Math.round(num(value.spaceAfter, 20)),
  }
}

/** One wrapped line and which paragraph it belongs to. */
export interface PositionedLine {
  text: string
  /** 0-based paragraph index; blank spacer lines inherit the next index. */
  paragraph: number
  /** True for a line that only exists to make vertical space. */
  spacer: boolean
}

/**
 * How many space characters are needed to cover `indent` document units.
 *
 * Measured rather than assumed: a space in the current font is a fraction of
 * the em, so a hardcoded "one space per N units" would be wrong at every
 * font size except one. Returns at least 1 for a non-zero indent, because an
 * indent of 0.2 units still has to be visible.
 */
export function indentSpaces(indent: number, measure: (line: string) => number): number {
  if (!(indent > 0)) return 0
  const one = measure(' ')
  if (!(one > 0)) return 1
  // Round up so the indent is never short of what was asked for.
  return Math.max(1, Math.ceil(indent / one))
}

/**
 * Turn wrapped lines plus their paragraph indices into the final content
 * string, applying the indent and the vertical spacing.
 */
export function layoutParagraphs(
  lines: Array<{ text: string; paragraph: number }>,
  settings: ParagraphSettings,
  measure: (line: string) => number
): PositionedLine[] {
  const { firstLineIndent, spaceBefore, spaceAfter } = normalizeParagraphSettings(settings)
  const spaces = indentSpaces(firstLineIndent, measure)
  const out: PositionedLine[] = []
  let previousParagraph = -1

  for (const line of lines) {
    if (line.paragraph !== previousParagraph) {
      // A new paragraph: the gap goes above it, never above the first one.
      if (previousParagraph >= 0 && spaceBefore > 0) {
        for (let i = 0; i < spaceBefore; i++) {
          out.push({ text: '', paragraph: line.paragraph, spacer: true })
        }
      }
      previousParagraph = line.paragraph
      out.push({
        text: ' '.repeat(spaces) + line.text,
        paragraph: line.paragraph,
        spacer: false,
      })
      continue
    }
    out.push({ text: line.text, paragraph: line.paragraph, spacer: false })
  }

  if (spaceAfter > 0) {
    const last = previousParagraph >= 0 ? previousParagraph : 0
    for (let i = 0; i < spaceAfter; i++) {
      out.push({ text: '', paragraph: last, spacer: true })
    }
  }
  return out
}

/** Just the strings, for a PointText's content. */
export function layoutToContent(
  lines: Array<{ text: string; paragraph: number }>,
  settings: ParagraphSettings,
  measure: (line: string) => number
): string {
  return layoutParagraphs(lines, settings, measure)
    .map((line) => line.text)
    .join('\n')
}
