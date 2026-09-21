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
import { colorDistanceRgb, colorToCSS, parseCssColor } from './color'
import { getItemById, isClipGroup, walkUserItems } from './engine-layers'

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

/**
 * Group the selection (needs 2+ top-level members). The group is placed
 * explicitly — never via `new Group(items)`, which paper inserts into
 * `project.activeLayer` (often a chrome layer, hiding the group from the
 * panel). Shared parents keep the back-most member's slot so contiguous
 * ranges never jump; cross-parent selections collect into the front-most
 * member's parent, like Illustrator. Returns false when grouped nothing.
 */
export function groupSelection(e: EditorEngine): boolean {
  const items = e.getSelection().filter((item) => item.parent)
  if (items.length < 2) return false
  // Back-to-front document order (isAbove/isBelow span layers).
  const ordered = items
    .slice()
    .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))
  const shared = ordered.every((item) => item.parent === ordered[0].parent)
  const anchor = shared ? ordered[0] : ordered[ordered.length - 1]
  const parent = anchor.parent ?? e.getActiveLayer()
  let at = parent.children.indexOf(anchor)
  if (at < 0) at = parent.children.length
  const group = new e.scope.Group({ insert: false }) as paper.Group
  for (const node of ordered) group.addChild(node)
  parent.insertChild(Math.min(at, parent.children.length), group)
  group.data.id = e.genId()
  group.data.isUserItem = true
  e.selectItem(group)
  e.pushHistory('Group')
  e.scope.view.update()
  return true
}

/**
 * Ungroup selected groups/sublayers (children keep slot, selection
 * clears). Clipping masks and path-text runs are skipped — they have
 * dedicated release commands. Returns false when nothing ungrouped.
 */
export function ungroupSelection(e: EditorEngine): boolean {
  const groups = e.getSelection().filter(
    (i) =>
      i instanceof e.scope.Group &&
      (i.data as any)?.id &&
      (i.data as any)?.textMode !== 'path' &&
      !isClipGroup(i as paper.Group)
  ) as paper.Group[]
  if (groups.length === 0) return false
  const released: paper.Item[] = []
  groups.forEach((g) => {
    const children = g.children.slice()
    const parent = g.parent
    const at = parent ? parent.children.indexOf(g) : -1
    children.forEach((c: any) => {
      if (parent) parent.insertChild(at < 0 ? parent.children.length : at, c)
      released.push(c)
    })
    g.remove()
  })
  e.clearSelection()
  released.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.pushHistory('Ungroup')
  e.scope.view.update()
  return true
}

/**
 * Ungroup recursively until no selected group remains (cycle-guarded).
 * Each level records its own history entry, like repeated Ungroup.
 * Returns levels released.
 */
export function ungroupAllSelected(e: EditorEngine): number {
  let levels = 0
  for (let i = 0; i < 100; i++) {
    if (!ungroupSelection(e)) break
    levels++
  }
  return levels
}

export function selectSame(
  e: EditorEngine,
  attribute: 'fill' | 'stroke' | 'strokeWidth' | 'opacity' | 'blendMode',
  additive = false,
  tolerance = 0
): number {
  const leaves = appearanceLeaves(e)
  if (leaves.length === 0) return 0
  const reference = e.getSelection()
    .map((item) => firstLeaf(e, item))
    .find((leaf) => leaf !== null) as paper.Item | undefined
  if (!reference) return 0
  const tol = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 0
  let matches: paper.Item[]
  if (tol > 0 && (attribute === 'fill' || attribute === 'stroke')) {
    const paint = (reference as any)[attribute === 'fill' ? 'fillColor' : 'strokeColor'] as any
    if (paint?.gradient) return 0
    const refCss = colorToCSS(paint)
    const refRgba = refCss ? parseCssColor(refCss) : null
    if (!refRgba) return 0
    matches = leaves.filter((leaf) => {
      const other = (leaf as any)[attribute === 'fill' ? 'fillColor' : 'strokeColor'] as any
      if (!other || other.gradient) return refCss === 'none' && !other
      const css = colorToCSS(other)
      const rgba = css ? parseCssColor(css) : null
      if (!rgba) return false
      return colorDistanceRgb(refRgba, rgba) <= tol
    })
  } else {
    const key = appearanceKey(reference, attribute)
    matches = leaves.filter((leaf) => appearanceKey(leaf, attribute) === key)
  }
  if (!additive) e.clearSelection()
  matches.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.scope.view.update()
  return matches.length
}

/**
 * AI Select > Same > Font Family / Font Size: select every unlocked text
 * item sharing the first selected text item's font family (or size).
 * Returns the match count; 0 when the selection holds no text.
 */
