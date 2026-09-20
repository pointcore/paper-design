/**
 * Named raster-export presets (D3).
 *
 * A preset captures the Asset Export controls (area + format + scales) under
 * a name so web/print hand-off is one click. Pure data layer: validation,
 * descriptions and built-ins live here; ActionsPanel owns running them
 * (engine.exportRaster) and localStorage persistence.
 */
import type { RasterExportArea, RasterExportFormat } from './types'

/** One saved export configuration. */
export interface ExportPreset {
  id: string
  name: string
  area: RasterExportArea
  format: RasterExportFormat
  /** Scales to export, e.g. [1] or [1, 2, 3]. */
  scales: number[]
}

const AREAS: RasterExportArea[] = ['selection', 'artwork', 'page']
const FORMATS: RasterExportFormat[] = ['png', 'jpeg', 'webp']

/** Built-in starting points (web 1x, retina 2x, print 3x, full set). */
export function defaultExportPresets(): ExportPreset[] {
  return [
    { id: 'preset-web-1x', name: 'Web 1x PNG', area: 'artwork', format: 'png', scales: [1] },
    { id: 'preset-retina-2x', name: 'Retina 2x PNG', area: 'artwork', format: 'png', scales: [2] },
    { id: 'preset-print-3x', name: 'Print 3x PNG', area: 'page', format: 'png', scales: [3] },
    { id: 'preset-full-set', name: 'Full set 1x+2x+3x', area: 'artwork', format: 'png', scales: [1, 2, 3] },
  ]
}

/** True when a preset is well-formed and runnable. */
export function isValidExportPreset(p: Partial<ExportPreset>): p is ExportPreset {
  return (
    typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.name === 'string' && p.name.trim().length > 0 &&
    AREAS.includes(p.area as RasterExportArea) &&
    FORMATS.includes(p.format as RasterExportFormat) &&
    Array.isArray(p.scales) &&
    p.scales.length >= 1 && p.scales.length <= 3 &&
    p.scales.every((s) => s === 1 || s === 2 || s === 3)
  )
}

/** Human-readable summary, e.g. `PNG artwork 1x+2x`. */
export function describeExportPreset(p: ExportPreset): string {
  return `${p.format.toUpperCase()} ${p.area} ${p.scales.map((s) => `${s}x`).join('+')}`
}

/** Sanitize a loaded list (storage may be corrupt or from an older shape). */
export function cleanExportPresets(list: unknown): ExportPreset[] {
  if (!Array.isArray(list)) return []
  return (list as Array<Partial<ExportPreset>>)
    .filter((p) => p && typeof p === 'object' && isValidExportPreset(p))
    .slice(0, 24)
    .map((p) => ({
      id: p.id as string,
      name: (p.name as string).trim().slice(0, 40),
      area: p.area as RasterExportArea,
      format: p.format as RasterExportFormat,
      scales: [...(p.scales as number[])].sort(),
    }))
}
