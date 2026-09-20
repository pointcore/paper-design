/**
 * Selection-frame geometry (C2: first slice out of select-controller.ts).
 *
 * Paper-free transform-handle math for the select tool's oriented
 * bounding-box frame: handle mappings, hit predicates and pointer
 * measurements over structural `{ x, y }` points (paper.Point satisfies
 * this structurally, so call sites pass paper points without conversion).
 * Frame-corner construction itself stays on the controller: it needs
 * live paper Points, which cannot even be imported under jsdom (paper
 * requires a 2D canvas at module load), so it is untestable here while
 * everything in this file is unit-locked.
 */
import type { Xy } from '../geometry'

/** Bounding-box transform handle in select mode (corners double as rotate zones). */
export type TransformHandle =
  | 'none'
  | 'topLeft' | 'topCenter' | 'topRight'
  | 'middleLeft' | 'middleRight'
  | 'bottomLeft' | 'bottomCenter' | 'bottomRight'
  | 'rotate'

/** Scale-handle names (everything except none / rotate). */
export type FrameHandle = Exclude<TransformHandle, 'none' | 'rotate'>

/**
 * Persistent oriented selection frame: center + size + clockwise degrees.
 * Unlike the axis-aligned bounds, it survives rotation — the box never
 * snaps back upright while the selection is intact.
 */
export interface SelectionFrame {
  cx: number
  cy: number
  w: number
  h: number
  angle: number
  selKey: string
  version: number
}

/** Opposite pivot name for a scale handle (the corner that stays fixed). */
export function oppositeHandle(handle: FrameHandle): FrameHandle {
  switch (handle) {
    case 'topLeft': return 'bottomRight'
    case 'topRight': return 'bottomLeft'
    case 'bottomLeft': return 'topRight'
    case 'bottomRight': return 'topLeft'
    case 'topCenter': return 'bottomCenter'
    case 'bottomCenter': return 'topCenter'
    case 'middleLeft': return 'middleRight'
    case 'middleRight': return 'middleLeft'
  }
}

/** True for the four corner handles (rotate zones hang off these). */
export function isCornerHandle(handle: TransformHandle): boolean {
  return (
    handle === 'topLeft' ||
    handle === 'topRight' ||
    handle === 'bottomLeft' ||
    handle === 'bottomRight'
  )
}

/** Clockwise pointer angle in degrees around a center point. */
export function pointerAngle(point: Xy, center: Xy): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI
}

/** Nearest frame corner to a point (labels a corner-started rotate drag). */
export function nearestCorner(point: Xy, positions: Record<FrameHandle, Xy>): FrameHandle {
  const corners: FrameHandle[] = [
    'topLeft', 'topRight', 'bottomLeft', 'bottomRight',
  ]
  let best = corners[0]
  let bestDist = Math.hypot(point.x - positions[best].x, point.y - positions[best].y)
  for (const corner of corners) {
    const d = Math.hypot(point.x - positions[corner].x, point.y - positions[corner].y)
    if (d < bestDist) {
      best = corner
      bestDist = d
    }
  }
  return best
}

/** Local (axis-aligned) position of a named handle at grab time. */
export function localHandlePoint(
  base: { cx: number; cy: number; w: number; h: number },
  name: FrameHandle
): { x: number; y: number } {
  const hw = base.w / 2
  const hh = base.h / 2
  switch (name) {
    case 'topLeft': return { x: base.cx - hw, y: base.cy - hh }
    case 'topCenter': return { x: base.cx, y: base.cy - hh }
    case 'topRight': return { x: base.cx + hw, y: base.cy - hh }
    case 'middleLeft': return { x: base.cx - hw, y: base.cy }
    case 'middleRight': return { x: base.cx + hw, y: base.cy }
    case 'bottomLeft': return { x: base.cx - hw, y: base.cy + hh }
    case 'bottomCenter': return { x: base.cx, y: base.cy + hh }
    case 'bottomRight': return { x: base.cx + hw, y: base.cy + hh }
  }
}
