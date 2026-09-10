/**
 * Shared geometry helpers (runtime-dependency-free apart from Paper.js
 * types, so they stay unit-testable under plain Node).
 */
import type paper from 'paper'

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
