/**
 * User-layer domain (C1: third slice out of engine.ts).
 *
 * Delegation target for user-layer CRUD plus the tree-adjacent layer
 * helpers that only need public engine surface. Each function takes the
 * engine as an explicit first argument and otherwise runs the historical
 * method body unchanged. The EditorEngine import is type-only, so the
 * runtime dependency flows one way (engine → engine-layers). Layer
 * infrastructure that owns private engine fields (`initLayers`,
 * `getOverlayLayer`, `getAnnotationLayer`) stays on the engine, as do
 * grid chrome and the thumbnail render cache.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'

export function createLayer(e: EditorEngine, name?: string): paper.Layer {
  const layer = new e.scope.Layer()
  layer.name = (name ?? '').trim() || nextUserLayerName(e)
  layer.data.isUserLayer = true
  layer.data.layerId = e.genId()
  // `new Layer()` appends at the very top of the stack (above guides and
  // overlay chrome, which would bury interaction feedback). Park the layer
  // on top of the user band instead.
  parkUserLayer(e, layer)
  layer.activate()
  e.syncLayersToStore()
  e.pushHistory('New Layer')
  e.scope.view.update()
  return layer
}

/** First unused "Layer N" name across user layers. */
export function nextUserLayerName(e: EditorEngine): string {
  const users = e.project.layers.filter((l) => (l.data as any)?.isUserLayer)
  const names = new Set(users.map((l) => l.name))
  let n = users.length + 1
  while (names.has(`Layer ${n}`)) n++
  return `Layer ${n}`
}

/**
 * Keep a newborn user layer inside the user band: directly above the
 * topmost user layer (project order is bottom-first), or below the
 * first chrome layer when no user band exists yet.
 */
export function parkUserLayer(e: EditorEngine, layer: paper.Layer): void {
  const users = e.project.layers.filter(
    (l) => (l.data as any)?.isUserLayer && l !== layer
  )
  if (users.length > 0) {
    layer.insertAbove(users[users.length - 1])
    return
  }
  const chrome = e.project.layers.find((l) => !(l.data as any)?.isUserLayer && l !== layer)
  if (chrome) layer.insertBelow(chrome)
}

/**
 * Duplicate a user layer with its artwork right above the source. Every
 * document id in the copy is restamped so selection and history never
 * confuse originals with clones.
 */
export function duplicateLayer(e: EditorEngine, layerId: string): void {
  const source = e.project.layers.find((l) => (l.data as any)?.layerId === layerId)
  if (!source || !(source.data as any)?.isUserLayer) return
  const clone = source.clone({ insert: false }) as paper.Layer
  clone.data.layerId = e.genId()
  clone.name = `${source.name || 'Layer'} copy`
  e.restampCloneTree(clone)
  clone.insertAbove(source)
  clone.activate()
  e.syncLayersToStore()
  e.store.setActiveLayer(clone.data.layerId as string)
  e.pushHistory('Duplicate Layer')
  e.scope.view.update()
}

export function deleteLayer(e: EditorEngine, layerId: string): boolean {
  const layer = e.project.layers.find((l) => (l.data as any)?.layerId === layerId)
  if (!layer) return false
  layer.remove()
  e.clearSelection()
  e.syncLayersToStore()
  pointActiveLayerAtRestoredStack(e)
  e.pushHistory('Delete Layer')
  e.scope.view.update()
  return true
}

/**
 * Layer visibility / lock / rename with store sync and history (the panel
 * used to write these straight through, leaving them un-undoable and
 * overwritable by the next undo). Labels reuse the object-op names so the
 * entries stay frame-safe. Each returns false when nothing changed.
 */
export function setUserLayerVisible(e: EditorEngine, layerId: string, visible: boolean): boolean {
  const layer = e.project.layers.find((l) => (l.data as any)?.layerId === layerId)
  if (!layer || layer.visible === visible) return false
  layer.visible = visible
  e.store.updateLayer(layerId, { visible })
  e.pushHistory(visible ? 'Show' : 'Hide')
  e.scope.view.update()
  return true
}

