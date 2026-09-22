import { describe, expect, it } from 'vitest'
import {
  DASH_PRESETS,
  MAX_TEXT_PRESETS,
  cleanTextStylePresets,
  normalizeGradient,
  normalizePatternFill,
  parseDashPattern,
} from './property-helpers'

describe('parseDashPattern', () => {
  it('parses space and comma separated lengths', () => {
    expect(parseDashPattern('4 2')).toEqual([4, 2])
    expect(parseDashPattern('6,2,1,2')).toEqual([6, 2, 1, 2])
    // Leading/trailing separators parse as zero-length runs (kept
    // verbatim from the panel implementation).
    expect(parseDashPattern(' 8  3 ')).toEqual([0, 8, 3, 0])
  })

  it('maps empty input to a single zero run (solid)', () => {
    expect(parseDashPattern('')).toEqual([0])
  })

  it('drops non-numeric and negative parts', () => {
    expect(parseDashPattern('4 xx -2 3')).toEqual([4, 3])
  })

  it('ships a solid default plus named patterns', () => {
    expect(DASH_PRESETS[0]).toEqual({ value: '', label: 'Solid' })
    expect(DASH_PRESETS.length).toBeGreaterThan(1)
  })
})

describe('cleanTextStylePresets', () => {
  const good = (over: Record<string, unknown> = {}) => ({
    id: 't1',
    name: 'Title',
    char: { fontFamily: 'Arial' },
    paragraph: { align: 'left' },
    ...over,
  })

  it('keeps well-formed presets intact', () => {
    expect(cleanTextStylePresets([good()])).toEqual([good()])
  })

  it('drops entries without object char/paragraph snapshots', () => {
    const out = cleanTextStylePresets([good(), null, { id: 'bad' }, good({ char: null }), 'zzz'])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('t1')
  })

  it('restores stable ids and names', () => {
    const out = cleanTextStylePresets([{ char: {}, paragraph: {} }])
    expect(out[0].id).toBe('text-restored-0')
    expect(out[0].name).toBe('Text 1')
    const long = cleanTextStylePresets([{ id: 'x', name: 'n'.repeat(100), char: {}, paragraph: {} }])
    expect(long[0].name).toHaveLength(40)
  })

  it('caps the list', () => {
    const many = Array.from({ length: MAX_TEXT_PRESETS + 10 }, (_, i) => good({ id: `t${i}` }))
    expect(cleanTextStylePresets(many)).toHaveLength(MAX_TEXT_PRESETS)
  })

  it('round-trips through JSON (persistence contract)', () => {
    const list = [good(), good({ id: 't2', name: 'Body' })]
    expect(cleanTextStylePresets(JSON.parse(JSON.stringify(list)))).toEqual(list)
  })
})

describe('normalizeGradient', () => {
  it('clamps offsets, defaults colors and sorts by offset', () => {
    expect(
      normalizeGradient(
        [
          { offset: 100, color: '#ffffff' },
          { offset: -20, color: '' },
          { offset: 50, color: '#808080' },
        ],
        'linear',
        0
      )
    ).toEqual({
      type: 'linear',
      stops: [
        { offset: 0, color: '#000000' },
        { offset: 0.5, color: '#808080' },
        { offset: 1, color: '#ffffff' },
      ],
      angle: 0,
    })
  })

  it('normalizes linear direction into 0-360', () => {
    expect(normalizeGradient([], 'linear', -90).angle).toBe(270)
    expect(normalizeGradient([], 'linear', 450).angle).toBe(90)
  })

  it('omits the angle field for radial gradients', () => {
    const out = normalizeGradient([{ offset: 0, color: '#000' }], 'radial', 45)
    expect(out).toEqual({ type: 'radial', stops: [{ offset: 0, color: '#000' }] })
    expect('angle' in out).toBe(false)
  })
})

describe('normalizePatternFill', () => {
  const base = {
    kind: 'dots' as const,
    color: '#123456',
    background: '#ffffff',
    transparent: false,
    scale: 1,
    angle: 45,
  }

  it('passes valid rows through', () => {
    expect(normalizePatternFill(base)).toEqual({
      kind: 'dots',
      color: '#123456',
      background: '#ffffff',
      scale: 1,
      angle: 45,
    })
  })

  it('drops the background when transparent and defaults the motif paint', () => {
    expect(normalizePatternFill({ ...base, transparent: true })).toEqual({
      ...normalizePatternFill(base),
      background: null,
    })
    expect(normalizePatternFill({ ...base, color: '' }).color).toBe('#000000')
  })

  it('clamps tile density to the renderer range', () => {
    expect(normalizePatternFill({ ...base, scale: 99 }).scale).toBe(4)
    expect(normalizePatternFill({ ...base, scale: 0 }).scale).toBe(1)
    expect(normalizePatternFill({ ...base, scale: 0.1 }).scale).toBe(0.25)
  })
})
