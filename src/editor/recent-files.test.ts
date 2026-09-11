import { describe, expect, it } from 'vitest'
import { MAX_RECENT_FILES, normalizeRecentList } from './recent-files'

function entry(name: string, savedAt: number, fileText?: string) {
  return {
    id: `recent-${name}`,
    name,
    savedAt,
    fileText: fileText ?? '{"version":2,"snapshot":{"layers":[{"name":"User"}]}}',
  }
}

describe('normalizeRecentList', () => {
  it('keeps valid entries newest first', () => {
    const list = normalizeRecentList([entry('a', 100), entry('b', 300), entry('c', 200)])
    expect(list.map((e) => e.name)).toEqual(['b', 'c', 'a'])
  })

  it('rejects junk entries', () => {
    expect(normalizeRecentList(null)).toEqual([])
    expect(normalizeRecentList([null, 'x', 42])).toEqual([])
    expect(normalizeRecentList([{ name: '', savedAt: 5, fileText: '{"snapshot":1}' }])).toEqual([])
    expect(normalizeRecentList([entry('a', NaN)])).toEqual([])
    expect(normalizeRecentList([entry('a', 0)])).toEqual([])
  })

  it('rejects file text that is not plausibly a project file', () => {
    expect(normalizeRecentList([entry('a', 100, 'hello')])).toEqual([])
    expect(normalizeRecentList([entry('a', 100, '{"other":1}')])).toEqual([])
  })

  it('dedupes by name keeping the newest save', () => {
    const list = normalizeRecentList([entry('a', 100), entry('a', 500, '{"version":2,"snapshot":{"layers":[{"n":"newer"}]}}')])
    expect(list).toHaveLength(1)
    expect(list[0].savedAt).toBe(500)
  })

  it('caps the list length', () => {
    const many = Array.from({ length: MAX_RECENT_FILES + 4 }, (_, i) => entry(`f${i}`, i + 1))
    expect(normalizeRecentList(many)).toHaveLength(MAX_RECENT_FILES)
  })
})
