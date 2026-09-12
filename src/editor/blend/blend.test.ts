import { describe, expect, it } from 'vitest'
import {
  alignSampledPoints,
  lerp,
  lerpRgba,
  rgbaToCss,
  sampleCountFor,
  type BlendPoint,
} from './blend'

const circle = (cx: number, cy: number, r: number, n: number, phase = 0): BlendPoint[] => {
  const pts: BlendPoint[] = []
  for (let i = 0; i < n; i++) {
    const a = phase + (Math.PI * 2 * i) / n
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  }
  return pts
}

describe('lerp', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(lerp(3, 9, 0)).toBe(3)
    expect(lerp(3, 9, 1)).toBe(9)
  })

  it('interpolates linearly between them', () => {
    expect(lerp(3, 9, 0.5)).toBe(6)
  })
})

describe('sampleCountFor', () => {
  it('honors the denser operand with a 6x budget', () => {
    expect(sampleCountFor([4, 12])).toBe(72)
  })

  it('clamps to a minimum of 24 and a maximum of 720', () => {
    expect(sampleCountFor([1, 1])).toBe(24)
    expect(sampleCountFor([500, 3])).toBe(720)
  })
})

describe('alignSampledPoints', () => {
  it('rotates a closed outline to start near the target start', () => {
    const target = circle(0, 0, 10, 8, 0)
    // Same ring but the sample run starts a quarter turn away.
    const source = circle(0, 0, 10, 8, Math.PI / 2)
    const aligned = alignSampledPoints(target, source, true)
    // The nearest source vertex to target[0] = (10, 0) is (7.07, -7.07) or
    // (7.07, 7.07); after alignment point 0 must be one of those, and the
    // outline must line up far better than the unrotated run.
    const err = aligned.reduce((s, p, i) => s + Math.hypot(p.x - target[i].x, p.y - target[i].y), 0)
    expect(err).toBeLessThan(1e-6)
  })

  it('reverses a closed outline when the winding runs against the target', () => {
    const target = circle(0, 0, 10, 8, 0)
    const source = circle(0, 0, 10, 8, 0).reverse()
    const aligned = alignSampledPoints(target, source, true)
    const err = aligned.reduce((s, p, i) => s + Math.hypot(p.x - target[i].x, p.y - target[i].y), 0)
    expect(err).toBeLessThan(1e-6)
  })

  it('keeps open outlines endpoints-fixed and only flips direction', () => {
    const target: BlendPoint[] = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ]
    const source: BlendPoint[] = [
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ]
    const aligned = alignSampledPoints(target, source, false)
    // Reversed run: endpoints line up against the target's.
    expect(aligned[0]).toEqual({ x: 0, y: 1 })
    expect(aligned[2]).toEqual({ x: 2, y: 1 })
  })

  it('passes through mismatched input untouched', () => {
    const source: BlendPoint[] = [{ x: 0, y: 0 }]
    expect(alignSampledPoints([{ x: 1, y: 1 }, { x: 2, y: 2 }], source, true)).toBe(source)
    expect(alignSampledPoints([], [], true)).toEqual([])
  })
})

describe('lerpRgba', () => {
  it('blends channels toward the second color', () => {
    expect(lerpRgba({ r: 0, g: 0, b: 0, a: 1 }, { r: 100, g: 200, b: 50, a: 0 }, 0.5)).toEqual({
      r: 50,
      g: 100,
      b: 25,
      a: 0.5,
    })
  })

  it('rounds channels to whole 8-bit values', () => {
    const mid = lerpRgba({ r: 1, g: 2, b: 3, a: 1 }, { r: 2, g: 3, b: 4, a: 1 }, 0.5)
    expect(mid).toEqual({ r: 2, g: 3, b: 4, a: 1 })
  })
})

describe('rgbaToCss', () => {
  it('emits rgb() for opaque colors and rgba() otherwise', () => {
    expect(rgbaToCss({ r: 255, g: 10, b: 0, a: 1 })).toBe('rgb(255,10,0)')
    expect(rgbaToCss({ r: 255, g: 10, b: 0, a: 0.5 })).toBe('rgba(255,10,0,0.5)')
  })
})
