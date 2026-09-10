/**
 * Unit tests for the print-color helpers (CMYK preview + gamut flags).
 * Pure functions, no DOM or Paper.js needed — run with `vitest run`.
 */
import { describe, expect, it } from 'vitest'
import {
  cmykToRgb,
  cssToCmykString,
  isOutOfCmykGamut,
  parseCssColor,
  rgbToCmyk,
} from './color'

describe('parseCssColor', () => {
  it('parses 6-digit hex', () => {
    expect(parseCssColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
  })

  it('parses 3-digit hex', () => {
    expect(parseCssColor('#0f0')).toEqual({ r: 0, g: 255, b: 0, a: 1 })
  })

  it('parses 8-digit hex with alpha', () => {
    expect(parseCssColor('#00000000')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(parseCssColor('#ffffffff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
  })

  it('parses rgb() and rgba()', () => {
    expect(parseCssColor('rgb(255, 0, 0)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
    expect(parseCssColor('rgba(0, 0, 0, 0.5)')).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
  })

  it('parses percent channels', () => {
    expect(parseCssColor('rgb(100%, 0%, 0%)')).toEqual({ r: 255, g: 0, b: 0, a: 1 })
  })

  it('rejects garbage and blanks', () => {
    expect(parseCssColor('nope')).toBeNull()
    expect(parseCssColor('')).toBeNull()
    expect(parseCssColor(null)).toBeNull()
    expect(parseCssColor(undefined)).toBeNull()
    expect(parseCssColor('#12')).toBeNull()
  })
})

describe('rgbToCmyk / cmykToRgb', () => {
  it('maps black to K100 and white to zeros', () => {
    expect(rgbToCmyk(0, 0, 0)).toEqual({ c: 0, m: 0, y: 0, k: 100 })
    expect(rgbToCmyk(255, 255, 255)).toEqual({ c: 0, m: 0, y: 0, k: 0 })
  })

  it('maps pure red to M100 Y100', () => {
    expect(rgbToCmyk(255, 0, 0)).toEqual({ c: 0, m: 100, y: 100, k: 0 })
  })

  it('inverts back within rounding', () => {
    expect(cmykToRgb(0, 100, 100, 0)).toMatchObject({ r: 255, g: 0, b: 0 })
    expect(cmykToRgb(0, 0, 0, 100)).toMatchObject({ r: 0, g: 0, b: 0 })
  })
})

describe('cssToCmykString', () => {
  it('formats readouts', () => {
    expect(cssToCmykString('#ff0000')).toBe('C0 M100 Y100 K0')
  })

  it('returns null when unparseable', () => {
    expect(cssToCmykString('nope')).toBeNull()
    expect(cssToCmykString(null)).toBeNull()
  })
})

describe('isOutOfCmykGamut', () => {
  it('flags fully saturated RGB vertices', () => {
    for (const css of ['#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ff00ff', '#ffff00']) {
      expect(isOutOfCmykGamut(css)).toBe(true)
    }
  })

  it('passes neutrals, pastels and unparseable input', () => {
    for (const css of ['#808080', '#000000', '#ffffff', '#c08040', '#4060a0']) {
      expect(isOutOfCmykGamut(css)).toBe(false)
    }
    expect(isOutOfCmykGamut('nope')).toBe(false)
    expect(isOutOfCmykGamut(null)).toBe(false)
  })
})
