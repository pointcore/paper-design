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

/** Normalize degrees into (-180, 180]. */
export function normAngle180(deg: number): number {
  return ((deg + 540) % 360) - 180
}

/**
 * Outward heading of each scale handle in frame-local space, clockwise
 * degrees from east (screen coords, y down): E=0, SE=45, S=90, SW=135,
 * W=180, NW=225, N=270, NE=315.
 */
export const HANDLE_HEADINGS: Record<FrameHandle, number> = {
  middleRight: 0,
  bottomRight: 45,
  bottomCenter: 90,
  bottomLeft: 135,
  middleLeft: 180,
  topLeft: 225,
  topCenter: 270,
  topRight: 315,
}

/**
 * Resize cursor for a bidirectional axis heading (CSS resize cursors point
 * both ways, so the heading folds modulo 180° into the nearest of the
 * four axes). At angle 0 this reproduces the classic mapping exactly.
 */
export function resizeCursorForHeading(headingDeg: number): string {
  const h = ((headingDeg % 180) + 180) % 180
  if (h < 22.5 || h >= 157.5) return 'ew-resize'
  if (h < 67.5) return 'nwse-resize'
  if (h < 112.5) return 'ns-resize'
  return 'nesw-resize'
}

/**
 * Diagonal-only cursor for corner handles: a corner resizes along its
 * right-angle bisector (45°), so it always shows a diagonal arrow — the
 * nearer of the two diagonals — never an axis arrow.
 */
export function diagonalCursorForHeading(headingDeg: number): string {
  const h = ((headingDeg % 180) + 180) % 180
  return Math.abs(h - 45) <= Math.abs(h - 135) ? 'nwse-resize' : 'nesw-resize'
}

/**
 * True when a corner bisector lands within half a degree of a native
 * diagonal (folded modulo 180°): the hover cursor can be a stock diagonal
 * arrow, otherwise the controller draws an exact-angle double arrow.
 */
export function isNearDiagonal(headingDeg: number): boolean {
  const folded = ((headingDeg % 180) + 180) % 180
  return Math.min(Math.abs(folded - 45), Math.abs(folded - 135)) < 0.5
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

/** Rotate a point around a center by degrees (paper.js convention). */
export function rotateXy(p: Xy, deg: number, center: Xy): Xy {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = p.x - center.x
  const dy = p.y - center.y
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

/** World-space corner / edge positions of an oriented frame. */
export function frameHandlePositions(frame: SelectionFrame): Record<FrameHandle, Xy> {
  const center = { x: frame.cx, y: frame.cy }
  const at = (local: Xy): Xy => rotateXy(local, frame.angle, center)
  const TL = at(localHandlePoint(frame, 'topLeft'))
  const TR = at(localHandlePoint(frame, 'topRight'))
  const BR = at(localHandlePoint(frame, 'bottomRight'))
  const BL = at(localHandlePoint(frame, 'bottomLeft'))
  const mid = (a: Xy, b: Xy): Xy => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
  return {
    topLeft: TL,
    topCenter: mid(TL, TR),
    topRight: TR,
    middleLeft: mid(TL, BL),
    middleRight: mid(TR, BR),
    bottomLeft: BL,
    bottomCenter: mid(BL, BR),
    bottomRight: BR,
  }
}

/** Map a world point into the frame's local (unrotated) space. */
export function toFrameLocal(p: Xy, frame: SelectionFrame): Xy {
  return rotateXy(p, -frame.angle, { x: frame.cx, y: frame.cy })
}