export function setUserLayerLocked(e: EditorEngine, layerId: string, locked: boolean): boolean {
  const layer = e.project.layers.find((l) => (l.data as any)?.layerId === layerId)
  if (!layer || layer.locked === locked) return false
  layer.locked = locked
  e.store.updateLayer(layerId, { locked })
  e.pushHistory(locked ? 'Lock' : 'Unlock')
  e.scope.view.update()
  return true
}

export function renameUserLayer(e: EditorEngine, layerId: string, name: string): boolean {
  const next = (name ?? '').trim() || 'Layer'
  const layer = e.project.layers.find((l) => (l.data as any)?.layerId === layerId)
  if (!layer || layer.name === next) return false
  layer.name = next
  e.store.updateLayer(layerId, { name: next })
  e.pushHistory('Rename')
  e.scope.view.update()
  return true
}

/**
 * Solo a user layer (AI Alt-click eye/lock parity): visibility solos
 * toggle (hide the rest, or restore all when already solo); lock solos
 * one-way (Unlock All restores). Returns false for unknown layers.
 */
export function soloUserLayer(e: EditorEngine, layerId: string, mode: 'visible' | 'locked'): boolean {
  const users = e.project.layers.filter((l) => (l.data as any)?.isUserLayer)
  const target = users.find((l) => (l.data as any)?.layerId === layerId)
  if (!target) return false
  if (mode === 'locked') {
    let changed = false
    for (const layer of users) {
      const id = (layer.data as any)?.layerId as string
      if (id === layerId || layer.locked) continue
      layer.locked = true
      e.store.updateLayer(id, { locked: true })
      changed = true
    }
    if (!changed) return false
    e.pushHistory('Lock Others')
    e.scope.view.update()
    return true
  }
  const others = users.filter((l) => (l.data as any)?.layerId !== layerId)
  if (others.length > 0 && others.every((l) => !l.visible)) {
    for (const layer of users) {
      const id = (layer.data as any)?.layerId as string
      if (layer.visible) continue
      layer.visible = true
      e.store.updateLayer(id, { visible: true })
    }
    if (!target.visible) {
      target.visible = true
      e.store.updateLayer(layerId, { visible: true })
    }
    e.pushHistory('Show All Layers')
  } else {
    for (const layer of others) {
      const id = (layer.data as any)?.layerId as string
      if (!layer.visible) continue
      layer.visible = false
      e.store.updateLayer(id, { visible: false })
    }
    if (!target.visible) {
      target.visible = true
      e.store.updateLayer(layerId, { visible: true })
    }
    e.pushHistory('Solo Layer')
  }
  e.scope.view.update()
  return true
}

/**
 * Re-point the active layer when a restore/import/delete dropped it:
 * keep the id when it still exists, else fall to the topmost user layer.
 */
export function pointActiveLayerAtRestoredStack(e: EditorEngine): void {
  const activeId = e.store.activeLayerId
  const stillExists =
    !!activeId &&
    e.project.layers.some((l) => (l.data as any)?.layerId === activeId)
  if (stillExists) return
  const userLayers = e.project.layers.filter((l) => (l.data as any)?.isUserLayer)
  const last = userLayers[userLayers.length - 1]
  if (last) {
    e.store.setActiveLayer((last.data as any)?.layerId as string)
  }
}

/**
 * Move a user layer to a position in the user band (0 = bottom).
 * Only permutes user layers via pairwise stacking, so the grid, guide
 * and overlay layers keep their slots. Callers mirror the store order.
 */
export function moveUserLayer(e: EditorEngine, layerId: string, toUserIndex: number): boolean {
  const users = e.project.layers.filter((l) => (l.data as any)?.isUserLayer)
  const from = users.findIndex((l) => (l.data as any)?.layerId === layerId)
  if (from < 0) return false
  const clamped = Math.min(users.length - 1, Math.max(0, toUserIndex))
  if (clamped === from) return false
  const [moved] = users.splice(from, 1)
  users.splice(clamped, 0, moved)
  for (let i = 1; i < users.length; i++) {
    users[i].insertAbove(users[i - 1])
  }
  e.pushHistory('Rearrange')
  e.scope.view.update()
  return true
}

