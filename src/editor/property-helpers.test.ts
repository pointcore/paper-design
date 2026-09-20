import { describe, expect, it } from 'vitest'
import { DASH_PRESETS, MAX_TEXT_PRESETS, cleanTextStylePresets, parseDashPattern } from './property-helpers'

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
