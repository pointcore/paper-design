/**
 * Bbox transform-drag math (C2: slice out of select-controller.ts).
 *
 * Paper-free kernels for the select tool's absolute scale / rotate drags:
 * rotation accumulation with branch-cut normalization plus Shift 45° snap,
 * scale-factor totals measured in frame-local space, incremental steps
 * from totals, and tracked-frame advance. Every point is a structural Xy
 * (paper.Point satisfies this structurally, so call sites pass plain
 * coordinates without conversion); the rotation below reproduces
 * paper.js Point.rotate exactly (standard matrix, y-down appearance).
 * The controller owns grab state, hit-testing, item mutation, chrome and
 * history — everything here is unit-locked.
 */
import type { Xy } from '../geometry'
import { isCornerHandle, localHandlePoint, oppositeHandle, rotateXy, type FrameHandle } from './frame-geometry'

/**
 * Snap a clockwise angle in degrees to the nearest 45-degree increment,
 * matching the Shift-constrain convention used by the pen and shape tools.
 */
export function snapAngle45(deg: number): number {
  return Math.round(deg / 45) * 45
}

/** Accumulated rotate-drag state (mirrors the controller's grab fields). */
export interface RotateDragState {
  /** Unsnapped pointer angle of the previous step. */
  lastRaw: number
  /** Unsnapped swept total (branch-cut normalized, multi-turn safe). */
  accum: number
  /** Snapped-or-raw total already applied to the artwork. */
  applied: number
}

/**
 * One absolute-rotation step: fold the pointer sweep into the unsnapped
 * total, snap the total under Shift, and report the delta to apply plus
 * the status-bar readout. Mutates the passed state like the controller
 * fields it replaces.
 */
export function rotateDragStep(
  state: RotateDragState,
  pointerDeg: number,
  shift: boolean
): { delta: number; shown: number } {
  const stepRaw = ((pointerDeg - state.lastRaw + 540) % 360) - 180
  state.accum += stepRaw
  state.lastRaw = pointerDeg
  const target = shift ? snapAngle45(state.accum) : state.accum
  const delta = target - state.applied
  if (Math.abs(delta) > 1e-9) {
    state.applied = target
  }
  const shown = ((state.applied % 360) + 540) % 360 - 180
  return { delta: Math.abs(delta) > 1e-9 ? delta : 0, shown }
}

/** Grab-time frame snapshot for absolute scale drags. */
export interface ScaleDragBase {
  cx: number
  cy: number
  w: number
  h: number
  /** Clockwise frame tilt in degrees. */
  angle: number
}

/**
 * Absolute scale-factor totals measured in frame-local space (grab-time
 * orientation), so handles on a tilted box scale along the box axes.
 * Edge handles lock the orthogonal axis, Shift on corners equalizes
 * magnitude while preserving each axis sign, and totals clamp off zero
 * so pivot crossing flips in one bounded step. Also returns the pivot in
 * local space for the tracked-frame advance below.
 */
export function scaleDragTotals(
  base: ScaleDragBase,
  handle: FrameHandle,
  start: Xy,
  current: Xy,
  centerPivot: boolean,
  shift: boolean
): { fx: number; fy: number; pivotLocal: Xy } {
  const centerW = { x: base.cx, y: base.cy }
  const toLocal = (p: Xy) => rotateXy(p, -base.angle, centerW)
  const pivotLocal: Xy = centerPivot
    ? { x: base.cx, y: base.cy }
    : localHandlePoint(base, oppositeHandle(handle))
  const sL = toLocal(start)
  const qL = toLocal(current)
  const dxs = sL.x - pivotLocal.x
  const dys = sL.y - pivotLocal.y
  const corner = isCornerHandle(handle)
  const horizontalEdge = handle === 'middleLeft' || handle === 'middleRight'
  const verticalEdge = handle === 'topCenter' || handle === 'bottomCenter'

  let fx = 1
  let fy = 1
  if (corner || horizontalEdge) {
    fx = Math.abs(dxs) > 1e-9 ? (qL.x - pivotLocal.x) / dxs : 1
  }
  if (corner || verticalEdge) {
    fy = Math.abs(dys) > 1e-9 ? (qL.y - pivotLocal.y) / dys : 1
  }
  if (!Number.isFinite(fx)) fx = 1
  if (!Number.isFinite(fy)) fy = 1

  if (shift && corner) {
    // Uniform proportions: dominant magnitude wins, each axis keeps its
    // own flip sign so Shift never invents a new mirror.
    const mag = Math.max(Math.abs(fx), Math.abs(fy))
    fx = (fx < 0 ? -1 : 1) * mag
    fy = (fy < 0 ? -1 : 1) * mag
  }

  // Clamp totals: cap runaway zoom, floor off zero so pivot crossing flips
  // in one bounded step instead of dividing by ~0.
  const startW = Math.max(base.w, 1e-9)
  const startH = Math.max(base.h, 1e-9)
  const MIN_SIZE = 0.5
  const MAX_SCALE = 100
  const minFx = MIN_SIZE / startW
  const minFy = MIN_SIZE / startH
  if (corner || horizontalEdge) {
    const s = fx < 0 ? -1 : 1
    const a = Math.abs(fx)
    fx = s * Math.max(minFx, Math.min(MAX_SCALE, a))
  }
  if (corner || verticalEdge) {
    const s = fy < 0 ? -1 : 1
    const a = Math.abs(fy)
    fy = s * Math.max(minFy, Math.min(MAX_SCALE, a))
  }
  return { fx, fy, pivotLocal }
}

/**
 * Incremental step from totals over the last applied totals. Returns null
 * when there is nothing to apply, so callers skip the item walk.
 */
export function scaleStepFromTotals(
  fx: number,
  fy: number,
  lastFx: number,
  lastFy: number
): { stepFx: number; stepFy: number } | null {
  const safeLastFx = Math.abs(lastFx) < 1e-12 ? 1 : lastFx
  const safeLastFy = Math.abs(lastFy) < 1e-12 ? 1 : lastFy
  let stepFx = fx / safeLastFx
  let stepFy = fy / safeLastFy
  if (!Number.isFinite(stepFx)) stepFx = 1
  if (!Number.isFinite(stepFy)) stepFy = 1
  if (Math.abs(stepFx - 1) < 1e-9 && Math.abs(stepFy - 1) < 1e-9) return null
  return { stepFx, stepFy }
}

/**
 * Advance the tracked frame from signed totals (angle never changes under
 * scaling): the center rides the pivot-anchored interpolation back into
 * world space, size takes absolute factors so flips stay honest.
 */
export function advanceScaledFrame(
  base: ScaleDragBase,
  pivotLocal: Xy,
  fx: number,
  fy: number
): { cx: number; cy: number; w: number; h: number } {
  const clx = pivotLocal.x + (base.cx - pivotLocal.x) * fx
  const cly = pivotLocal.y + (base.cy - pivotLocal.y) * fy
  const cw = rotateXy({ x: clx, y: cly }, base.angle, { x: base.cx, y: base.cy })
  return { cx: cw.x, cy: cw.y, w: base.w * Math.abs(fx), h: base.h * Math.abs(fy) }
}
