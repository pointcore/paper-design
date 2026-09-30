/**
 * Text metrics for line breaking.
 *
 * The bug these lock down: the wrapper measured with the *type tool's* current
 * style, so any text item with a different font size or family was wrapped
 * against the wrong metrics — the "fitting" lines ran past the frame edge and
 * the overflow count was fiction.
 */
import { describe, expect, it } from 'vitest'
import { lineWidth, metricsForItem, metricsForStyle, trackingAdvance } from './metrics'

const STYLE = {
  fontSize: 12,
  fontFamily: 'Helvetica',
  fontWeight: 'normal',
  fontStyle: 'normal',
  tracking: 0,
}

describe('metricsForItem', () => {
  it('uses the item font, not the tool style', () => {
    const m = metricsForItem({ fontSize: 36, fontFamily: 'Georgia', fontWeight: 'bold', fontStyle: 'italic' }, STYLE)
    expect(m.font).toBe('italic bold 36px Georgia')
    expect(m.fontSize).toBe(36)
  })

  it('falls back per field, so a partial item still measures', () => {
    const m = metricsForItem({ fontSize: 24 }, STYLE)
    expect(m.font).toBe('normal normal 24px Helvetica')
  })

  it('refuses a nonsense font size instead of wrapping against it', () => {
    for (const bad of [0, -10, Number.NaN, 'big', null, undefined]) {
      const m = metricsForItem({ fontSize: bad }, STYLE)
      expect(m.fontSize).toBe(12)
      expect(m.font).toContain('12px')
    }
  })

  it('survives an item that is not an item at all', () => {
    expect(metricsForItem(null, STYLE).font).toBe('normal normal 12px Helvetica')
    expect(metricsForItem(undefined, STYLE).fontSize).toBe(12)
  })

  it('keeps a numeric font weight as the font string wants it', () => {
    const m = metricsForItem({ fontSize: 12, fontWeight: 700 }, { ...STYLE, fontWeight: 'normal' })
    expect(m.font).toContain('700')
  })
})

describe('metricsForStyle', () => {
  it('builds the same font string as an item with those values', () => {
    const fromStyle = metricsForStyle({ ...STYLE, fontSize: 30, fontFamily: 'Georgia' })
    const fromItem = metricsForItem({ fontSize: 30, fontFamily: 'Georgia', fontWeight: 'normal', fontStyle: 'normal' }, STYLE)
    expect(fromStyle.font).toBe(fromItem.font)
  })

  it('falls back to a readable size for a broken style', () => {
    expect(metricsForStyle({ ...STYLE, fontSize: 0 }).fontSize).toBe(12)
  })
})

describe('lineWidth', () => {
  const measure = (text: string) => text.length * 10

  it('adds tracking per gap, not per character', () => {
    const metrics = metricsForStyle({ ...STYLE, fontSize: 100, tracking: 10 })
    expect(trackingAdvance(metrics)).toBe(1)
    // Five characters: four gaps, so four extra units.
    expect(lineWidth('abcde', metrics, measure)).toBe(50 + 4)
    // A single glyph has no gap to space out.
    expect(lineWidth('a', metrics, measure)).toBe(10)
  })

  it('is the plain width when there is no tracking', () => {
    const metrics = metricsForStyle(STYLE)
    expect(lineWidth('hello world', metrics, measure)).toBe(110)
  })

  it('trusts the probe for everything else, kerning included', () => {
    // A kerned pair is narrower than two glyphs side by side; the probe already
    // knows that, and adding kerning again here is the classic double-kern.
    const kerned = (text: string) => (text === 'AV' ? 15 : text.length * 10)
    expect(lineWidth('AV', metricsForStyle(STYLE), kerned)).toBe(15)
  })
})
