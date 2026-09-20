/**
 * Pathfinder boolean domain (C1: fourth slice out of engine.ts).
 *
 * Delegation target for the boolean ops: each function takes the engine
 * as an explicit first argument and otherwise runs the historical method
 * body unchanged. The EditorEngine import is type-only, so the runtime
 * dependency flows one way (engine → engine-pathfinder). The private
 * `isEmptyPathResult` helper moves along as a module function since all
 * of its callers live in this domain.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import type { BooleanOperation, StyleState } from './types'

/** Whether a boolean result carries no visible geometry. */
function isEmptyPathResult(e: EditorEngine, item: paper.PathItem): boolean {
  const scope = e.scope
  if (item instanceof scope.Path) return item.segments.length === 0
  if (item instanceof scope.CompoundPath) return item.children.length === 0
  return false
}

/**
 * Combine unlocked selected paths with a Pathfinder boolean operation.
 * Operands run back-to-front in document order: unite / intersect /
 * exclude merge every operand, subtract removes each front operand from
 * the back one. The result keeps the back operand style, replaces the
 * originals and becomes the new selection. Consumed (empty) results are
 * still recorded so Undo restores the operands. Returns false when fewer
 * than two unlocked paths are selected or the operation fails.
 */
export function booleanOperation(e: EditorEngine, op: BooleanOperation): boolean {
  const scope = e.scope
  const paths = e.getSelection().filter(
    (item) =>
      !item.locked &&
      item.parent &&
      (item instanceof scope.Path || item instanceof scope.CompoundPath)
  ) as paper.PathItem[]
  if (paths.length < 2) return false
  // Deterministic back-to-front operand order.
  const ordered = paths
    .slice()
    .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))
  const base = ordered[0]
  const style = e.getStyleFromItem(base)
  const parent = base.parent ?? e.getActiveLayer()

  let working: paper.PathItem = base
  let workingIsIntermediate = false
  try {
    for (let i = 1; i < ordered.length; i++) {
      const next = ordered[i]
      let combined: paper.PathItem
      switch (op) {
        case 'unite': combined = working.unite(next); break
        case 'subtract': combined = working.subtract(next); break
        case 'intersect': combined = working.intersect(next); break
        case 'exclude': combined = working.exclude(next); break
      }
      if (workingIsIntermediate) working.remove()
      working = combined
      workingIsIntermediate = true
    }
  } catch {
    if (workingIsIntermediate) working.remove()
    return false
  }

  for (const operand of ordered) operand.remove()
  const historyLabel =
    op === 'unite' ? 'Unite' :
    op === 'subtract' ? 'Subtract' :
    op === 'intersect' ? 'Intersect' : 'Exclude'
  if (isEmptyPathResult(e, working)) {
    working.remove()
    e.clearSelection()
    e.pushHistory(historyLabel)
    e.scope.view.update()
    return true
  }
  parent.addChild(working)
  working.data.id = e.genId()
  working.data.isUserItem = true
  e.applyStyleToItem(working, style)
  e.clearSelection()
  working.selected = true
  e.syncSelectionToStore()
  e.pushHistory(historyLabel)
  e.scope.view.update()
  return true
}

/**
 * Extended shaper ops composed from the four boolean primitives.
 * - minusBack: top-most path minus everything below (keeps top style).
 * - divide: exactly two paths -> intersect + remainders (keeps per-piece styles).
 * - trim: exactly two paths -> back-minus-front plus the intact front.
 * - outline: alias for Outline Stroke (one history entry).
 * Returns false when the selection does not satisfy the op.
 */
