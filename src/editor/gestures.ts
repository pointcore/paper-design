/**
 * Touch gesture math (D10).
 *
 * Pure two-pointer/long-press layer (no Vue / DOM): the pinch transform
 * maps a pointer pair's last→current frames onto view operations, and the
 * long-press classifier decides when a stationary hold becomes a menu
 * gesture. CanvasHost owns the listeners and the engine binding.
 *
 * Scope notes: the canvas has no rotation transform, so the reported
 * twist is measured (and unit-locked) but intentionally not applied to
 * the view — twisting artwork instead would corrupt data. Pen input
 * needs no work here (brush pressure fields already exist).
 */
import type { Xy } from './geometry'

/** Long-press fires after this hold with no appreciable move. */
export const LONG_PRESS_MS = 500

/** Pointer drift tolerated inside a long-press, in CSS px. */
export const LONG_PRESS_SLOP_PX = 10

/** Pinch frame delta: uniform scale, signed twist, midpoint pan. */
export interface PinchTransform {
  /** Multiplicative zoom about the midpoint (1 = no change). */
  scale: number
  /** Signed twist in degrees, (-180, 180] (measured, not applied). */
  rotationDeg: number
  /** Midpoint travel in CSS px. */
  panX: number
  panY: number
}

/** Neutral frame (no measurable change). */
export const NEUTRAL_PINCH: PinchTransform = { scale: 1, rotationDeg: 0, panX: 0, panY: 0 }

/**
 * Map two pointer frames onto a view transform. A near-zero opening
 * span cannot define scale/rotation (guards a divide-by-zero); any
 * non-finite coordinate degrades to neutral instead of throwing.
 */
export function pinchTransform(before1: Xy, before2: Xy, after1: Xy, after2: Xy): PinchTransform {
  for (const p of [before1, before2, after1, after2]) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return { ...NEUTRAL_PINCH }
  }
  const bx = before2.x - before1.x
  const by = before2.y - before1.y
  const ax = after2.x - after1.x
  const ay = after2.y - after1.y
  const beforeDist = Math.hypot(bx, by)
  const afterDist = Math.hypot(ax, ay)
  const panX = (after1.x + after2.x) / 2 - (before1.x + before2.x) / 2
  const panY = (after1.y + after2.y) / 2 - (before1.y + before2.y) / 2
  if (beforeDist < 1e-6 || afterDist < 1e-6) return { ...NEUTRAL_PINCH, panX, panY }
  const scale = afterDist / beforeDist
  const rotationDeg = normalizeTwist(
    ((Math.atan2(ay, ax) - Math.atan2(by, bx)) * 180) / Math.PI
  )
  return {
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    rotationDeg,
    panX,
    panY,
  }
}

/** Wrap a twist into (-180, 180]. */
export function normalizeTwist(deg: number): number {
  if (!Number.isFinite(deg)) return 0
  return ((deg + 540) % 360) - 180
}

/**
 * Long-press classifier: held at least `timeMs` with drift under
 * `slopPx`. Negative inputs never qualify.
 */
export function isLongPress(
  durationMs: number,
  movedPx: number,
  timeMs: number = LONG_PRESS_MS,
  slopPx: number = LONG_PRESS_SLOP_PX,
): boolean {
  if (!Number.isFinite(durationMs) || !Number.isFinite(movedPx)) return false
  if (!Number.isFinite(timeMs) || !Number.isFinite(slopPx)) return false
  return durationMs >= timeMs && movedPx <= slopPx
}
