/**
 * Unit tests for saved-selection helpers — run with `vitest run`.
 */
import { describe, expect, it } from 'vitest'
import { pruneSelectionIds, uniqueSelectionName } from './saved-selection'

describe('uniqueSelectionName', () => {
  it('takes the base name when free', () => {
    expect(uniqueSelectionName([])).toBe('Selection')
    expect(uniqueSelectionName(['Other'])).toBe('Selection')
  })

  it('numbers up past taken names', () => {
    expect(uniqueSelectionName(['Selection', 'Selection 2'])).toBe('Selection 3')
  })
})

describe('pruneSelectionIds', () => {
  it('drops missing ids, keeps order and dedupes', () => {
    expect(pruneSelectionIds(['a', 'b', 'a', 'zzz'], ['b', 'a'])).toEqual(['a', 'b'])
    expect(pruneSelectionIds(['zzz'], ['a'])).toEqual([])
  })
})
