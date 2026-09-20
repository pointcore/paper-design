/**
 * Compound-path domain (C1: sixth slice out of engine.ts).
 *
 * Delegation target for compound make/release: each function takes the
 * engine as an explicit first argument and otherwise runs the historical
 * method body unchanged. The EditorEngine import is type-only, so the
 * runtime dependency flows one way (engine → engine-compound).
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'

/**
 * Merge unlocked selected paths into one compound path with even-odd
 * holes. Compound operands contribute their children so nesting never
 * stacks. The result takes the back operand style (painted onto every
 * leaf so rendering never depends on inheritance) and its stacking slot.
 */
export function makeCompoundPath(e: EditorEngine): boolean {
  const scope = e.scope
  const operands = e.getSelection().filter(
    (item) =>
      !item.locked &&
      item.parent &&
      (item instanceof scope.Path || item instanceof scope.CompoundPath)
  ) as Array<paper.Path | paper.CompoundPath>
  if (operands.length < 2) return false
  const ordered = operands
    .slice()
    .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))
  const leaves: paper.Path[] = []
  for (const operand of ordered) {
    if (operand instanceof scope.CompoundPath) {
      for (const child of operand.children.slice()) leaves.push(child as paper.Path)
    } else {
      leaves.push(operand)
    }
  }
  if (leaves.length < 2) return false
  const base = ordered[0]
  const style = e.getStyleFromItem(base)
  const parent = base.parent ?? e.getActiveLayer()
  const rawAt = parent.children.indexOf(base)
  const at = rawAt < 0 ? parent.children.length : rawAt
  const compound = new scope.CompoundPath({ insert: false }) as paper.CompoundPath
  for (const leaf of leaves) compound.addChild(leaf)
  // Plain leaves already reparented above — only the emptied source
  // compounds still need removal. Removing a leaf here would detach it
  // from the new compound and lose the artwork (the old code did exactly
  // that, so make+release destroyed the selection).
  for (const operand of ordered) {
    if (operand instanceof scope.CompoundPath) operand.remove()
  }
  parent.insertChild(Math.min(at, parent.children.length), compound)
  compound.data.id = e.genId()
  compound.data.isUserItem = true
  e.applyStyleToItem(compound, style)
  for (const leaf of leaves) {
    const node = leaf as any
    if (node.fillColor !== undefined) node.fillColor = style.fillColor
    if (node.strokeColor !== undefined) node.strokeColor = style.strokeColor
    if (node.strokeWidth !== undefined) node.strokeWidth = style.strokeWidth
  }
  compound.fillRule = 'evenodd'
  e.clearSelection()
  compound.selected = true
  e.syncSelectionToStore()
  e.pushHistory('Make Compound Path')
  e.scope.view.update()
  return true
}

/**
 * Release selected compound paths back into plain paths. Each child
 * keeps its stacking slot and inherits the compound style so the artwork
 * looks identical after the release.
 */
export function releaseCompoundPath(e: EditorEngine): boolean {
  const scope = e.scope
  const compounds = e.getSelection().filter(
    (item) => !item.locked && item.parent && item instanceof scope.CompoundPath
  ) as paper.CompoundPath[]
  if (compounds.length === 0) return false
  const released: paper.Item[] = []
  for (const compound of compounds) {
    const style = e.getStyleFromItem(compound)
    const parent = compound.parent ?? e.getActiveLayer()
    let at = parent.children.indexOf(compound)
    if (at < 0) at = parent.children.length
    for (const child of compound.children.slice()) {
      const node = child as paper.Item
      parent.insertChild(Math.min(at, parent.children.length), node)
      at++
      node.data.id = e.genId()
      node.data.isUserItem = true
      e.applyStyleToItem(node, style)
      released.push(node)
    }
    compound.remove()
  }
  e.clearSelection()
  released.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.pushHistory('Release Compound Path')
  e.scope.view.update()
  return true
}
