import { describe, expect, it } from 'vitest'
import {
  EXPORT_AREAS,
  EXPORT_FORMATS,
  EXPORT_QUALITIES,
  EXPORT_SCALES,
  MAX_RASTER_DIM,
  PAGE_PRESETS,
  defaultBoardsExport,
  defaultExportForm,
  matchPagePreset,
  preflightKindLabel,
  preflightSeverity,
  rasterFailText,
  resolveBoardsToExport,
  sanitizeBoardsExport,
  sanitizeExportForm,
  selectableBoardIds,
} from './topbar-dialogs'

describe('preflightKindLabel / preflightSeverity', () => {
  it('labels every engine issue kind', () => {
    expect(preflightKindLabel('overflow')).toBe('Overflow')
    expect(preflightKindLabel('gamut')).toBe('Gamut')
    expect(preflightKindLabel('tac')).toBe('Ink')
    expect(preflightKindLabel('small')).toBe('Type')
    expect(preflightKindLabel('hairline')).toBe('Stroke')
    expect(preflightKindLabel('dpi')).toBe('DPI')
    expect(preflightKindLabel('empty-layer')).toBe('Layer')
    expect(preflightKindLabel('whatever')).toBe('Layer')
  })

  it('grades severity with print blockers first', () => {
    for (const k of ['overflow', 'dpi', 'tac']) expect(preflightSeverity(k)).toBe('danger')
    for (const k of ['gamut', 'hairline', 'small']) expect(preflightSeverity(k)).toBe('warning')
    expect(preflightSeverity('empty-layer')).toBe('info')
    expect(preflightSeverity('whatever')).toBe('info')
  })
})

describe('page presets', () => {
  it('matches known sizes and falls back to custom', () => {
    expect(matchPagePreset(1920, 1080)).toBe('1920x1080')
    expect(matchPagePreset(595, 842)).toBe('595x842')
    expect(matchPagePreset(123, 456)).toBe('custom')
    expect(matchPagePreset(NaN, 1080)).toBe('custom')
  })

  it('keeps custom as the first option', () => {
    expect(PAGE_PRESETS[0].value).toBe('custom')
  })
})

describe('export option lists', () => {
  it('covers the runnable combinations', () => {
    expect(EXPORT_FORMATS.map((o) => o.value)).toEqual(['png', 'jpeg', 'webp'])
    expect(EXPORT_SCALES.map((o) => o.value)).toEqual([1, 2, 3])
    expect(EXPORT_QUALITIES.map((o) => o.value)).toEqual([0.92, 0.75, 0.55])
    expect(EXPORT_AREAS.map((o) => o.value)).toEqual(['artwork', 'selection', 'page'])
  })
})

describe('sanitizeExportForm', () => {
  it('keeps valid forms intact', () => {
    const form = { format: 'jpeg', scale: 3, area: 'page', quality: 0.55 } as const
    expect(sanitizeExportForm(form)).toEqual(form)
  })

  it('falls back per field on corrupt input', () => {
    const clean = sanitizeExportForm({ format: 'gif', scale: 9, area: 'sheet', quality: 1 })
    expect(clean).toEqual(defaultExportForm())
    expect(sanitizeExportForm(null)).toEqual(defaultExportForm())
    expect(sanitizeExportForm('zzz')).toEqual(defaultExportForm())
  })

  it('round-trips through JSON (persistence contract)', () => {
    const form = defaultExportForm()
    expect(sanitizeExportForm(JSON.parse(JSON.stringify(form)))).toEqual(form)
  })
})

describe('rasterFailText', () => {
  it('stays silent without a size or inside the guard', () => {
    expect(rasterFailText(null)).toBeNull()
    expect(rasterFailText({ width: 800, height: 600 })).toBeNull()
  })

  it('names oversized outputs and the guard', () => {
    expect(MAX_RASTER_DIM).toBe(16384)
    const over = rasterFailText({ width: 20000, height: 100 })
    expect(over).toContain('20000x100')
    expect(over).toContain('16384')
    expect(rasterFailText({ width: 100, height: 20000 })).toContain('100x20000')
  })
})

describe('sanitizeBoardsExport', () => {
  it('keeps valid forms intact', () => {
    const form = { format: 'svg', scale: 1, quality: 0.75 } as const
    expect(sanitizeBoardsExport(form)).toEqual(form)
  })

  it('falls back per field on corrupt input', () => {
    expect(sanitizeBoardsExport({ format: 'gif', scale: 9, quality: 1 })).toEqual(
      defaultBoardsExport()
    )
    expect(sanitizeBoardsExport(null)).toEqual(defaultBoardsExport())
    expect(sanitizeBoardsExport('zzz')).toEqual(defaultBoardsExport())
  })

  it('round-trips through JSON (persistence contract)', () => {
    const form = defaultBoardsExport()
    expect(sanitizeBoardsExport(JSON.parse(JSON.stringify(form)))).toEqual(form)
  })
})

describe('board export filtering', () => {
  const boards = [
    { id: 'a', width: 100, height: 100 },
    { id: 'b', width: 0, height: 100 },
    { id: 'c', width: 50, height: 50 },
  ]

  it('pre-ticks only boards with a real size', () => {
    expect(selectableBoardIds(boards)).toEqual(['a', 'c'])
  })

  it('resolves checked boards in document order', () => {
    expect(resolveBoardsToExport(boards, ['c', 'a', 'b'])).toEqual([boards[0], boards[2]])
    expect(resolveBoardsToExport(boards, ['b'])).toEqual([])
    expect(resolveBoardsToExport(boards, [])).toEqual([])
  })
})
