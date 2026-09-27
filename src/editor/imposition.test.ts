/**
 * Unit tests for N-up imposition layout — run with `vitest run`.
 *
 * Exercises the REAL engine.computeNUpLayout implementation
 * (engine-export.ts) so the tests cannot drift from production.
 */
import { describe, expect, it } from 'vitest'
import { computeNUpLayout } from './engine-export'

describe('computeNUpLayout', () => {
  it('returns empty for empty boards', () => {
    expect(computeNUpLayout([])).toEqual([])
  })

  it('returns empty for zero upCount', () => {
    expect(computeNUpLayout([{ width: 100, height: 100 }], 0)).toEqual([])
  })

  it('places one board centered', () => {
    const layout = computeNUpLayout([{ width: 100, height: 100 }], 1)
    expect(layout).toHaveLength(1)
    expect(layout[0].pageIndex).toBe(0)
    expect(layout[0].x).toBeGreaterThan(0)
    expect(layout[0].y).toBeGreaterThan(0)
  })

  it('places 4 boards in a 2×2 grid', () => {
    const boards = Array.from({ length: 4 }, () => ({ width: 100, height: 100 }))
    const layout = computeNUpLayout(boards, 4)
    expect(layout).toHaveLength(4)
    // All boards should have valid positions
    for (const item of layout) {
      expect(item.x).toBeGreaterThanOrEqual(0)
      expect(item.y).toBeGreaterThanOrEqual(0)
      expect(item.scale).toBeGreaterThan(0)
    }
  })

  it('limits to upCount boards', () => {
    const boards = Array.from({ length: 10 }, () => ({ width: 100, height: 100 }))
    const layout = computeNUpLayout(boards, 4)
    expect(layout).toHaveLength(4)
  })

  it('does not upscale', () => {
    const boards = [{ width: 50, height: 50 }]
    const layout = computeNUpLayout(boards, 4, 12, 36)
    expect(layout[0].scale).toBeLessThanOrEqual(1)
  })

  it('handles landscape boards correctly', () => {
    const boards = [{ width: 200, height: 100 }]
    const layout = computeNUpLayout(boards, 4, 12, 36, true)
    expect(layout).toHaveLength(1)
    expect(layout[0].scale).toBeGreaterThan(0)
  })

  it('handles portrait boards correctly', () => {
    const boards = [{ width: 100, height: 200 }]
    const layout = computeNUpLayout(boards, 4, 12, 36, false)
    expect(layout).toHaveLength(1)
    expect(layout[0].scale).toBeGreaterThan(0)
  })

  it('respects spacing parameter', () => {
    const boards = Array.from({ length: 4 }, () => ({ width: 100, height: 100 }))
    const layout1 = computeNUpLayout(boards, 4, 0, 36)
    const layout2 = computeNUpLayout(boards, 4, 50, 36)
    // With more spacing, boards should be further apart
    expect(layout2[1].x).toBeGreaterThan(layout1[1].x)
  })

  it('respects margin parameter', () => {
    const boards = [{ width: 100, height: 100 }]
    const layout1 = computeNUpLayout(boards, 1, 12, 10)
    const layout2 = computeNUpLayout(boards, 1, 12, 100)
    // Larger margin means board is pushed further from edge
    expect(layout2[0].x).toBeGreaterThan(layout1[0].x)
  })
})
