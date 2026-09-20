import { describe, expect, it } from 'vitest'
import {
  TREE_ROW_HEIGHT,
  TREE_WINDOW_OVERSCAN,
  TREE_WINDOW_THRESHOLD,
  TREE_WINDOW_VIEWPORT,
  calcTreeWindow,
} from './tree-window'

describe('calcTreeWindow', () => {
  it('returns an empty window for empty or invalid lists', () => {
    expect(calcTreeWindow(0, 0)).toEqual({ start: 0, end: 0 })
    expect(calcTreeWindow(-5, 0)).toEqual({ start: 0, end: 0 })
    expect(calcTreeWindow(NaN, 0)).toEqual({ start: 0, end: 0 })
  })

  it('covers small lists fully from the top', () => {
    // 360px viewport / 28px rows = 13 visible + 10 overscan covers 23 rows.
    expect(calcTreeWindow(20, 0)).toEqual({ start: 0, end: 20 })
    expect(calcTreeWindow(1, 0)).toEqual({ start: 0, end: 1 })
  })

  it('windows large lists with overscan on both sides', () => {
    const w = calcTreeWindow(1000, 10 * TREE_ROW_HEIGHT)
    expect(w.start).toBe(0)
    expect(w.end).toBe(10 + Math.ceil(TREE_WINDOW_VIEWPORT / TREE_ROW_HEIGHT) + TREE_WINDOW_OVERSCAN)
    const mid = calcTreeWindow(1000, 500 * TREE_ROW_HEIGHT)
    expect(mid.start).toBe(500 - TREE_WINDOW_OVERSCAN)
    expect(mid.end).toBe(500 + Math.ceil(TREE_WINDOW_VIEWPORT / TREE_ROW_HEIGHT) + TREE_WINDOW_OVERSCAN)
  })

  it('clamps the end at the bottom of the list', () => {
    const w = calcTreeWindow(1000, 990 * TREE_ROW_HEIGHT)
    expect(w.end).toBe(1000)
    // Spacer math stays exact: every row is either rendered or spaced.
    expect(w.start * TREE_ROW_HEIGHT + (w.end - w.start) * TREE_ROW_HEIGHT + (1000 - w.end) * TREE_ROW_HEIGHT)
      .toBe(1000 * TREE_ROW_HEIGHT)
  })

  it('clamps stale scroll offsets past deleted content', () => {
    const w = calcTreeWindow(50, 100000)
    expect(w.end).toBe(50)
    expect(w.start).toBeLessThanOrEqual(w.end)
  })

  it('treats negative scroll as zero', () => {
    expect(calcTreeWindow(1000, -40)).toEqual(calcTreeWindow(1000, 0))
  })

  it('supports zero overscan for exact viewport slicing', () => {
    const visible = Math.ceil(TREE_WINDOW_VIEWPORT / TREE_ROW_HEIGHT)
    expect(calcTreeWindow(1000, 0, TREE_WINDOW_VIEWPORT, TREE_ROW_HEIGHT, 0)).toEqual({ start: 0, end: visible })
  })

  it('falls back on invalid geometry instead of throwing', () => {
    const visible = Math.ceil(TREE_WINDOW_VIEWPORT / TREE_ROW_HEIGHT)
    // Zero sizes fall back to defaults; negative overscan clamps to none.
    expect(calcTreeWindow(1000, 0, 0, 0, -3)).toEqual({ start: 0, end: visible })
    expect(calcTreeWindow(1000, NaN)).toEqual(calcTreeWindow(1000, 0))
  })

  it('keeps every row covered: spacers + window == total height', () => {
    for (const total of [151, 500, 1000, 5000]) {
      for (const scroll of [0, 137, 2828, 99999]) {
        const { start, end } = calcTreeWindow(total, scroll)
        expect(start).toBeGreaterThanOrEqual(0)
        expect(end).toBeLessThanOrEqual(total)
        expect(start * TREE_ROW_HEIGHT + (end - start) * TREE_ROW_HEIGHT + (total - end) * TREE_ROW_HEIGHT)
          .toBe(total * TREE_ROW_HEIGHT)
      }
    }
  })

  it('threshold sits above one viewport so small docs never window', () => {
    expect(TREE_WINDOW_THRESHOLD).toBeGreaterThan(Math.ceil(TREE_WINDOW_VIEWPORT / TREE_ROW_HEIGHT))
    expect(TREE_WINDOW_THRESHOLD).toBe(150)
  })
})
