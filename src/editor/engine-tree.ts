/**
 * Layer object-tree domain (C1: slice out of engine.ts).
 *
 * Paper `project.layers` stays flat (sync/export/order depend on it), so
 * Illustrator sublayers are emulated as flagged groups, and the panel
 * reads this AI-style nested hierarchy instead. Delegation target: each
 * function takes the engine as an explicit first argument and otherwise
 * runs the historical method body unchanged. The EditorEngine import is
 * type-only, so the runtime dependency flows one way
 * (engine → engine-tree). Thumbnail generation stays on the engine: it
 * owns the private per-document render cache.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import { isClipGroup } from './engine-layers'
import type { LayerItemNode } from './types'

/** Kind discriminator for one tree entry (drives panel icons). */
function itemTreeKind(e: EditorEngine, item: paper.Item): LayerItemNode['kind'] {
  const scope = e.scope
  const data = (item.data as any) ?? {}
  if (data.isPatternTile) return 'path'
  if (item instanceof scope.Group && (data as any).isSublayer) return 'sublayer'
  if (data.textMode === 'path' || data.textMode === 'area' || data.textMode === 'vertical') {
    return item instanceof scope.Group ? 'group' : 'text'
  }
  if (item instanceof scope.Group && isClipGroup(item)) return 'clip'
  if (item instanceof scope.PointText) return 'text'
  if (item instanceof scope.CompoundPath) return 'compound'
  if (item instanceof scope.SymbolItem) return 'symbol'
  if (item instanceof scope.Raster) return 'image'
  if (item instanceof scope.Group) return 'group'
  if (item instanceof scope.Path) return 'path'
  return 'object'
}

/** Build one tree node (children attached recursively). */
function buildTreeNode(e: EditorEngine, item: paper.Item, layerId: string, parentId: string, depth: number): LayerItemNode | null {
  const scope = e.scope
  const data = (item.data as any) ?? {}
  if (data.isChrome || data.isPreview || data.isGuide || data.annotation) return null
  if (data.isPatternTile) return null
  if (
    item instanceof scope.CompoundPath ||
    item instanceof scope.Path ||
    item instanceof scope.PointText ||
    item instanceof scope.SymbolItem ||
    item instanceof scope.Raster
  ) {
    if (!data.id) return null
    return {
      id: data.id as string,
      name: itemTreeLabel(e, item),
      depth,
      visible: item.visible,
      locked: item.locked,
      collapsible: false,
      collapsed: false,
      kind: itemTreeKind(e, item),
      layerId,
      parentId,
      children: [],
    }
  }
  if (item instanceof scope.Group) {
    // Tagged groups (artwork groups, sublayers, clip groups, path-text
    // runs) are entries; untagged wrappers are never passed here — the
    // append walker splices those before calling this method.
    if (!data.id) return null
    const foldable = data.textMode !== 'path' && item.children.length > 0
    const collapsed = foldable && (data.treeCollapsed as boolean | undefined) === true
    const node: LayerItemNode = {
      id: data.id as string,
      name: itemTreeLabel(e, item),
      depth,
      visible: item.visible,
      locked: item.locked,
      collapsible: foldable,
      collapsed,
      kind: itemTreeKind(e, item),
      layerId,
      parentId,
      children: [],
    }
    if (data.textMode === 'path') return node
    appendGroupChildren(e, item, layerId, node.id, depth + 1, node.children)
    return node
  }
  if (data.id) {
    return {
      id: data.id as string,
      name: itemTreeLabel(e, item),
      depth,
      visible: (item as paper.Item).visible,
      locked: (item as paper.Item).locked,
      collapsible: false,
      collapsed: false,
      kind: itemTreeKind(e, item),
      layerId,
      parentId,
      children: [],
    }
  }
  return null
}

/**
 * Append one item's tree representation (0..n nodes: untagged groups
 * splice their children through). Single funnel for layer tops and group
 * interiors so transparent wrappers never drop siblings at any depth.
 */
