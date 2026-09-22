import { describe, expect, it } from 'vitest'
import { cssTextAlignFor, normalizeAlign, paperJustificationFor } from './text-align'

describe('normalizeAlign', () => {
  it('keeps the four valid values', () => {
    expect(normalizeAlign('left')).toBe('left')
    expect(normalizeAlign('center')).toBe('center')
    expect(normalizeAlign('right')).toBe('right')
    expect(normalizeAlign('justify')).toBe('justify')
  })

  it('coerces garbage to left', () => {
    expect(normalizeAlign(undefined)).toBe('left')
    expect(normalizeAlign(null)).toBe('left')
    expect(normalizeAlign('JUSTIFY')).toBe('left')
    expect(normalizeAlign(42)).toBe('left')
  })
})

describe('paperJustificationFor', () => {
  it('maps justify to left (paper has no justified PointText)', () => {
    expect(paperJustificationFor('justify')).toBe('left')
    expect(paperJustificationFor('left')).toBe('left')
    expect(paperJustificationFor('center')).toBe('center')
    expect(paperJustificationFor('right')).toBe('right')
  })
})

describe('cssTextAlignFor', () => {
  it('preserves justify for the editing overlay', () => {
    expect(cssTextAlignFor('justify')).toBe('justify')
    expect(cssTextAlignFor('center')).toBe('center')
  })
})
