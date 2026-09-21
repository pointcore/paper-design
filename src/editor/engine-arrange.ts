/**
 * Arrange domain (C1: twelfth slice out of engine.ts).
 *
 * Delegation target for align/distribute/pivot readouts: each function
 * takes the engine as an explicit first argument and otherwise runs the
 * historical method body unchanged. The EditorEngine import is
 * type-only, so the runtime dependency flows one way
 * (engine → engine-arrange). The private `unitedBoundsOf` helper moves
 * along as a module function since all of its callers in this domain
 * come with it (other engine callers keep using the public
 * `getSelectionBounds` facade).
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import type { AlignMode, DistributeAxis, ReferencePoint } from './types'

/** United axis-aligned bounds of the current selection, or null. */
export function getSelectionBounds(e: EditorEngine): paper.Rectangle | null {
  return unitedBoundsOf(e.getSelection())
}

/** United axis-aligned bounds of the given items, or null. */
export function unitedBoundsOf(items: paper.Item[]): paper.Rectangle | null {
  let rect: paper.Rectangle | null = null
  for (const item of items) {
    const b = item.bounds
    if (!b) continue
    rect = rect ? rect.unite(b) : b.clone()
  }
  return rect
}

/** Position of a nine-point reference anchor within a rectangle. */
export function referencePointForRect(e: EditorEngine, rect: paper.Rectangle, point: ReferencePoint): paper.Point {
  const left = rect.x
  const centerX = rect.x + rect.width / 2
  const right = rect.x + rect.width
  const top = rect.y
  const centerY = rect.y + rect.height / 2
  const bottom = rect.y + rect.height
  switch (point) {
    case 'top-left': return new e.scope.Point(left, top)
    case 'top-center': return new e.scope.Point(centerX, top)
    case 'top-right': return new e.scope.Point(right, top)
    case 'middle-left': return new e.scope.Point(left, centerY)
    case 'middle-right': return new e.scope.Point(right, centerY)
    case 'bottom-left': return new e.scope.Point(left, bottom)
    case 'bottom-center': return new e.scope.Point(centerX, bottom)
    case 'bottom-right': return new e.scope.Point(right, bottom)
    case 'center':
    default: return new e.scope.Point(centerX, centerY)
  }
}

/** Pivot derived from the store reference point over the selection bounds. */
export function selectionReferencePivot(e: EditorEngine): paper.Point | null {
  const bounds = getSelectionBounds(e)
  if (!bounds) return null
  return referencePointForRect(e, bounds, e.store.referencePoint)
}

/** Bounds of the align key object, or null when unset/unusable. */
export function getKeyObjectBounds(e: EditorEngine): paper.Rectangle | null {
  const id = (e.store as any).keyObjectId as string | undefined
  if (!id) return null
  const item = e.getItemById(id)
  if (!item || item.locked || !item.parent || !item.bounds) return null
  return item.bounds.clone()
}

/**
 * Align every unlocked selected item to an edge or center of a target
 * rectangle (explicit board target, or the united unlocked-selection
 * bounds which needs at least two items). Returns false when there is
 * nothing to align; callers record history only then.
 */
export function alignSelection(e: EditorEngine, mode: AlignMode, target?: paper.Rectangle): boolean {
  const items = e.getSelection().filter((item) => !item.locked)
  if (items.length === 0) return false
  const bounds = target ?? (items.length >= 2 ? unitedBoundsOf(items) : null)
  if (!bounds) return false
  const targetLeft = bounds.x
  const targetCenterX = bounds.x + bounds.width / 2
  const targetRight = bounds.x + bounds.width
  const targetTop = bounds.y
  const targetCenterY = bounds.y + bounds.height / 2
  const targetBottom = bounds.y + bounds.height
  let moved = false
  for (const item of items) {
    const b = item.bounds
    if (!b) continue
    let dx = 0
    let dy = 0
    switch (mode) {
      case 'left': dx = targetLeft - b.x; break
      case 'centerX': dx = targetCenterX - (b.x + b.width / 2); break
      case 'right': dx = targetRight - (b.x + b.width); break
      case 'top': dy = targetTop - b.y; break
      case 'centerY': dy = targetCenterY - (b.y + b.height / 2); break
      case 'bottom': dy = targetBottom - (b.y + b.height); break
    }
    if (dx !== 0 || dy !== 0) {
      item.position = item.position.add(new e.scope.Point(dx, dy))
      e.refreshItemGradient(item)
      moved = true
    }
  }
  if (moved) e.reflowTextsForItems(items)
  e.scope.view.update()
  return moved
}

