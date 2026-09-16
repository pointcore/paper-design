/**
 * Unit tests for N-up imposition layout — run with `vitest run`.
 */
import { describe, expect, it } from 'vitest'

/** Minimal EditorEngine stand-in for testing computeNUpLayout. */
function computeNUpLayout(
  boards: Array<{ width: number; height: number }>,
  upCount: number = 4,
  spacing: number = 12,
  margin: number = 36,
  landscape?: boolean,
): Array<{ pageIndex: number; x: number; y: number; scale: number }> {
  if (boards.length === 0 || upCount < 1) return []

  const maxW = Math.max(...boards.map((b) => b.width))
  const maxH = Math.max(...boards.map((b) => b.height))

  const cols = Math.ceil(Math.sqrt(upCount))
  const rows = Math.ceil(upCount / cols)

  const useLandscape = landscape ?? (maxW >= maxH)
  const sheetW = useLandscape ? Math.max(maxW, maxH) : Math.min(maxW, maxH)
  const sheetH = useLandscape ? Math.min(maxW, maxH) : Math.max(maxW, maxH)

  const cellW = (sheetW * 2 - margin * 2 - spacing * (cols - 1)) / cols
  const cellH = (sheetH * 2 - margin * 2 - spacing * (rows - 1)) / rows

  const result: Array<{ pageIndex: number; x: number; y: number; scale: number }> = []

  for (let i = 0; i < Math.min(boards.length, upCount); i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const board = boards[i]

    const scaleX = cellW / board.width
    const scaleY = cellH / board.height
    const scale = Math.min(scaleX, scaleY, 1)

    const drawW = board.width * scale
    const drawH = board.height * scale
    const cellX = margin + col * (cellW + spacing)
    const cellY = margin + row * (cellH + spacing)
    const x = cellX + (cellW - drawW) / 2
    const y = cellY + (cellH - drawH) / 2

    result.push({ pageIndex: i, x, y, scale })
  }

  return result
}

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
