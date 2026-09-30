/**
 * Baseline grid: the typographic grid a column of text is set against.
 *
 * The document grid draws squares for geometry; the baseline grid is a
 * different thing entirely — horizontal lines spaced by the *type leading*, so
 * every line of type in the document lands on the same rhythm. It is what a
 * designer sets before laying out a page of text, and its whole value is that
 * the text is measured against it, not that the lines are visible.
 *
 * The geometry is pure data so it can be unit tested: the engine turns the
 * line positions into paper items, the store holds the settings, and the
 * snapping arithmetic lives here where it can be locked down.
 */

/** Baseline grid settings, per document. */
export interface BaselineGridSettings {
  /** Show the lines on the canvas. */
  visible: boolean
  /** Distance between baselines in document units (normally the leading). */
  interval: number
  /** Y of the first baseline, in document units. */
  origin: number
  /** CSS color of the drawn lines. */
  color: string
  /**
   * Force every text baseline onto the grid, rather than only offering it as a
   * snap target. This is the setting that makes a page of type look even.
   */
  alignText: boolean
  /** Pull a dragged baseline onto the nearest grid line. */
  snap: boolean
}

/**
 * Distance from a text item's position to the baseline of its first line.
 *
 * A Paper.js PointText is positioned by the top of its frame; the first
 * baseline sits half a leading plus the ascent below it (line-height 1.2 and a
 * ~0.8em ascent). Everything that talks about "a text baseline" uses this one
 * number: the grid is about baselines, not frame tops, and mixing the two puts
 * type a whole leading off the rhythm.
 */
export const FIRST_BASELINE_RATIO = 0.9

/** The first baseline of a text item whose position is `y`. */
export function firstBaselineY(y: number, fontSize: number): number {
  return y + (Number(fontSize) || 12) * FIRST_BASELINE_RATIO
}

/** A snap distance in document units, converted from a screen distance. */
export const BASELINE_SNAP_SCREEN_PX = 4

/** Bounds that keep a hand-typed interval from breaking the layout. */
const MIN_INTERVAL = 1
const MAX_INTERVAL = 400

export function defaultBaselineGrid(): BaselineGridSettings {
  return {
    visible: false,
    interval: 14.4,
    origin: 0,
    color: '#4a90d9',
    alignText: false,
    snap: false,
  }
}

/** Coerce anything (a saved file, a hand-edited project) into valid settings. */
export function normalizeBaselineGrid(raw: unknown): BaselineGridSettings {
  const fallback = defaultBaselineGrid()
  if (!raw || typeof raw !== 'object') return fallback
  const value = raw as Partial<BaselineGridSettings>
  const interval = Number(value.interval)
  const origin = Number(value.origin)
  return {
    visible: value.visible === true,
    interval: Number.isFinite(interval) ? Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, interval)) : fallback.interval,
    // The origin is a position, not a count: a negative or large value is fine.
    origin: Number.isFinite(origin) ? origin : fallback.origin,
    // Only the lengths CSS actually defines (3, 4, 6, 8): a 5- or 7-digit hex
    // is not a color, and passing it to the canvas draws black.
    color:
      typeof value.color === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.color.trim())
        ? value.color.trim()
        : fallback.color,
    alignText: value.alignText === true,
    snap: value.snap === true,
  }
}

/** The baseline nearest to `y`, and how far it is from `y`. */
export function nearestBaseline(y: number, settings: BaselineGridSettings): { y: number; distance: number } {
  const step = settings.interval > 0 ? settings.interval : 1
  const n = Math.round((y - settings.origin) / step)
  const target = settings.origin + n * step
  return { y: target, distance: Math.abs(y - target) }
}

/**
 * Snap a baseline to the grid, or leave it alone.
 *
 * `tolerance` is a document-space distance, which the caller derives from the
 * screen tolerance and the current zoom: a snap that behaves at 800% and
 * misbehaves at 10% is a snap nobody trusts.
 */
/**
 * How much of the interval a snap may claim, at most.
 *
 * A snap that reaches half the interval (or more) claims *every* position:
 * there is nowhere left that does not snap, so the grid stops being a choice
 * and the type lands on a rhythm the user never picked. 40% leaves a dead zone
 * in the middle of each step, which is what makes the grid something you aim
 * at rather than something that happens to you.
 */
export const MAX_SNAP_FRACTION = 0.4

export function snapBaseline(
  y: number,
  settings: BaselineGridSettings,
  tolerance: number
): { y: number; snapped: boolean } {
  const step = settings.interval > 0 ? settings.interval : 0
  const reach = Math.min(tolerance, step * MAX_SNAP_FRACTION)
  const near = nearestBaseline(y, settings)
  if (!(reach > 0) || near.distance > reach) return { y, snapped: false }
  return { y: near.y, snapped: true }
}

/**
 * Force a text item's first baseline onto the grid.
 *
 * Aligning the *first* baseline is enough: the leading then carries every
 * following line to a grid line too, as long as the leading is a multiple of
 * the interval — which is why the panel defaults the interval to the leading
 * and says so.
 */
export function alignFirstBaseline(y: number, settings: BaselineGridSettings): number {
  return nearestBaseline(y, settings).y
}

/** Baselines a text item must be shifted by to sit on the grid. */
export function baselineOffsetFor(
  y: number,
  settings: BaselineGridSettings
): { shift: number; onGrid: boolean } {
  if (!settings.alignText) return { shift: 0, onGrid: true }
  const target = alignFirstBaseline(y, settings)
  const shift = target - y
  return { shift, onGrid: Math.abs(shift) < 1e-6 }
}

/**
 * Baseline positions to draw across a viewport.
 *
 * The step doubles when the lines would be too dense to read, and it always
 * stays an exact multiple of the interval so the drawn lines are still on the
 * real grid — a decimated grid that is off-grid is worse than none.
 */
export function baselineLines(
  viewport: { x: number; y: number; width: number; height: number },
  settings: BaselineGridSettings,
  maxLines = 200
): { y: number; major: boolean }[] {
  if (!(viewport.height > 0) || !(viewport.width > 0)) return []
  const base = settings.interval > 0 ? settings.interval : 1
  let step = base
  while (viewport.height / step > maxLines) step *= 2
  const first = Math.ceil((viewport.y - settings.origin) / step) * step + settings.origin
  const lines: Array<{ y: number; major: boolean }> = []
  for (let y = first; y <= viewport.y + viewport.height; y += step) {
    // Every fifth line is drawn stronger, the way a document grid majors every
    // fifth step: it gives the eye something to count against.
    const major = Math.round((y - settings.origin) / step) % 5 === 0
    lines.push({ y: Math.round(y * 1000) / 1000, major })
    if (lines.length > maxLines) break
  }
  return lines
}