/** Set the active user layer opacity (store stays in sync, one history entry). */
export function setActiveLayerOpacity(e: EditorEngine, opacity: number): void {
  const layer = e.getActiveLayer()
  if (!layer) return
  const clamped = Math.min(1, Math.max(0, opacity))
  if (layer.opacity === clamped) return
  layer.opacity = clamped
  const id = (layer.data as any)?.layerId as string | undefined
  if (id) e.store.updateLayer(id, { opacity: clamped })
  e.pushHistory('Layer Opacity')
  e.scope.view.update()
}

/**
 * Merge the user layer below the active one into it. Donor children land
 * underneath in order; the emptied donor is removed. Returns false when
 * the active layer is already the bottom one.
 */
export function mergeLayerBelow(e: EditorEngine): boolean {
  const users = e.project.layers.filter((l) => (l.data as any)?.isUserLayer)
  const at = users.findIndex((l) => (l.data as any)?.layerId === e.store.activeLayerId)
  if (at <= 0) return false
  const target = users[at]
  const donor = users[at - 1]
  const wasLocked = target.locked
  target.locked = false
  let index = 0
  for (const child of donor.children.slice()) {
    target.insertChild(index, child as paper.Item)
    index++
  }
  donor.remove()
  target.locked = wasLocked
  e.syncLayersToStore()
  e.pushHistory('Merge Layer Below')
  e.scope.view.update()
  return true
}

export function getItemById(e: EditorEngine, id: string): paper.Item | null {
  if (!id) return null
  const walk = (item: paper.Item): paper.Item | null => {
    if ((item.data as any)?.id === id) return item
    const children = (item as any).children as paper.Item[] | undefined
    if (children) {
      for (const child of children) {
        const found = walk(child)
        if (found) return found
      }
    }
    return null
  }
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer) continue
    for (const child of layer.children) {
      const found = walk(child as paper.Item)
      if (found) return found
    }
  }
  return null
}

/** Select one object-tree entry (shift extends the selection). */
export function selectItemById(e: EditorEngine, id: string, additive = false): void {
  const item = getItemById(e, id)
  if (!item || (item as any).locked) return
  if (!additive) e.project.deselectAll()
  item.selected = true
  e.syncSelectionToStore()
  e.scope.view.update()
}

/** Toggle one object-tree entry visibility. */
export function setItemVisible(e: EditorEngine, id: string, visible: boolean): void {
  const item = getItemById(e, id)
  if (!item) return
  item.visible = visible
  e.pushHistory(visible ? 'Show' : 'Hide')
  e.scope.view.update()
}

/** Toggle one object-tree entry lock. */
export function setItemLocked(e: EditorEngine, id: string, locked: boolean): void {
  const item = getItemById(e, id)
  if (!item) return
  item.locked = locked
  e.pushHistory(locked ? 'Lock' : 'Unlock')
  e.scope.view.update()
}

/**
 * Fold or unfold an object-tree group entry. View-only paper metadata:
 * no history entry, the panel refreshes itself after toggling.
 */
export function setTreeCollapsed(e: EditorEngine, id: string, collapsed: boolean): void {
  const item = getItemById(e, id)
  if (!item || !(item instanceof e.scope.Group)) return
  if (collapsed) (item.data as any).treeCollapsed = true
  else delete (item.data as any).treeCollapsed
}

export function getActiveLayer(e: EditorEngine): paper.Layer {
  const activeId = e.store.activeLayerId
  if (activeId) {
    const layer = e.project.layers.find((l) => (l.data as any)?.layerId === activeId)
    if (layer) return layer
  }
  const userLayers = e.project.layers.filter((l) => (l.data as any)?.isUserLayer)
  const found = userLayers[userLayers.length - 1]
  if (found) return found
  // Degenerate stacks (bad imports, cleared projects) must never hand
  // 30+ call sites an undefined layer: rebuild one silent user layer.
  const layer = new e.scope.Layer()
  layer.name = 'Layer 1'
  layer.data.isUserLayer = true
  layer.data.layerId = e.genId()
  parkUserLayer(e, layer)
  layer.activate()
  e.syncLayersToStore()
  e.store.setActiveLayer(layer.data.layerId as string)
  return layer
}

