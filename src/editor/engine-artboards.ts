/**
 * Artboard sheet domain (C1: first slice out of engine.ts).
 *
 * Pure delegation target for the engine's artboard CRUD: each function
 * takes the engine as an explicit first argument and otherwise runs the
 * historical method body unchanged. The import of EditorEngine is
 * type-only, so the runtime dependency flows one way
 * (engine → engine-artboards) and call sites keep calling
 * `engine.renameArtboard(...)` exactly as before.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'

/**
 * Rename an artboard with history. Returns false when missing or
 * unchanged so callers stay silent then.
 */
export function renameArtboard(e: EditorEngine, boardId: string, name: string): boolean {
  const next = (name ?? '').trim() || 'Artboard'
  const board = e.store.artboards.find((b) => b.id === boardId)
  if (!board || board.name === next) return false
  e.store.updateArtboard(boardId, { name: next })
  e.refreshArtboards()
  e.pushHistory('Rename Artboard')
  e.scope.view.update()
  return true
}

/**
 * Move an artboard sheet with history. With `withArtwork`, overlapping
 * unlocked artwork travels by the same delta (AI move-with-art parity).
 * Returns false when missing, invalid or unmoved.
 */
export function moveArtboard(
  e: EditorEngine,
  boardId: string,
  x: number,
  y: number,
  opts?: { withArtwork?: boolean }
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false
  const board = e.store.artboards.find((b) => b.id === boardId)
  if (!board || (board.x === x && board.y === y)) return false
  const dx = x - board.x
  const dy = y - board.y
  e.store.updateArtboard(boardId, { x, y })
  if (opts?.withArtwork && (dx !== 0 || dy !== 0)) {
    const before = new e.scope.Rectangle(board.x, board.y, board.width, board.height)
    const shift = new e.scope.Point(dx, dy)
    const moved: paper.Item[] = []
    for (const layer of e.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      for (const child of layer.children) {
        const c = child as paper.Item
        if ((c as any).locked || !c.visible || (c as any).data?.isPreview) continue
        const bounds = (c as any).bounds as paper.Rectangle | undefined
        if (!bounds) continue
        try {
          if (!bounds.intersects(before)) continue
        } catch {
          continue
        }
        c.position = (c.position as paper.Point).add(shift)
        e.refreshItemGradient(c)
        moved.push(c)
      }
    }
    if (moved.length > 0) e.reflowTextsForItems(moved)
  }
  e.refreshArtboards()
  e.pushHistory('Move Artboard')
  e.scope.view.update()
  return true
}

/**
 * Resize an artboard sheet with history (Canvas Settings drive the
 * active board). Dimensions clamp to 1–16384; unchanged sizes stay
 * silent. Returns false when nothing changed.
 */
export function resizeArtboard(
  e: EditorEngine,
  boardId: string,
  width: number,
  height: number
): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false
  const w = Math.min(16384, Math.max(1, Math.round(width)))
  const h = Math.min(16384, Math.max(1, Math.round(height)))
  const board = e.store.artboards.find((b) => b.id === boardId)
  if (!board || (board.width === w && board.height === h)) return false
  e.store.updateArtboard(boardId, { width: w, height: h })
  e.refreshArtboards()
  e.pushHistory('Resize Artboard')
  e.scope.view.update()
  return true
}

/**
 * Duplicate an artboard sheet plus the artwork overlapping it (AI
 * duplicate-artboard parity). The copy lands beside the source with an
 * offset clone of every intersecting top-level user item (fresh ids,
 * thread links remapped inside the cloned set, selection preserved).
 * Returns false when the board is missing.
 */
