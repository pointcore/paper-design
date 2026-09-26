import { describe, expect, it } from 'vitest'
import {
  MIN_HISTORY_ENTRIES,
  evictCountForBudget,
  snapshotByteLength,
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

describe('snapshotByteLength', () => {
  it('counts pure-ASCII JSON as one byte per char', () => {
    const ascii = '[["Path",{"data":1}]]'
    expect(snapshotByteLength(ascii)).toBe(ascii.length)
    expect(snapshotByteLength('')).toBe(0)
    expect(snapshotByteLength(null)).toBe(0)
  })

  it('counts CJK content at its UTF-8 size, not UTF-16 units', () => {
    // '图层' is 2 UTF-16 units but 6 UTF-8 bytes — length undercounted 3x.
    expect(snapshotByteLength('图层')).toBe(6)
    expect(snapshotByteLength('ab图层cd')).toBe(10)
  })

  it('counts astral surrogate pairs as 4 bytes', () => {
    // U+1D11E is one code point (2 UTF-16 units, 4 UTF-8 bytes).
    expect(snapshotByteLength('𝄞')).toBe(4)
  })
})
