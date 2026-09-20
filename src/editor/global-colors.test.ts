import { describe, expect, it } from 'vitest'
import {
  countColorUsages,
  filterTextPresets,
  isSameColor,
  isValidGlobalColor,
  normalizeColor,
  remapPaint,
} from './global-colors'

describe('normalizeColor / isSameColor', () => {
  it('compares case- and whitespace-insensitively', () => {
    expect(normalizeColor('  #FF0000 ')).toBe('#ff0000')
    expect(isSameColor('#FF0000', '#ff0000')).toBe(true)
    expect(isSameColor('red', 'RED')).toBe(true)
  })

  it('distinguishes different paints', () => {
    expect(isSameColor('#ff0000', '#00ff00')).toBe(false)
  })

  it('empty only equals empty', () => {
    expect(isSameColor('', '')).toBe(true)
    expect(isSameColor('', '#fff')).toBe(false)
  })
})

describe('isValidGlobalColor', () => {
  it('accepts well-formed entries', () => {
    expect(isValidGlobalColor({ id: 'g1', name: 'Brand', color: '#ff0000' })).toBe(true)
  })

  it('rejects blanks', () => {
    expect(isValidGlobalColor({ id: '', name: 'Brand', color: '#ff0000' })).toBe(false)
    expect(isValidGlobalColor({ id: 'g1', name: '  ', color: '#ff0000' })).toBe(false)
    expect(isValidGlobalColor({ id: 'g1', name: 'Brand', color: '' })).toBe(false)
  })
})

describe('countColorUsages', () => {
  it('counts fills and strokes using the target paint', () => {
    expect(countColorUsages(['#ff0000', '#00ff00', '#FF0000', null], '#ff0000')).toBe(2)
  })

  it('returns 0 for an empty target', () => {
    expect(countColorUsages(['#ff0000'], '')).toBe(0)
  })
})

describe('remapPaint', () => {
  it('swaps matching paints and keeps the rest', () => {
    expect(remapPaint('#FF0000', '#ff0000', '#0000ff')).toBe('#0000ff')
    expect(remapPaint('#00ff00', '#ff0000', '#0000ff')).toBe('#00ff00')
    expect(remapPaint(null, '#ff0000', '#0000ff')).toBeNull()
  })
})

describe('global color save/reopen round-trip', () => {
  it('survives JSON serialization', () => {
    const list = [{ id: 'g1', name: 'Brand Red', color: '#e74c3c' }]
    expect(JSON.parse(JSON.stringify(list))).toEqual(list)
  })
})

describe('filterTextPresets', () => {
  const presets = [
    { id: 't1', name: 'Heading', char: {} as never, paragraph: {} as never },
    { id: 't2', name: 'Body Copy', char: {} as never, paragraph: {} as never },
  ]

  it('empty query returns all', () => {
    expect(filterTextPresets(presets, '')).toHaveLength(2)
  })

  it('matches by name case-insensitively', () => {
    expect(filterTextPresets(presets, 'head').map((p) => p.id)).toEqual(['t1'])
    expect(filterTextPresets(presets, 'BODY').map((p) => p.id)).toEqual(['t2'])
  })

  it('returns empty for nonsense', () => {
    expect(filterTextPresets(presets, 'zzz')).toHaveLength(0)
  })
})
