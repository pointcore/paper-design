import { describe, expect, it } from 'vitest'
import {
  advanceScaledFrame,
  rotateDragStep,
  scaleDragTotals,
  scaleStepFromTotals,
  snapAngle45,
  type RotateDragState,
} from './transform-math'
import { rotateXy } from './frame-geometry'

describe('snapAngle45', () => {
  it('snaps to the nearest 45° increment', () => {
    expect(snapAngle45(0)).toBe(0)
    expect(snapAngle45(22)).toBe(0)
    expect(snapAngle45(23)).toBe(45)
    expect(snapAngle45(-30)).toBe(-45)
    expect(snapAngle45(400)).toBe(405)
  })
})

describe('rotateDragStep', () => {
  const fresh = (): RotateDragState => ({ lastRaw: 0, accum: 0, applied: 0 })

  it('accumulates unsnapped sweeps without snapping', () => {
    const s = fresh()
    expect(rotateDragStep(s, 30, false)).toEqual({ delta: 30, shown: 30 })
    expect(rotateDragStep(s, 50, false)).toEqual({ delta: 20, shown: 50 })
    expect(s.accum).toBe(50)
  })

  it('normalizes the branch cut so multi-turn drags keep counting', () => {
    const s = fresh()
    rotateDragStep(s, 170, false)
    // 170 -> -170 (=190): a +20 continuation, not a -340 jump.
    const step = rotateDragStep(s, -170, false)
    expect(step.delta).toBeCloseTo(20, 9)
    expect(s.accum).toBeCloseTo(190, 9)
  })

  it('snaps the total under Shift and reports zero when settled', () => {
    const s = fresh()
    const first = rotateDragStep(s, 30, true)
    expect(first.delta).toBe(45)
    expect(s.applied).toBe(45)
    // Same pointer again: nothing left to apply.
    expect(rotateDragStep(s, 30, true)).toEqual({ delta: 0, shown: 45 })
  })
})

describe('scaleDragTotals', () => {
  const base = { cx: 0, cy: 0, w: 100, h: 50, angle: 0 }

  it('is the identity at the grab point for any tilt', () => {
    for (const angle of [0, 30, 90, -45]) {
      const b = { ...base, angle }
      const out = scaleDragTotals(b, 'bottomRight', { x: 50, y: 25 }, { x: 50, y: 25 }, false, false)
      expect(out.fx).toBeCloseTo(1, 9)
      expect(out.fy).toBeCloseTo(1, 9)
    }
  })

  it('measures corner factors from the opposite pivot', () => {
    // Opposite of bottomRight is topLeft (-50, -25).
    const out = scaleDragTotals(base, 'bottomRight', { x: 50, y: 25 }, { x: 100, y: 50 }, false, false)
    expect(out.fx).toBeCloseTo(1.5, 9)
    expect(out.fy).toBeCloseTo(1.5, 9)
    expect(out.pivotLocal).toEqual({ x: -50, y: -25 })
  })

  it('locks the orthogonal axis on edge handles', () => {
    const out = scaleDragTotals(base, 'middleRight', { x: 50, y: 0 }, { x: 100, y: 40 }, false, false)
    expect(out.fx).toBeCloseTo(1.5, 9)
    expect(out.fy).toBe(1)
  })

  it('equalizes magnitude under Shift while keeping flip signs', () => {
    const out = scaleDragTotals(base, 'bottomRight', { x: 50, y: 25 }, { x: 100, y: 37.5 }, false, true)
    // Raw: fx 1.5, fy 1.25 -> uniform 1.5.
    expect(out.fx).toBeCloseTo(1.5, 9)
    expect(out.fy).toBeCloseTo(1.5, 9)
  })

  it('clamps runaway zoom and floors off zero', () => {
    const huge = scaleDragTotals(base, 'bottomRight', { x: 50, y: 25 }, { x: 50000, y: 25 }, false, false)
    expect(huge.fx).toBe(100)
    const tiny = scaleDragTotals(base, 'bottomRight', { x: 50, y: 25 }, { x: -49.99, y: 25 }, false, false)
    // minFx for w=100 is 0.005: pivot crossing flips in one bounded step.
    expect(tiny.fx).toBeCloseTo(0.005, 9)
  })

  it('scales along box axes on a tilted frame', () => {
    // 90° tilt: world +x travels along local -y.
    const tilted = { ...base, angle: 90 }
    const p = rotateXy({ x: 1, y: 0 }, -90, { x: 0, y: 0 })
    expect(p.x).toBeCloseTo(0, 9)
    expect(p.y).toBeCloseTo(-1, 9)
    const out = scaleDragTotals(tilted, 'bottomRight', { x: 50, y: 25 }, { x: 50, y: 25 }, false, false)
    expect(out.fx).toBeCloseTo(1, 9)
    expect(out.fy).toBeCloseTo(1, 9)
  })
})

describe('scaleStepFromTotals', () => {
  it('returns null when there is nothing to apply', () => {
    expect(scaleStepFromTotals(1, 1, 1, 1)).toBeNull()
    expect(scaleStepFromTotals(1.5, 1.5, 1.5, 1.5)).toBeNull()
  })

  it('divides totals by last totals, guarding degenerate denominators', () => {
    expect(scaleStepFromTotals(1.5, 2, 1, 1)).toEqual({ stepFx: 1.5, stepFy: 2 })
    expect(scaleStepFromTotals(2, 2, 0, 0)).toEqual({ stepFx: 2, stepFy: 2 })
  })
})

describe('advanceScaledFrame', () => {
  it('holds the center for a uniform scale about the middle', () => {
    const base = { cx: 0, cy: 0, w: 100, h: 50, angle: 0 }
    expect(advanceScaledFrame(base, { x: 0, y: 0 }, 2, 2)).toEqual({ cx: 0, cy: 0, w: 200, h: 100 })
  })

  it('rides the fixed pivot when scaling from a corner', () => {
    const base = { cx: 0, cy: 0, w: 100, h: 50, angle: 0 }
    // Doubling about topLeft (-50, -25): center moves to (50, 25).
    expect(advanceScaledFrame(base, { x: -50, y: -25 }, 2, 2)).toEqual({ cx: 50, cy: 25, w: 200, h: 100 })
  })

  it('keeps size honest through flips', () => {
    const base = { cx: 0, cy: 0, w: 100, h: 50, angle: 0 }
    const out = advanceScaledFrame(base, { x: -50, y: -25 }, -1.5, 1.5)
    expect(out.w).toBe(150)
    expect(out.h).toBe(75)
  })
})