/**
 * Spread unlocked selected items along an axis with equal gaps between
 * neighbors (first and last stay put; even overlap when cramped).
 * Needs at least three unlocked items. Callers record history.
 */
export function distributeSpacing(e: EditorEngine, axis: DistributeAxis): boolean {
  const items = e.getSelection().filter((item) => !item.locked && item.bounds)
  if (items.length < 3) return false
  const horizontal = axis === 'horizontal'
  const leading = (b: paper.Rectangle) => (horizontal ? b.x : b.y)
  const sizeOf = (b: paper.Rectangle) => (horizontal ? b.width : b.height)
  const sorted = items.slice().sort((a, b) => leading(a.bounds) - leading(b.bounds))
  const first = leading(sorted[0].bounds)
  const last = leading(sorted[sorted.length - 1].bounds) + sizeOf(sorted[sorted.length - 1].bounds)
  const totalSize = sorted.reduce((sum, item) => sum + sizeOf(item.bounds), 0)
  const gap = (last - first - totalSize) / (items.length - 1)
  if (!Number.isFinite(gap)) return false
  let cursor = first
  let moved = false
  for (const item of sorted) {
    const b = item.bounds
    const delta = cursor - leading(b)
    if (Math.abs(delta) > 1e-9) {
      const shift = horizontal
        ? new e.scope.Point(delta, 0)
        : new e.scope.Point(0, delta)
      item.position = item.position.add(shift)
      e.refreshItemGradient(item)
      moved = true
    }
    cursor += sizeOf(item.bounds) + gap
  }
  if (moved) e.reflowTextsForItems(items)
  e.scope.view.update()
  return moved
}

/**
 * Spread unlocked selected items evenly along an axis by distributing
 * their centers between the extreme centers. The extreme items stay in
 * place. Needs at least three unlocked items with distinct extremes.
 * Returns whether anything moved; callers record history only then.
 */
export function distributeSelection(e: EditorEngine, axis: DistributeAxis): boolean {
  const items = e.getSelection().filter((item) => !item.locked && item.bounds)
  if (items.length < 3) return false
  const horizontal = axis === 'horizontal'
  const centers = items.map((item) => {
    const b = item.bounds
    return horizontal ? b.x + b.width / 2 : b.y + b.height / 2
  })
  const order = items.map((_, index) => index).sort((a, b) => centers[a] - centers[b])
  const first = centers[order[0]]
  const last = centers[order[order.length - 1]]
  if (!Number.isFinite(first) || !Number.isFinite(last)) return false
  if (Math.abs(last - first) < 1e-9) return false
  const step = (last - first) / (items.length - 1)
  let moved = false
  order.forEach((itemIndex, rank) => {
    const delta = first + step * rank - centers[itemIndex]
    if (Math.abs(delta) < 1e-9) return
    const item = items[itemIndex]
    const shift = horizontal
      ? new e.scope.Point(delta, 0)
      : new e.scope.Point(0, delta)
    item.position = item.position.add(shift)
    e.refreshItemGradient(item)
    moved = true
  })
  if (moved) e.reflowTextsForItems(items)
  e.scope.view.update()
  return moved
}

/**
 * Distribute with an exact gap value (first item stays, the rest follow
 * with `gap` document units between neighbors). Needs 3+ unlocked items.
 */
export function distributeSpacingExact(e: EditorEngine, axis: DistributeAxis, gap: number): boolean {
  if (!Number.isFinite(gap) || gap < 0) return false
  const items = e.getSelection().filter((item) => !item.locked && item.bounds)
  if (items.length < 3) return false
  const horizontal = axis === 'horizontal'
  const leading = (b: paper.Rectangle) => (horizontal ? b.x : b.y)
  const sizeOf = (b: paper.Rectangle) => (horizontal ? b.width : b.height)
  const sorted = items.slice().sort((a, b) => leading(a.bounds) - leading(b.bounds))
  let cursor = leading(sorted[0].bounds)
  let moved = false
  for (const item of sorted) {
    const b = item.bounds
    const delta = cursor - leading(b)
    if (Math.abs(delta) > 1e-9) {
      const shift = horizontal
        ? new e.scope.Point(delta, 0)
        : new e.scope.Point(0, delta)
      item.position = item.position.add(shift)
      e.refreshItemGradient(item)
      moved = true
    }
    cursor += sizeOf(item.bounds) + gap
  }
  if (moved) e.reflowTextsForItems(items)
  e.scope.view.update()
  return moved
}
