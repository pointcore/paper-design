/**
 * Per-character text measurement (C2: slice out of select-controller.ts).
 *
 * Paper-free hit/layout math for per-character text selection: given plain
 * content + style + a width probe, locate the character index closest to a
 * point and lay out per-character rects. The canvas 2d probe injects as a
 * callback so unit tests run against a stub width (jsdom has no text
 * metrics); the controller owns the shared measure context, the font
 * setup and the paper/DOM shells (bounds guard, DOMRect mapping, overlay
 * highlight). Any other alignment value renders like left, matching the
 * controller's historical branches.
 */
import type { Xy } from '../geometry'

/** Plain-text layout inputs (no paper types: plain numbers and strings). */
export interface CharMeasureStyle {
  /** paper justification string; only center/right shift, rest is left. */
  justification: string
  /** Line advance in document units. */
  leading: number
  /** First-baseline origin in document units. */
  anchorX: number
  anchorY: number
}

/** Width probe: canvas measureText behind it in production, stub in tests. */
export type TextWidthFn = (text: string) => number

/** One laid-out character box in document coordinates. */
export interface CharRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Character index closest to `point` (multi-line aware). Newlines count
 * one index each, so the result addresses the raw content directly.
 */
export function charIndexAt(
  content: string,
  style: CharMeasureStyle,
  point: Xy,
  measure: TextWidthFn,
): number {
  if (!content || content.length === 0) return 0
  const lines = content.split('\n')

  // Determine which line the click falls on.
  const localY = point.y - style.anchorY
  let lineIdx = Math.round(localY / style.leading)
  lineIdx = Math.max(0, Math.min(lineIdx, lines.length - 1))

  // Within the line, find the closest character by x.
  const line = lines[lineIdx]
  const localX = point.x - style.anchorX
  const lineW = measure(line)

  let bestOffset = 0
  let bestDist = Infinity
  for (let i = 0; i <= line.length; i++) {
    const advance = measure(line.substring(0, i))
    let charX: number
    if (style.justification === 'center') {
      charX = -lineW / 2 + advance
    } else if (style.justification === 'right') {
      charX = -lineW + advance
    } else {
      charX = advance
    }
    const dist = Math.abs(localX - charX)
    if (dist < bestDist) {
      bestDist = dist
      bestOffset = i
    }
  }

  // Convert line-local offset to global character index.
  let globalIdx = 0
  for (let i = 0; i < lineIdx; i++) {
    globalIdx += lines[i].length + 1 // +1 for the \n
  }
  return globalIdx + bestOffset
}

/**
 * Per-character boxes in document coordinates (multi-line aware).
 * Newlines advance the layout but produce no box, so the array holds
 * exactly one entry per visible character.
 */
export function charRects(
  content: string,
  style: CharMeasureStyle,
  measure: TextWidthFn,
): CharRect[] {
  if (!content || content.length === 0) return []
  const lines = content.split('\n')
  const rects: CharRect[] = []

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li]
    const lineW = measure(line)
    const lineY = style.anchorY + li * style.leading

    for (let ci = 0; ci < line.length; ci++) {
      const before = measure(line.substring(0, ci))
      const charW = measure(line[ci])
      let x: number
      if (style.justification === 'center') {
        x = style.anchorX - lineW / 2 + before
      } else if (style.justification === 'right') {
        x = style.anchorX - lineW + before
      } else {
        x = style.anchorX + before
      }
      rects.push({ x, y: lineY, width: charW, height: style.leading })
    }
  }
  return rects
}
