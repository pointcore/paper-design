/**
 * Fixed-row-height list windowing for the layer object tree (C6).
 *
 * Rendering 1000+ object rows as DOM nodes freezes the panel, so expanded
 * layers above TREE_WINDOW_THRESHOLD render only the scrolled window plus
 * overscan, with top/bottom spacers preserving the scrollbar. Lists at or
 * below the threshold render fully, exactly as before.
 *
 * Pure math layer (no Vue / Paper.js): LayerPanel owns scroll state and the
 * 360px viewport. Keep the constants in sync with LayerPanel.vue:
 * TREE_ROW_HEIGHT mirrors `.tree-item` height, TREE_WINDOW_VIEWPORT mirrors
 * `.layer-children.tree-window` max-height.
 */

/** Row height in px (mirrors `.tree-item` height in LayerPanel.vue). */
export const TREE_ROW_HEIGHT = 28

/** Viewport height in px (mirrors `.layer-children.tree-window` max-height). */
export const TREE_WINDOW_VIEWPORT = 360

/**
 * Lists longer than this render windowed; shorter lists render fully.
 * Matches the thumbnail generation budget so the two caps move together.
 */
export const TREE_WINDOW_THRESHOLD = 150

/** Extra rows rendered above/below the viewport to cover fast scrolling. */
export const TREE_WINDOW_OVERSCAN = 10

/** Visible slice as [start, end) indexes into the flattened row list. */
export interface TreeWindow {
  start: number
  end: number
}

/**
 * Compute the row window for a scroll position. Stale scroll offsets
 * (rows deleted since) clamp to the content so no blank gap appears;
 * invalid inputs degrade to an empty window instead of throwing.
 */
export function calcTreeWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number = TREE_WINDOW_VIEWPORT,
  rowHeight: number = TREE_ROW_HEIGHT,
  overscan: number = TREE_WINDOW_OVERSCAN,
): TreeWindow {
  const n = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0
  if (n === 0) return { start: 0, end: 0 }
  const rh = Number.isFinite(rowHeight) && rowHeight > 0 ? rowHeight : TREE_ROW_HEIGHT
  const vh = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : TREE_WINDOW_VIEWPORT
  const over = Number.isFinite(overscan) ? Math.max(0, Math.floor(overscan)) : TREE_WINDOW_OVERSCAN
  const top = Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : 0
  // Clamp stale offsets (e.g. rows deleted while scrolled down).
  const maxTop = Math.max(0, n * rh - vh)
  const first = Math.floor(Math.min(top, maxTop) / rh)
  const visible = Math.ceil(vh / rh)
  const start = Math.max(0, Math.min(n, first - over))
  const end = Math.max(start, Math.min(n, first + visible + over))
  return { start, end }
}
