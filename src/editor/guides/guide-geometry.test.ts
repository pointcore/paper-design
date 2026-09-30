/**
 * Guide geometry math.
 *
 * Everything here is pure, which is the point: a diagonal guide's distance,
 * projection and slide are three formulas that are easy to get subtly wrong
 * and impossible to eyeball on a canvas. The engine-level behaviour (the
 * item data, the endpoints, the dialog) is covered by guides-domain.test.ts
 * and the acceptance spec.
 */
import { describe, expect, it } from 'vitest'
import {
  direction,
  displayGuideAngle,
  distance,
  endpoints,
  normalizeGuideAngle,
  normal,
  project,
  slide,
  type GuideGeometry,
} from './guide-geometry'

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps)

const diagonal = (angle: number, x = 0, y = 0): GuideGeometry => ({
  orientation: 'diagonal',
  position: x,
  cross: y,
  angle,
})

describe('direction and normal', () => {
  it('reads angles the way the canvas does (y grows downward)', () => {
    close(direction(0).x, 1)
    close(direction(0).y, 0)
    // 90 degrees points down the screen, not up.
    close(direction(90).x, 0, 1e-9)
    close(direction(90).y, 1)
  })

  it('normal is the direction rotated a quarter turn', () => {
    for (const angle of [0, 30, 45, 90, 137]) {
      const n = normal(angle)
      // A point on the line must not move along the normal.
      const p = project(diagonal(angle, 10, 20), { x: 10 + direction(angle).x * 5, y: 20 + direction(angle).y * 5 })
      close(n.x * (p.x - 10) + n.y * (p.y - 20), 0, 1e-9)
    }
  })
})

describe('endpoints', () => {
  it('spans a huge range either side of the anchor', () => {
    const [a, b] = endpoints(diagonal(45, 0, 0), 1000)
    close(a.x, -1000 * Math.SQRT1_2)
    close(a.y, -1000 * Math.SQRT1_2)
    close(b.x, 1000 * Math.SQRT1_2)
    close(b.y, 1000 * Math.SQRT1_2)
  })

  it('keeps axis-aligned guides axis-aligned', () => {
    const [v0, v1] = endpoints({ orientation: 'vertical', position: 42, cross: 0, angle: 0 }, 10)
    expect(v0).toEqual({ x: 42, y: -10 })
    expect(v1).toEqual({ x: 42, y: 10 })
    const [h0, h1] = endpoints({ orientation: 'horizontal', position: 7, cross: 0, angle: 0 }, 10)
    expect(h0).toEqual({ x: -10, y: 7 })
    expect(h1).toEqual({ x: 10, y: 7 })
  })
})

describe('project and distance', () => {
  it('snaps a point onto the diagonal through the anchor', () => {
    // A 45-degree guide through the origin: (10, 0) projects to (5, 5).
    const p = project(diagonal(45), { x: 10, y: 0 })
    close(p.x, 5)
    close(p.y, 5)
  })

  it('measures the perpendicular distance, not the axis distance', () => {
    // (10, 0) is 7.07 from the 45-degree line, not 10 and not 0.
    close(distance(diagonal(45), { x: 10, y: 0 }), Math.SQRT1_2 * 10)
    close(distance(diagonal(45), { x: 0, y: 0 }), 0)
    // Above the line is the same distance as below it.
    close(distance(diagonal(45), { x: 0, y: 10 }), distance(diagonal(45), { x: 10, y: 0 }))
  })

  it('measures axis-aligned guides along their own axis', () => {
    close(distance({ orientation: 'vertical', position: 100, cross: 0, angle: 0 }, { x: 130, y: 999 }), 30)
    close(distance({ orientation: 'horizontal', position: 100, cross: 0, angle: 0 }, { x: 999, y: 70 }), 30)
  })

  it('respects an off-origin anchor', () => {
    // 90-degree guide at x = 50: (50, 0) is on it, (0, 0) is 50 away.
    close(distance(diagonal(90, 50, 0), { x: 50, y: 123 }), 0)
    close(distance(diagonal(90, 50, 0), { x: 0, y: 0 }), 50)
  })
})

describe('slide', () => {
  it('follows the pointer along a ruler guide free axis', () => {
    const vertical = { orientation: 'vertical', position: 10, cross: 0, angle: 0 } as const
    expect(slide(vertical, { x: 0, y: 0 }, { x: 25, y: 999 }).position).toBe(25)
    const horizontal = { orientation: 'horizontal', position: 10, cross: 0, angle: 0 } as const
    expect(slide(horizontal, { x: 0, y: 0 }, { x: 999, y: 33 }).position).toBe(33)
  })

  it('moves a diagonal guide only along its normal', () => {
    const guide = diagonal(45, 0, 0)
    // A drag along the guide's own direction must not move it.
    const along = slide(guide, { x: 0, y: 0 }, { x: 10, y: 10 })
    close(along.position, 0)
    close(along.cross, 0)
    // A drag straight down the normal (-1, 1) for 45 degrees slides it by t.
    const across = slide(guide, { x: 0, y: 0 }, { x: -5, y: 5 })
    close(across.position + across.cross, 0, 1e-9)
    close(Math.hypot(across.position, across.cross), 5 * Math.SQRT2)
  })

  it('keeps the angle through a slide', () => {
    const moved = slide(diagonal(30, 4, 5), { x: 0, y: 0 }, { x: 3, y: -9 })
    expect(moved.angle).toBe(30)
  })

  it('is the identity for a zero-length drag', () => {
    const guide = diagonal(37, 12, -4)
    const moved = slide(guide, { x: 5, y: 5 }, { x: 5, y: 5 })
    close(moved.position, 12)
    close(moved.cross, -4)
  })
})

describe('normalizeGuideAngle', () => {
  it('folds an angle into [0, 180)', () => {
    expect(normalizeGuideAngle(0)).toBe(0)
    expect(normalizeGuideAngle(180)).toBe(0)
    expect(normalizeGuideAngle(-45)).toBe(135)
    expect(normalizeGuideAngle(225)).toBe(45)
    expect(normalizeGuideAngle(179.9999999999)).toBe(0)
  })

  it('falls back to 0 for nonsense', () => {
    expect(normalizeGuideAngle(Number.NaN)).toBe(0)
    expect(normalizeGuideAngle(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('displayGuideAngle', () => {
  it('shows the signed angle a user would have typed', () => {
    // Storage is canonical in [0, 180); the field must not show 150 for -30.
    expect(displayGuideAngle(150)).toBe(-30)
    expect(displayGuideAngle(-30)).toBe(-30)
    expect(displayGuideAngle(30)).toBe(30)
    expect(displayGuideAngle(0)).toBe(0)
    expect(displayGuideAngle(90)).toBe(90)
  })

  it('round-trips through storage unchanged', () => {
    for (const typed of [-89, -45, -1, 0, 1, 45, 89]) {
      expect(displayGuideAngle(normalizeGuideAngle(typed))).toBe(typed)
    }
  })
})
