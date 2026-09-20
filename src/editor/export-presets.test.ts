import { describe, expect, it } from 'vitest'
import {
  cleanExportPresets,
  defaultExportPresets,
  describeExportPreset,
  isValidExportPreset,
} from './export-presets'

describe('defaultExportPresets', () => {
  it('ships valid runnable presets', () => {
    const presets = defaultExportPresets()
    expect(presets.length).toBeGreaterThan(0)
    for (const p of presets) expect(isValidExportPreset(p)).toBe(true)
  })

  it('covers 1x, 2x and 3x densities', () => {
    const scales = new Set(defaultExportPresets().flatMap((p) => p.scales))
    expect(scales.has(1)).toBe(true)
    expect(scales.has(2)).toBe(true)
    expect(scales.has(3)).toBe(true)
  })
})

describe('isValidExportPreset', () => {
  it('accepts a well-formed preset', () => {
    expect(
      isValidExportPreset({ id: 'p1', name: 'Web', area: 'artwork', format: 'png', scales: [1, 2] }),
    ).toBe(true)
  })

  it('rejects bad areas, formats and scales', () => {
    type AnyPreset = Record<string, unknown>
    const base: AnyPreset = { id: 'p1', name: 'Web', area: 'artwork', format: 'png', scales: [1] }
    const check = (patch: AnyPreset) =>
      isValidExportPreset({ ...base, ...patch } as unknown as Partial<import('./export-presets').ExportPreset>)
    expect(check({ area: 'sheet' })).toBe(false)
    expect(check({ format: 'gif' })).toBe(false)
    expect(check({ scales: [] })).toBe(false)
    expect(check({ scales: [4] })).toBe(false)
    expect(check({ name: '  ' })).toBe(false)
  })
})

describe('describeExportPreset', () => {
  it('summarizes format, area and scales', () => {
    expect(
      describeExportPreset({ id: 'p', name: 'x', area: 'artwork', format: 'png', scales: [1, 2] }),
    ).toBe('PNG artwork 1x+2x')
  })
})

describe('cleanExportPresets', () => {
  it('drops corrupt entries and caps the list', () => {
    const good = { id: 'g', name: 'Good', area: 'page', format: 'jpeg', scales: [3] }
    const out = cleanExportPresets([good, null, { id: 'bad' }, 'zzz'])
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('g')
  })

  it('round-trips through JSON (save/reopen contract)', () => {
    const presets = defaultExportPresets()
    expect(cleanExportPresets(JSON.parse(JSON.stringify(presets)))).toEqual(presets)
  })
})