/** Every user item including group descendants (lock / visibility sweeps). */
export function* walkUserItems(e: EditorEngine): Generator<paper.Item> {
  const walk = function* (item: paper.Item): Generator<paper.Item> {
    yield item
    const children = (item as any).children as paper.Item[] | undefined
    if (children) {
      for (const child of children) yield* walk(child)
    }
  }
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer) continue
    for (const child of layer.children) yield* walk(child as paper.Item)
  }
}

/** Unlock every user item in the document. */
export function unlockAll(e: EditorEngine): void {
  let changed = false
  for (const item of walkUserItems(e)) {
    if (item.locked) {
      item.locked = false
      changed = true
    }
  }
  if (changed) e.pushHistory('Unlock All')
  e.scope.view.update()
}

/** Show every user item in the document. */
export function showAll(e: EditorEngine): void {
  let changed = false
  for (const item of walkUserItems(e)) {
    if (!item.visible) {
      item.visible = true
      changed = true
    }
  }
  if (changed) e.pushHistory('Show All')
  e.scope.view.update()
}

export function setAllTreeCollapsed(e: EditorEngine, collapsed: boolean): void {
  for (const item of walkUserItems(e)) {
    if (item instanceof e.scope.Group && (item.data as any)?.id) {
      if (collapsed) (item.data as any).treeCollapsed = true
      else delete (item.data as any).treeCollapsed
    }
  }
  e.scope.view.update()
}

/** First unused "Sublayer N" name inside a parent container. */
export function nextSublayerName(parent: paper.Item): string {
  const names = new Set(
    ((parent as any).children as paper.Item[]).map(
      (c) => ((c as any).name as string | undefined) ?? ''
    )
  )
  let n = (parent as any).children.length + 1
  while (names.has(`Sublayer ${n}`)) n++
  return `Sublayer ${n}`
}

/** Whether a group clips through a masked child. */
export function isClipGroup(group: paper.Group): boolean {
  for (const child of group.children) {
    if ((child as any).clipMask) return true
  }
  return false
}

/**
 * Create an empty AI-style sublayer (a flagged group) inside the active
 * layer — or inside the selected group/sublayer when one is selected, so
 * nesting works like Illustrator. Selects the new sublayer.
 */
export function createSublayer(e: EditorEngine): paper.Group | null {
  const scope = e.scope
  let parent: paper.Item = e.getActiveLayer()
  const sel = e.getSelection()
  if (sel.length === 1 && sel[0] instanceof scope.Group && sel[0].parent) {
    const data = (sel[0].data as any) ?? {}
    if (data.id && data.textMode !== 'path' && !isClipGroup(sel[0] as paper.Group)) {
      parent = sel[0]
    }
  }
  if ((parent as any).locked) {
    e.showStatus('Target is locked')
    return null
  }
  const group = new scope.Group({ insert: false }) as paper.Group
  group.data.id = e.genId()
  group.data.isUserItem = true
  group.data.isSublayer = true
  ;(group as any).name = nextSublayerName(parent)
  ;(parent as any).addChild(group)
  e.clearSelection()
  group.selected = true
  e.syncSelectionToStore()
  e.pushHistory('New Sublayer')
  e.scope.view.update()
  return group
}

/**
 * Collect the selection into a brand-new top user layer (AI's Collect in
 * New Layer). Works across layers; the new layer activates and the moved
 * artwork becomes the selection.
 */
