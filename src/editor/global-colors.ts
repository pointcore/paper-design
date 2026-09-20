/**
 * Global-color + text-preset pure helpers (D4).
 *
 * No Vue / Paper.js imports: color equality and preset matching must behave
 * identically in the store, the engine recolor pass and the panels.
 */
import type { GlobalColor, TextStylePreset } from './types'

/** Normalize a CSS color for comparison (trim + lowercase). */
export function normalizeColor(c: string): string {
  return (c || '').trim().toLowerCase()
}

/** True when two CSS colors denote the same paint. */
export function isSameColor(a: string, b: string): boolean {
  const na = normalizeColor(a)
  const nb = normalizeColor(b)
  if (!na || !nb) return na === nb
  return na === nb
}

/** Validate a global-color entry (non-empty id/name/color). */
export function isValidGlobalColor(g: Partial<GlobalColor>): g is GlobalColor {
  return (
    typeof g.id === 'string' && g.id.length > 0 &&
    typeof g.name === 'string' && g.name.trim().length > 0 &&
    typeof g.color === 'string' && g.color.trim().length > 0
  )
}

/**
 * Count paints in a flat CSS-color list that equal the target.
 * Used to report how many fills/strokes a global edit will touch.
 */
export function countColorUsages(paints: Array<string | null>, target: string): number {
  const t = normalizeColor(target)
  if (!t) return 0
  let n = 0
  for (const p of paints) {
    if (typeof p === 'string' && normalizeColor(p) === t) n++
  }
  return n
}

/** Remap a single paint: return `next` when it equals `prev`, else keep. */
export function remapPaint(paint: string | null, prev: string, next: string): string | null {
  if (typeof paint === 'string' && isSameColor(paint, prev)) return next
  return paint
}

/** Filter text presets by a free-text query (name only). */
export function filterTextPresets(presets: TextStylePreset[], query: string): TextStylePreset[] {
  const q = (query || '').trim().toLowerCase()
  if (!q) return [...presets]
  return presets.filter((p) => p.name.toLowerCase().includes(q))
}
