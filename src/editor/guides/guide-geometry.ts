/**
 * Guide-line geometry, as pure math.
 *
 * Ruler guides used to be axis-aligned only, so "where is this guide" was
 * one number and nothing here was worth isolating. Diagonal guides make it a
 * point plus an angle, and the operations that follow from that — distance
 * from a point to the line, the projection onto it, sliding a guide along
 * its own normal — are the kind of thing that is much easier to be sure
 * about away from paper.js and the DOM.
 *
 * Angles are degrees, measured the way a user reads them: 0 is a horizontal
 * guide (running to the right), 90 is vertical (running up), and document Y
 * grows downward, so a positive angle tilts clockwise on screen.
 */

/** A guide's placement: the anchor point it passes through, and its angle. */
export interface GuideGeometry {
  orientation: 'horizontal' | 'vertical' | 'diagonal'
  /** Anchor x for vertical and diagonal guides, y for horizontal ones. */
  position: number
  /** Anchor y, diagonal guides only. */
  cross: number
  /** Angle in degrees, diagonal guides only. */
  angle: number
}

export interface Point {
  x: number
  y: number
}

const DEG = Math.PI / 180

/** Unit direction of a guide at `angle` degrees. */
export function direction(angle: number): Point {
  const rad = (Number.isFinite(angle) ? angle : 0) * DEG
  return { x: Math.cos(rad), y: Math.sin(rad) }
}

/** Unit normal of a guide at `angle` degrees (the direction it slides along). */
export function normal(angle: number): Point {
  const d = direction(angle)
  return { x: -d.y, y: d.x }
}

/**
 * The two endpoints of a guide, `halfSpan` document units either side of the
 * anchor. Axis-aligned guides get the same treatment as before: a huge span
 * so they survive any pan or zoom.
 */
export function endpoints(geometry: GuideGeometry, halfSpan = 1e6): [Point, Point] {
  const { orientation, position, cross, angle } = geometry
  if (orientation === 'vertical') {
    return [
      { x: position, y: -halfSpan },
      { x: position, y: halfSpan },
    ]
  }
  if (orientation === 'horizontal') {
    return [
      { x: -halfSpan, y: position },
      { x: halfSpan, y: position },
    ]
  }
  const d = direction(angle)
  return [
    { x: position - d.x * halfSpan, y: cross - d.y * halfSpan },
    { x: position + d.x * halfSpan, y: cross + d.y * halfSpan },
  ]
}

/** The point on the guide closest to `p` (the projection). */
export function project(geometry: GuideGeometry, p: Point): Point {
  const anchor: Point =
    geometry.orientation === 'vertical'
      ? { x: geometry.position, y: p.y }
      : geometry.orientation === 'horizontal'
        ? { x: p.x, y: geometry.position }
        : { x: geometry.position, y: geometry.cross }
  if (geometry.orientation !== 'diagonal') return anchor
  const d = direction(geometry.angle)
  const dx = p.x - anchor.x
  const dy = p.y - anchor.y
  const t = dx * d.x + dy * d.y
  return { x: anchor.x + d.x * t, y: anchor.y + d.y * t }
}

/**
 * Perpendicular distance from `p` to the guide's line. Axis-aligned guides
 * measure along their own axis, which is what snapping has always used.
 */
export function distance(geometry: GuideGeometry, p: Point): number {
  if (geometry.orientation === 'vertical') return Math.abs(p.x - geometry.position)
  if (geometry.orientation === 'horizontal') return Math.abs(p.y - geometry.position)
  const q = project(geometry, p)
  return Math.hypot(p.x - q.x, p.y - q.y)
}

/**
 * Slide a guide by the drag from `from` to `to`, keeping its angle.
 *
 * Axis-aligned guides follow the pointer along their free axis, which is
 * what dragging a ruler guide has always done. A diagonal guide is moved
 * along its own normal: the component of the drag in that direction, and
 * nothing else, so the guide never rotates or drifts sideways while it is
 * being dragged.
 */
export function slide(geometry: GuideGeometry, from: Point, to: Point): GuideGeometry {
  if (geometry.orientation === 'vertical') {
    return { ...geometry, position: to.x }
  }
  if (geometry.orientation === 'horizontal') {
    return { ...geometry, position: to.y }
  }
  const n = normal(geometry.angle)
  const t = (to.x - from.x) * n.x + (to.y - from.y) * n.y
  return { ...geometry, position: geometry.position + n.x * t, cross: geometry.cross + n.y * t }
}

/** Normalize an angle into [0, 180): a guide at 0 and 180 is the same line. */
export function normalizeGuideAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0
  const wrapped = ((angle % 180) + 180) % 180
  // 179.9999 degrees is a horizontal guide in all but name.
  return wrapped >= 180 - 1e-9 ? 0 : wrapped
}

/**
 * The angle to show a user: signed, in (-90, 90].
 *
 * Guides are stored canonically in [0, 180) so 0 and 180 cannot be two
 * different lines, but a field that turns a typed -30 into a displayed 150
 * reads as the editor disagreeing with the user. Both describe the same line.
 */
export function displayGuideAngle(angle: number): number {
  const normalized = normalizeGuideAngle(angle)
  const signed = normalized > 90 ? normalized - 180 : normalized
  // -0 reads as 0.
  return signed === 0 ? 0 : signed
}