export function collectInNewLayer(e: EditorEngine): boolean {
  const items = e.getSelection().filter((item) => !item.locked && item.parent)
  if (items.length === 0) return false
  const ordered = items
    .slice()
    .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))
  const layer = new e.scope.Layer()
  const id = e.genId()
  layer.name = nextUserLayerName(e)
  layer.data.isUserLayer = true
  layer.data.layerId = id
  parkUserLayer(e, layer)
  for (const node of ordered) layer.addChild(node)
  layer.activate()
  e.syncLayersToStore()
  e.store.setActiveLayer(id)
  e.syncSelectionToStore()
  e.pushHistory('Collect in New Layer')
  e.scope.view.update()
  return true
}

/**
 * Release selected groups/sublayers to layers (AI's Release to Layers):
 * every direct child of each selected container moves into its own new
 * user layer named after the child. Empty containers dissolve.
 */
export function releaseToLayers(e: EditorEngine): boolean {
  const scope = e.scope
  const groups = e.getSelection().filter(
    (item) =>
      !item.locked &&
      item.parent &&
      item instanceof scope.Group &&
      (item.data as any)?.id &&
      (item.data as any)?.textMode !== 'path' &&
      !isClipGroup(item as paper.Group)
  ) as paper.Group[]
  if (groups.length === 0) return false
  const released: paper.Item[] = []
  let changed = false
  for (const group of groups) {
    const kids = group.children.slice() as paper.Item[]
    if (kids.length === 0) {
      group.remove()
      changed = true
      continue
    }
    let dissolved = false
    for (const kid of kids) {
      // Locked children stay behind: releasing must not steal them.
      if ((kid as any).locked) continue
      const layer = new scope.Layer()
      const id = e.genId()
      const label = ((kid as any).name as string | undefined)?.trim()
      layer.name = label || nextUserLayerName(e)
      layer.data.isUserLayer = true
      layer.data.layerId = id
      parkUserLayer(e, layer)
      layer.addChild(kid)
      released.push(kid)
      dissolved = true
    }
    // Only dissolve containers that actually emptied; locked leftovers
    // keep their group alive.
    if (dissolved) {
      if (group.children.length === 0) group.remove()
      changed = true
    }
  }
  if (!changed) return false
  e.syncLayersToStore()
  const users = e.project.layers.filter((l) => (l.data as any)?.isUserLayer)
  const last = users[users.length - 1]
  if (last) e.store.setActiveLayer((last.data as any)?.layerId as string)
  e.clearSelection()
  released.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.pushHistory('Release to Layers')
  e.scope.view.update()
  return true
}

/** Rename one object-tree entry (groups, sublayers and leaves). */
export function renameTreeItem(e: EditorEngine, id: string, name: string): boolean {
  const item = getItemById(e, id)
  if (!item) return false
  const clean = name.trim()
  if (!clean) return false
  // Labels render as `name (Kind)`; strip a pasted kind suffix so the
  // kind never doubles up after repeated renames.
  const bare = clean.replace(/\s*\((Sublayer|Group|Clipping Mask|Compound Path|Closed Path|Path|Path Text|Area Text|Vertical Text|Text|Image|Symbol|Pattern \w+|Object)\)\s*$/i, '').trim()
  if (!bare) return false
  ;(item as any).name = bare
  e.pushHistory('Rename')
  e.scope.view.update()
  return true
}

/** Whether `node` sits inside `ancestor` (cycle guard for moves). */
export function isDescendantOf(node: paper.Item, ancestor: paper.Item): boolean {
  let at = node.parent
  while (at) {
    if (at === ancestor) return true
    at = at.parent
  }
  return false
}

/** Whether the item or any ancestor up to the layer is locked. */
export function isEffectivelyLocked(e: EditorEngine, item: paper.Item): boolean {
  let at: paper.Item | null = item
  while (at && !(at instanceof e.scope.Layer)) {
    if ((at as any).locked) return true
    at = at.parent
  }
  return !!at && !!(at as any).locked
}

/**
 * Move one tree entry to a new parent / position (panel drag-drop).
 * `destParentId` is a group id, or '' for layer top level (then
 * `destLayerId` picks the layer, defaulting to the item's own layer).
 * `destIndex` counts in bottom-first paper order; omitted means append on
 * top. Returns false when the move is illegal (locked target, cycles).
 */
