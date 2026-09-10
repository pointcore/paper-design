/**
 * Unit tests for shared geometry helpers — run with `vitest run`.
 */
import { describe, expect, it } from 'vitest'
import { gradientAngleFromVector, linearGradientEndpoints, normalizeAngleDeg, remainingRuns, rulerUnitFactor, snap45 } from './geometry'

/** Minimal PaperScope stand-in (snap45 only news up points). */
const scope = {
  Point: class {
    x: number
    y: number
    constructor(x = 0, y = 0) {
      this.x = x
      this.y = y
    }
  },
} as any

function vec(x: number, y: number) {
  return new scope.Point(x, y)
}

describe('snap45', () => {
  it('keeps axis vectors unchanged', () => {
    const east = snap45(vec(10, 0), scope)
    expect(east.x).toBeCloseTo(10, 9)
    expect(east.y).toBeCloseTo(0, 9)
    const north = snap45(vec(0, -7), scope)
    expect(north.x).toBeCloseTo(0, 9)
    expect(north.y).toBeCloseTo(-7, 9)
  })

  it('keeps exact diagonals unchanged', () => {
    const out = snap45(vec(5, 5), scope)
    expect(out.x).toBeCloseTo(5, 9)
    expect(out.y).toBeCloseTo(5, 9)
  })

  it('snaps near-axis vectors onto the axis', () => {
    const out = snap45(vec(10, 1), scope)
    expect(out.y).toBeCloseTo(0, 9)
    expect(out.x).toBeCloseTo(Math.hypot(10, 1), 9)
  })

  it('snaps to the nearer diagonal', () => {
    // ~30° goes to 45°, preserving length.
    const out = snap45(vec(10, 6), scope)
    const len = Math.hypot(10, 6)
    expect(out.x).toBeCloseTo(Math.cos(Math.PI / 4) * len, 9)
    expect(out.y).toBeCloseTo(Math.sin(Math.PI / 4) * len, 9)
  })

  it('maps zero vectors to zero without dividing', () => {
    expect(snap45(vec(0, 0), scope)).toMatchObject({ x: 0, y: 0 })
    expect(snap45(vec(1e-9, 0), scope)).toMatchObject({ x: 0, y: 0 })
  })
})

describe('rulerUnitFactor', () => {
  it('converts CSS px at 96dpi', () => {
    expect(rulerUnitFactor('px')).toBe(1)
    expect(rulerUnitFactor('pt')).toBe(0.75)
    expect(rulerUnitFactor('mm')).toBeCloseTo(25.4 / 96, 12)
    expect(rulerUnitFactor('cm')).toBeCloseTo(2.54 / 96, 12)
    expect(rulerUnitFactor('in')).toBeCloseTo(1 / 96, 12)
  })

  it('falls back to identity for unknown units', () => {
    expect(rulerUnitFactor('furlong' as any)).toBe(1)
  })
})

describe('gradient angle helpers', () => {
  it('normalizes degrees into [0, 360)', () => {
    expect(normalizeAngleDeg(0)).toBe(0)
    expect(normalizeAngleDeg(720)).toBe(0)
    expect(normalizeAngleDeg(-90)).toBe(270)
    expect(normalizeAngleDeg(Number.NaN)).toBe(0)
  })

  it('reads vector angles in screen coords (y down)', () => {
    expect(gradientAngleFromVector(10, 0)).toBe(0)
    expect(gradientAngleFromVector(0, 10)).toBe(90)
    expect(gradientAngleFromVector(-10, 0)).toBe(180)
    expect(gradientAngleFromVector(0, 0)).toBe(0)
  })

  it('lays linear endpoints horizontally at 0 degrees', () => {
    const e = linearGradientEndpoints(100, 50, 200, 100, 0)
    expect(e.x1).toBeCloseTo(0, 9)
    expect(e.x2).toBeCloseTo(200, 9)
    expect(e.y1).toBeCloseTo(50, 9)
    expect(e.y2).toBeCloseTo(50, 9)
  })

  it('lays linear endpoints vertically at 90 degrees', () => {
    const e = linearGradientEndpoints(100, 50, 200, 100, 90)
    expect(e.x1).toBeCloseTo(100, 9)
    expect(e.x2).toBeCloseTo(100, 9)
    expect(e.y1).toBeCloseTo(0, 9)
    expect(e.y2).toBeCloseTo(100, 9)
  })

  it('keeps endpoints symmetric about the center at 45 degrees', () => {
    const e = linearGradientEndpoints(0, 0, 100, 100, 45)
    expect(e.x1).toBeCloseTo(-e.x2, 9)
    expect(e.y1).toBeCloseTo(-e.y2, 9)
    expect(gradientAngleFromVector(e.x2 - e.x1, e.y2 - e.y1)).toBeCloseTo(45, 9)
  })
})

describe('remainingRuns', () => {
  it('keeps open paths whole without removals', () => {
    expect(remainingRuns(false, 4, new Set())).toEqual([[0, 1, 2, 3]])
  })

  it('splits open paths at removed curves', () => {
    expect(remainingRuns(false, 4, new Set([1]))).toEqual([[0, 1], [2, 3]])
    expect(remainingRuns(false, 4, new Set([0]))).toEqual([[0], [1, 2, 3]])
    expect(remainingRuns(false, 4, new Set([2]))).toEqual([[0, 1, 2], [3]])
  })

  it('opens closed paths at the removed curve', () => {
    // Pentagon minus curve 2 (anchors 2→3): one run from 3 round to 2.
    expect(remainingRuns(true, 5, new Set([2]))).toEqual([[3, 4, 0, 1, 2]])
  })

  it('splits closed paths at every removed curve', () => {
    expect(remainingRuns(true, 5, new Set([1, 3]))).toEqual([[2, 3], [4, 0, 1]])
  })

  it('keeps a lone surviving curve as a two-anchor run', () => {
    expect(remainingRuns(true, 4, new Set([0, 1, 2]))).toEqual([[3, 0]])
  })

  it('returns no runs when every curve is gone', () => {
    expect(remainingRuns(true, 3, new Set([0, 1, 2]))).toEqual([])
  })
})
