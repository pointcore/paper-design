import { describe, expect, it } from 'vitest'
import {
  MIN_HISTORY_ENTRIES,
  evictCountForBudget,
} from './history-budget'

describe('evictCountForBudget', () => {
  it('evicts nothing when under both caps', () => {
    expect(evictCountForBudget([10, 20, 30], 1000, 100)).toBe(0)
  })

  it('enforces the entry-count cap', () => {
    const sizes = new Array(105).fill(10)
    expect(evictCountForBudget(sizes, 10 ** 12, 100)).toBe(5)
  })

  it('evicts oldest entries until bytes fit', () => {
    const sizes = [8 * 1024 * 1024, 8 * 1024 * 1024, 8 * 1024 * 1024, 8 * 1024 * 1024]
    // 32MB total, 30MB budget, floor keeps at least MIN entries so only
    // the overflow (2MB over) forces one eviction here.
    const evict = evictCountForBudget(sizes, 30 * 1024 * 1024, 100, 2)
    expect(evict).toBe(1)
  })

  it('never shrinks below the floor for budget reasons', () => {
    const sizes = new Array(MIN_HISTORY_ENTRIES + 2).fill(10 * 1024 * 1024)
    const evict = evictCountForBudget(sizes, 1, 10 ** 9, MIN_HISTORY_ENTRIES)
    expect(sizes.length - evict).toBe(MIN_HISTORY_ENTRIES)
  })

  it('handles empty stacks', () => {
    expect(evictCountForBudget([], 1, 100)).toBe(0)
  })
})
