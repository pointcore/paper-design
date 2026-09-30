/**
 * Threaded area text: flowing one text through several frames.
 *
 * Threading used to be a one-way split: the first frame kept the lines that
 * fitted, its raw text was *truncated* to match, and the overflow became a
 * second, independent text item. Nothing linked them afterwards, so resizing
 * the second frame could not pull text back, and the original text was gone
 * from the first frame for good.
 *
 * The fix is to treat the thread as one text with several boxes. The first
 * frame owns the author's text; every frame is a window onto a *character
 * range* of it. Reflowing re-derives each window from the text and the frame
 * boxes, so the flow runs in both directions, and editing a continuation frame
 * splices its text back into the whole rather than forking it.
 *
 * This module is pure: text in, per-frame windows out. The controller owns the
 * paper items and the links between them.
 */
import { layoutParagraphs, normalizeParagraphSettings, wrapParagraphIndentedWithOffsets, type ParagraphSettings, type PositionedLine } from './paragraphs'
import { wrapParagraphWithOffsets } from './line-break'

/** One frame's box, in chain order. */
export interface FlowFrame {
  width: number
  height: number
}

/** What one frame shows, and where in the thread's text it came from. */
export interface FlowWindow {
  /** The frame's rendered content, paragraph layout applied. */
  content: string
  /** Offset in the thread text where this frame's text starts. */
  start: number
  /** Offset where the next frame takes over (thread text length at the end). */
  end: number
  /** Rendered lines, spacers included. */
  lines: number
  /** Lines the frame's height actually holds. */
  fits: number
  /** Characters that do not fit in this frame and the ones after it. */
  overflowChars: number
}

export interface FlowOptions {
  /** Effective leading in document units. */
  leading: number
  /** Advance width of a candidate line, in document units. */
  measure: (line: string) => number
  settings?: ParagraphSettings
  /** Smallest usable frame width, so a tiny frame cannot loop. */
  minSpan?: number
}

/** Default floor for a frame's width, matching the controller. */
const MIN_SPAN = 12

/**
 * Wrap the thread text and distribute it across the frames.
 *
 * Each frame takes as many rendered lines as its height holds and hands the
 * rest on. The offsets are what make the result a *thread*: a frame's
 * `start`/`end` say which characters it owns, so an edit in frame two can be
 * spliced back into the text instead of replacing it.
 */
export function flowTextThroughFrames(
  raw: string,
  frames: FlowFrame[],
  opts: FlowOptions
): FlowWindow[] {
  const settings = normalizeParagraphSettings(opts.settings)
  const minSpan = opts.minSpan ?? MIN_SPAN
  const windows: FlowWindow[] = []
  let offset = 0
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const width = Math.max(frame.width, minSpan)
    // The paragraph break the previous frame was in the middle of is already
    // rendered there: emitting it again would put a blank line in front of
    // every continuation. Exactly one is skipped, so an author's own empty
    // paragraph still survives as the empty paragraph it is.
    const skip = i > 0 && raw[offset] === '\n' ? 1 : 0
    const tailStart = offset + skip
    const { wrapped } = wrapTail(raw.slice(tailStart), width, settings, opts.measure)
    const laid = layoutParagraphs(wrapped, settings, opts.measure)
    const fits = Math.max(1, Math.floor(frame.height / (opts.leading || 1)))
    // The last frame takes everything that is left: there is nowhere else for
    // it to go, and its `fits` says out loud that it does not all fit. That is
    // also what makes the offsets tile the text exactly.
    const keepAll = i === frames.length - 1
    const window_ = keepAll ? laid : laid.slice(0, Math.max(1, fits))
    // A blank line at the end of a window belongs to the *next* paragraph, so
    // keeping it would spend a line of the frame on nothing. Applied after the
    // slice, since that is where the frame's last line is decided.
    const trimmed = dropTrailingSpacers(window_)
    const kept = trimmed.length ? trimmed : window_.slice(0, 1)
    const content = kept.map((line) => line.text).join('\n')
    // How far into the text this frame got: the wrapped line behind the last
    // one it kept, or the start of the frame when it kept none.
    const keptContentLines = kept.filter((line) => !line.spacer).length
    const consumed = contentOffset(wrapped, keptContentLines)
    const end = tailStart + consumed
    windows.push({
      content,
      start: offset,
      end,
      lines: trimmed.length,
      fits,
      overflowChars: Math.max(0, raw.length - end),
    })
    offset = end
  }
  return windows
}

/** Drop the blank lines at the end of a laid-out block. */
function dropTrailingSpacers(lines: PositionedLine[]): PositionedLine[] {
  let end = lines.length
  while (end > 0 && lines[end - 1].spacer) end -= 1
  return end === lines.length ? lines : lines.slice(0, end)
}

/**
 * Replace one frame's slice of the thread text.
 *
 * This is what makes a continuation frame editable: the frames share one
 * text, so typing in the second one has to edit the text the first one is
 * also showing, at exactly the range the second one owns.
 */
export function spliceThreadedText(
  raw: string,
  start: number,
  end: number,
  replacement: string
): string {
  const from = Math.max(0, Math.min(raw.length, start))
  const to = Math.max(from, Math.min(raw.length, end))
  return raw.slice(0, from) + replacement + raw.slice(to)
}

/**
 * Wrap the tail of the thread text at this frame's width.
 *
 * A first line that would not fit once the paragraph indent is in front of it
 * is re-wrapped narrower, the same rule the single-frame layout uses; without
 * it an indented thread overflows every frame by the width of the indent.
 */
function wrapTail(
  tail: string,
  width: number,
  settings: ParagraphSettings,
  measure: (line: string) => number
): { wrapped: Array<{ text: string; paragraph: number; end: number }> } {
  const { firstLineIndent, hangingIndent } = settings
  const paragraphs = tail.split('\n')
  const wrapped: Array<{ text: string; paragraph: number; end: number }> = []
  let pos = 0
  for (let p = 0; p < paragraphs.length; p++) {
    const paragraph = paragraphs[p]
    // The continuation frame lays out exactly like the frame before it: the
    // body is narrower by the hanging indent, and the first line gets its
    // allowance back.
    const lines = wrapParagraphIndentedWithOffsets(
      paragraph,
      {
        firstLine: Math.max(1, width - Math.max(0, firstLineIndent - hangingIndent)),
        body: Math.max(1, width - hangingIndent),
      },
      measure
    )
    for (const line of lines) {
      wrapped.push({ text: line.text, paragraph: p, end: pos + line.end })
    }
    pos += paragraph.length + 1
  }
  return { wrapped }
}

/**
 * Offset behind the n-th wrapped line.
 *
 * `n` counts content lines (spacers are not in this list), and the answer is
 * clamped to what the text actually has: a frame that keeps nothing but a
 * blank line still has to end where it began, or a thread would loop.
 */
function contentOffset(
  wrapped: Array<{ text: string; paragraph: number; end: number }>,
  n: number
): number {
  if (n <= 0) return 0
  const line = wrapped[Math.min(n, wrapped.length) - 1]
  return line ? line.end : 0
}
