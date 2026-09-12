/**
 * Pure math for Object > Blend (AI/CDR): sampled-point alignment between two
 * operand outlines plus scalar/color interpolation for the intermediate
 * steps. Kept free of paper.js so the geometry is unit-testable; the engine
 * owns the paper.Path resampling and builds the step shapes.
 */
import type { Rgba } from '../color'

/** A sampled outline vertex in document coordinates. */
export interface BlendPoint {
  x: number
  y: number
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/**
 * Vertex budget for resampling both operands: dense enough to honor the
 * more complex outline, clamped so 200 steps never explode the snapshot.
 */
export function sampleCountFor(segCounts: number[]): number {
  const densest = Math.max(1, ...segCounts.map((c) => Math.max(1, Math.round(c))))
  return Math.min(720, Math.max(24, densest * 6))
}

function sumSquaredError(a: BlendPoint[], b: BlendPoint[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const dx = a[i].x - b[i].x
    const dy = a[i].y - b[i].y
    sum += dx * dx + dy * dy
  }
  return sum
}

function nearestIndex(point: BlendPoint, pts: BlendPoint[]): number {
  let best = 0
  let bestDist = Infinity
  for (let i = 0; i < pts.length; i++) {
    const dx = point.x - pts[i].x
    const dy = point.y - pts[i].y
    const d = dx * dx + dy * dy
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  }
  return best
}

/**
 * Rotate (closed outlines) or flip (open outlines) the sampled source so it
 * lines up with the target before interpolation — without this, blending two
 * circles whose sample runs start at different angles twists the steps.
 * Closed outlines try the forward and reversed runs, each rotated to start at
 * the vertex nearest the target's first vertex, then keep whichever squares
 * off best against the target. Open outlines keep their endpoints and only
 * choose the travel direction.
 */
export function alignSampledPoints(
  target: BlendPoint[],
  source: BlendPoint[],
  closed: boolean
): BlendPoint[] {
  const n = target.length
  if (n === 0 || source.length !== n) return source
  const reverse = (pts: BlendPoint[]) => pts.slice().reverse()
  if (!closed) {
    return sumSquaredError(target, source) <= sumSquaredError(target, reverse(source))
      ? source
      : reverse(source)
  }
  const rotate = (pts: BlendPoint[], k: number) => pts.slice(k).concat(pts.slice(0, k))
  const reversed = reverse(source)
  const forward = rotate(source, nearestIndex(target[0], source))
  const backward = rotate(reversed, nearestIndex(target[0], reversed))
  return sumSquaredError(target, forward) <= sumSquaredError(target, backward)
    ? forward
    : backward
}

/** Linear blend of two 8-bit RGB colors with an alpha in 0..1. */
export function lerpRgba(a: Rgba, b: Rgba, t: number): Rgba {
  return {
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
    a: lerp(a.a, b.a, t),
  }
}

/** Render an interpolated color as `rgb()`/`rgba()` CSS for paper.Color. */
export function rgbaToCss({ r, g, b, a }: Rgba): string {
  if (a >= 1) return `rgb(${r},${g},${b})`
  return `rgba(${r},${g},${b},${Math.round(a * 1000) / 1000})`
}
