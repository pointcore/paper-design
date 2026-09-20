import { describe, expect, it } from 'vitest'
import {
  filterPalette,
  matchesQuery,
  normalizeQuery,
  toolEntries,
  commandEntries,
  type PaletteItem,
} from './command-palette'

const items: PaletteItem[] = [
  ...toolEntries([
    { id: 'pen', label: 'Pen Tool', shortcut: 'P' },
    { id: 'rect', label: 'Rectangle', shortcut: 'R' },
  ]),
  ...commandEntries([
    { id: 'save', label: 'Save Project', shortcut: 'Ctrl+S' },
    { id: 'export-png', label: 'Export PNG', shortcut: '' },
  ]),
  { id: 'board:1', title: 'Cover Page', category: 'Artboard', keywords: 'board' },
  { id: 'layer:2', title: 'Background', category: 'Layer', keywords: 'layer' },
]

describe('normalizeQuery', () => {
  it('lowercases, trims and collapses spaces', () => {
    expect(normalizeQuery('  Pen   Tool ')).toBe('pen tool')
    expect(normalizeQuery('')).toBe('')
  })
})

describe('matchesQuery', () => {
  it('empty query matches everything', () => {
    expect(matchesQuery('anything', '')).toBe(true)
  })

  it('matches contiguous substrings case-insensitively', () => {
    expect(matchesQuery('Pen Tool', 'pen')).toBe(true)
    expect(matchesQuery('Pen Tool', 'PEN')).toBe(true)
  })

  it('matches scattered subsequences in order', () => {
    expect(matchesQuery('Rectangle', 'rtg')).toBe(true)
    expect(matchesQuery('Rectangle', 'rgt')).toBe(false)
  })

  it('ignores spaces in the query', () => {
    expect(matchesQuery('Export PNG', 'ex png')).toBe(true)
  })
})

describe('filterPalette', () => {
  it('empty query returns all items', () => {
    expect(filterPalette(items, '')).toHaveLength(items.length)
  })

  it('filters tools by name', () => {
    const out = filterPalette(items, 'pen')
    expect(out.some((i) => i.id === 'tool:pen')).toBe(true)
  })

  it('finds artboards and layers', () => {
    expect(filterPalette(items, 'cover').map((i) => i.id)).toContain('board:1')
    expect(filterPalette(items, 'background').map((i) => i.id)).toContain('layer:2')
  })

  it('matches categories and keywords', () => {
    const out = filterPalette(items, 'artboard')
    expect(out.some((i) => i.id === 'board:1')).toBe(true)
  })

  it('returns empty for nonsense queries', () => {
    expect(filterPalette(items, 'zzz-no-match')).toHaveLength(0)
  })

  it('caps the result count', () => {
    const many: PaletteItem[] = Array.from({ length: 100 }, (_, i) => ({
      id: `cmd:${i}`,
      title: `Command ${i}`,
      category: 'Command',
    }))
    expect(filterPalette(many, '', 20)).toHaveLength(20)
  })
})