export function moveTreeItem(
  e: EditorEngine,
  itemId: string,
  destParentId: string,
  destLayerId: string,
  destIndex?: number
): boolean {
  const scope = e.scope
  const item = getItemById(e, itemId)
  if (!item || !item.parent) return false
  if (isEffectivelyLocked(e, item)) {
    e.showStatus('Item is locked')
    return false
  }
  let destParent: paper.Item
  if (destParentId) {
    const group = getItemById(e, destParentId)
    if (!group || !(group instanceof scope.Group) || !group.parent) return false
    const data = (group.data as any) ?? {}
    if (data.textMode === 'path' || isClipGroup(group)) return false
    if (group === item || isDescendantOf(group, item)) return false
    destParent = group
  } else {
    const layerId = destLayerId || getItemLayerId(e, itemId)
    const layer = e.project.layers.find((l) => (l.data as any)?.layerId === layerId)
    if (!layer || !(layer.data as any)?.isUserLayer) return false
    destParent = layer
  }
  if (isEffectivelyLocked(e, destParent)) {
    e.showStatus('Target is locked')
    return false
  }
  const kids = (destParent as any).children as paper.Item[]
  const sameParent = (item.parent as unknown) === (destParent as unknown)
  const from = sameParent ? kids.indexOf(item) : -1
  let at: number
  if (typeof destIndex === 'number' && Number.isFinite(destIndex)) {
    at = Math.min(kids.length, Math.max(0, Math.floor(destIndex)))
    // Same-parent moves: removing first shifts later slots down by one.
    if (from >= 0 && from < at) at--
  } else {
    at = kids.length
    if (from >= 0 && from < at) at--
  }
  // Dropping back onto the same slot changes nothing: skip history.
  if (from >= 0 && from === at) {
    e.syncSelectionToStore()
    return true
  }
  ;(destParent as any).insertChild(at, item)
  // Keep the layer activation in sync when crossing layers.
  const layerId = getItemLayerId(e, itemId)
  if (layerId) e.store.setActiveLayer(layerId)
  e.syncSelectionToStore()
  e.pushHistory('Rearrange')
  e.scope.view.update()
  return true
}

/**
 * Select all unlocked visible top-level artwork on a user layer (AI
 * target-circle parity). Returns how many were selected; no history
 * (selection-only, like marquee).
 */
export function selectLayerArtwork(e: EditorEngine, layerId: string): number {
  const layer = e.project.layers.find(
    (l) => (l.data as any)?.isUserLayer && (l.data as any)?.layerId === layerId
  )
  if (!layer || !layer.visible || layer.locked) return 0
  const tops = (layer.children as unknown as paper.Item[]).filter(
    (child) => child.visible && !(child as any).locked && !(child as any).data?.isPreview
  )
  e.clearSelection()
  tops.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.scope.view.update()
  return tops.length
}

/** Owning user-layer id of one tree entry (follows parents up). */
export function getItemLayerId(e: EditorEngine, id: string): string {
  const item = getItemById(e, id)
  if (!item) return ''
  let at: paper.Item | null = item
  while (at) {
    if (at instanceof e.scope.Layer && (at.data as any)?.isUserLayer) {
      return (at.data as any)?.layerId as string
    }
    at = at.parent
  }
  return ''
}

/** Direct parent group id of one tree entry ('' at layer top level). */
export function getItemParentId(e: EditorEngine, id: string): string {
  const item = getItemById(e, id)
  if (!item || !item.parent) return ''
  if (item.parent instanceof e.scope.Group) {
    return ((item.parent.data as any)?.id as string | undefined) ?? ''
  }
  return ''
}

export function getUserItems(e: EditorEngine): paper.Item[] {
  const items: paper.Item[] = []
  for (const layer of e.project.layers) {
    if ((layer.data as any)?.isUserLayer && layer.visible) {
      layer.children.forEach((child: any) => {
        if (child.visible && !child.data?.isPreview) items.push(child)
      })
    }
  }
  return items
}
