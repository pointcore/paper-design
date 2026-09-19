// @vitest-environment node
/**
 * Unit tests for the select-mode chrome outline budget: huge selections
 * (whole imported pages) fall back to bounds rects instead of tracing
 * every path leaf, which used to freeze selection for hundreds of ms.
 */
import { describe, expect, it } from 'vitest'
import { SELECT_OUTLINE_LEAF_BUDGET, countOutlineLeaves } from './selection-style'

function path() {
  return { className: 'Path' }
}
function group(...children: unknown[]) {
  return { className: 'Group', children }
}
function compound(n: number) {
  return {
    className: 'CompoundPath',
    children: Array.from({ length: n }, () => ({ className: 'Path' })),
  }
}

describe('countOutlineLeaves', () => {
  it('counts paths, nested paths and compound children', () => {
    expect(countOutlineLeaves([])).toBe(0)
    expect(countOutlineLeaves([path()])).toBe(1)
    expect(
      countOutlineLeaves([group(path(), path()), compound(3), { className: 'PointText' }]),
    ).toBe(2 + 3)
  })

  it('ignores non-path leaves and empty groups', () => {
    expect(countOutlineLeaves([group(), { className: 'Raster' }])).toBe(0)
  })
})

describe('SELECT_OUTLINE_LEAF_BUDGET', () => {
  it('is a positive sanity threshold', () => {
    expect(SELECT_OUTLINE_LEAF_BUDGET).toBeGreaterThan(0)
    // A whole imported page (600+ leaves) must exceed it; a handful of
    // paths must stay detailed.
    expect(countOutlineLeaves([group(...Array.from({ length: 600 }, path))])).toBeGreaterThan(
      SELECT_OUTLINE_LEAF_BUDGET,
    )
    expect(countOutlineLeaves([group(path(), path())])).toBeLessThanOrEqual(
      SELECT_OUTLINE_LEAF_BUDGET,
    )
  })
})
