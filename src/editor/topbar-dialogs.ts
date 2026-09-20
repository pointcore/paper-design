/**
 * TopBar dialog helpers (C2: first logic slice out of TopBar.vue).
 *
 * Pure display data and form validation for the preflight, export and
 * page-setup dialogs: issue-kind labels/severity, raster option lists,
 * page-size presets and export-form sanitizing. No Vue / Paper.js, so
 * everything here is unit-locked; TopBar keeps only the reactive shell
 * and the engine calls.
 */
import type { RasterExportArea, RasterExportFormat } from './types'

/** Short display group for a preflight issue kind. */
export function preflightKindLabel(kind: string): string {
  switch (kind) {
    case 'overflow': return 'Overflow'
    case 'gamut': return 'Gamut'
    case 'tac': return 'Ink'
    case 'small': return 'Type'
    case 'hairline': return 'Stroke'
    case 'dpi': return 'DPI'
    default: return 'Layer'
  }
}

/** Severity tag for a preflight issue kind. */
export function preflightSeverity(kind: string): 'danger' | 'warning' | 'info' {
  if (kind === 'overflow' || kind === 'dpi' || kind === 'tac') return 'danger'
  if (kind === 'gamut' || kind === 'hairline' || kind === 'small') return 'warning'
  return 'info'
}

/** Raster format options for the export dialog. */
export const EXPORT_FORMATS: Array<{ value: RasterExportFormat; label: string }> = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
]

/** Raster scale options for the export dialog. */
export const EXPORT_SCALES: Array<{ value: number; label: string }> = [
  { value: 1, label: '1x' },
  { value: 2, label: '2x' },
  { value: 3, label: '3x' },
]

/** Raster quality options for the export dialog. */
export const EXPORT_QUALITIES: Array<{ value: number; label: string }> = [
  { value: 0.92, label: 'High' },
  { value: 0.75, label: 'Medium' },
  { value: 0.55, label: 'Low' },
]

/** Export area options for the export dialog. */
export const EXPORT_AREAS: Array<{ value: RasterExportArea; label: string }> = [
  { value: 'artwork', label: 'Artwork' },
  { value: 'selection', label: 'Selection' },
  { value: 'page', label: 'Page' },
]

/** One export dialog state (JSON-serializable for localStorage). */
export interface ExportForm {
  format: RasterExportFormat
  scale: number
  area: RasterExportArea
  quality: number
}

export function defaultExportForm(): ExportForm {
  return { format: 'png', scale: 2, area: 'artwork', quality: 0.92 }
}

/**
 * Sanitize a loaded export form (storage may be corrupt or hand-edited):
 * unknown fields fall back to defaults, so the dialog never offers an
 * unrunnable combination.
 */
export function sanitizeExportForm(v: unknown): ExportForm {
  const fallback = defaultExportForm()
  if (!v || typeof v !== 'object') return fallback
  const raw = v as Partial<ExportForm>
  return {
    format:
      raw.format === 'png' || raw.format === 'jpeg' || raw.format === 'webp'
        ? raw.format
        : fallback.format,
    scale: raw.scale === 1 || raw.scale === 2 || raw.scale === 3 ? raw.scale : fallback.scale,
    area:
      raw.area === 'artwork' || raw.area === 'selection' || raw.area === 'page'
        ? raw.area
        : fallback.area,
    quality:
      raw.quality === 0.92 || raw.quality === 0.75 || raw.quality === 0.55
        ? raw.quality
        : fallback.quality,
  }
}

/** Page-size presets for the page-setup dialog. */
export const PAGE_PRESETS: Array<{ value: string; label: string }> = [
  { value: 'custom', label: 'Custom' },
  { value: '1920x1080', label: 'HD 1920 x 1080' },
  { value: '3840x2160', label: '4K 3840 x 2160' },
  { value: '1080x1080', label: 'Square 1080 x 1080' },
  { value: '1080x1350', label: 'Post 1080 x 1350' },
  { value: '1080x1920', label: 'Story 1080 x 1920' },
  { value: '595x842', label: 'A4 595 x 842' },
  { value: '842x1191', label: 'A3 842 x 1191' },
  { value: '612x792', label: 'Letter 612 x 792' },
  { value: '792x1224', label: 'Tabloid 792 x 1224' },
]

/** Preset value matching W/H, or custom when nothing matches. */
export function matchPagePreset(width: number, height: number): string {
  const found = PAGE_PRESETS.find((p) => p.value === `${width}x${height}`)
  return found ? found.value : 'custom'
}

/** Hard raster dimension guard (mirrors the engine export path). */
export const MAX_RASTER_DIM = 16384

/**
 * Precise raster-failure reason for an estimated output size: oversized
 * output names its pixels and the guard, so users lower the scale
 * instead of retrying blindly. Null when there is nothing to explain.
 */
export function rasterFailText(size: { width: number; height: number } | null): string | null {
  if (!size) return null
  return size.width > MAX_RASTER_DIM || size.height > MAX_RASTER_DIM
    ? `Too large (${size.width}x${size.height}px, ${MAX_RASTER_DIM} max) — lower the scale`
    : null
}
