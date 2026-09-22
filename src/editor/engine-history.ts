/**
 * History domain (C1: slice out of engine.ts).
 *
 * Whole-project JSON snapshots with a count cap plus a byte budget, undo /
 * redo / jump, and the snapshot/restore plumbing (clean-scene detach,
 * bitmap sidecar, document metadata). Each function takes the engine as an
 * explicit first argument and otherwise runs the historical method body
 * unchanged. The EditorEngine import is type-only, so the runtime
 * dependency flows one way (engine → engine-history).
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import type { ArtboardMeta } from './types'
import { SnapService } from './snap/snap-service'
import { inflateHistoryImages, slimHistoryImages } from './history-images'
import { MAX_HISTORY_BYTES, MIN_HISTORY_ENTRIES, evictCountForBudget } from './history-budget'
import { walkUserItems } from './engine-layers'

/** Document metadata snapshotted alongside each history entry. */
export interface HistoryDocMeta {
  artboards: ArtboardMeta[]
  activeArtboardId: string
  bleed: number
  pageSize: { width: number; height: number }
}

/** History entries that provably preserve selection geometry (no reset). */
const FRAME_SAFE_HISTORY = new Set([
  'Add Guide', 'Move Guide', 'Delete Guide',
  'Change Fill', 'Clear Fill', 'Change Stroke', 'Clear Stroke',
  'Change Stroke Style', 'Change Dash Pattern', 'Change Blend Mode',
  'Change Opacity', 'Spot Color',
  'Eyedropper',
  'Bring to Front', 'Bring Forward', 'Send Backward', 'Send to Back',
  'Rearrange',
  'Lock', 'Unlock', 'Show', 'Hide', 'Show All', 'Unlock All',
  'New Sublayer', 'Duplicate Layer', 'Merge Layer Below', 'Rename',
  'New Artboard', 'Delete Artboard', 'Rename Artboard', 'Move Artboard',
  'Resize Artboard', 'Change Bleed', 'Layer Opacity',
  'Duplicate',
])

/**
 * Shared snap service for invalidating the document-wide cache.
 * (Controllers own their own SnapService instances; this one only serves
 * the history entry points, which every document mutation funnels through.)
 */
const snapService = new SnapService()

export function snapshotProject(e: EditorEngine): string {
  // History diet (C5): inline bitmap pixels are replaced by sidecar
  // tokens so 100 snapshots share one copy of each distinct image.
  // Project files (snapshotProjectObject) stay self-contained.
  const obj = withCleanScene(
    e,
    () => (e.project as any).exportJSON({ asString: false }) as unknown,
  )
  return JSON.stringify(slimHistoryImages(obj, e.historyImageStore))
}

/** Snapshot as a plain object for v2 project files (no double encoding). */
export function snapshotProjectObject(e: EditorEngine): Record<string, unknown> | unknown[] {
  return withCleanScene(
    e,
    () => (e.project as any).exportJSON({ asString: false }) as Record<string, unknown> | unknown[]
  )
}

/**
 * Run `fn` with regenerable scene content detached: grid lines plus
 * editing chrome and drag previews. Everything is re-attached in order
 * afterwards, so history snapshots and project files stay lean.
 */
function withCleanScene<T>(e: EditorEngine, fn: () => T): T {
  // Grid lines are regenerable view cache: keep them out of history and
  // project files (they used to bloat snapshots and resurrect as stale
  // duplicates after undo). Children are stashed and restored in order.
  const grid =
    e.gridLayer && e.gridLayer.parent ? e.gridLayer : null
  const stashed = grid ? grid.removeChildren() : null
  // Same for editing chrome and drag previews (selection outlines,
  // anchors, handles, rubber bands): flagged isChrome / isPreview, kept
  // out of snapshots and re-attached afterwards in index order.
  const stashedChrome: Array<{ item: paper.Item; parent: paper.Item; index: number }> = []
  const collect = (item: paper.Item): void => {
    const children = ((item as any).children as paper.Item[] | undefined) ?? []
    for (const child of children.slice()) collect(child as paper.Item)
    const data = (item as any).data ?? {}
    if (!(data.isChrome || data.isPreview)) return
    const parent = item.parent as paper.Item | null
    if (!parent) return
    stashedChrome.push({ item, parent, index: parent.children.indexOf(item) })
    item.remove()
  }
  for (const layer of e.project.layers.slice()) collect(layer as paper.Item)
  try {
    return fn()
  } finally {
    if (grid && stashed) grid.addChildren(stashed)
    const byParent = new Map<paper.Item, Array<{ item: paper.Item; index: number }>>()
    for (const entry of stashedChrome) {
      const list = byParent.get(entry.parent) ?? []
      list.push({ item: entry.item, index: entry.index })
      byParent.set(entry.parent, list)
    }
    for (const [parent, list] of byParent) {
      list.sort((a, b) => a.index - b.index)
      for (const { item, index } of list) {
        parent.insertChild(Math.min(index, parent.children.length), item)
      }
    }
  }
}

