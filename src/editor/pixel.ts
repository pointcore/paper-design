/**
 * Pixel preview + snap-to-pixel helpers (D2).
 *
 * Web / slice work needs geometry on whole device pixels: at 1x every
 * coordinate snaps to integers, at 2x to halves. Pure functions so the
 * store, the engine align pass and the panels share one rounding rule.
 */

/** Device-pixel ratio used by the preview (1 or 2). */
export type PixelRatio = 1 | 2;

/** Round a document-unit value onto the device-pixel grid. */
export function alignToPixel(value: number, ratio: PixelRatio = 1): number {
  if (!Number.isFinite(value) || (ratio !== 1 && ratio !== 2)) return value
  return Math.round(value * ratio) / ratio
}

/** Round a point onto the device-pixel grid. */
export function alignPointToPixel(
  p: { x: number; y: number },
  ratio: PixelRatio = 1,
): { x: number; y: number } {
  return { x: alignToPixel(p.x, ratio), y: alignToPixel(p.y, ratio) }
}

/** Grid step in document units for the given preview ratio. */
export function pixelGridStep(ratio: PixelRatio = 1): number {
  return ratio === 2 ? 0.5 : 1
}

/** Clamp a raw ratio choice to the supported set (1 or 2). */
export function normalizePixelRatio(n: unknown): PixelRatio {
  return n === 2 ? 2 : 1
}
