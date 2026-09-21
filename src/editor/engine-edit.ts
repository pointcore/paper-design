/**
 * Selection edit domain (C1: slice out of engine.ts).
 *
 * Delegation target for delete/duplicate/simplify/close-path: each
 * function takes the engine as an explicit first argument and otherwise
 * runs the historical method body unchanged. The EditorEngine import is
 * type-only, so the runtime dependency flows one way
 * (engine → engine-edit).
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'

export function deleteSelected(e: EditorEngine) {
  const items = e.getSelection().filter((item) => !item.locked)
  if (items.length === 0) return
  items.forEach((i) => i.remove())
  e.clearSelection()
  e.pushHistory('Delete')
  e.scope.view.update()
}

export function duplicateSelected(e: EditorEngine) {
  const items = e.getSelection()
  if (items.length === 0) return
  const activeLayer = e.getActiveLayer()
  if (!activeLayer) return
  // Clone from a snapshot and reselect only the clones: reselecting the
  // sources too used to double the selection on every repeat (1→2→4→8).
  const clones: paper.Item[] = []
  for (const item of items) {
    const clone = item.clone()
    activeLayer.addChild(clone)
    e.restampCloneTree(clone)
    clone.data.id = e.genId()
    clone.data.isUserItem = true
    clones.push(clone)
  }
  e.clearSelection()
  if (clones.length > 0) {
    const dx = 10
    const dy = 10
    clones.forEach((c) => {
      c.position = c.position.add(new e.scope.Point(dx, dy))
      c.selected = true
    })
    e.syncSelectionToStore()
    e.pushHistory('Duplicate')
    e.scope.view.update()
  }
}

/**
 * Reduce anchor counts on unlocked selected plain paths with zoom-scaled
 * fitting tolerance. Returns how many paths lost anchors; records
 * history only then.
 */
export function simplifyPaths(e: EditorEngine): number {
  const scope = e.scope
  const paths = e.getSelection().filter(
    (item) =>
      !item.locked &&
      item.parent &&
      item instanceof scope.Path &&
      !(item instanceof scope.CompoundPath) &&
      item.segments.length >= 2
  ) as paper.Path[]
  if (paths.length === 0) return 0
  const tolerance = 2.5 / (scope.view.zoom || 1)
  let changed = 0
  for (const path of paths) {
    const before = path.segments.length
    try {
      path.simplify(tolerance)
    } catch {
      continue
    }
    if (path.segments.length < before) changed++
  }
  if (changed > 0) {
    e.pushHistory('Simplify')
    e.scope.view.update()
  }
  return changed
}

/**
 * Close open paths (connect ends) or open closed ones in the unlocked
 * selection. Returns how many paths changed; records history only then.
 */
export function setPathsClosed(e: EditorEngine, closed: boolean): number {
  const scope = e.scope
  const paths = e.getSelection().filter(
    (item) =>
      !item.locked &&
      item.parent &&
      item instanceof scope.Path &&
      !(item instanceof scope.CompoundPath) &&
      item.segments.length >= 2 &&
      item.closed !== closed
  ) as paper.Path[]
  if (paths.length === 0) return 0
  for (const path of paths) {
    path.closed = closed
  }
  e.pushHistory(closed ? 'Close Path' : 'Open Path')
  e.scope.view.update()
  return paths.length
}
