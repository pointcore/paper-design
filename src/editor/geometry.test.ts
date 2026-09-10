/**
 * Unit tests for shared geometry helpers — run with `vitest run`.
 */
import { describe, expect, it } from 'vitest'
import { snap45 } from './geometry'

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
