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
 * Select every visible unlocked top-level user item except the current
 * selection. Locked and hidden artwork stays out so follow-up commands
 * cannot touch it by accident. Selection-only change: no history entry.
 */
export function invertSelection(e: EditorEngine): void {
  const candidates: paper.Item[] = []
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
    for (const child of layer.children) {
      const item = child as paper.Item
      const data = (item.data as any) ?? {}
      if (!item.visible || (item as any).locked) continue
      if (data.isPreview || data.isChrome) continue
      candidates.push(item)
    }
  }
  const selected = new Set(e.getSelection())
  e.project.deselectAll()
  candidates.forEach((item) => {
    if (!selected.has(item)) item.selected = true
  })
  e.syncSelectionToStore()
  e.scope.view.update()
}

/**
 * Lock or unlock the current selection (locked items skip most tools).
 * Uses the raw flagged set (not the top-most selection): lock checks
 * throughout the tools are per-item, so group members need their own
 * flags to actually stay unselectable.
 */
export function setSelectedLocked(e: EditorEngine, locked: boolean): void {
  const items = e.project.selectedItems as paper.Item[]
  if (items.length === 0) return
  items.forEach((item) => {
    item.locked = locked
  })
  e.pushHistory(locked ? 'Lock' : 'Unlock')
  e.scope.view.update()
}

/** Hide or show the current selection. */
export function setSelectedVisible(e: EditorEngine, visible: boolean): void {
  const items = e.getSelection()
  if (items.length === 0) return
  items.forEach((item) => {
    item.visible = visible
  })
  e.pushHistory(visible ? 'Show' : 'Hide')
  e.scope.view.update()
}

/**
 * Lock every unlocked top-level user item outside the selection
 * (Unlock All restores). Returns newly locked count; one history.
 */
export function lockOthers(e: EditorEngine): number {
  const selection = e.getSelection()
  if (selection.length === 0) return 0
  const keep = new Set<paper.Item>()
  for (const item of selection) {
    let at: paper.Item | null = item
    while (at) {
      keep.add(at)
      at = at.parent
    }
  }
  let locked = 0
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
    for (const child of layer.children) {
      const c = child as paper.Item
      if (keep.has(c) || (c as any).locked) continue
      c.locked = true
      locked++
    }
  }
  if (locked > 0) {
    e.pushHistory('Lock Others')
    e.scope.view.update()
  }
  return locked
}

/**
 * Reverse the stacking order of the unlocked selection (keeps every
 * item in its own parent; cross-layer order untouched). One history.
 */
export function reverseOrder(e: EditorEngine): number {
  const items = e.getSelection().filter((item) => !item.locked && item.parent)
  if (items.length < 2) return 0
  const byParent = new Map<paper.Item, paper.Item[]>()
  for (const item of items) {
    const parent = item.parent as paper.Item
    const list = byParent.get(parent) ?? []
    list.push(item)
    byParent.set(parent, list)
  }
  let moved = 0
  for (const [parent, group] of byParent) {
    if (group.length < 2) continue
    const kids = ((parent as any).children as paper.Item[]).slice()
    const slots = group
      .map((g) => kids.indexOf(g))
      .filter((s) => s >= 0)
      .sort((a, b) => a - b)
    if (slots.length < 2) continue
    const reversed = group
      .slice()
      .sort((a, b) => kids.indexOf(a) - kids.indexOf(b))
      .reverse()
    for (const g of group) {
      try {
        g.remove()
      } catch { /* already gone */ }
    }
    slots.forEach((slot, i) => {
      ;(parent as any).insertChild(Math.min(slot, (parent as any).children.length), reversed[i])
      moved++
    })
  }
  if (moved > 0) {
    e.pushHistory('Reverse Order')
    e.scope.view.update()
  }
  return moved
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

/** Swap each selected item with the sibling beside it in `direction`. */
function shiftSelectedOrder(e: EditorEngine, direction: 1 | -1): void {
  const moving = new Set(e.getSelection())
  if (moving.size === 0) return
  const byParent = new Map<paper.Item, paper.Item[]>()
  for (const item of moving) {
    const parent = item.parent
    if (!parent) continue
    const list = byParent.get(parent) ?? []
    list.push(item)
    byParent.set(parent, list)
  }
  for (const [parent, items] of byParent) {
    const children = parent.children as paper.Item[]
    items.sort((a, b) =>
      direction > 0
        ? children.indexOf(b) - children.indexOf(a)
        : children.indexOf(a) - children.indexOf(b)
    )
    for (const item of items) {
      const at = children.indexOf(item)
      const target = at + direction
      if (target < 0 || target >= children.length) continue
      // A selected neighbor travels with the block: leave it in place.
      if (moving.has(children[target])) continue
      parent.insertChild(target, item)
    }
  }
}

/**
 * Bring the selection to the very front (top of each parent stack).
 * Returns false (no history) when nothing is selected.
 */
export function bringSelectionToFront(e: EditorEngine): boolean {
  const items = e.getSelection().filter((i) => !i.locked)
  if (items.length === 0) return false
  items.forEach((i) => i.bringToFront())
  e.scope.view.update()
  e.pushHistory('Bring to Front')
  return true
}

/**
 * Send the selection to the very back. Returns false when empty.
 */
export function sendSelectionToBack(e: EditorEngine): boolean {
  const items = e.getSelection().filter((i) => !i.locked)
  if (items.length === 0) return false
  items.forEach((i) => i.sendToBack())
  e.scope.view.update()
  e.pushHistory('Send to Back')
  return true
}

/**
 * Move every selected item one step towards the front within its parent.
 * Items move front-most first so multi-selections keep their order.
 */
export function bringForward(e: EditorEngine): void {
  shiftSelectedOrder(e, 1)
  e.pushHistory('Bring Forward')
  e.scope.view.update()
}

/** Move every selected item one step towards the back within its parent. */
export function sendBackward(e: EditorEngine): void {
  shiftSelectedOrder(e, -1)
  e.pushHistory('Send Backward')
  e.scope.view.update()
}
