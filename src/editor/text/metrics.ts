/**
 * Text measurement for line breaking.
 *
 * The wrapper has to know how wide a line is, and it was measuring with the
 * *tool's* current character style rather than the item's own font. Every text
 * item that is not exactly the style the type tool happens to be set to was
 * therefore wrapped against the wrong metrics: a 36pt paragraph in a 200pt
 * frame was measured as if it were 12pt, so the "fitting" lines ran past the
 * frame edge and the overflow count was fiction.
 *
 * The metrics are the item's, with the store's style as the fallback for text
 * that has not been given one (a legacy item, or a frame being laid out
 * before it exists). Measuring is done on a canvas context injected by the
 * caller, so the arithmetic here stays testable without a DOM.
 */

/** What a line of text needs to be measured with. */
export interface TextMetrics {
  /** Canvas `font` shorthand. */
  font: string
  /** Font size in points, needed for tracking. */
  fontSize: number
  /** Letter spacing in 1/1000 em (AI's tracking unit). */
  tracking: number
}

/** The metrics a text item is actually drawn with. */
export function metricsForItem(
  item: unknown,
  fallback: {
    fontSize: number
    fontFamily: string
    fontWeight: string | number
    fontStyle: string
    tracking: number
  }
): TextMetrics {
  const any = (item ?? {}) as Record<string, unknown>
  const pick = (key: string, backup: string | number): string => {
    const value = any[key]
    if (typeof value === 'string' && value.trim()) return value
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    return String(backup)
  }
  const fontSize = Number(any.fontSize)
  return {
    font: `${pick('fontStyle', fallback.fontStyle)} ${pick('fontWeight', fallback.fontWeight)} ${
      Number.isFinite(fontSize) && fontSize > 0 ? fontSize : fallback.fontSize
    }px ${pick('fontFamily', fallback.fontFamily)}`,
    fontSize: Number.isFinite(fontSize) && fontSize > 0 ? fontSize : fallback.fontSize,
    tracking: Number(fallback.tracking) || 0,
  }
}

/** Metrics for a style object in the store (the pre-item fallback). */
export function metricsForStyle(style: {
  fontSize: number
  fontFamily: string
  fontWeight: string | number
  fontStyle: string
  tracking: number
}): TextMetrics {
  const size = Number(style.fontSize) || 12
  return {
    font: `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`,
    fontSize: size,
    tracking: Number(style.tracking) || 0,
  }
}

/** Per-character tracking advance, in document units. */
export function trackingAdvance(metrics: TextMetrics): number {
  return (metrics.tracking / 1000) * (metrics.fontSize || 12)
}

/**
 * Width of one line, in document units.
 *
 * `measure` is the caller's canvas probe (kerned, as the browser draws it), so
 * the wrapper's arithmetic and the rendering agree: the font's own kerning is
 * already inside `measure`, and adding it again would be the classic
 * double-kerning bug.
 */
export function lineWidth(
  line: string,
  metrics: TextMetrics,
  measure: (text: string) => number
): number {
  const advance = trackingAdvance(metrics)
  if (line.length < 2 || !(advance > 0)) return measure(line)
  // Tracking adds per-character advance, with no trailing space after the last
  // glyph: a one-character line is just its own glyph.
  return measure(line) + (line.length - 1) * advance
}
