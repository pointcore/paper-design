/**
 * Shared geometry helpers (runtime-dependency-free apart from Paper.js
 * types, so they stay unit-testable under plain Node).
 */
import type paper from 'paper'
import type { RulerUnit } from './types'

/**
 * Snap a direction vector to the nearest 45-degree increment (including
 * the axes). Returns a new vector of the same length constrained to one
 * of the eight cardinal / diagonal directions.
 */
export function snap45(v: paper.Point, scope: paper.PaperScope): paper.Point {
  const length = Math.hypot(v.x, v.y)
  if (length < 1e-6) return new scope.Point(0, 0)
  const angle = Math.atan2(v.y, v.x)
  const oct = Math.round(angle / (Math.PI / 4))
  const snappedAngle = oct * (Math.PI / 4)
  return new scope.Point(
    Math.cos(snappedAngle) * length,
    Math.sin(snappedAngle) * length
  )
}

/**
 * Normalize degrees into [0, 360). Non-finite values map to 0.
 */
export function normalizeAngleDeg(angle: number): number {
  if (!Number.isFinite(angle)) return 0
  return ((angle % 360) + 360) % 360
}

/**
 * Gradient direction vector angle in degrees (screen coords, y down):
 * 0 = +x (left→right), 90 = +y (top→bottom).
 */
export function gradientAngleFromVector(dx: number, dy: number): number {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return 0
  if (Math.hypot(dx, dy) < 1e-9) return 0
  return normalizeAngleDeg((Math.atan2(dy, dx) * 180) / Math.PI)
}

/**
 * Linear-gradient endpoints rotated `angleDeg` about the bounds center.
 * The half-extent covers the rotated box (|w·cos| + |h·sin|) / 2 so the
 * gradient always spans the shape at any angle.
 */
export function linearGradientEndpoints(
  cx: number, cy: number, w: number, h: number, angleDeg: number
): { x1: number; y1: number; x2: number; y2: number } {
  const a = (normalizeAngleDeg(angleDeg) * Math.PI) / 180
  const dx = Math.cos(a)
  const dy = Math.sin(a)
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2
  return { x1: cx - dx * half, y1: cy - dy * half, x2: cx + dx * half, y2: cy + dy * half }
}

/**
 * Reshape-brush falloff (AI Reshape tool): full strength at the cursor,
 * easing to zero at the radius edge so strokes blend into the artwork.
 * Returns 0 outside the radius or for non-finite input.
 */
export function reshapeFalloff(distance: number, radius: number): number {
  if (!Number.isFinite(distance) || !Number.isFinite(radius)) return 0
  if (radius <= 0 || distance < 0 || distance >= radius) return 0
  const t = 1 - distance / radius
  return t * t * (3 - 2 * t)
}

/**
 * Round-corner handle length (AI Round Corners / CDR fillet lite): tangent
 * run clamped by both edge half-lengths (never eats past a midpoint),
 * scaled by the circle-approx kappa so short runs stay circular.
 */
export function roundCornerHandle(edgeA: number, edgeB: number, radius: number): number {
  if (!Number.isFinite(edgeA) || !Number.isFinite(edgeB) || !Number.isFinite(radius)) return 0
  if (edgeA <= 0 || edgeB <= 0 || radius <= 0) return 0
  return Math.min(radius, edgeA / 2, edgeB / 2) * 0.5523
}

/**
 * Document units (CSS px at 96dpi) → ruler unit factor for display
 * readouts. Geometry itself never converts; rulers, status bar and the
 * measure tool share this so their numbers agree.
 */
export function rulerUnitFactor(unit: RulerUnit): number {
  switch (unit) {
    case 'pt': return 0.75
    case 'mm': return 25.4 / 96
    case 'cm': return 2.54 / 96
    case 'in': return 1 / 96
    default: return 1
  }
}

/**
 * Anchor runs surviving a curve deletion (curve i spans anchors
 * i → i+1, wrapping on closed paths). Open paths split at removed
 * curves; closed paths rotate to start after a removed curve so the
 * linearization stays contiguous, then split at each removed curve.
 * Single-anchor runs survive (AI keeps lone anchors for later joins).
 */
export function remainingRuns(closed: boolean, n: number, removed: Set<number>): number[][] {
  const runs: number[][] = []
  if (!closed) {
    let run: number[] = []
    for (let i = 0; i < n; i++) {
      run.push(i)
      if (i < n - 1 && removed.has(i)) {
        runs.push(run)
        run = []
      }
    }
    if (run.length > 0) runs.push(run)
    return runs
  }
  let gap = -1
  for (let c = 0; c < n; c++) {
    if (removed.has(c)) {
      gap = c
      break
    }
  }
  if (gap < 0) return [Array.from({ length: n }, (_, i) => i)]
  let run: number[] = []
  let prevEnd: number | null = null
  for (let j = 0; j < n; j++) {
    const c = (gap + 1 + j) % n
    if (removed.has(c)) {
      if (run.length > 0) {
        runs.push(run)
        run = []
      }
      prevEnd = null
      continue
    }
    if (run.length === 0) run.push(c)
    else if (prevEnd !== c) {
      runs.push(run)
      run = [c]
    }
    run.push((c + 1) % n)
    prevEnd = (c + 1) % n
  }
  if (run.length > 0) runs.push(run)
  return runs
}