export function duplicateArtboard(e: EditorEngine, boardId: string): boolean {
  const scope = e.scope
  const src = e.store.artboards.find((b) => b.id === boardId)
  if (!src || !(src.width > 0) || !(src.height > 0)) return false
  const names = new Set(e.store.artboards.map((b) => b.name))
  let base = `${src.name} copy`
  let n = 2
  while (names.has(base)) {
    base = `${src.name} copy ${n}`
    n++
  }
  const board = {
    id: e.genId(),
    name: base,
    x: src.x + src.width + 100,
    y: src.y,
    width: src.width,
    height: src.height,
  }
  const dx = board.x - src.x
  const dy = board.y - src.y
  const srcRect = new scope.Rectangle(src.x, src.y, src.width, src.height)
  // Intersecting top-level user items (visible layers; locked art rides
  // along so the copy stays faithful).
  const targets: paper.Item[] = []
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer || !layer.visible) continue
    for (const child of layer.children) {
      const c = child as paper.Item
      if ((c as any).data?.isPreview || !c.visible) continue
      const bounds = (c as any).bounds as paper.Rectangle | undefined
      if (!bounds) continue
      try {
        if (bounds.intersects(srcRect)) targets.push(c)
      } catch {
        targets.push(c)
      }
    }
  }
  const idMap = new Map<string, string>()
  const clones: Array<{ node: paper.Item; parent: paper.Item }> = []
  for (const item of targets) {
    const parent = item.parent ?? e.getActiveLayer()
    const clone = (item as any).clone({ insert: false }) as paper.Item
    clone.translate(new scope.Point(dx, dy))
    const walk = (node: paper.Item) => {
      const data = (node as any).data ?? ((node as any).data = {})
      if (data.id || data.isUserItem) {
        const fresh = e.genId()
        if (typeof data.id === 'string') idMap.set(data.id, fresh)
        data.id = fresh
        data.isUserItem = true
      }
      delete data.isPreview
      ;(node as any).selected = false
      const children = (node as any).children as paper.Item[] | undefined
      if (children) for (const child of children) walk(child)
    }
    walk(clone)
    clones.push({ node: clone, parent })
  }
  // Remap thread links that point inside the cloned set.
  for (const { node } of clones) {
    const walk = (n: paper.Item) => {
      const data = (n as any).data ?? {}
      if (typeof data.threadNext === 'string' && idMap.has(data.threadNext)) {
        data.threadNext = idMap.get(data.threadNext)
      }
      if (typeof data.threadPrev === 'string' && idMap.has(data.threadPrev)) {
        data.threadPrev = idMap.get(data.threadPrev)
      }
      const children = (n as any).children as paper.Item[] | undefined
      if (children) for (const child of children) walk(child)
    }
    walk(node)
  }
  e.store.addArtboard(board)
  for (const { node, parent } of clones) {
    ;(parent as paper.Item).addChild(node)
  }
  e.refreshArtboards()
  if (clones.length > 0) {
    e.clearSelection()
    for (const { node } of clones) node.selected = true
    e.syncSelectionToStore()
  }
  e.pushHistory('Duplicate Artboard')
  e.scope.view.update()
  return true
}

/**
 * Shrink-wrap the artboard around its overlapping artwork (AI Fit to
 * Artwork Bounds parity). Padding expands the united bounds; empty
 * boards stay silent. Returns false when nothing fits.
 */
export function fitArtboardToArtwork(e: EditorEngine, boardId: string, padding = 20): boolean {
  const board = e.store.artboards.find((b) => b.id === boardId)
  if (!board) return false
  const pad = Number.isFinite(padding) ? Math.min(500, Math.max(0, padding)) : 20
  const rect = new e.scope.Rectangle(board.x, board.y, board.width, board.height)
  const hits: paper.Rectangle[] = []
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer || !layer.visible) continue
    for (const child of layer.children) {
      const c = child as paper.Item
      if ((c as any).data?.isPreview || !c.visible) continue
      const bounds = (c as any).bounds as paper.Rectangle | undefined
      if (!bounds || bounds.width <= 0 || bounds.height <= 0) continue
      try {
        if (bounds.intersects(rect)) hits.push(bounds)
      } catch { /* treat untestable bounds as a hit */ hits.push(bounds) }
    }
  }
  if (hits.length === 0) return false
  let united = hits[0].clone()
  for (let i = 1; i < hits.length; i++) united = united.unite(hits[i])
  const w = Math.min(16384, Math.max(1, Math.round(united.width + pad * 2)))
  const h = Math.min(16384, Math.max(1, Math.round(united.height + pad * 2)))
  e.store.updateArtboard(boardId, {
    x: Math.round((united.x - pad) * 10) / 10,
    y: Math.round((united.y - pad) * 10) / 10,
    width: w,
    height: h,
  })
  e.refreshArtboards()
  e.pushHistory('Fit Artboard to Artwork')
  e.scope.view.update()
  return true
}

/**
 * Lay every artboard out in a single X-sorted row with even spacing
 * (AI Rearrange Artboards, one-row v1). Records one history entry.
 */
export function arrangeArtboards(e: EditorEngine, spacing = 100): boolean {
  const boards = e.store.artboards
  if (boards.length === 0) return false
  const gap = Number.isFinite(spacing) ? Math.min(2000, Math.max(0, spacing)) : 100
  const ordered = boards.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  let cursor = ordered[0].x
  for (const board of ordered) {
    if (board.x !== cursor) e.store.updateArtboard(board.id, { x: Math.round(cursor * 10) / 10 })
    cursor += board.width + gap
  }
  e.refreshArtboards()
  e.pushHistory('Arrange Artboards')
  e.scope.view.update()
  return true
}
