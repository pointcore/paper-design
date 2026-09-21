/**
 * User-layer domain (C1: third slice out of engine.ts).
 *
 * Delegation target for user-layer CRUD plus the tree-adjacent layer
 * helpers that only need public engine surface. Each function takes the
 * engine as an explicit first argument and otherwise runs the historical
 * method body unchanged. The EditorEngine import is type-only, so the
 * runtime dependency flows one way (engine → engine-layers). Layer
 * infrastructure that owns private engine fields (`initLayers`,
 * `getActiveLayer`, `getOverlayLayer`, `getAnnotationLayer`) stays on
 * the engine, as does the object-tree section below it.
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
