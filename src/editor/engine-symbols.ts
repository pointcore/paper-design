/**
 * Symbol library domain (C1: eighth slice out of engine.ts).
 *
 * Delegation target for symbol define/place/swap/break: each function
 * takes the engine as an explicit first argument and otherwise runs the
 * historical method body unchanged. The EditorEngine import is type-only,
 * so the runtime dependency flows one way (engine → engine-symbols).
 * The keeper-layer helpers move along as module functions since all of
 * their callers live in this domain.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import type { SymbolEntry } from './types'

function getKeeperLayer(e: EditorEngine, create = true): paper.Layer | null {
  const existing = e.project.layers.find(
    (l) => (l.data as any)?.isSymbolKeeper
  ) as paper.Layer | undefined
  if (existing) return existing
  if (!create) return null
  const layer = new e.scope.Layer()
  layer.name = 'symbols'
  layer.locked = true
  layer.visible = false
  layer.data.isUserLayer = false
  layer.data.isSymbolKeeper = true
  return layer
}

/** All symbol keepers (library entries) in creation order. */
function getKeepers(e: EditorEngine): paper.SymbolItem[] {
  const layer = getKeeperLayer(e, false)
  if (!layer) return []
  return (layer.children as paper.Item[]).filter(
    (child) => (child.data as any)?.symbolId
  ) as paper.SymbolItem[]
}

/** First unused "Symbol N" name. */
function nextSymbolName(e: EditorEngine): string {
  const names = new Set(getKeepers(e).map((k) => (k.data as any)?.symbolName as string))
  let n = getKeepers(e).length + 1
  while (names.has(`Symbol ${n}`)) n++
  return `Symbol ${n}`
}

/**
 * Library entries with live instance counts (keepers excluded from the
 * count). The panel rebuilds off history/selection changes.
 */
export function listSymbols(e: EditorEngine): SymbolEntry[] {
  const keepers = getKeepers(e)
  if (keepers.length === 0) return []
  const counts = new Map<object, number>()
  const tally = (item: paper.Item) => {
    if (item instanceof e.scope.SymbolItem && !(item.data as any)?.isKeeper) {
      const definition = (item as any)._definition ?? (item as any).definition
      if (definition) counts.set(definition, (counts.get(definition) ?? 0) + 1)
    }
    const children = (item as any).children as paper.Item[] | undefined
    if (children) {
      for (const child of children) tally(child)
    }
  }
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer) continue
    for (const child of layer.children) tally(child as paper.Item)
  }
  return keepers.map((keeper) => {
    const data = keeper.data as any
    const definition = data ? ((keeper as any)._definition ?? (keeper as any).definition) : null
    return {
      id: data.symbolId as string,
      name: (data.symbolName as string) || 'Symbol',
      instances: definition ? (counts.get(definition) ?? 0) : 0,
    }
  })
}

/**
 * Define a symbol from the unlocked selection (grouped when plural).
 * The source leaves the scene into the definition; one hidden keeper
 * holds the library entry. Returns false when nothing qualifies.
 */
export function defineSymbolFromSelection(e: EditorEngine): boolean {
  const scope = e.scope
  const items = e.getSelection().filter((item) => !item.locked && item.parent)
  if (items.length === 0) return false
  const root =
    items.length === 1 ? items[0] : (new scope.Group(items) as paper.Group)
  const definition = new scope.SymbolDefinition(root)
  const keeperLayer = getKeeperLayer(e)
  if (!keeperLayer) return false
  const keeper = definition.place(new scope.Point(0, 0)) as paper.SymbolItem
  keeper.visible = false
  keeper.data.symbolId = e.genId()
  keeper.data.symbolName = nextSymbolName(e)
  keeper.data.isKeeper = true
  const wasLocked = keeperLayer.locked
  keeperLayer.locked = false
  keeperLayer.addChild(keeper)
  keeperLayer.locked = wasLocked
  e.clearSelection()
  e.pushHistory('Make Symbol')
  e.scope.view.update()
  return true
}

/** Place a symbol instance at the view center and select it. */
export function placeSymbol(e: EditorEngine, id: string): boolean {
  const keeper = getKeepers(e).find((k) => (k.data as any)?.symbolId === id)
  if (!keeper) return false
  const definition = (keeper as any)._definition ?? (keeper as any).definition
  if (!definition) return false
  const instance = definition.place(e.scope.view.center.clone()) as paper.SymbolItem
  const layer = e.getActiveLayer()
  layer.addChild(instance)
  instance.data.id = e.genId()
  instance.data.isUserItem = true
  e.store.setSpraySymbol(id)
  e.selectItem(instance)
  e.pushHistory('Place Symbol')
  e.scope.view.update()
  return true
}

/**
 * Scatter one symbol instance for the sprayer (no history; the stroke
 * records once on release). Scale/rotation jitter around 1 / 0.
 * Returns the instance, or null for an unknown definition.
 */