function appendTreeNodes(
  e: EditorEngine,
  item: paper.Item,
  layerId: string,
  parentId: string,
  depth: number,
  out: LayerItemNode[]
): void {
  const scope = e.scope
  const data = (item.data as any) ?? {}
  if (data.isChrome || data.isPreview || data.isGuide || data.annotation) return
  if (data.isPatternTile) return
  if (item instanceof scope.Group && !data.id) {
    appendGroupChildren(e, item, layerId, parentId, depth, out)
    return
  }
  const children = (item as any).children as paper.Item[] | undefined
  const isLeafType =
    item instanceof scope.CompoundPath ||
    item instanceof scope.Path ||
    item instanceof scope.PointText ||
    item instanceof scope.SymbolItem ||
    item instanceof scope.Raster
  if (children && !isLeafType && !(item instanceof scope.Group)) {
    appendGroupChildren(e, item as unknown as paper.Group, layerId, parentId, depth, out)
    return
  }
  const node = buildTreeNode(e, item, layerId, parentId, depth)
  if (node) out.push(node)
}

/** Append every child of a container (bottom-first paper order). */
function appendGroupChildren(
  e: EditorEngine,
  container: paper.Group | paper.Item,
  layerId: string,
  parentId: string,
  depth: number,
  out: LayerItemNode[]
): void {
  const children = ((container as any).children as paper.Item[] | undefined) ?? []
  for (const child of children) {
    appendTreeNodes(e, child as paper.Item, layerId, parentId, depth, out)
  }
}

export function listLayerTree(e: EditorEngine, layerId: string): LayerItemNode[] {
  const out: LayerItemNode[] = []
  const layer = e.project.layers.find((l) => (l.data as any)?.layerId === layerId)
  if (!layer) return out
  for (const child of layer.children) {
    appendTreeNodes(e, child as paper.Item, layerId, '', 0, out)
  }
  // Render top-first like Illustrator (paper children are bottom-first).
  out.reverse()
  const reverseChildren = (nodes: LayerItemNode[]): void => {
    for (const node of nodes) {
      if (node.children.length > 1) node.children.reverse()
      if (node.children.length > 0) reverseChildren(node.children)
    }
  }
  reverseChildren(out)
  return out
}

/**
 * Flat depth-first object entries for one user layer. Path-text glyph
 * runs stay whole (their group is the entry); untagged plain groups are
 * transparent containers whose children list at the same depth.
 * Collapsed groups hide their descendants (panel fold state).
 */
export function listLayerItems(e: EditorEngine, layerId: string): LayerItemNode[] {
  const out: LayerItemNode[] = []
  const flatten = (nodes: LayerItemNode[]): void => {
    for (const node of nodes) {
      out.push(node)
      if (node.collapsible && node.collapsed) continue
      if (node.children.length > 0) flatten(node.children)
    }
  }
  // listLayerTree is top-first; the legacy flat list is also top-first.
  flatten(listLayerTree(e, layerId))
  return out
}

/** Display label for an object-tree entry (imported names win). */
function itemTreeLabel(e: EditorEngine, item: paper.Item): string {
  const scope = e.scope
  const data = (item.data as any) ?? {}
  const named = ((item as any).name as string | undefined)?.trim()
  let kind: string
  if (data.textMode === 'path') kind = 'Path Text'
  else if (data.textMode === 'area') kind = 'Area Text'
  else if (data.textMode === 'vertical') kind = 'Vertical Text'
  else if ((data as any).isSublayer) kind = 'Sublayer'
  else if ((data as any).isPatternFill) kind = `Pattern ${(data as any).pattern?.kind ?? ''}`.trim()
  else if (item instanceof scope.Group && isClipGroup(item)) kind = 'Clipping Mask'
  else if (item instanceof scope.PointText) kind = 'Text'
  else if (item instanceof scope.CompoundPath) kind = 'Compound Path'
  else if (item instanceof scope.SymbolItem) kind = 'Symbol'
  else if (item instanceof scope.Raster) kind = 'Image'
  else if (item instanceof scope.Group) kind = 'Group'
  else if (item instanceof scope.Path) kind = item.closed ? 'Closed Path' : 'Path'
  else kind = 'Object'
  return named ? `${named} (${kind})` : kind
}
