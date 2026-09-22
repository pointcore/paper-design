/**
 * Paragraph-alignment mapping (Batch 2).
 *
 * Paper.js PointText only understands left/center/right, so `justify` is
 * stored verbatim on `item.data.align` (survives Save/Open) while the
 * canvas renders it left-aligned. The HTML editing overlay and any future
 * renderer read the stored value back via cssTextAlignFor().
 */
import type { TextAlign } from '../types'

/** Coerce unknown input to a valid TextAlign (garbage becomes left). */
export function normalizeAlign(v: unknown): TextAlign {
  return v === 'center' || v === 'right' || v === 'justify' ? v : 'left'
}

/**
 * Paper.js justification for an align. `justify` has no paper equivalent
 * and renders left-aligned on canvas (documented limitation).
 */
export function paperJustificationFor(align: TextAlign): 'left' | 'center' | 'right' {
  if (align === 'center') return 'center'
  if (align === 'right') return 'right'
  return 'left'
}

/** CSS text-align for the editing overlay (justify honored while editing). */
export function cssTextAlignFor(align: TextAlign): 'left' | 'center' | 'right' | 'justify' {
  return normalizeAlign(align)
}
