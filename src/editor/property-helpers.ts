/**
 * PropertyPanel helpers (C2: second logic slice out of PropertyPanel.vue).
 *
 * Pure stroke-dash parsing/presets and text-preset list hygiene. No Vue /
 * Paper.js, so everything here is unit-locked; the panel keeps only the
 * reactive shell and the engine calls.
 */
import type { CharStyle, ParagraphStyle, TextStylePreset } from './types'

/** Dash presets for the stroke section (empty value means solid). */
export const DASH_PRESETS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Solid' },
  { value: '4 2', label: 'Dashed' },
  { value: '1 2', label: 'Dotted' },
  { value: '6 2 1 2', label: 'Dash-Dot' },
  { value: '8 3 2 3', label: 'Long Dash' },
]

/** Parse a dash pattern like "4 2" into lengths (empty means solid). */
export function parseDashPattern(text: string): number[] {
  return (text || '')
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n) && n >= 0)
}

/** Hard cap on kept text presets (matches the store). */
export const MAX_TEXT_PRESETS = 24

/**
 * Sanitize a loaded text-preset list (storage may be corrupt or from an
 * older shape): entries need object char/paragraph snapshots, ids and
 * names fall back to stable defaults, and the list caps at 24.
 */
export function cleanTextStylePresets(list: unknown): TextStylePreset[] {
  if (!Array.isArray(list)) return []
  return (list as Array<Partial<TextStylePreset>>)
    .filter(
      (p) =>
        p &&
        typeof p === 'object' &&
        typeof p.char === 'object' &&
        p.char !== null &&
        typeof p.paragraph === 'object' &&
        p.paragraph !== null
    )
    .slice(0, MAX_TEXT_PRESETS)
    .map((p, i) => ({
      id: typeof p.id === 'string' && p.id ? p.id : `text-restored-${i}`,
      name:
        typeof p.name === 'string' && p.name ? (p.name as string).slice(0, 40) : `Text ${i + 1}`,
      char: p.char as CharStyle,
      paragraph: p.paragraph as ParagraphStyle,
    }))
}
