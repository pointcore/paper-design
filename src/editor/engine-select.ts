/**
 * Selection-set domain (C1: tenth slice out of engine.ts).
 *
 * Delegation target for selection set operations (select-all variants
 * and send-to-layer): each function takes the engine as an explicit
 * first argument and otherwise runs the historical method body
 * unchanged. The EditorEngine import is type-only, so the runtime
 * dependency flows one way (engine → engine-select). The selection
 * core itself (`getSelection`, history-coupled ordering) stays on the
 * engine.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'

/**
 * Select every visible unlocked top-level user item across all layers.
 */
export function selectAllArtwork(e: EditorEngine): void {
  e.project.deselectAll()
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
    for (const child of layer.children) {
      const item = child as paper.Item
      if (!item.visible || (item as any).locked) continue
      item.selected = true
    }
  }
  e.syncSelectionToStore()
  e.scope.view.update()
}

/**
 * CDR "select all in page" parity: select every visible unlocked
 * top-level item whose bounds intersect the active artboard sheet.
 * Returns the selected count; 0 when there is no usable board.
 */
export function selectAllOnActiveArtboard(e: EditorEngine): number {
  const board = e.store.activeArtboard
  if (!board || board.width <= 0 || board.height <= 0) return 0
  const sheet = new e.scope.Rectangle(board.x, board.y, board.width, board.height)
  e.project.deselectAll()
  let count = 0
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
    for (const child of layer.children) {
      const item = child as paper.Item
      if (!item.visible || (item as any).locked) continue
      const b = item.bounds
      if (!b) continue
      if (!b.intersects(sheet)) continue
      item.selected = true
      count++
    }
  }
  e.syncSelectionToStore()
  e.scope.view.update()
  return count
}

/**
 * AI Arrange > Send to Current Layer: move every selected item's
 * top-level ancestor into the active layer, stacked on top in their
 * original order. Returns the moved count (0 when nothing can move).
 */
export function moveSelectionToActiveLayer(e: EditorEngine): number {
  const active = e.getActiveLayer()
  const picked: paper.Item[] = []
  const seen = new Set<paper.Item>()
  for (const item of e.getSelection()) {
    if ((item as any).locked) continue
    let top: paper.Item | null = item
    while (top && !(top.parent instanceof e.scope.Layer)) {
      top = top.parent as paper.Item | null
    }
    if (!top || top === active || seen.has(top)) continue
    seen.add(top)
    picked.push(top)
  }
  if (picked.length === 0) return 0
  for (const item of picked) {
    item.remove()
    active.addChild(item)
  }
  e.syncLayersToStore()
  e.syncSelectionToStore()
  // Cross-layer moves leave the oriented frame's layer bookkeeping stale.
  e.bumpGeometryVersion()
  e.pushHistory('Send to Current Layer')
  e.scope.view.update()
  return picked.length
}