export function restoreSnapshot(e: EditorEngine, snapshot: string | Record<string, unknown> | unknown[]) {
  restoreSnapshotWithMeta(e, snapshot, null)
}

/**
 * Restore paper state plus, when provided, the document metadata riding
 * alongside history entries (artboards, bleed, page size) so board ops
 * participate in undo/redo like artwork ops do.
 */
function restoreSnapshotWithMeta(
  e: EditorEngine,
  snapshot: string | Record<string, unknown> | unknown[],
  meta: HistoryDocMeta | null
) {
  // Project#importJSON appends a fresh layer stack whenever it runs (its
  // layer-merge path only triggers for an empty active layer of matching
  // type), so the project must be cleared first or every undo/redo would
  // duplicate the whole document.
  e.clearIsolationState()
  e.project.clear()
  // History snapshots carry image tokens (see snapshotProject): inflate
  // them from the session sidecar. Full-fidelity payloads (project files,
  // pre-diet snapshots) pass through untouched.
  const raw = typeof snapshot === 'string' ? (JSON.parse(snapshot) as unknown) : snapshot
  e.project.importJSON(inflateHistoryImages(raw, e.historyImageStore) as string)
  if (meta) {
    const page = meta.pageSize
    if (page && Number.isFinite(page.width) && Number.isFinite(page.height) && page.width > 0 && page.height > 0) {
      e.store.setPageSize(page.width, page.height)
    }
    e.store.setBleed(Number(meta.bleed) || 0)
    if (Array.isArray(meta.artboards) && meta.artboards.length > 0) {
      e.store.setArtboards(meta.artboards.map((b) => ({ ...b })))
      if (typeof meta.activeArtboardId === 'string') {
        e.store.setActiveArtboard(meta.activeArtboardId)
      }
    }
  }
  // Paste offsets step from the source: restart the stepping after any
  // restore so undo/redo cannot walk pastes out of the viewport.
  e.resetPasteOffset()
  // Isolation hides ride in snapshots as plain visible=false: lift the
  // flagged ones so undo during isolation cannot hide artwork forever
  // (the mode itself is already dropped above).
  for (const item of walkUserItems(e)) {
    if ((item.data as any)?.isolationHidden) {
      item.visible = true
      delete (item.data as any).isolationHidden
    }
  }
  e.geometryVersion++
  e.syncLayersToStore()
  e.syncSelectionToStore()
  e.refreshArtboards()
  e.scope.view.update()
}

/** Document metadata snapshot riding alongside each history entry. */
export function captureDocMeta(e: EditorEngine): HistoryDocMeta {
  return {
    artboards: e.store.artboards.map((board) => ({ ...board })),
    activeArtboardId: e.store.activeArtboardId,
    bleed: Number(e.store.bleed) || 0,
    pageSize: { ...e.store.pageSize },
  }
}

export function pushHistory(e: EditorEngine, name: string, icon: string = '') {
  const snapshot = snapshotProject(e)
  e.history = e.history.slice(0, e.historyIndex + 1)
  e.historySnapshots = e.historySnapshots.slice(0, e.historyIndex + 1)
  e.historySizes = e.historySizes.slice(0, e.historyIndex + 1)
  e.historyMeta = e.historyMeta.slice(0, e.historyIndex + 1)
  e.history.push({ name, icon, timestamp: Date.now() })
  e.historySnapshots.push(snapshot)
  e.historySizes.push(snapshot?.length ?? 0)
  e.historyMeta.push(captureDocMeta(e))
  const limit = e.store.historyLimit || 100
  const evict = evictCountForBudget(e.historySizes, MAX_HISTORY_BYTES, limit, MIN_HISTORY_ENTRIES)
  for (let i = 0; i < evict; i++) {
    e.history.shift()
    e.historySnapshots.shift()
    e.historySizes.shift()
    e.historyMeta.shift()
  }
  e.historyIndex = e.history.length - 1
  e.store.setHistory(e.history, e.historyIndex)
  e.store.bumpRevision()
  if (!FRAME_SAFE_HISTORY.has(name)) {
    e.geometryVersion++
    // Invalidate snap cache when document geometry changes.
    snapService.invalidateCache()
  }
}

