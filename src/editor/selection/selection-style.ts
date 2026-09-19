/**
 * AI-aligned selection colors.
 *
 * Illustrator paints selection chrome (path outlines, anchors, bbox) with the
 * owning layer's color so overlapping artwork stays distinguishable. This
 * module is the single source of truth for that mapping: canvas chrome and
 * the Layers panel both read from here.
 */
import type { EditorEngine } from '../engine'

/** Layer accent palette (index = position in the user-layer stack). */
export const LAYER_COLORS = ['#e04c4c', '#4a90d9', '#7ac943', '#e6a23c', '#9b59b6', '#1abc9c']

/** Fallback when an item has no resolvable user layer. */
export const FALLBACK_SELECTION_COLOR = '#4a90d9'

/** Accent color for a user-layer id by its position in the store stack. */
export function layerColorById(engine: EditorEngine, layerId: string | undefined): string {
  if (!layerId) return FALLBACK_SELECTION_COLOR
  const meta = engine.store.layers.find((l) => l.id === layerId)
  if (!meta) return FALLBACK_SELECTION_COLOR
  // A user-picked color (Layer Options parity) overrides the palette.
  if (meta.color) return meta.color
  const idx = engine.store.layers.indexOf(meta)
  return LAYER_COLORS[((idx % LAYER_COLORS.length) + LAYER_COLORS.length) % LAYER_COLORS.length]
}

/** Walk up to the owning top-level layer and return its accent color. */
export function selectionColorForItem(engine: EditorEngine, item: paper.Item): string {
  let node: paper.Item | null = item
  while (node && !(node instanceof engine.scope.Layer)) {
    node = node.parent
  }
  const layerId = (node?.data as any)?.layerId as string | undefined
  // Non-user layers (guides / artboards / chrome) fall back to default blue.
  if (!node || !(node.data as any)?.isUserLayer) return FALLBACK_SELECTION_COLOR
  return layerColorById(engine, layerId)
}

/** BBox color for a selection: the first item's layer color (AI convention). */
export function selectionColorForItems(engine: EditorEngine, items: paper.Item[]): string {
  if (items.length === 0) return FALLBACK_SELECTION_COLOR
  return selectionColorForItem(engine, items[0])
}

/**
 * Per-path outline budget for select-mode chrome. Tracing every path leaf
 * clones all of its segments (~0.35ms/leaf), so a whole imported page
 * (600+ leaves) freezes selection for hundreds of ms per click — and per
 * mousemove while dragging. Past this leaf count the chrome falls back to
 * one bounds rect per top-level item (AI group-selection parity), which is
 * O(top-level) instead of O(segments).
 */
export const SELECT_OUTLINE_LEAF_BUDGET = 60

/**
 * Count path leaves under the given items (compound children included).
 * Duck-typed: only className/children are read, so tests can pass fakes
 * without a Paper.js canvas.
 */
export function countOutlineLeaves(items: Array<{ className?: string; children?: unknown[] }>): number {
  let n = 0
  const stack: Array<{ className?: string; children?: unknown[] }> = items.slice()
  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) continue
    if (node.className === 'Path') n++
    else if (node.className === 'CompoundPath') {
      for (const c of node.children || []) {
        if ((c as { className?: string })?.className === 'Path') n++
      }
    } else if (node.children) {
      for (const c of node.children) stack.push(c as { className?: string; children?: unknown[] })
    }
  }
  return n
}