export function extendedBoolean(e: EditorEngine, op: 'minusBack' | 'divide' | 'trim' | 'outline'): boolean {
  if (op === 'outline') return e.outlineStroke()
  const scope = e.scope
  const paths = e.getSelection().filter(
    (item) =>
      !item.locked &&
      item.parent &&
      (item instanceof scope.Path || item instanceof scope.CompoundPath)
  ) as paper.PathItem[]
  if (paths.length < 2) return false
  const ordered = paths
    .slice()
    .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))
  const parent = ordered[0].parent ?? e.getActiveLayer()
  const at = Math.max(0, parent.children.indexOf(ordered[0] as any))
  try {
    if (op === 'minusBack') {
      const top = ordered[ordered.length - 1]
      const style = e.getStyleFromItem(top)
      let working = (top.clone({ insert: false }) as paper.PathItem)
      for (let i = ordered.length - 2; i >= 0; i--) {
        const cutter = ordered[i].clone({ insert: false }) as paper.PathItem
        const next = (working.subtract(cutter, { insert: false } as any) as paper.PathItem)
        working.remove()
        cutter.remove()
        working = next
      }
      for (const o of ordered) o.remove()
      if (isEmptyPathResult(e, working)) {
        working.remove()
        e.clearSelection()
        e.pushHistory('Minus Back')
        e.scope.view.update()
        return true
      }
      parent.insertChild(Math.min(at, parent.children.length), working as any)
      working.data.id = e.genId()
      working.data.isUserItem = true
      e.applyStyleToItem(working, style)
      e.clearSelection()
      working.selected = true
      e.syncSelectionToStore()
      e.pushHistory('Minus Back')
      e.scope.view.update()
      return true
    }
    if (ordered.length !== 2) return false
    const back = ordered[0]
    const front = ordered[1]
    const backStyle = e.getStyleFromItem(back)
    const frontStyle = e.getStyleFromItem(front)
    if (op === 'divide') {
      const a = back.clone({ insert: false }) as paper.PathItem
      const b = front.clone({ insert: false }) as paper.PathItem
      const inter = (a.clone({ insert: false }) as paper.PathItem).intersect(b, { insert: false } as any) as paper.PathItem
      const aMinus = (a.subtract(b, { insert: false } as any) as paper.PathItem)
      const bMinus = ((front.clone({ insert: false }) as paper.PathItem).subtract(back.clone({ insert: false }) as paper.PathItem, { insert: false } as any) as paper.PathItem)
      a.remove()
      b.remove()
      const pieces: Array<{ node: paper.PathItem; style: StyleState }> = []
      if (!isEmptyPathResult(e, aMinus)) pieces.push({ node: aMinus, style: backStyle })
      else aMinus.remove()
      if (!isEmptyPathResult(e, bMinus)) pieces.push({ node: bMinus, style: frontStyle })
      else bMinus.remove()
      if (!isEmptyPathResult(e, inter)) pieces.push({ node: inter, style: frontStyle })
      else inter.remove()
      back.remove()
      front.remove()
      if (pieces.length === 0) {
        e.clearSelection()
        e.pushHistory('Divide')
        e.scope.view.update()
        return true
      }
      e.clearSelection()
      pieces.forEach(({ node, style }, i) => {
        parent.insertChild(Math.min(at + i, parent.children.length), node as any)
        node.data.id = e.genId()
        node.data.isUserItem = true
        e.applyStyleToItem(node, style)
        node.selected = true
      })
      e.syncSelectionToStore()
      e.pushHistory('Divide')
      e.scope.view.update()
      return true
    }
    // trim: back gets cut by front, front stays intact on top.
    const cut = (back.clone({ insert: false }) as paper.PathItem).subtract(
      front.clone({ insert: false }) as paper.PathItem, { insert: false } as any
    ) as paper.PathItem
    const frontCopy = front.clone({ insert: false }) as paper.PathItem
    back.remove()
    front.remove()
    e.clearSelection()
    let idx = 0
    if (!isEmptyPathResult(e, cut)) {
      parent.insertChild(Math.min(at, parent.children.length), cut as any)
      cut.data.id = e.genId()
      cut.data.isUserItem = true
      e.applyStyleToItem(cut, backStyle)
      cut.selected = true
      idx++
    } else {
      cut.remove()
    }
    parent.insertChild(Math.min(at + idx, parent.children.length), frontCopy as any)
    frontCopy.data.id = e.genId()
    frontCopy.data.isUserItem = true
    e.applyStyleToItem(frontCopy, frontStyle)
    frontCopy.selected = true
    e.syncSelectionToStore()
    e.pushHistory('Trim')
    e.scope.view.update()
    return true
  } catch {
    return false
  }
}
