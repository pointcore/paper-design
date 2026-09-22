/**
 * PropertyPanel helpers (C2: second logic slice out of PropertyPanel.vue).
 *
 * Pure stroke-dash parsing/presets and text-preset list hygiene. No Vue /
 * Paper.js, so everything here is unit-locked; the panel keeps only the
 * reactive shell and the engine calls.
 */
import type { CharStyle, GradientState, ParagraphStyle, PatternFillState, TextStylePreset } from './types'

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

/** One editable gradient stop row (offsets in percent, 0-100). */
export interface GradientStopInput {
  offset: unknown
  color?: unknown
}

/**
 * Build normalized gradient parameters from editable stop rows: offsets
 * clamp to 0-1, missing colors fall back to black, stops sort by offset,
 * and linear gradients carry a normalized 0-360 direction (radial has no
 * angle field at all).
 */
export function normalizeGradient(
  stops: GradientStopInput[],
  type: GradientState['type'],
  angle: unknown
): GradientState {
  const clean = (stops ?? [])
    .map((stop) => ({
      offset: Math.min(1, Math.max(0, (Number(stop.offset) || 0) / 100)),
      color: (typeof stop.color === 'string' && stop.color) || '#000000',
    }))
    .sort((a, b) => a.offset - b.offset)
  if (type !== 'linear') return { type, stops: clean }
  const normalized = ((Number(angle) || 0) % 360 + 360) % 360
  return { type, stops: clean, angle: normalized }
}

/** Editable pattern-fill rows from the appearance section. */
export interface PatternFillInput {
  kind: PatternFillState['kind']
  color?: unknown
  background?: unknown
  transparent: unknown
  scale: unknown
  angle: unknown
}

/**
 * Build a pattern-fill state from panel rows: missing motif paint falls
 * back to black, transparent switches drop the background, and the tile
 * density clamps to the 0.25-4 range the renderer supports.
 */
export function normalizePatternFill(v: PatternFillInput): PatternFillState {
  return {
    kind: v.kind,
    color: (typeof v.color === 'string' && v.color) || '#000000',
    background: v.transparent ? null : ((typeof v.background === 'string' && v.background) || null),
    scale: Math.min(4, Math.max(0.25, Number(v.scale) || 1)),
    angle: Number(v.angle) || 0,
  }
}