export function selectSameTextFont(e: EditorEngine, by: 'family' | 'size'): number {
  const scope = e.scope
  const reference = e.getSelection().find(
    (item) => item instanceof scope.PointText && !item.locked
  ) as paper.PointText | undefined
  if (!reference) return 0
  const refValue = by === 'family'
    ? String(reference.fontFamily || '')
    : Math.round((Number(reference.fontSize) || 0) * 100) / 100
  const matches: paper.PointText[] = []
  for (const item of walkUserItems(e)) {
    if (!(item instanceof scope.PointText) || (item as any).locked) continue
    if (item === reference) continue
    const value = by === 'family'
      ? String(item.fontFamily || '')
      : Math.round((Number(item.fontSize) || 0) * 100) / 100
    if (value === refValue) matches.push(item)
  }
  if (matches.length === 0) return 0
  e.clearSelection()
  reference.selected = true
  matches.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.scope.view.update()
  return matches.length
}

/** Fill / stroke / width / opacity / blend key used by select-same. */
function appearanceKey(item: paper.Item, attribute: 'fill' | 'stroke' | 'strokeWidth' | 'opacity' | 'blendMode'): string {
  if (attribute === 'strokeWidth') return `w:${Math.round((Number((item as any).strokeWidth) || 0) * 100) / 100}`
  if (attribute === 'opacity') return `o:${Math.round((Number((item as any).opacity ?? 1)) * 1000) / 1000}`
  if (attribute === 'blendMode') return `b:${String((item as any).blendMode ?? 'source-over')}`
  const color = (
    attribute === 'fill'
      ? (item as any).fillColor
      : (item as any).strokeColor
  ) as any
  if (color && color.gradient) return 'gradient'
  return colorToCSS(color) ?? 'none'
}

/** First style-carrying leaf under an item (itself when it is one). */
export function firstLeaf(e: EditorEngine, item: paper.Item): paper.Item | null {
  const scope = e.scope
  if (
    item instanceof scope.Path ||
    item instanceof scope.CompoundPath ||
    item instanceof scope.PointText
  ) {
    return item
  }
  const children = (item as any).children as paper.Item[] | undefined
  if (children) {
    for (const child of children) {
      const found = firstLeaf(e, child)
      if (found) return found
    }
  }
  return null
}

/** Every selectable style-carrying leaf (locked / hidden art excluded). */
function appearanceLeaves(e: EditorEngine): paper.Item[] {
  const scope = e.scope
  const out: paper.Item[] = []
  const walk = (item: paper.Item, hidden: boolean, locked: boolean) => {
    const data = (item.data as any) ?? {}
    if (data.isChrome || data.isPreview || data.isGuide || data.annotation) return
    hidden = hidden || (item as any).visible === false
    locked = locked || !!(item as any).locked
    if (data.isPatternTile) return
    // Clip masks are scaffolding: match the visible content instead.
    if ((item as any).clipMask) return
    if (
      item instanceof scope.Path ||
      item instanceof scope.CompoundPath ||
      item instanceof scope.PointText
    ) {
      if (!hidden && !locked) out.push(item)
      return
    }
    const children = (item as any).children as paper.Item[] | undefined
    if (children) {
      for (const child of children) walk(child, hidden, locked)
    }
  }
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer) continue
    const layerHidden = (layer as any).visible === false
    const layerLocked = !!(layer as any).locked
    for (const child of layer.children) walk(child as paper.Item, layerHidden, layerLocked)
  }
  return out
}

/**
 * Current selection reduced to top-most members. Paper groups propagate
 * the selected flag to their whole subtree (`_selectChildren`), so the
 * raw list contains every descendant — operating on those as well would
 * apply every transform/copy/order op twice (once via the group, once
 * directly). All document ops go through here and therefore treat a
 * selected group as one unit, like Illustrator.
 */
export function getSelection(e: EditorEngine): paper.Item[] {
  return topmostItems(e.project.selectedItems as paper.Item[])
}

/** Drop items nested inside another included item (selection de-dup). */
export function topmostItems(items: paper.Item[]): paper.Item[] {
  if (items.length < 2) return items.slice()
  const set = new Set(items)
  return items.filter((item) => {
    let at = item.parent
    while (at) {
      if (set.has(at as paper.Item)) return false
      at = at.parent
    }
    return true
  })
}

export function selectItem(e: EditorEngine, item: paper.Item, addToSelection = false) {
  if (!addToSelection) {
    e.project.deselectAll()
  }
  item.selected = true
  e.syncSelectionToStore()
}

/**
 * Restore an id list as the selection, skipping missing items (AI
 * Reselect / saved-selection loading). Returns how many were selected.
 */
export function selectByIds(e: EditorEngine, ids: string[]): number {
  let n = 0
  e.project.deselectAll()
  for (const id of ids) {
    const item = getItemById(e, id)
    if (!item || (item as any).locked) continue
    item.selected = true
    n++
  }
  e.syncSelectionToStore()
  e.scope.view.update()
  return n
}

/** Re-select the previous selection (AI Select > Reselect parity). */
export function reselect(e: EditorEngine): number {
  const ids = [...(e.store.lastSelection ?? [])]
  if (ids.length === 0) return 0
  return selectByIds(e, ids)
}
