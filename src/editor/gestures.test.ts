import { describe, expect, it } from 'vitest'
import {
  LONG_PRESS_MS,
  LONG_PRESS_SLOP_PX,
  isLongPress,
  normalizeTwist,
  pinchTransform,
} from './gestures'

const pt = (x: number, y: number) => ({ x, y })

describe('pinchTransform', () => {
  it('measures a symmetric pinch-out as pure scale', () => {
    const t = pinchTransform(pt(90, 100), pt(110, 100), pt(80, 100), pt(120, 100))
    expect(t.scale).toBeCloseTo(2, 9)
    expect(t.rotationDeg).toBeCloseTo(0, 9)
    expect(t.panX).toBeCloseTo(0, 9)
    expect(t.panY).toBeCloseTo(0, 9)
  })

  it('measures a pinch-in below one', () => {
    const t = pinchTransform(pt(80, 100), pt(120, 100), pt(90, 100), pt(110, 100))
    expect(t.scale).toBeCloseTo(0.5, 9)
    expect(t.rotationDeg).toBeCloseTo(0, 9)
  })

  it('measures a joint drag as pure pan', () => {
    const t = pinchTransform(pt(0, 0), pt(40, 0), pt(10, 5), pt(50, 5))
    expect(t.scale).toBeCloseTo(1, 9)
    expect(t.rotationDeg).toBeCloseTo(0, 9)
    expect(t.panX).toBeCloseTo(10, 9)
    expect(t.panY).toBeCloseTo(5, 9)
  })

  it('measures a quarter turn as signed rotation', () => {
    // Pair rotates from horizontal to vertical, midpoint fixed.
    const t = pinchTransform(pt(80, 100), pt(120, 100), pt(100, 80), pt(100, 120))
    expect(t.scale).toBeCloseTo(1, 9)
    expect(Math.abs(t.rotationDeg)).toBeCloseTo(90, 9)
    expect(t.panX).toBeCloseTo(0, 9)
    expect(t.panY).toBeCloseTo(0, 9)
  })

  it('combines scale, twist and pan in one frame', () => {
    const t = pinchTransform(pt(0, 0), pt(10, 0), pt(5, 5), pt(5, 25))
    expect(t.scale).toBeCloseTo(2, 9)
    expect(Math.abs(t.rotationDeg)).toBeCloseTo(90, 9)
    expect(t.panX).toBeCloseTo(0, 9)
    expect(t.panY).toBeCloseTo(15, 9)
  })

  it('guards a zero opening span without dividing', () => {
    const t = pinchTransform(pt(50, 50), pt(50, 50), pt(40, 50), pt(60, 50))
    expect(t.scale).toBe(1)
    expect(t.rotationDeg).toBe(0)
    // Midpoint travel still reports so the pan half survives.
    expect(t.panX).toBeCloseTo(0, 9)
  })

  it('degrades non-finite input to neutral', () => {
    const nan = Number.NaN
    expect(pinchTransform(pt(nan, 0), pt(1, 0), pt(0, 0), pt(1, 0))).toEqual({
      scale: 1,
      rotationDeg: 0,
      panX: 0,
      panY: 0,
    })
  })
})

describe('normalizeTwist', () => {
  it('wraps into (-180, 180]', () => {
    expect(normalizeTwist(270)).toBeCloseTo(-90, 9)
    expect(normalizeTwist(-270)).toBeCloseTo(90, 9)
    expect(normalizeTwist(180)).toBeCloseTo(-180, 9)
    expect(normalizeTwist(0)).toBe(0)
    expect(normalizeTwist(Number.NaN)).toBe(0)
  })
})

describe('isLongPress', () => {
  it('fires on a stationary hold past the threshold', () => {
    expect(LONG_PRESS_MS).toBe(500)
    expect(LONG_PRESS_SLOP_PX).toBe(10)
    expect(isLongPress(500, 0)).toBe(true)
    expect(isLongPress(1200, 9.9)).toBe(true)
  })

  it('rejects early release and drift', () => {
    expect(isLongPress(499, 0)).toBe(false)
    expect(isLongPress(800, 10.1)).toBe(false)
  })

  it('honours custom thresholds and bad input', () => {
    expect(isLongPress(300, 0, 300, 4)).toBe(true)
    expect(isLongPress(-5, 0)).toBe(false)
    expect(isLongPress(600, Number.NaN)).toBe(false)
  })
})