/**
 * Record a history entry, coalescing with the previous one when it shares
 * the name and landed inside `windowMs`. Lets held-down keys (nudge)
 * share one undo step instead of flooding the history panel.
 */
export function pushCoalescedHistory(e: EditorEngine, name: string, windowMs = 1200) {
  const now = Date.now()
  const last = e.history[e.historyIndex]
  // Only coalesce with the top of the stack. After an undo the cursor sits
  // mid-stack, and merging into that past entry overwrote its snapshot
  // while the redo branch behind it stayed — redo then jumped to a state
  // that no longer matched its own baseline.
  const atTop = e.historyIndex === e.history.length - 1
  if (atTop && last && last.name === name && now - last.timestamp < windowMs) {
    const snapshot = snapshotProject(e)
    e.historySnapshots[e.historyIndex] = snapshot
    e.historySizes[e.historyIndex] = snapshot?.length ?? 0
    e.historyMeta[e.historyIndex] = captureDocMeta(e)
    last.timestamp = now
    e.store.setHistory(e.history, e.historyIndex)
    e.store.bumpRevision()
    enforceHistoryBudget(e)
  } else {
    pushHistory(e, name)
  }
}

/** Evict oldest entries until the stack fits count + byte budgets. */
function enforceHistoryBudget(e: EditorEngine): void {
  const limit = e.store.historyLimit || 100
  const evict = evictCountForBudget(e.historySizes, MAX_HISTORY_BYTES, limit, MIN_HISTORY_ENTRIES)
  for (let i = 0; i < evict; i++) {
    e.history.shift()
    e.historySnapshots.shift()
    e.historySizes.shift()
    e.historyMeta.shift()
  }
  e.historyIndex = e.history.length - 1
  e.store.setHistory(e.history, e.historyIndex)
}

export function undo(e: EditorEngine) {
  if (e.historyIndex > 0) {
    e.historyIndex--
    restoreSnapshotWithMeta(
      e,
      e.historySnapshots[e.historyIndex],
      e.historyMeta[e.historyIndex] ?? null
    )
    e.store.setHistoryIndex(e.historyIndex)
    e.store.bumpRevision()
    // Invalidate snap cache after undo (document geometry may have changed).
    snapService.invalidateCache()
  }
}

export function redo(e: EditorEngine) {
  if (e.historyIndex < e.history.length - 1) {
    e.historyIndex++
    restoreSnapshotWithMeta(
      e,
      e.historySnapshots[e.historyIndex],
      e.historyMeta[e.historyIndex] ?? null
    )
    e.store.setHistoryIndex(e.historyIndex)
    e.store.bumpRevision()
    // Invalidate snap cache after redo (document geometry may have changed).
    snapService.invalidateCache()
  }
}

/**
 * Jump the document to a history entry. Snapshots are whole-project
 * JSON, so a direct restore is equivalent to replaying every step and
 * stays O(1) even for far jumps.
 */
export function jumpToHistory(e: EditorEngine, index: number): void {
  if (e.history.length === 0) return
  const clamped = Math.min(e.history.length - 1, Math.max(0, index))
  if (clamped === e.historyIndex) return
  e.historyIndex = clamped
  restoreSnapshotWithMeta(
    e,
    e.historySnapshots[e.historyIndex],
    e.historyMeta[e.historyIndex] ?? null
  )
  e.store.setHistoryIndex(e.historyIndex)
  e.store.bumpRevision()
}

/** Drop the whole history stack (history panel clear action). */
export function clearHistory(e: EditorEngine): void {
  e.history = []
  e.historySnapshots = []
  e.historySizes = []
  e.historyMeta = []
  e.historyIndex = -1
  e.store.setHistory([], -1)
  // Clearing drops undo history; the document content itself is untouched,
  // so the dirty flag must keep its previous value. It used to call
  // markSaved() here, which reported an edited document as saved and
  // suppressed the New/Open/reload warnings right after losing undo.
  e.clearSelection()
  e.clearIsolationState()
  e.clearThumbCache()
}

/** Drop the whole history stack and start over with a single entry. */
export function resetHistory(e: EditorEngine, name: string): void {
  e.history = []
  e.historySnapshots = []
  e.historySizes = []
  e.historyMeta = []
  e.historyIndex = -1
  e.store.setHistory([], -1)
  // Bitmap stash is keyed by item id and belongs to the outgoing document.
  e.clearImageStash()
  // Same for the history image sidecar: the new baseline snapshot
  // re-registers the live document's pixels on the pushHistory below.
  e.historyImageStore.clear()
  pushHistory(e, name)
  e.markSaved()
}
