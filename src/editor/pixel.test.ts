import { describe, expect, it } from 'vitest'
import {
  alignPointToPixel,
  alignToPixel,
  normalizePixelRatio,
  pixelGridStep,
} from './pixel'

describe('alignToPixel', () => {
  it('snaps to integers at 1x', () => {
    expect(alignToPixel(10.4, 1)).toBe(10)
    expect(alignToPixel(10.5, 1)).toBe(11)
    expect(alignToPixel(-3.6, 1)).toBe(-4)
  })

  it('snaps to halves at 2x', () => {
    expect(alignToPixel(10.24, 2)).toBe(10)
    expect(alignToPixel(10.26, 2)).toBe(10.5)
    expect(alignToPixel(10.75, 2)).toBe(11)
  })

  it('leaves integers alone at either ratio', () => {
    expect(alignToPixel(7, 1)).toBe(7)
    expect(alignToPixel(7, 2)).toBe(7)
  })

  it('passes non-finite values through', () => {
    expect(alignToPixel(NaN, 1)).toBeNaN()
    expect(alignToPixel(Infinity, 2)).toBe(Infinity)
  })
})

describe('alignPointToPixel', () => {
  it('rounds both axes', () => {
    expect(alignPointToPixel({ x: 1.4, y: 2.6 }, 1)).toEqual({ x: 1, y: 3 })
    expect(alignPointToPixel({ x: 1.24, y: 2.26 }, 2)).toEqual({ x: 1, y: 2.5 })
  })
})

describe('pixelGridStep / normalizePixelRatio', () => {
  it('reports the document-unit step', () => {
    expect(pixelGridStep(1)).toBe(1)
    expect(pixelGridStep(2)).toBe(0.5)
  })

  it('clamps unknown ratios to 1x', () => {
    expect(normalizePixelRatio(2)).toBe(2)
    expect(normalizePixelRatio(3)).toBe(1)
    expect(normalizePixelRatio(undefined)).toBe(1)
  })
})