export function spraySymbol(e: EditorEngine, id: string, point: paper.Point, scale: number, rotation: number): paper.SymbolItem | null {
  const keeper = getKeepers(e).find((k) => (k.data as any)?.symbolId === id)
  if (!keeper) return null
  const definition = (keeper as any)._definition ?? (keeper as any).definition
  if (!definition) return null
  const instance = definition.place(point.clone()) as paper.SymbolItem
  try {
    if (Number.isFinite(scale) && scale > 0) instance.scaling = new e.scope.Point(scale, scale)
    if (Number.isFinite(rotation) && rotation !== 0) instance.rotation = rotation
  } catch { /* jitter is best-effort; the dab still lands */ }
  e.getActiveLayer().addChild(instance)
  instance.data.id = e.genId()
  instance.data.isUserItem = true
  return instance
}

/** Delete a symbol definition (placed instances keep working). */
export function deleteSymbol(e: EditorEngine, id: string): boolean {
  const keeper = getKeepers(e).find((k) => (k.data as any)?.symbolId === id)
  if (!keeper) return false
  keeper.remove()
  e.pushHistory('Delete Symbol')
  e.scope.view.update()
  return true
}

/** Rename a symbol definition (metadata only, no history). */
export function renameSymbol(e: EditorEngine, id: string, name: string): void {
  const keeper = getKeepers(e).find((k) => (k.data as any)?.symbolId === id)
  if (!keeper) return
  ;(keeper.data as any).symbolName = name
  e.scope.view.update()
}

/**
 * Break selected symbol instances into plain artwork: definition content
 * cloned through the instance matrix, keeping slot, paint and stacking.
 */
export function breakSymbolLinks(e: EditorEngine): boolean {
  const scope = e.scope
  const instances = e.getSelection().filter(
    (item) => item.parent && item instanceof scope.SymbolItem && !(item.data as any)?.isKeeper
  ) as paper.SymbolItem[]
  if (instances.length === 0) return false
  const released: paper.Item[] = []
  for (const instance of instances) {
    const definition = (instance as any)._definition ?? (instance as any).definition
    const source = definition?.item ?? definition?._item
    if (!source) continue
    const content = (source.clone({ insert: false }) as paper.Item)
    content.transform(instance.matrix)
    const parent = instance.parent ?? e.getActiveLayer()
    const rawAt = parent.children.indexOf(instance)
    parent.insertChild(Math.min(Math.max(rawAt, 0), parent.children.length), content)
    content.data.id = e.genId()
    content.data.isUserItem = true
    instance.remove()
    released.push(content)
  }
  if (released.length === 0) return false
  e.clearSelection()
  released.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.pushHistory('Break Symbol Link')
  e.scope.view.update()
  return true
}

/**
 * Swap selected symbol instances to another definition (AI Replace
 * Symbol parity): position, rotation, scaling and opacity carry over,
 * slot and stacking stay. Returns instances swapped; one history entry.
 */
export function swapSymbolInstances(e: EditorEngine, symbolId: string): number {
  const scope = e.scope
  const keeper = getKeepers(e).find((k) => (k.data as any)?.symbolId === symbolId)
  if (!keeper) return 0
  const definition = (keeper as any)._definition ?? (keeper as any).definition
  if (!definition) return 0
  const instances = e.getSelection().filter(
    (item) => !item.locked && item.parent && item instanceof scope.SymbolItem && !(item.data as any)?.isKeeper
  ) as paper.SymbolItem[]
  if (instances.length === 0) return 0
  const swapped: paper.Item[] = []
  for (const instance of instances) {
    const next = definition.place((instance.position as paper.Point).clone()) as paper.SymbolItem
    try {
      next.rotation = (instance as any).rotation ?? 0
      const scaling = (instance as any).scaling as paper.Point | undefined
      if (scaling) next.scaling = scaling.clone()
      if ((instance as any).opacity !== undefined) next.opacity = (instance as any).opacity
    } catch { /* transforms are best-effort; the swap still lands */ }
    const parent = instance.parent ?? e.getActiveLayer()
    const rawAt = parent.children.indexOf(instance)
    parent.insertChild(Math.min(Math.max(rawAt, 0), parent.children.length), next as any)
    next.data.id = e.genId()
    next.data.isUserItem = true
    instance.remove()
    swapped.push(next as paper.Item)
  }
  if (swapped.length === 0) return 0
  e.clearSelection()
  swapped.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.pushHistory('Swap Symbol')
  e.scope.view.update()
  return swapped.length
}

/**
 * Select every placed instance of a symbol definition (locked ones
 * stay out, like every selection path). Returns instances selected.
 */
export function selectSymbolInstances(e: EditorEngine, symbolId: string): number {
  const scope = e.scope
  const keeper = getKeepers(e).find((k) => (k.data as any)?.symbolId === symbolId)
  if (!keeper) return 0
  const definition = (keeper as any)._definition ?? (keeper as any).definition
  if (!definition) return 0
  const hits: paper.Item[] = []
  const walk = (node: paper.Item) => {
    const data = (node as any).data ?? {}
    if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard || data.annotation) return
    if ((node as any).locked) return
    if (node instanceof scope.SymbolItem && !data.isKeeper) {
      const def = (node as any)._definition ?? (node as any).definition
      if (def && def === definition) hits.push(node)
      return
    }
    const children = (node as any).children as paper.Item[] | undefined
    if (children) for (const child of children) walk(child)
  }
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer || !layer.visible) continue
    for (const child of layer.children) walk(child as paper.Item)
  }
  e.clearSelection()
  hits.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.scope.view.update()
  return hits.length
}
