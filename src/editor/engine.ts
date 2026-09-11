/**
 * EditorEngine - Vue/Pinia ↔ Paper.js bridge hub
 */
import paper from 'paper'
import { PaperOffset } from 'paperjs-offset'
import type { ToolName, StyleState, LayerMeta, LayerItemNode, ArtboardMeta, SymbolEntry, HistoryEntry, GuideOrientation, ProjectFileData, ReferencePoint, AlignMode, DistributeAxis, BooleanOperation, RasterExportOptions, GradientState, PatternFillState, EnvelopePreset } from './types'
import { createDefaultStyle } from './store'
import { cursorForTool } from './cursors'
import { gradientAngleFromVector, linearGradientEndpoints, normalizeAngleDeg } from './geometry'
import { changeCaseText } from './text/text-case'
import { colorDistanceRgb, invertCssColor, isOutOfCmykGamut, parseCssColor, rgbToCmyk, shiftCssColor } from './color'
import { parseProjectFile } from './project-file'
import type { EditorStore } from './store-types'

/** Identifier stamped into every saved project file. */
const PROJECT_FILE_APP = 'vue-vector-editor'
/** Current project file format version. */
const PROJECT_FILE_VERSION = 2

/** Document metadata snapshotted alongside each history entry. */
export interface HistoryDocMeta {
  artboards: ArtboardMeta[]
  activeArtboardId: string
  bleed: number
  pageSize: { width: number; height: number }
}

export class EditorEngine {
  project!: paper.Project
  scope!: paper.PaperScope
  canvas!: HTMLCanvasElement
  store: EditorStore

  private toolName: ToolName = 'select'

  private overlayLayer: paper.Layer | null = null
  private annotationLayer: paper.Layer | null = null
  private guideLayer: paper.Layer | null = null
  private gridLayer: paper.Layer | null = null

  zoom = 1
  center = { x: 0, y: 0 }

  private controllers: Map<ToolName, any> = new Map()

  /** Callback invoked whenever view changes (zoom, pan, etc). */
  onViewChange: (() => void) | null = null

  history: HistoryEntry[] = []
  historyIndex = -1
  private historySnapshots: string[] = []
  /** Document metadata riding alongside each paper snapshot (undoable). */
  private historyMeta: Array<HistoryDocMeta | null> = []

  constructor(canvas: HTMLCanvasElement, store: EditorStore) {
    this.canvas = canvas
    this.store = store

    this.scope = new paper.PaperScope()
    this.scope.setup(canvas)
    this.project = this.scope.project

    this.setupProject()
    this.initLayers()
    if (this.store.artboards.length === 0) {
      const page = this.store.pageSize
      const id = this.genId()
      this.store.setArtboards([
        { id, name: 'Artboard 1', x: 0, y: 0, width: page.width, height: page.height },
      ])
      this.store.setActiveArtboard(id)
    }
    this.refreshArtboards()
    // Seed the cached transform from Paper's authoritative view so the
    // first pan/zoom never starts from a stale (0,0) origin.
    this.syncViewBookkeeping()
  }

  private setupProject() {
    // Grid layer sits at the very bottom (behind user content).
    this.gridLayer = new this.scope.Layer()
    this.gridLayer.name = 'grid'
    this.gridLayer.locked = true
    this.gridLayer.data.isUserLayer = false
    this.gridLayer.data.isGridLayer = true
    this.gridLayer.visible = false

    const userLayer = new this.scope.Layer()
    userLayer.name = 'Layer 1'
    userLayer.data.isUserLayer = true
    userLayer.data.layerId = this.genId()
    userLayer.activate()

    this.overlayLayer = new this.scope.Layer()
    this.overlayLayer.name = 'overlay'
    this.overlayLayer.locked = true
    this.overlayLayer.data.isUserLayer = false

    this.annotationLayer = new this.scope.Layer()
    this.annotationLayer.name = 'annotation'
    this.annotationLayer.locked = true
    this.annotationLayer.data.isUserLayer = false

    this.guideLayer = new this.scope.Layer()
    this.guideLayer.name = 'guides'
    this.guideLayer.locked = true
    this.guideLayer.data.isUserLayer = false
    this.guideLayer.visible = this.store.view.showGuides

    // Keep the grid layer at the very bottom of the stacking order
    if (this.gridLayer) {
      this.gridLayer.sendToBack()
    }
    userLayer.activate()
  }

  private initLayers() {
    const layers: LayerMeta[] = []
    for (const layer of this.project.layers) {
      if (layer.data.isUserLayer) {
        layers.push({
          id: layer.data.layerId as string,
          name: layer.name || 'Layer',
          visible: layer.visible,
          locked: layer.locked,
          opacity: layer.opacity,
          isUserLayer: true,
          expand: true,
        })
      }
    }
    this.store.syncLayers(layers)
  }

  genId(): string {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36)
  }

  // ===== Artboards =====

  /**
   * Redraw artboard page sheets from the store (white sheets with name
   * labels on a dedicated locked layer below user artwork). Visuals carry
   * data.isArtboard so hit tests skip them; the layer hides in exports
   * like every other non-user layer.
   */
  refreshArtboards(): void {
    const scope = this.scope
    let layer = this.project.layers.find(
      (l) => (l.data as any)?.isArtboardLayer
    ) as paper.Layer | undefined
    if (!layer || !layer.parent) {
      layer = new scope.Layer()
      layer.name = 'artboards'
      layer.data.isUserLayer = false
      layer.data.isArtboardLayer = true
    }
    const users = this.project.layers.filter((l) => (l.data as any)?.isUserLayer)
    if (users.length > 0) layer.insertBelow(users[0])

    // Locked layers reject children: unlock around the redraw like guides.
    layer.locked = false
    layer.removeChildren()
    const zoom = scope.view.zoom || 1
    for (const board of this.store.artboards) {
      if (!(board.width > 0 && board.height > 0)) continue
      const active = board.id === this.store.activeArtboardId
      const rect = new scope.Path.Rectangle(
        new scope.Rectangle(board.x, board.y, board.width, board.height)
      ) as paper.Path
      rect.fillColor = new scope.Color('#ffffff')
      rect.strokeColor = new scope.Color(active ? '#4a90d9' : '#8a8a8a')
      rect.strokeWidth = (active ? 1.5 : 1) / zoom
      rect.data.isArtboard = true
      layer.addChild(rect)
      const bleed = Number(this.store.bleed) || 0
      if (bleed > 0) {
        const bleedRect = new scope.Path.Rectangle(
          new scope.Rectangle(board.x - bleed, board.y - bleed, board.width + bleed * 2, board.height + bleed * 2)
        ) as paper.Path
        bleedRect.fillColor = null
        bleedRect.strokeColor = new scope.Color('#e5484d')
        bleedRect.strokeWidth = 1 / zoom
        bleedRect.dashArray = [4 / zoom, 3 / zoom]
        bleedRect.data.isArtboard = true
        layer.addChild(bleedRect)
      }
      const label = new scope.PointText({
        point: new scope.Point(board.x, board.y - 6 / zoom),
        content: board.name,
        fontFamily: 'Arial',
        fontSize: 12 / zoom,
        justification: 'left',
        fillColor: '#999999',
      }) as paper.PointText
      label.data.isArtboard = true
      layer.addChild(label)
    }
    layer.locked = true
    scope.view.update()
  }

  /**
   * Rename an artboard with history. Returns false when missing or
   * unchanged so callers stay silent then.
   */
  renameArtboard(boardId: string, name: string): boolean {
    const next = (name ?? '').trim() || 'Artboard'
    const board = this.store.artboards.find((b) => b.id === boardId)
    if (!board || board.name === next) return false
    this.store.updateArtboard(boardId, { name: next })
    this.refreshArtboards()
    this.pushHistory('Rename Artboard')
    this.scope.view.update()
    return true
  }

  /**
   * Move an artboard sheet with history. With `withArtwork`, overlapping
   * unlocked artwork travels by the same delta (AI move-with-art parity).
   * Returns false when missing, invalid or unmoved.
   */
  moveArtboard(boardId: string, x: number, y: number, opts?: { withArtwork?: boolean }): boolean {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false
    const board = this.store.artboards.find((b) => b.id === boardId)
    if (!board || (board.x === x && board.y === y)) return false
    const dx = x - board.x
    const dy = y - board.y
    this.store.updateArtboard(boardId, { x, y })
    if (opts?.withArtwork && (dx !== 0 || dy !== 0)) {
      const before = new this.scope.Rectangle(board.x, board.y, board.width, board.height)
      const shift = new this.scope.Point(dx, dy)
      const moved: paper.Item[] = []
      for (const layer of this.project.layers) {
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
          this.refreshItemGradient(c)
          moved.push(c)
        }
      }
      if (moved.length > 0) this.reflowTextsForItems(moved)
    }
    this.refreshArtboards()
    this.pushHistory('Move Artboard')
    this.scope.view.update()
    return true
  }

  /**
   * Resize an artboard sheet with history (Canvas Settings drive the
   * active board). Dimensions clamp to 1–16384; unchanged sizes stay
   * silent. Returns false when nothing changed.
   */
  resizeArtboard(boardId: string, width: number, height: number): boolean {
    if (!Number.isFinite(width) || !Number.isFinite(height)) return false
    const w = Math.min(16384, Math.max(1, Math.round(width)))
    const h = Math.min(16384, Math.max(1, Math.round(height)))
    const board = this.store.artboards.find((b) => b.id === boardId)
    if (!board || (board.width === w && board.height === h)) return false
    this.store.updateArtboard(boardId, { width: w, height: h })
    this.refreshArtboards()
    this.pushHistory('Resize Artboard')
    this.scope.view.update()
    return true
  }

  /**
   * Duplicate an artboard sheet plus the artwork overlapping it (AI
   * duplicate-artboard parity). The copy lands beside the source with an
   * offset clone of every intersecting top-level user item (fresh ids,
   * thread links remapped inside the cloned set, selection preserved).
   * Returns false when the board is missing.
   */
  duplicateArtboard(boardId: string): boolean {
    const scope = this.scope
    const src = this.store.artboards.find((b) => b.id === boardId)
    if (!src || !(src.width > 0) || !(src.height > 0)) return false
    const names = new Set(this.store.artboards.map((b) => b.name))
    let base = `${src.name} copy`
    let n = 2
    while (names.has(base)) {
      base = `${src.name} copy ${n}`
      n++
    }
    const board = {
      id: this.genId(),
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
    for (const layer of this.project.layers) {
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
      const parent = item.parent ?? this.getActiveLayer()
      const clone = (item as any).clone({ insert: false }) as paper.Item
      clone.translate(new scope.Point(dx, dy))
      const walk = (node: paper.Item) => {
        const data = (node as any).data ?? ((node as any).data = {})
        if (data.id || data.isUserItem) {
          const fresh = this.genId()
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
    this.store.addArtboard(board)
    for (const { node, parent } of clones) {
      ;(parent as paper.Item).addChild(node)
    }
    this.refreshArtboards()
    if (clones.length > 0) {
      this.clearSelection()
      for (const { node } of clones) node.selected = true
      this.syncSelectionToStore()
    }
    this.pushHistory('Duplicate Artboard')
    this.scope.view.update()
    return true
  }

  /**
   * Shrink-wrap the artboard around its overlapping artwork (AI Fit to
   * Artwork Bounds parity). Padding expands the united bounds; empty
   * boards stay silent. Returns false when nothing fits.
   */
  fitArtboardToArtwork(boardId: string, padding = 20): boolean {
    const board = this.store.artboards.find((b) => b.id === boardId)
    if (!board) return false
    const pad = Number.isFinite(padding) ? Math.min(500, Math.max(0, padding)) : 20
    const rect = new this.scope.Rectangle(board.x, board.y, board.width, board.height)
    const hits: paper.Rectangle[] = []
    for (const layer of this.project.layers) {
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
    this.store.updateArtboard(boardId, {
      x: Math.round((united.x - pad) * 10) / 10,
      y: Math.round((united.y - pad) * 10) / 10,
      width: w,
      height: h,
    })
    this.refreshArtboards()
    this.pushHistory('Fit Artboard to Artwork')
    this.scope.view.update()
    return true
  }

  /**
   * Lay every artboard out in a single X-sorted row with even spacing
   * (AI Rearrange Artboards, one-row v1). Records one history entry.
   */
  arrangeArtboards(spacing = 100): boolean {
    const boards = this.store.artboards
    if (boards.length === 0) return false
    const gap = Number.isFinite(spacing) ? Math.min(2000, Math.max(0, spacing)) : 100
    const ordered = boards.slice().sort((a, b) => a.x - b.x || a.y - b.y)
    let cursor = ordered[0].x
    for (const board of ordered) {
      if (board.x !== cursor) this.store.updateArtboard(board.id, { x: Math.round(cursor * 10) / 10 })
      cursor += board.width + gap
    }
    this.refreshArtboards()
    this.pushHistory('Arrange Artboards')
    this.scope.view.update()
    return true
  }

  /** Center the view on a document point (artboard activation). */
  panViewTo(point: paper.Point): void {
    this.scope.view.center = point.clone()
    this.syncViewBookkeeping()
    this.refreshGrid()
    this.scope.view.update()
    this.emitViewChange()
  }

  /**
   * Mirror Paper's authoritative view state (center / zoom) into the
   * engine's cached `center` (document-space top-left) + `zoom`.
   * All view mutations must go through here so later pan/zoom steps,
   * rulers and grid never operate on a stale transform (stale caches
   * made post-zoom pans crawl or jump).
   */
  syncViewBookkeeping(): void {
    const v = this.scope.view
    const zoom = v.zoom || 1
    const bounds = v.bounds
    this.zoom = zoom
    this.center = {
      x: v.center.x - bounds.width / 2,
      y: v.center.y - bounds.height / 2,
    }
  }

  setTool(tool: ToolName) {
    this.toolName = tool
    // Leaving the selection tools: hand paper.js back its native decoration
    // first, otherwise suppressed items would stay invisible (no native blue
    // and no custom chrome) until the next select-tool activation.
    if (tool !== 'select' && tool !== 'direct-select') {
      const selectCtrl = this.controllers.get('select') as { releaseNativeSuppressions?: () => void } | undefined
      try {
        selectCtrl?.releaseNativeSuppressions?.()
      } catch {
        // Never block tool switches on chrome bookkeeping.
      }
    }
    // Remove any transient editing chrome (e.g. anchor overlays) left over
    // by the previously active tool so it does not linger after switching.
    this.clearTransientChrome()
    // Park the AI-aligned default cursor for the new tool; the controller's
    // activate() may refine it (e.g. zoom-out with Alt, brush ring sizes).
    // Setting it here covers controllers that never touch the cursor.
    this.canvas.style.cursor = cursorForTool(tool)
    const controller = this.controllers.get(tool)
    if (controller) {
      controller.activate?.()
    }
  }

  /** Remove temporary overlay layers used for editing feedback. */
  clearTransientChrome() {
    for (const layer of this.project.layers) {
      if ((layer.data as any)?.isChromeRoot) {
        layer.remove()
      }
    }
  }

  registerController(toolName: ToolName, controller: any) {
    this.controllers.set(toolName, controller)
    if (controller.attachEngine) {
      controller.attachEngine(this)
    }
  }

  /** Look up the controller registered for a tool, or null. */
  getController(toolName: ToolName): any | null {
    return this.controllers.get(toolName) ?? null
  }

  /**
   * Current selection reduced to top-most members. Paper groups propagate
   * the selected flag to their whole subtree (`_selectChildren`), so the
   * raw list contains every descendant — operating on those as well would
   * apply every transform/copy/order op twice (once via the group, once
   * directly). All document ops go through here and therefore treat a
   * selected group as one unit, like Illustrator.
   */
  getSelection(): paper.Item[] {
    return this.topmostItems(this.project.selectedItems as paper.Item[])
  }

  /** Drop items nested inside another included item (selection de-dup). */
  private topmostItems(items: paper.Item[]): paper.Item[] {
    if (items.length < 2) return items.slice()
    const set = new Set(items)
    return items.filter((item) => {
      let at = item.parent
      while (at) {
        if (set.has(at as paper.Item)) return false
        at = at.parent
      }
      return true
    })
  }

  clearSelection() {
    this.project.deselectAll()
    this.store.clearSelection()
    this.refreshSelectionChrome()
  }

  selectItem(item: paper.Item, addToSelection = false) {
    if (!addToSelection) {
      this.project.deselectAll()
    }
    item.selected = true
    this.syncSelectionToStore()
  }

  /**
   * Restore an id list as the selection, skipping missing items (AI
   * Reselect / saved-selection loading). Returns how many were selected.
   */
  selectByIds(ids: string[]): number {
    let n = 0
    this.project.deselectAll()
    for (const id of ids) {
      const item = this.getItemById(id)
      if (!item || (item as any).locked) continue
      item.selected = true
      n++
    }
    this.syncSelectionToStore()
    this.scope.view.update()
    return n
  }

  /** Re-select the previous selection (AI Select > Reselect parity). */
  reselect(): number {
    const ids = [...(this.store.lastSelection ?? [])]
    if (ids.length === 0) return 0
    return this.selectByIds(ids)
  }

  syncSelectionToStore() {
    const ids = this.topmostItems(this.project.selectedItems as paper.Item[]).map(
      (item) => (item as any).data?.id as string
    )
    this.store.setSelection(ids.filter(Boolean))
    this.refreshSelectionChrome()
  }

  /**
   * Repaint the select / direct-select chrome after a selection change that
   * bypassed the tool's own mouse handlers (Layers panel, undo/redo,
   * shortcuts, history jumps). No-op unless a selection tool is active so
   * pen / shape previews are never clobbered.
   */
  refreshSelectionChrome() {
    if (this.toolName !== 'select' && this.toolName !== 'direct-select' && this.toolName !== 'lasso' && this.toolName !== 'free-transform') return
    const ctrl = this.controllers.get(this.toolName) as { refreshSelectionChrome?: () => void } | undefined
    try {
      ctrl?.refreshSelectionChrome?.()
    } catch {
      // Chrome repaint must never break document ops.
    }
  }

  syncLayersToStore() {
    const prevExpand = new Map(this.store.layers.map((l) => [l.id, l.expand]))
    const layers: LayerMeta[] = []
    for (const layer of this.project.layers) {
      if (layer.data?.isUserLayer) {
        const id = layer.data.layerId as string
        layers.push({
          id,
          name: layer.name || 'Layer',
          visible: layer.visible,
          locked: layer.locked,
          opacity: layer.opacity,
          isUserLayer: true,
          // Keep the panel fold state across syncs (undo/import/duplicates
          // rebuild the list from the project and would expand everything).
          expand: prevExpand.get(id) ?? true,
        })
      }
    }
    this.store.syncLayers(layers)
  }

  getActiveLayer(): paper.Layer {
    const activeId = this.store.activeLayerId
    if (activeId) {
      const layer = this.project.layers.find((l) => (l.data as any)?.layerId === activeId)
      if (layer) return layer
    }
    const userLayers = this.project.layers.filter((l) => (l.data as any)?.isUserLayer)
    const found = userLayers[userLayers.length - 1]
    if (found) return found
    // Degenerate stacks (bad imports, cleared projects) must never hand
    // 30+ call sites an undefined layer: rebuild one silent user layer.
    const layer = new this.scope.Layer()
    layer.name = 'Layer 1'
    layer.data.isUserLayer = true
    layer.data.layerId = this.genId()
    this.parkUserLayer(layer)
    layer.activate()
    this.syncLayersToStore()
    this.store.setActiveLayer(layer.data.layerId as string)
    return layer
  }

  createLayer(name?: string): paper.Layer {
    const layer = new this.scope.Layer()
    layer.name = (name ?? '').trim() || this.nextUserLayerName()
    layer.data.isUserLayer = true
    layer.data.layerId = this.genId()
    // `new Layer()` appends at the very top of the stack (above guides and
    // overlay chrome, which would bury interaction feedback). Park the layer
    // on top of the user band instead.
    this.parkUserLayer(layer)
    layer.activate()
    this.syncLayersToStore()
    this.pushHistory('New Layer')
    this.scope.view.update()
    return layer
  }

  /** First unused "Layer N" name across user layers. */
  private nextUserLayerName(): string {
    const users = this.project.layers.filter((l) => (l.data as any)?.isUserLayer)
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
  private parkUserLayer(layer: paper.Layer): void {    const users = this.project.layers.filter(
      (l) => (l.data as any)?.isUserLayer && l !== layer
    )
    if (users.length > 0) {
      layer.insertAbove(users[users.length - 1])
      return
    }
    const chrome = this.project.layers.find((l) => !(l.data as any)?.isUserLayer && l !== layer)
    if (chrome) layer.insertBelow(chrome)
  }

  /**
   * Duplicate a user layer with its artwork right above the source. Every
   * document id in the copy is restamped so selection and history never
   * confuse originals with clones.
   */
  duplicateLayer(layerId: string): void {
    const source = this.project.layers.find((l) => (l.data as any)?.layerId === layerId)
    if (!source || !(source.data as any)?.isUserLayer) return
    const clone = source.clone({ insert: false }) as paper.Layer
    clone.data.layerId = this.genId()
    clone.name = `${source.name || 'Layer'} copy`
    this.restampCloneTree(clone)
    clone.insertAbove(source)
    clone.activate()
    this.syncLayersToStore()
    this.store.setActiveLayer(clone.data.layerId as string)
    this.pushHistory('Duplicate Layer')
    this.scope.view.update()
  }

  deleteLayer(layerId: string): boolean {
    const layer = this.project.layers.find((l) => (l.data as any)?.layerId === layerId)
    if (!layer) return false
    layer.remove()
    this.clearSelection()
    this.syncLayersToStore()
    this.pointActiveLayerAtRestoredStack()
    this.pushHistory('Delete Layer')
    this.scope.view.update()
    return true
  }

  /**
   * Layer visibility / lock / rename with store sync and history (the panel
   * used to write these straight through, leaving them un-undoable and
   * overwritable by the next undo). Labels reuse the object-op names so the
   * entries stay frame-safe. Each returns false when nothing changed.
   */
  setUserLayerVisible(layerId: string, visible: boolean): boolean {
    const layer = this.project.layers.find((l) => (l.data as any)?.layerId === layerId)
    if (!layer || layer.visible === visible) return false
    layer.visible = visible
    this.store.updateLayer(layerId, { visible })
    this.pushHistory(visible ? 'Show' : 'Hide')
    this.scope.view.update()
    return true
  }

  setUserLayerLocked(layerId: string, locked: boolean): boolean {
    const layer = this.project.layers.find((l) => (l.data as any)?.layerId === layerId)
    if (!layer || layer.locked === locked) return false
    layer.locked = locked
    this.store.updateLayer(layerId, { locked })
    this.pushHistory(locked ? 'Lock' : 'Unlock')
    this.scope.view.update()
    return true
  }

  renameUserLayer(layerId: string, name: string): boolean {
    const next = (name ?? '').trim() || 'Layer'
    const layer = this.project.layers.find((l) => (l.data as any)?.layerId === layerId)
    if (!layer || layer.name === next) return false
    layer.name = next
    this.store.updateLayer(layerId, { name: next })
    this.pushHistory('Rename')
    this.scope.view.update()
    return true
  }

  /**
   * Solo a user layer (AI Alt-click eye/lock parity): visibility solos
   * toggle (hide the rest, or restore all when already solo); lock solos
   * one-way (Unlock All restores). Returns false for unknown layers.
   */
  soloUserLayer(layerId: string, mode: 'visible' | 'locked'): boolean {
    const users = this.project.layers.filter((l) => (l.data as any)?.isUserLayer)
    const target = users.find((l) => (l.data as any)?.layerId === layerId)
    if (!target) return false
    if (mode === 'locked') {
      let changed = false
      for (const layer of users) {
        const id = (layer.data as any)?.layerId as string
        if (id === layerId || layer.locked) continue
        layer.locked = true
        this.store.updateLayer(id, { locked: true })
        changed = true
      }
      if (!changed) return false
      this.pushHistory('Lock Others')
      this.scope.view.update()
      return true
    }
    const others = users.filter((l) => (l.data as any)?.layerId !== layerId)
    if (others.length > 0 && others.every((l) => !l.visible)) {
      for (const layer of users) {
        const id = (layer.data as any)?.layerId as string
        if (layer.visible) continue
        layer.visible = true
        this.store.updateLayer(id, { visible: true })
      }
      if (!target.visible) {
        target.visible = true
        this.store.updateLayer(layerId, { visible: true })
      }
      this.pushHistory('Show All Layers')
    } else {
      for (const layer of others) {
        const id = (layer.data as any)?.layerId as string
        if (!layer.visible) continue
        layer.visible = false
        this.store.updateLayer(id, { visible: false })
      }
      if (!target.visible) {
        target.visible = true
        this.store.updateLayer(layerId, { visible: true })
      }
      this.pushHistory('Solo Layer')
    }
    this.scope.view.update()
    return true
  }

  getOverlayLayer(): paper.Layer {
    if (this.overlayLayer && this.project.layers.includes(this.overlayLayer)) {
      return this.overlayLayer
    }
    // Top-level layers never carry .parent (they sit directly on the
    // project), so a parent check would recreate the layer on every call.
    // Reuse the existing overlay by name instead, like the guide layer does.
    const existing = this.project.layers.find(
      (l) => l.name === 'overlay' && !(l.data as any)?.isUserLayer
    ) as paper.Layer | undefined
    this.overlayLayer = existing ?? new this.scope.Layer()
    this.overlayLayer.name = 'overlay'
    this.overlayLayer.locked = true
    this.overlayLayer.data.isUserLayer = false
    return this.overlayLayer
  }

  getAnnotationLayer(): paper.Layer {
    if (this.annotationLayer && this.project.layers.includes(this.annotationLayer)) {
      return this.annotationLayer
    }
    const existing = this.project.layers.find(
      (l) => l.name === 'annotation' && !(l.data as any)?.isUserLayer
    ) as paper.Layer | undefined
    this.annotationLayer = existing ?? new this.scope.Layer()
    this.annotationLayer.name = 'annotation'
    this.annotationLayer.locked = true
    this.annotationLayer.data.isUserLayer = false
    return this.annotationLayer
  }

  getGuideLayer(): paper.Layer {
    if (this.guideLayer && this.project.layers.includes(this.guideLayer)) {
      return this.guideLayer
    }
    {
      // After an import/undo the layer object may have been replaced;
      // locate the existing guides layer by name if present.
      const existing = this.project.layers.find(
        (l) => l.name === 'guides' && !(l.data as any)?.isUserLayer
      ) as paper.Layer | undefined
      this.guideLayer = existing ?? new this.scope.Layer()
      this.guideLayer.name = 'guides'
      this.guideLayer.locked = true
      this.guideLayer.data.isUserLayer = false
      this.guideLayer.visible = this.store.view.showGuides
      // Keep guides above artwork but below overlay/anchor chrome
      this.guideLayer.bringToFront()
      const userLayers = this.project.layers.filter((l) => (l.data as any)?.isUserLayer)
      const lastUser = userLayers[userLayers.length - 1]
      if (lastUser) {
        this.guideLayer.insertAbove(lastUser)
      }
    }
    return this.guideLayer
  }

  /** Whether an item is a guide line. */
  isGuide(item: paper.Item): boolean {
    return !!(item && (item.data as any)?.isGuide)
  }

  /** All guide items currently on the guide layer. */
  getGuides(): paper.Path[] {
    const layer = this.getGuideLayer()
    const out: paper.Path[] = []
    if (!layer) return out
    layer.children.forEach((child: any) => {
      if ((child as any).data?.isGuide) out.push(child as paper.Path)
    })
    return out
  }

  /** Guide orientation of a guide item, or null if it is not a guide. */
  getGuideOrientation(item: paper.Item): GuideOrientation | null {
    if (!this.isGuide(item)) return null
    return (item.data as any)?.guideOrientation as GuideOrientation
  }

  /** Document coordinate along the guide's free axis. */
  getGuidePosition(item: paper.Item): number {
    const orientation = this.getGuideOrientation(item)
    if (!orientation) return 0
    const segs = (item as paper.Path).segments
    if (!segs || segs.length === 0) return 0
    if (orientation === 'vertical') {
      return segs[0].point.x
    }
    return segs[0].point.y
  }

  /** Keep guide strokes at hairline width across zooms (selected = 2px). */
  refreshGuideWidths(): void {
    const guides = this.getGuides()
    if (guides.length === 0) return
    const z = this.scope.view.zoom || 1
    const sc = this.controllers.get('select') as
      | { guides?: { getSelectedGuides?: () => paper.Item[] } }
      | undefined
    let selected: paper.Item[] = []
    try {
      selected = sc?.guides?.getSelectedGuides?.() ?? []
    } catch {
      selected = []
    }
    const selSet = new Set(selected)
    const layer = this.getGuideLayer()
    if (!layer) return
    const wasLocked = layer.locked
    layer.locked = false
    try {
      for (const guide of guides) {
        ;(guide as any).strokeWidth = (selSet.has(guide as paper.Item) ? 2 : 1) / z
      }
    } finally {
      layer.locked = wasLocked
    }
  }

  /** Move a guide to a new document position along its free axis. */
  moveGuide(item: paper.Item, position: number) {
    if (!this.isGuide(item) || !(item instanceof this.scope.Path)) return
    const path = item as paper.Path
    const orientation = this.getGuideOrientation(item)
    const s0 = path.segments[0]
    const s1 = path.segments[path.segments.length - 1]
    if (!s0 || !s1) return

    const layer = this.getGuideLayer()
    const wasLocked = layer ? layer.locked : false
    if (layer) layer.locked = false
    try {
      if (orientation === 'horizontal') {
        // Horizontal guide: line is (a, y) - (b, y); update y.
        ;(s0 as any).point.y = position
        ;(s1 as any).point.y = position
      } else if (orientation === 'vertical') {
        ;(s0 as any).point.x = position
        ;(s1 as any).point.x = position
      }
    } finally {
      if (layer) layer.locked = wasLocked
      this.scope.view.update()
    }
  }

  /**
   * Create a guide line on the guide layer.
   * Vertical guides sit at a document X and run vertically;
   * horizontal guides sit at a document Y and run horizontally.
   * Guides span a huge document range so they stay visible through
   * pan/zoom operations.
   */
  createGuide(position: number, orientation: GuideOrientation): paper.Path | null {
    const scope = this.scope
    const layer = this.getGuideLayer()
    if (!layer) return null

    const span = 1e6 // document units on each side
    const p1 = new scope.Point(-span, position)
    const p2 = new scope.Point(span, position)
    if (orientation === 'vertical') {
      p1.x = position
      p1.y = -span
      p2.x = position
      p2.y = span
    }

    const line = new scope.Path.Line(p1, p2) as paper.Path
    line.data.isGuide = true
    line.data.guideId = this.genId()
    line.data.guideOrientation = orientation
    line.strokeColor = new scope.Color('#00bcd4') // cyan
    line.strokeWidth = 1 / this.zoom
    line.strokeCap = 'butt'
    line.locked = false
    line.data.isUserLayer = false

    // Unlock temporarily so we can add to the locked guide layer
    layer.locked = false
    try {
      layer.addChild(line)
    } finally {
      layer.locked = true
    }

    this.scope.view.update()
    return line
  }

  /** Delete a guide item from the guide layer. */
  deleteGuide(guide: paper.Path) {
    const layer = this.getGuideLayer()
    if (!layer) return
    layer.locked = false
    try {
      guide.remove()
    } finally {
      layer.locked = true
      this.scope.view.update()
    }
  }

  /** Every guide as plain data (id / orientation / position), top-first. */
  listGuides(): Array<{ id: string; orientation: GuideOrientation; position: number }> {
    const layer = this.getGuideLayer()
    if (!layer) return []
    const out: Array<{ id: string; orientation: GuideOrientation; position: number }> = []
    for (const child of layer.children) {
      const data = (child as any).data ?? {}
      if (!data.isGuide) continue
      const orientation = (data.guideOrientation === 'vertical' ? 'vertical' : 'horizontal') as GuideOrientation
      const segs = (child as paper.Path).segments
      const p = segs.length > 0 ? (segs[0] as any).point : null
      if (!p) continue
      const position = orientation === 'vertical' ? Number(p.x) : Number(p.y)
      if (!Number.isFinite(position)) continue
      out.push({ id: String(data.guideId ?? ''), orientation, position: Math.round(position * 10) / 10 })
    }
    return out.reverse()
  }

  /** Move a guide by id; false when the id is unknown. Callers record history. */
  moveGuideById(id: string, position: number): boolean {
    if (!id || !Number.isFinite(position)) return false
    const layer = this.getGuideLayer()
    if (!layer) return false
    const guide = layer.children.find((c) => String((c as any).data?.guideId ?? '') === id)
    if (!guide) return false
    this.moveGuide(guide as paper.Item, position)
    return true
  }

  /** Delete a guide by id; false when the id is unknown. Callers record history. */
  deleteGuideById(id: string): boolean {
    if (!id) return false
    const layer = this.getGuideLayer()
    if (!layer) return false
    const guide = layer.children.find((c) => String((c as any).data?.guideId ?? '') === id)
    if (!guide || !(guide instanceof this.scope.Path)) return false
    this.deleteGuide(guide as paper.Path)
    return true
  }

  /** Remove all guides from the guide layer. */
  clearGuides() {
    const layer = this.getGuideLayer()
    if (!layer) return
    layer.locked = false
    try {
      layer.removeChildren()
    } finally {
      layer.locked = true
      this.scope.view.update()
    }
  }

  /** Set guide-layer visibility according to the current store setting. */
  refreshGuides() {
    const layer = this.getGuideLayer()
    if (!layer) return
    layer.visible = this.store.view.showGuides
    this.scope.view.update()
  }

  /** Pending rAF grid rebuild (coalesces rapid zoom/pan ticks). */
  private gridRaf = 0
  /** Cache key of the last drawn grid; identical views skip the rebuild. */
  private lastGridKey = ''

  /**
   * Grid layer, adopted or created on demand. Never leaves a duplicate
   * behind (old snapshots may restore one) and never steals the active
   * layer — `new Layer()` activates itself, which used to divert later
   * artwork into the grid layer after undo / new-document flows.
   */
  private ensureGridLayer(): paper.Layer {
    const flagged = this.project.layers.filter((l) => (l.data as any)?.isGridLayer)
    let layer =
      this.gridLayer && this.gridLayer.parent
        ? this.gridLayer
        : (flagged[0] as paper.Layer | undefined) ?? null
    for (const dup of flagged) {
      if (dup !== layer) dup.remove()
    }
    if (!layer || !layer.parent) {
      const prevActive = this.project.activeLayer
      layer = new this.scope.Layer()
      layer.name = 'grid'
      layer.locked = true
      layer.data.isUserLayer = false
      layer.data.isGridLayer = true
      if (prevActive && prevActive.parent) prevActive.activate()
      else {
        const fallback = this.getActiveLayer()
        if (fallback && fallback.parent) fallback.activate()
      }
    }
    layer.name = 'grid'
    layer.locked = true
    layer.data.isUserLayer = false
    layer.data.isGridLayer = true
    layer.sendToBack()
    this.gridLayer = layer
    return layer
  }

  /**
   * Draw a line grid covering exactly the visible viewport.
   * `view.bounds` is already in project coordinates. The step grows
   * adaptively (always a multiple of gridSize, so lines stay on the
   * real grid) to cap the total line count when zoomed out.
   */
  private drawGrid(gridSize: number) {
    if (!this.gridLayer) return

    const v = this.scope.view
    const b = v.bounds
    if (!(b.width > 0) || !(b.height > 0)) return

    const base = gridSize > 0 ? gridSize : 10
    let step = base
    // Cap total lines so zoomed-out views stay cheap (<= ~600 Paths).
    while ((b.width / step + b.height / step) > 600) step *= 2

    // Skip the rebuild when the visible grid did not change (e.g. a zoom
    // tick that lands on the same lines, or a redundant refresh call).
    const key = [
      Math.floor(b.x / step),
      Math.floor(b.y / step),
      Math.ceil((b.x + b.width) / step),
      Math.ceil((b.y + b.height) / step),
      step,
    ].join(',')
    if (key === this.lastGridKey) return
    this.lastGridKey = key

    this.gridLayer.removeChildren()

    const minorColor = new this.scope.Color('#555555')
    minorColor.alpha = 0.18
    const majorColor = new this.scope.Color('#555555')
    majorColor.alpha = 0.4
    const lineWidth = 1 / (v.zoom || 1)
    const minorStyle = {
      strokeColor: minorColor,
      strokeWidth: lineWidth,
      strokeCap: 'round' as 'round' | 'square' | 'butt',
    }
    const majorStyle = {
      strokeColor: majorColor,
      strokeWidth: lineWidth,
      strokeCap: 'round' as 'round' | 'square' | 'butt',
    }

    const left = Math.floor(b.x / step) * step
    const right = b.x + b.width
    const top = Math.floor(b.y / step) * step
    const bottom = b.y + b.height
    /** AI-style major line every 5 steps (display only; snap stays on base). */
    const isMajor = (coord: number): boolean => Math.round(coord / step) % 5 === 0

    // Draw vertical grid lines
    for (let x = left; x <= right; x += step) {
      const line = new this.scope.Path.Line(
        new this.scope.Point(x, top),
        new this.scope.Point(x, bottom)
      )
      line.set(isMajor(x) ? majorStyle : minorStyle)
      line.data.isGridItem = true
      this.gridLayer.addChild(line)
    }

    // Draw horizontal grid lines
    for (let y = top; y <= bottom; y += step) {
      const line = new this.scope.Path.Line(
        new this.scope.Point(left, y),
        new this.scope.Point(right, y)
      )
      line.set(isMajor(y) ? majorStyle : minorStyle)
      line.data.isGridItem = true
      this.gridLayer.addChild(line)
    }

    this.gridLayer.locked = true
  }

  /**
   * Redraw the grid based on current zoom and view settings.
   * Rebuilds are coalesced to one per animation frame so wheel-zoom and
   * pan gestures (dozens of ticks per second) never rebuild the grid
   * more than the screen can display. Hiding applies immediately.
   */
  refreshGrid() {
    if (!this.store.view.showGrid) {
      if (this.gridRaf) {
        cancelAnimationFrame(this.gridRaf)
        this.gridRaf = 0
      }
      if (this.gridLayer && (this.gridLayer.visible || this.gridLayer.children.length > 0)) {
        this.gridLayer.visible = false
        this.gridLayer.removeChildren()
        this.scope.view.update()
      }
      this.lastGridKey = ''
      return
    }
    if (this.gridRaf) return
    this.gridRaf = requestAnimationFrame(() => {
      this.gridRaf = 0
      if (!this.store.view.showGrid) return
      const layer = this.ensureGridLayer()
      layer.visible = true
      this.drawGrid(this.store.snap.gridSize || 10)
      this.scope.view.update()
    })
  }

  /** Notify listeners that the view has changed (zoom / pan). */
  emitViewChange() {
    this.onViewChange?.()
  }

  screenToCanvas(point: paper.Point): paper.Point {
    // Screen (canvas pixel) -> document: top-left cache + pixel / zoom.
    const zoom = this.zoom || 1
    return new this.scope.Point(
      this.center.x + point.x / zoom,
      this.center.y + point.y / zoom
    )
  }

  canvasToScreen(point: paper.Point): paper.Point {
    // Document -> screen (canvas pixel).
    const zoom = this.zoom || 1
    return new this.scope.Point(
      (point.x - this.center.x) * zoom,
      (point.y - this.center.y) * zoom
    )
  }

  panBy(dx: number, dy: number) {
    // dx/dy arrive in document units (hand tool + middle-drag both diff
    // viewToProject points). The view center lives in the same space, so
    // shift it 1:1 — dividing by zoom again would shrink post-zoom pans
    // toward zero and feel like a freeze when zoomed in.
    const v = this.scope.view
    v.center = v.center.subtract(new this.scope.Point(dx, dy))
    this.syncViewBookkeeping()
    this.refreshGrid()
    this.emitViewChange()
  }

  private updateViewCenter() {
    const v = this.scope.view
    // engine.center is the document-space top-left; the Paper center sits
    // half a viewport (already in document units via bounds) to its right.
    const bounds = v.bounds
    const center = new this.scope.Point(
      this.center.x + bounds.width / 2,
      this.center.y + bounds.height / 2
    )
    v.center = center
  }

  /**
   * Zoom by a factor around the screen point (canvasX, canvasY) given in
   * canvas pixel coordinates. When no reference point is provided the view
   * zooms about its center. The resulting zoom is synced back to the store
   * so the status-bar percentage stays accurate.
   */
  zoomAt(scale: number, canvasX?: number, canvasY?: number) {
    const v = this.scope.view
    const oldZoom = v.zoom || 1
    const newZoom = Math.max(0.01, Math.min(64, oldZoom * scale))
    if (newZoom === oldZoom) return

    const W = this.canvas.width
    const H = this.canvas.height
    const zoomAtCenter = typeof canvasX !== 'number' || typeof canvasY !== 'number'

    // Document point that sits under the reference screen point (before zooming).
    let anchorX = v.center.x
    let anchorY = v.center.y
    if (!zoomAtCenter) {
      anchorX = v.center.x + (canvasX - W / 2) / oldZoom
      anchorY = v.center.y + (canvasY - H / 2) / oldZoom
    }

    v.zoom = newZoom
    if (!zoomAtCenter) {
      // Keep the anchor's document point fixed on screen while zooming.
      v.center = new this.scope.Point(
        anchorX - (canvasX - W / 2) / newZoom,
        anchorY - (canvasY - H / 2) / newZoom
      )
    }

    this.zoom = newZoom
    // Mirror the authoritative Paper transform (bounds are already in
    // document units — no extra division by zoom here).
    this.syncViewBookkeeping()

    v.update()
    this.refreshGrid()
    this.refreshGuideWidths()
    this.store.updateView({ zoom: newZoom })
    this.emitViewChange()
  }

  fitToContent() {
    this.fitBounds(this.unitedBoundsOf(this.getUserItems()))
  }

  /** Fit the view to the current selection bounds (View menu). */
  zoomToSelection(): void {
    this.fitBounds(this.getSelectionBounds())
  }

  /** Fit the view to the active artboard sheet (View menu). */
  zoomToArtboard(): void {
    this.fitBounds(this.getActiveArtboardRect())
  }

  /** Reset the view zoom to 100% (View menu, Ctrl+1). */
  zoomToActualSize(): void {
    this.zoom = 1
    this.scope.view.zoom = 1
    this.syncViewBookkeeping()
    this.store.updateView({ zoom: 1 })
    this.scope.view.update()
    this.refreshGrid()
    this.emitViewChange()
  }

  /** Zoom the view to frame bounds with padding (ignores empty bounds). */
  private fitBounds(bounds: paper.Rectangle | null): void {
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return
    const padding = 50
    const zoom = Math.min(
      (this.canvas.width - padding * 2) / bounds.width,
      (this.canvas.height - padding * 2) / bounds.height,
      100
    )
    const v = this.scope.view
    v.zoom = zoom
    v.center = bounds.center.clone()
    this.syncViewBookkeeping()
    v.update()
    this.refreshGrid()
    this.refreshGuideWidths()
    this.store.updateView({ zoom: this.zoom })
    this.emitViewChange()
  }

  getUserItems(): paper.Item[] {
    const items: paper.Item[] = []
    for (const layer of this.project.layers) {
      if ((layer.data as any)?.isUserLayer && layer.visible) {
        layer.children.forEach((child: any) => {
          if (child.visible && !child.data?.isPreview) items.push(child)
        })
      }
    }
    return items
  }

  applyStyleToItem(item: paper.Item, style: StyleState) {
    // Pattern groups own their fill (motifs + background); a solid/gradient
    // paint must not leak into the tiles. Stroke/opacity/blend still apply.
    if (this.isPatternGroup(item)) {
      const paperStyle: any = {}
      if (style.strokeColor) paperStyle.strokeColor = style.strokeColor
      else paperStyle.strokeColor = null
      paperStyle.strokeWidth = style.strokeWidth
      paperStyle.strokeCap = style.lineCap
      paperStyle.strokeJoin = style.lineJoin
      paperStyle.miterLimit = style.miterLimit
      if (style.dashArray && style.dashArray.length > 0) paperStyle.dashArray = style.dashArray
      paperStyle.opacity = style.opacity
      paperStyle.blendMode = style.blendMode
      item.set(paperStyle)
      return
    }
    const paperStyle: any = {}
    const gradientFill = this.gradientFillForItem(item, style)
    if (gradientFill) paperStyle.fillColor = gradientFill
    else if (style.fillColor) paperStyle.fillColor = style.fillColor
    else paperStyle.fillColor = null
    if (style.fillRule) paperStyle.fillRule = style.fillRule
    if (style.strokeColor) paperStyle.strokeColor = style.strokeColor
    else paperStyle.strokeColor = null
    paperStyle.strokeWidth = style.strokeWidth
    paperStyle.strokeCap = style.lineCap
    paperStyle.strokeJoin = style.lineJoin
    paperStyle.miterLimit = style.miterLimit
    if (style.dashArray && style.dashArray.length > 0) paperStyle.dashArray = style.dashArray
    else paperStyle.dashArray = []
    paperStyle.dashOffset = Number.isFinite(style.dashOffset) ? style.dashOffset : 0
    paperStyle.opacity = style.opacity
    paperStyle.blendMode = style.blendMode
    item.set(paperStyle)
  }

  /**
   * Build a gradient fill anchored to the item bounds (linear runs at the
   * stored angle about the bounds center, default 0 = left→right; radial
   * spans the larger half-extent), or null when no gradient applies.
   * Radial colors always carry an explicit highlight so linear vs radial
   * stays detectable on readback.
   */
  private gradientFillForItem(item: paper.Item, style: StyleState): paper.Color | null {
    const gradient = style.gradient
    if (!gradient || gradient.stops.length === 0) return null
    const scope = this.scope
    const bounds = (item as any).bounds as paper.Rectangle | undefined
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
    const stops = gradient.stops.map(
      (stop) => new scope.GradientStop(new scope.Color(stop.color), stop.offset)
    )
    // The bundled typings omit the Gradient constructor overloads, so the
    // gradient is assembled through its declared properties instead.
    const paperGradient = new scope.Gradient()
    paperGradient.stops = stops
    paperGradient.radial = gradient.type === 'radial'
    if (gradient.type === 'radial') {
      const center = bounds.center
      const radius = Math.max(bounds.width, bounds.height) / 2
      const edge = new scope.Point(center.x + radius, center.y)
      return new scope.Color(paperGradient, center, edge, center.clone()) as paper.Color
    }
    const angle = normalizeAngleDeg(gradient.angle ?? 0)
    const e = linearGradientEndpoints(bounds.center.x, bounds.center.y, bounds.width, bounds.height, angle)
    const origin = new scope.Point(e.x1, e.y1)
    const destination = new scope.Point(e.x2, e.y2)
    return new scope.Color(paperGradient, origin, destination) as paper.Color
  }

  /** Read a baked gradient back into parameters (stops + angle survive). */
  private gradientFromItem(item: paper.Item): GradientState | null {
    const fill = (item as any).fillColor as any
    if (!fill || !fill.gradient) return null
    const stops = (fill.gradient.stops as any[]).map((stop) => ({
      offset: Number(stop.offset ?? 0),
      color: (stop.color && this.colorToCSS(stop.color)) || '#000000',
    }))
    if (stops.length === 0) return null
    if (fill.highlight) return { type: 'radial', stops }
    const o = fill.origin as any
    const d = fill.destination as any
    const angle = o && d
      ? gradientAngleFromVector(Number(d.x) - Number(o.x), Number(d.y) - Number(o.y))
      : 0
    return { type: 'linear', stops, angle: Math.round(angle) }
  }

  /**
   * Re-anchor a baked gradient fill to the item's current bounds (linear
   * keeps its angle, radial recenters). Non-gradient fills are
   * untouched. Call after any geometry change so gradients travel with
   * their objects instead of staying pinned to old bounds.
   */
  refreshItemGradient(item: paper.Item): void {
    const params = this.gradientFromItem(item)
    if (!params) return
    const rebuilt = this.gradientFillForItem(item, { gradient: params } as StyleState)
    if (rebuilt) (item as any).fillColor = rebuilt
  }

  /**
   * Re-layout path-text runs attached to moved/reshaped items (AI: text
   * follows its path). Piggybacks the caller's history entry. Never
   * throws: text bookkeeping must not break document ops.
   */
  reflowTextsForItems(items: paper.Item[]): void {
    try {
      const tc = this.getController('type') as {
        reflowPathTextsForPaths?: (targets: paper.Item[]) => void
      } | null
      tc?.reflowPathTextsForPaths?.(items)
    } catch {
      // Ignore: a stale text run never blocks the geometry op.
    }
  }

  getStyleFromItem(item: paper.Item): StyleState {
    const style = createDefaultStyle()
    const s = item as any
    const pattern = this.getPatternFromItem(item)
    if (pattern) {
      style.pattern = { ...pattern }
      style.fillColor = null
      style.gradient = null
    } else {
      const baked = this.gradientFromItem(item)
      if (baked) {
        style.fillColor = null
        style.gradient = baked
      } else {
        style.fillColor = this.colorToCSS(s.fillColor)
      }
    }
    style.strokeColor = this.colorToCSS(s.strokeColor)
    style.strokeWidth = s.strokeWidth ?? style.strokeWidth
    style.lineCap = (s.strokeCap as any) ?? style.lineCap
    style.lineJoin = (s.strokeJoin as any) ?? style.lineJoin
    style.miterLimit = s.miterLimit ?? style.miterLimit
    style.dashArray = Array.isArray(s.dashArray) ? [...s.dashArray] : style.dashArray
    style.dashOffset = Number.isFinite(s.dashOffset) ? s.dashOffset : style.dashOffset
    style.fillRule = s.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'
    style.blendMode = (s.blendMode as any) ?? style.blendMode
    style.opacity = s.opacity ?? style.opacity
    return style
  }

  // ===== Pattern fills (AI-style swatches via clipped tile groups) =====
  //
  // Paper.js has no native pattern paint, so a pattern fill is a plain
  // Group: [mask path (clipMask, paint stashed in data.maskPaint),
  // background clone (optional), motif tiles (no data.id so the layer tree
  // skips them)]. The group carries data.isPatternFill + data.pattern, so
  // it survives JSON snapshots, Save/Open and SVG export as clipped art.

  /** Pattern params when the item is (or is inside) a pattern group. */
  getPatternFromItem(item: paper.Item): PatternFillState | null {
    let node: paper.Item | null = item
    while (node && !(node instanceof this.scope.Layer)) {
      const data = (node.data as any) ?? {}
      if (data.isPatternFill && data.pattern) {
        const p = data.pattern as PatternFillState
        return {
          kind: p.kind,
          color: p.color,
          background: p.background ?? null,
          scale: Number.isFinite(p.scale) ? p.scale : 1,
          angle: Number.isFinite(p.angle) ? p.angle : 0,
        }
      }
      node = node.parent
    }
    return null
  }

  /** Whether an item is a pattern-fill group. */
  isPatternGroup(item: paper.Item): boolean {
    return (
      item instanceof this.scope.Group &&
      !!((item.data as any)?.isPatternFill)
    )
  }

  /**
   * Apply a pattern fill to every selected unlocked Path/CompoundPath.
   * Already-patterned selections are re-tiled in place (params update).
   * Returns how many shapes now carry the pattern.
   */
  applyPatternFill(pattern: PatternFillState): number {
    const scope = this.scope
    const targets = this.getSelection().filter((i) => !i.locked && i.parent)
    if (targets.length === 0) return 0
    let applied = 0
    const next: paper.Item[] = []
    for (const target of targets) {
      if (this.isPatternGroup(target)) {
        ;(target.data as any).pattern = { ...pattern }
        this.retilePatternGroup(target as paper.Group)
        applied++
        next.push(target)
      } else if (
        target instanceof scope.Path ||
        target instanceof scope.CompoundPath
      ) {
        const group = this.buildPatternGroup(
          target as paper.PathItem,
          { ...pattern }
        )
        if (group) {
          applied++
          next.push(group)
        } else {
          next.push(target)
        }
      } else {
        next.push(target)
      }
    }
    if (applied > 0) {
      this.clearSelection()
      next.forEach((item) => { item.selected = true })
      this.syncSelectionToStore()
      this.store.updateStyle({ pattern: { ...pattern }, fillColor: null, gradient: null })
      this.pushHistory('Pattern Fill')
      this.scope.view.update()
    }
    return applied
  }

  /**
   * Remove pattern fills from the selection, restoring each mask path with
   * its stashed background/solid paint. Returns how many groups removed.
   */
  removePatternFill(): number {
    const groups = this.getSelection().filter(
      (i) => !i.locked && i.parent && this.isPatternGroup(i)
    ) as paper.Group[]
    if (groups.length === 0) return 0
    const restored: paper.Item[] = []
    for (const group of groups) {
      const base = this.releasePatternGroup(group)
      if (base) restored.push(base)
    }
    this.clearSelection()
    restored.forEach((item) => { item.selected = true })
    this.syncSelectionToStore()
    this.store.updateStyle({ pattern: null })
    this.pushHistory('Remove Pattern')
    this.scope.view.update()
    return restored.length
  }

  /** Build a pattern group from a plain path (caller handles selection). */
  private buildPatternGroup(
    source: paper.PathItem,
    pattern: PatternFillState
  ): paper.Group | null {
    const scope = this.scope
    const bounds = (source as any).bounds as paper.Rectangle | undefined
    if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return null
    const parent = source.parent ?? this.getActiveLayer()
    const at = Math.max(0, parent.children.indexOf(source))
    const mask = source.clone({ insert: false }) as paper.PathItem
    const maskAny = mask as any
    maskAny.data = { ...(maskAny.data ?? {}), id: (source.data as any)?.id ?? this.genId() }
    maskAny.data.maskPaint = {
      fill: this.cssOrNull(maskAny.fillColor),
      stroke: this.cssOrNull(maskAny.strokeColor),
      width: Number(maskAny.strokeWidth) || 0,
    }
    source.remove()
    const group = new scope.Group({ insert: false }) as paper.Group
    group.addChild(mask)
    mask.clipMask = true
    if (maskAny.fillColor !== undefined) maskAny.fillColor = null
    if (maskAny.strokeColor !== undefined) maskAny.strokeColor = null
    if (pattern.background) {
      const bg = mask.clone({ insert: false }) as paper.PathItem
      const bgAny = bg as any
      bgAny.clipMask = false
      if (bgAny.data) delete bgAny.data.id
      bgAny.data = { ...(bgAny.data ?? {}), isPatternTile: true }
      bgAny.fillColor = pattern.background
      if (bgAny.strokeColor !== undefined) bgAny.strokeColor = null
      group.addChild(bg)
    }
    group.data.id = this.genId()
    group.data.isUserItem = true
    group.data.isPatternFill = true
    group.data.pattern = { ...pattern }
    parent.insertChild(Math.min(at, parent.children.length), group)
    this.tilePatternGroup(group)
    return group
  }

  /** Regenerate tiles for new params (keeps mask + background slot). */
  private retilePatternGroup(group: paper.Group): void {
    const pattern = (group.data as any)?.pattern as PatternFillState | undefined
    if (!pattern) return
    const children = group.children.slice()
    // Child 0 is the clip mask; child 1 may be the background clone.
    for (let i = children.length - 1; i >= 1; i--) {
      const child = children[i] as any
      if (child?.data?.isPatternTile) child.remove()
    }
    const mask = group.children[0] as paper.PathItem
    if (pattern.background && mask) {
      const bg = (mask.clone({ insert: false }) as any) as paper.PathItem
      bg.clipMask = false
      if (bg.data) delete (bg.data as any).id
      ;(bg.data as any).isPatternTile = true
      ;(bg as any).fillColor = pattern.background
      if ((bg as any).strokeColor !== undefined) (bg as any).strokeColor = null
      group.insertChild(1, bg)
    }
    this.tilePatternGroup(group)
  }

  /** Generate motif tiles covering the mask bounds (capped at ~2000). */
  private tilePatternGroup(group: paper.Group): void {
    const scope = this.scope
    const pattern = (group.data as any)?.pattern as PatternFillState | undefined
    const mask = group.children[0] as paper.Item | undefined
    const bounds = (mask as any)?.bounds as paper.Rectangle | undefined
    if (!pattern || !bounds || !(bounds.width > 0) || !(bounds.height > 0)) return
    const scale = Math.min(4, Math.max(0.25, Number(pattern.scale) || 1))
    let step = 12 * scale
    const pad = step * 2
    const x0 = bounds.x - pad
    const y0 = bounds.y - pad
    const x1 = bounds.x + bounds.width + pad
    const y1 = bounds.y + bounds.height + pad
    let cols = Math.max(1, Math.ceil((x1 - x0) / step))
    let rows = Math.max(1, Math.ceil((y1 - y0) / step))
    // Cap total motifs so huge boards never freeze the tab.
    let guard = 0
    while (cols * rows > 2000 && guard < 8) {
      step *= 1.5
      cols = Math.max(1, Math.ceil((x1 - x0) / step))
      rows = Math.max(1, Math.ceil((y1 - y0) / step))
      guard++
    }
    const color = pattern.color || '#000000'
    const mk = (item: paper.Item): void => {
      const anyItem = item as any
      if (anyItem.data) delete anyItem.data.id
      anyItem.data = { ...(anyItem.data ?? {}), isPatternTile: true }
      if (anyItem.fillColor !== undefined) anyItem.fillColor = color
      if (anyItem.strokeColor !== undefined) anyItem.strokeColor = color
      anyItem.locked = false
      group.addChild(item)
    }
    const angle = ((Number(pattern.angle) || 0) % 360 + 360) % 360
    const rotateAbout = bounds.center
    const spin = (item: paper.Item): void => {
      if (angle !== 0) item.rotate(angle, rotateAbout)
    }
    if (pattern.kind === 'dots') {
      const r = Math.max(0.6, 1.6 * scale)
      for (let ix = 0; ix < cols; ix++) {
        for (let iy = 0; iy < rows; iy++) {
          const c = new scope.Point(x0 + (ix + 0.5) * step, y0 + (iy + 0.5) * step)
          const dot = new scope.Path.Circle({ center: c, radius: r, insert: false })
          const dAny = dot as any
          dAny.strokeColor = null
          dAny.strokeWidth = 0
          mk(dot)
        }
      }
    } else if (pattern.kind === 'stripes' || pattern.kind === 'grid' || pattern.kind === 'crosshatch') {
      const w = Math.max(0.6, 1.2 * scale)
      const diag = Math.hypot(x1 - x0, y1 - y0)
      const cx = (x0 + x1) / 2
      const cy = (y0 + y1) / 2
      const line = (xA: number, yA: number, xB: number, yB: number): void => {
        const p = new scope.Path({ insert: false })
        p.moveTo(new scope.Point(xA, yA))
        p.lineTo(new scope.Point(xB, yB))
        const pAny = p as any
        pAny.fillColor = null
        pAny.strokeColor = color
        pAny.strokeWidth = w
        spin(p)
        mk(p)
      }
      if (pattern.kind === 'stripes') {
        for (let iy = 0; iy <= rows; iy++) {
          const y = y0 + iy * step
          line(cx - diag, y, cx + diag, y)
        }
      } else {
        for (let iy = 0; iy <= rows; iy++) {
          const y = y0 + iy * step
          line(x0, y, x1, y)
        }
        for (let ix = 0; ix <= cols; ix++) {
          const x = x0 + ix * step
          line(x, y0, x, y1)
        }
        if (pattern.kind === 'crosshatch') {
          for (let k = -rows; k <= cols + rows; k++) {
            const xA = x0 + k * step
            line(xA, y0, xA + (y1 - y0), y1)
          }
          void cy
        }
      }
      // Stripes honour the angle via per-line rotation above; grid /
      // crosshatch keep axis alignment and use angle as 0 (documented).
      void cx
    }
  }

  /** Dissolve one pattern group back to its base path (tiles dropped). */
  private releasePatternGroup(group: paper.Group): paper.Item | null {
    const parent = group.parent ?? this.getActiveLayer()
    const at = Math.max(0, parent.children.indexOf(group))
    const mask = group.children[0] as any
    if (!mask) {
      group.remove()
      return null
    }
    const pattern = (group.data as any)?.pattern as PatternFillState | undefined
    mask.clipMask = false
    const paint = mask.data?.maskPaint as
      | { fill: string | null; stroke: string | null; width: number }
      | undefined
    if (mask.fillColor !== undefined) {
      mask.fillColor = pattern?.background ?? paint?.fill ?? null
    }
    if (mask.strokeColor !== undefined) {
      mask.strokeColor = paint?.stroke ?? null
      if (Number.isFinite(paint?.width)) mask.strokeWidth = paint!.width
    }
    if (mask.data) delete mask.data.maskPaint
    if (!mask.data?.id) mask.data.id = this.genId()
    mask.data.isUserItem = true
    parent.insertChild(Math.min(at, parent.children.length), mask)
    group.remove()
    return mask as paper.Item
  }

  // ===== History =====

  snapshotProject(): string {
    return this.withCleanScene(() => this.project.exportJSON({ asString: true }))
  }

  /** Snapshot as a plain object for v2 project files (no double encoding). */
  snapshotProjectObject(): Record<string, unknown> {
    return this.withCleanScene(
      () => (this.project as any).exportJSON({ asString: false }) as Record<string, unknown>
    )
  }

  /**
   * Run `fn` with regenerable scene content detached: grid lines plus
   * editing chrome and drag previews. Everything is re-attached in order
   * afterwards, so history snapshots and project files stay lean.
   */
  private withCleanScene<T>(fn: () => T): T {
    // Grid lines are regenerable view cache: keep them out of history and
    // project files (they used to bloat snapshots and resurrect as stale
    // duplicates after undo). Children are stashed and restored in order.
    const grid =
      this.gridLayer && this.gridLayer.parent ? this.gridLayer : null
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
    for (const layer of this.project.layers.slice()) collect(layer as paper.Item)
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

  restoreSnapshot(snapshot: string | Record<string, unknown>) {
    this.restoreSnapshotWithMeta(snapshot, null)
  }

  /**
   * Restore paper state plus, when provided, the document metadata riding
   * alongside history entries (artboards, bleed, page size) so board ops
   * participate in undo/redo like artwork ops do.
   */
  private restoreSnapshotWithMeta(
    snapshot: string | Record<string, unknown>,
    meta: HistoryDocMeta | null
  ) {
    // Project#importJSON appends a fresh layer stack whenever it runs (its
    // layer-merge path only triggers for an empty active layer of matching
    // type), so the project must be cleared first or every undo/redo would
    // duplicate the whole document.
    this.clearIsolationState()
    this.project.clear()
    this.project.importJSON(snapshot as string)
    if (meta) {
      const page = meta.pageSize
      if (page && Number.isFinite(page.width) && Number.isFinite(page.height) && page.width > 0 && page.height > 0) {
        this.store.setPageSize(page.width, page.height)
      }
      this.store.setBleed(Number(meta.bleed) || 0)
      if (Array.isArray(meta.artboards) && meta.artboards.length > 0) {
        this.store.setArtboards(meta.artboards.map((b) => ({ ...b })))
        if (typeof meta.activeArtboardId === 'string') {
          this.store.setActiveArtboard(meta.activeArtboardId)
        }
      }
    }
    // Paste offsets step from the source: restart the stepping after any
    // restore so undo/redo cannot walk pastes out of the viewport.
    this.pasteCount = 0
    // Isolation hides ride in snapshots as plain visible=false: lift the
    // flagged ones so undo during isolation cannot hide artwork forever
    // (the mode itself is already dropped above).
    for (const item of this.walkUserItems()) {
      if ((item.data as any)?.isolationHidden) {
        item.visible = true
        delete (item.data as any).isolationHidden
      }
    }
    this.geometryVersion++
    this.syncLayersToStore()
    this.syncSelectionToStore()
    this.refreshArtboards()
    this.scope.view.update()
  }

  /**
   * Monotonic document-geometry version. The select tool's oriented bbox
   * frame is only ever rebuilt from the axis-aligned bounds when this
   * counter (or the selection identity) no longer matches the frame's
   * snapshot — so any same-selection geometry change that the frame cannot
   * track incrementally must bump it (see pushHistory / restoreSnapshot).
   */
  geometryVersion = 0

  /** History entries that provably preserve selection geometry (no reset). */
  private static readonly FRAME_SAFE_HISTORY = new Set([
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

  /** Bump the geometry version (invalidates untracked selection frames). */
  bumpGeometryVersion() {
    this.geometryVersion++
  }

  pushHistory(name: string, icon: string = '') {
    const snapshot = this.snapshotProject()
    this.history = this.history.slice(0, this.historyIndex + 1)
    this.historySnapshots = this.historySnapshots.slice(0, this.historyIndex + 1)
    this.historyMeta = this.historyMeta.slice(0, this.historyIndex + 1)
    this.history.push({ name, icon, timestamp: Date.now() })
    this.historySnapshots.push(snapshot)
    this.historyMeta.push(this.captureDocMeta())
    const limit = this.store.historyLimit || 100
    if (this.history.length > limit) {
      this.history.shift()
      this.historySnapshots.shift()
      this.historyMeta.shift()
    }
    this.historyIndex = this.history.length - 1
    this.store.setHistory(this.history, this.historyIndex)
    if (!EditorEngine.FRAME_SAFE_HISTORY.has(name)) {
      this.geometryVersion++
    }
  }

  /** Document metadata snapshot riding alongside each history entry. */
  private captureDocMeta(): HistoryDocMeta {
    return {
      artboards: this.store.artboards.map((board) => ({ ...board })),
      activeArtboardId: this.store.activeArtboardId,
      bleed: Number(this.store.bleed) || 0,
      pageSize: { ...this.store.pageSize },
    }
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--
      this.restoreSnapshotWithMeta(
        this.historySnapshots[this.historyIndex],
        this.historyMeta[this.historyIndex] ?? null
      )
      this.store.setHistoryIndex(this.historyIndex)
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++
      this.restoreSnapshotWithMeta(
        this.historySnapshots[this.historyIndex],
        this.historyMeta[this.historyIndex] ?? null
      )
      this.store.setHistoryIndex(this.historyIndex)
    }
  }

  /**
   * Jump the document to a history entry. Snapshots are whole-project
   * JSON, so a direct restore is equivalent to replaying every step and
   * stays O(1) even for far jumps.
   */
  jumpToHistory(index: number): void {
    if (this.history.length === 0) return
    const clamped = Math.min(this.history.length - 1, Math.max(0, index))
    if (clamped === this.historyIndex) return
    this.historyIndex = clamped
    this.restoreSnapshotWithMeta(
      this.historySnapshots[this.historyIndex],
      this.historyMeta[this.historyIndex] ?? null
    )
    this.store.setHistoryIndex(this.historyIndex)
  }

  /** Drop the whole history stack (history panel clear action). */
  clearHistory(): void {
    this.history = []
    this.historySnapshots = []
    this.historyMeta = []
    this.historyIndex = -1
    this.store.setHistory([], -1)
    this.markSaved()
    this.clearSelection()
    this.clearIsolationState()
    this.thumbCache?.clear?.()
  }

  /** Mark the current history position as the saved (clean) revision. */
  markSaved(): void {
    this.store.setSavedRevision(this.store.historyIndex, this.store.history.length)
  }

  // ===== Document (Save/Open/New) =====

  /** Serialize the whole document into a versioned project file string. */
  exportProjectFile(): string {
    const data: ProjectFileData = {
      app: PROJECT_FILE_APP,
      version: PROJECT_FILE_VERSION,
      pageSize: { ...this.store.pageSize },
      bleed: Number(this.store.bleed) || 0,
      snapshot: this.snapshotProjectObject(),
      artboards: this.store.artboards.map((board) => ({ ...board })),
      activeArtboardId: this.store.activeArtboardId,
    }
    return JSON.stringify(data)
  }

  /**
   * Download the current document as a versioned project file. Shared by
   * File > Save / Save As and the Ctrl+S shortcut.
   */
  downloadProjectFile(filename?: string): void {
    const fileText = this.exportProjectFile()
    const blob = new Blob([fileText], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const clean = (filename ?? '').trim().replace(/[\\/:*?"<>|]+/g, '-')
    const stem = clean.replace(/(\.vec)?\.json$/i, '').slice(0, 80) || 'project'
    const a = document.createElement('a')
    a.href = url
    a.download = `${stem}.vec.json`
    // Firefox ignores clicks on detached anchors; the delayed revoke keeps
    // large files alive until the download starts.
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
    this.markSaved()
    this.showStatus('Project saved')
  }

  /**
   * Replace the current document with the content of a project file string.
   * Throws an Error with an English message when the file is invalid.
   */
  importProjectFile(fileText: string): void {
    // Parsing/validation is unit-tested pure logic; only apply below.
    const parsed = parseProjectFile(fileText, PROJECT_FILE_VERSION)
    const rawSnapshot = parsed.snapshot as unknown
    // Trial-restore first: importJSON throws on malformed snapshots AFTER
    // project.clear(), which used to wipe the open document with no way
    // back. Roll back to a backup snapshot when the file is unreadable.
    const backup = this.snapshotProject()
    try {
      // v1 snapshots are JSON strings, v2+ are nested objects; Paper
      // imports both, so old files keep opening.
      this.restoreSnapshot(rawSnapshot as string | Record<string, unknown>)
    } catch {
      try {
        this.restoreSnapshot(backup)
      } catch {
        // The backup came from our own exporter; a second failure means
        // the project itself is unusable, so surface the file error.
      }
      throw new Error('Invalid project file: snapshot unreadable')
    }
    const pageSize = parsed.pageSize
    if (
      pageSize &&
      Number.isFinite(pageSize.width) &&
      Number.isFinite(pageSize.height) &&
      pageSize.width > 0 &&
      pageSize.height > 0
    ) {
      this.store.setPageSize(pageSize.width, pageSize.height)
    }
    if (Number.isFinite(parsed.bleed)) {
      this.store.setBleed(Number(parsed.bleed))
    }
    this.restoreArtboards(parsed.artboards, parsed.activeArtboardId, pageSize)
    this.pointActiveLayerAtRestoredStack()
    this.clearSelection()
    this.clipboardItems = []
    this.pasteCount = 0
    this.resetHistory('Open Project')
    this.refreshArtboards()
    this.refreshGrid()
    this.refreshGuides()
    this.scope.view.update()
    this.emitViewChange()
  }

  /** Reset the document to an empty state with the given page size. */
  newDocument(width: number, height: number): void {
    const w = Number.isFinite(width) ? Math.min(16384, Math.max(1, Math.round(width))) : 1920
    const h = Number.isFinite(height) ? Math.min(16384, Math.max(1, Math.round(height))) : 1080
    this.clearIsolationState()
    this.project.clear()
    this.setupProject()
    this.initLayers()
    this.pointActiveLayerAtRestoredStack()
    this.store.setPageSize(w, h)
    const boardId = this.genId()
    this.store.setArtboards([
      { id: boardId, name: 'Artboard 1', x: 0, y: 0, width: w, height: h },
    ])
    this.store.setActiveArtboard(boardId)
    this.clearSelection()
    this.clipboardItems = []
    this.pasteCount = 0
    this.resetHistory('New Document')
    this.refreshArtboards()
    this.refreshGrid()
    this.refreshGuides()
    this.scope.view.update()
    this.emitViewChange()
  }

  /**
   * Load artboards from a project file (pre-artboard files fall back to a
   * single board from the page size). Parsing is tolerant: numeric strings
   * coerce, duplicate ids are suffixed, and only entries without any usable
   * geometry are dropped; an empty result keeps the current boards.
   */
  private restoreArtboards(
    raw: ArtboardMeta[] | undefined,
    activeId: string | undefined,
    pageSize: { width: number; height: number } | undefined
  ): void {
    const seenIds = new Set<string>()
    const clean = (Array.isArray(raw) ? raw : [])
      .map((board: any, index: number) => {
        if (!board || typeof board !== 'object') return null
        const x = Number(board.x)
        const y = Number(board.y)
        const width = Number(board.width)
        const height = Number(board.height)
        if (
          ![x, y, width, height].every((n) => Number.isFinite(n)) ||
          width <= 0 ||
          height <= 0
        ) {
          return null
        }
        let id = typeof board.id === 'string' && board.id ? board.id : this.genId()
        let dup = 1
        while (seenIds.has(id)) id = `${board.id}#${dup++}`
        seenIds.add(id)
        return {
          id,
          name: typeof board.name === 'string' && board.name.trim() ? board.name : `Artboard ${index + 1}`,
          x,
          y,
          width,
          height,
        }
      })
      .filter((board): board is ArtboardMeta => board !== null)
    if (clean.length === 0) {
      const page = pageSize ?? this.store.pageSize
      if (Number.isFinite(page.width) && Number.isFinite(page.height) && page.width > 0 && page.height > 0) {
        const id = this.genId()
        this.store.setArtboards([
          { id, name: 'Artboard 1', x: 0, y: 0, width: page.width, height: page.height },
        ])
        this.store.setActiveArtboard(id)
      }
      return
    }
    this.store.setArtboards(clean)
    this.store.setActiveArtboard(
      clean.some((board) => board.id === activeId) ? (activeId as string) : clean[0].id
    )
  }

  /**
   * Point the active layer id at the restored layer stack. Import and New
   * replace the whole layer stack, so a previously stored id may no longer
   * exist; fall back to the topmost user layer in that case.
   */
  private pointActiveLayerAtRestoredStack(): void {
    const activeId = this.store.activeLayerId
    const stillExists =
      !!activeId &&
      this.project.layers.some((l) => (l.data as any)?.layerId === activeId)
    if (stillExists) return
    const userLayers = this.project.layers.filter((l) => (l.data as any)?.isUserLayer)
    const last = userLayers[userLayers.length - 1]
    if (last) {
      this.store.setActiveLayer((last.data as any)?.layerId as string)
    }
  }

  /** Drop the whole history stack and start over with a single entry. */
  private resetHistory(name: string): void {
    this.history = []
    this.historySnapshots = []
    this.historyMeta = []
    this.historyIndex = -1
    this.store.setHistory([], -1)
    this.pushHistory(name)
    this.markSaved()
  }

  /**
   * Move a user layer to a position in the user band (0 = bottom).
   * Only permutes user layers via pairwise stacking, so the grid, guide
   * and overlay layers keep their slots. Callers mirror the store order.
   */
  moveUserLayer(layerId: string, toUserIndex: number): boolean {
    const users = this.project.layers.filter((l) => (l.data as any)?.isUserLayer)
    const from = users.findIndex((l) => (l.data as any)?.layerId === layerId)
    if (from < 0) return false
    const clamped = Math.min(users.length - 1, Math.max(0, toUserIndex))
    if (clamped === from) return false
    const [moved] = users.splice(from, 1)
    users.splice(clamped, 0, moved)
    for (let i = 1; i < users.length; i++) {
      users[i].insertAbove(users[i - 1])
    }
    this.pushHistory('Rearrange')
    this.scope.view.update()
    return true
  }

  /** Set the active user layer opacity (store stays in sync, one history entry). */
  setActiveLayerOpacity(opacity: number): void {
    const layer = this.getActiveLayer()
    if (!layer) return
    const clamped = Math.min(1, Math.max(0, opacity))
    if (layer.opacity === clamped) return
    layer.opacity = clamped
    const id = (layer.data as any)?.layerId as string | undefined
    if (id) this.store.updateLayer(id, { opacity: clamped })
    this.pushHistory('Layer Opacity')
    this.scope.view.update()
  }

  /**
   * Merge the user layer below the active one into it. Donor children land
   * underneath in order; the emptied donor is removed. Returns false when
   * the active layer is already the bottom one.
   */
  mergeLayerBelow(): boolean {
    const users = this.project.layers.filter((l) => (l.data as any)?.isUserLayer)
    const at = users.findIndex((l) => (l.data as any)?.layerId === this.store.activeLayerId)
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
    this.syncLayersToStore()
    this.pushHistory('Merge Layer Below')
    this.scope.view.update()
    return true
  }

  // ===== Layer object tree (AI-style nested hierarchy) =====
  //
  // Paper `project.layers` stays flat (sync/export/order depend on it), so
  // Illustrator sublayers are emulated as groups flagged with
  // `data.isSublayer`. They render like layers in the panel, nest freely,
  // and survive snapshots/exports because they are plain groups.

  /** Kind discriminator for one tree entry (drives panel icons). */
  private itemTreeKind(item: paper.Item): LayerItemNode['kind'] {
    const scope = this.scope
    const data = (item.data as any) ?? {}
    if (data.isPatternTile) return 'path'
    if (item instanceof scope.Group && (data as any).isSublayer) return 'sublayer'
    if (data.textMode === 'path' || data.textMode === 'area' || data.textMode === 'vertical') {
      return item instanceof scope.Group ? 'group' : 'text'
    }
    if (item instanceof scope.Group && this.isClipGroup(item)) return 'clip'
    if (item instanceof scope.PointText) return 'text'
    if (item instanceof scope.CompoundPath) return 'compound'
    if (item instanceof scope.SymbolItem) return 'symbol'
    if (item instanceof scope.Raster) return 'image'
    if (item instanceof scope.Group) return 'group'
    if (item instanceof scope.Path) return 'path'
    return 'object'
  }

  /** Build one tree node (children attached recursively). */
  private buildTreeNode(item: paper.Item, layerId: string, parentId: string, depth: number): LayerItemNode | null {
    const scope = this.scope
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
        name: this.itemTreeLabel(item),
        depth,
        visible: item.visible,
        locked: item.locked,
        collapsible: false,
        collapsed: false,
        kind: this.itemTreeKind(item),
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
        name: this.itemTreeLabel(item),
        depth,
        visible: item.visible,
        locked: item.locked,
        collapsible: foldable,
        collapsed,
        kind: this.itemTreeKind(item),
        layerId,
        parentId,
        children: [],
      }
      if (data.textMode === 'path') return node
      this.appendGroupChildren(item, layerId, node.id, depth + 1, node.children)
      return node
    }
    if (data.id) {
      return {
        id: data.id as string,
        name: this.itemTreeLabel(item),
        depth,
        visible: (item as paper.Item).visible,
        locked: (item as paper.Item).locked,
        collapsible: false,
        collapsed: false,
        kind: this.itemTreeKind(item),
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
  private appendTreeNodes(
    item: paper.Item,
    layerId: string,
    parentId: string,
    depth: number,
    out: LayerItemNode[]
  ): void {
    const scope = this.scope
    const data = (item.data as any) ?? {}
    if (data.isChrome || data.isPreview || data.isGuide || data.annotation) return
    if (data.isPatternTile) return
    if (item instanceof scope.Group && !data.id) {
      this.appendGroupChildren(item, layerId, parentId, depth, out)
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
      this.appendGroupChildren(item as unknown as paper.Group, layerId, parentId, depth, out)
      return
    }
    const node = this.buildTreeNode(item, layerId, parentId, depth)
    if (node) out.push(node)
  }

  /** Append every child of a container (bottom-first paper order). */
  private appendGroupChildren(
    container: paper.Group | paper.Item,
    layerId: string,
    parentId: string,
    depth: number,
    out: LayerItemNode[]
  ): void {
    const children = ((container as any).children as paper.Item[] | undefined) ?? []
    for (const child of children) {
      this.appendTreeNodes(child as paper.Item, layerId, parentId, depth, out)
    }
  }

  /**
   * Nested AI-style object tree for one user layer. Collapsed groups keep
   * their children attached (the panel decides whether to render them), so
   * expanding never needs a document rescan.
   */
  listLayerTree(layerId: string): LayerItemNode[] {
    const out: LayerItemNode[] = []
    const layer = this.project.layers.find((l) => (l.data as any)?.layerId === layerId)
    if (!layer) return out
    for (const child of layer.children) {
      this.appendTreeNodes(child as paper.Item, layerId, '', 0, out)
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
  listLayerItems(layerId: string): LayerItemNode[] {
    const out: LayerItemNode[] = []
    const flatten = (nodes: LayerItemNode[]): void => {
      for (const node of nodes) {
        out.push(node)
        if (node.collapsible && node.collapsed) continue
        if (node.children.length > 0) flatten(node.children)
      }
    }
    // listLayerTree is top-first; the legacy flat list is also top-first.
    flatten(this.listLayerTree(layerId))
    return out
  }

  /** Display label for an object-tree entry (imported names win). */
  private itemTreeLabel(item: paper.Item): string {
    const scope = this.scope
    const data = (item.data as any) ?? {}
    const named = ((item as any).name as string | undefined)?.trim()
    let kind: string
    if (data.textMode === 'path') kind = 'Path Text'
    else if (data.textMode === 'area') kind = 'Area Text'
    else if (data.textMode === 'vertical') kind = 'Vertical Text'
    else if ((data as any).isSublayer) kind = 'Sublayer'
    else if ((data as any).isPatternFill) kind = `Pattern ${(data as any).pattern?.kind ?? ''}`.trim()
    else if (item instanceof scope.Group && this.isClipGroup(item)) kind = 'Clipping Mask'
    else if (item instanceof scope.PointText) kind = 'Text'
    else if (item instanceof scope.CompoundPath) kind = 'Compound Path'
    else if (item instanceof scope.SymbolItem) kind = 'Symbol'
    else if (item instanceof scope.Raster) kind = 'Image'
    else if (item instanceof scope.Group) kind = 'Group'
    else if (item instanceof scope.Path) kind = item.closed ? 'Closed Path' : 'Path'
    else kind = 'Object'
    return named ? `${named} (${kind})` : kind
  }

  /** Thumbnail cache: `${historyIndex}:${isolation}:${itemId}` -> data URL. */
  private thumbCache = new Map<string, string>()

  /**
   * Small SVG preview of one object-tree entry for the Layers panel.
   * Exported nodes live in the item's parent frame, so nested items are
   * wrapped in the parent chain matrix to land inside the global viewBox.
   * Returns null when there is nothing renderable (panel shows a glyph).
   */
  thumbnailForItem(id: string, maxSize = 44): string | null {
    const item = this.getItemById(id)
    if (!item || !item.parent) return null
    const scope = this.scope
    // Symbol <use> nodes need definition context that a lone export cannot
    // guarantee; the panel falls back to a glyph for those.
    if (item instanceof scope.SymbolItem) return null
    const key = `${this.historyIndex}:${this.store.isolationActive ? 1 : 0}:${id}`
    const hit = this.thumbCache.get(key)
    if (hit !== undefined) return hit || null
    if (this.thumbCache.size > 500) this.thumbCache.clear()
    const url = this.renderItemThumbnail(item, maxSize)
    this.thumbCache.set(key, url ?? '')
    return url
  }

  /** Build the data URL (no caching); null when not renderable. */
  private renderItemThumbnail(item: paper.Item, maxSize: number): string | null {
    const scope = this.scope
    let bounds: paper.Rectangle
    try {
      bounds = (item as any).strokeBounds as paper.Rectangle
    } catch {
      return null
    }
    if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return null
    const fit = maxSize / Math.max(bounds.width, bounds.height)
    const scale = Math.min(8, fit)
    const w = Math.max(1, Math.round(bounds.width * scale * 10) / 10)
    const h = Math.max(1, Math.round(bounds.height * scale * 10) / 10)
    let node: string
    try {
      const exported = (item as any).exportSVG({ asString: true, precision: 2 }) as unknown
      if (!exported || typeof exported !== 'string') return null
      node = exported
    } catch {
      return null
    }
    // Unwrap paper's definitions wrapper (<svg><defs/>…</svg> has no
    // viewBox); the inner markup stays in the item's parent frame.
    const wrapped = node.match(/^\s*<svg[^>]*>([\s\S]*)<\/svg>\s*$/i)
    const inner = wrapped ? wrapped[1] : node
    if (!inner || !/<[a-z][a-z0-9]*[\s/>]/i.test(inner)) return null
    // Parent-chain placement so nested items land in the global viewBox.
    let placed = inner
    const parent = item.parent
    if (parent && !(parent instanceof scope.Layer)) {
      try {
        const m = (parent as paper.Item).globalMatrix as any
        if (m && typeof m.a === 'number') {
          const fmt = (n: number): number => Math.round(n * 1000) / 1000
          placed = `<g transform="matrix(${fmt(m.a)} ${fmt(m.b)} ${fmt(m.c)} ${fmt(m.d)} ${fmt(m.tx)} ${fmt(m.ty)})">${inner}</g>`
        }
      } catch {
        // Fall through with unplaced markup (still roughly right).
      }
    }
    const fmt1 = (n: number): number => Math.round(n * 10) / 10
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `viewBox="${fmt1(bounds.x)} ${fmt1(bounds.y)} ${fmt1(bounds.width)} ${fmt1(bounds.height)}" ` +
      `width="${w}" height="${h}">${placed}</svg>`
    // Slim metadata + hidden-state flags: hidden rows still preview (AI-like).
    // An empty dasharray would blank unfilled outlines in Blink, so drop it.
    let slim = svg
      .replace(/ data-paper-data="[^"]*"/g, '')
      .replace(/ visibility="hidden"/g, '')
      .replace(/ stroke-dasharray=""/g, '')
    // Hairlines vanish at thumbnail scale: enforce a minimum stroke width
    // (~1.3 CSS px on the chip) so unfilled outlines stay legible like AI.
    const minW = Math.round((2.6 / scale) * 10) / 10
    slim = slim.replace(/stroke-width="([\d.]+)"/g, (m, v) => {
      const n = parseFloat(v)
      return n < minW ? `stroke-width="${minW}"` : m
    })
    if (slim.length > 60000) return null
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(slim)}`
    } catch {
      return null
    }
  }

  /** Find any user-layer item by its document id (depth-first). */
  getItemById(id: string): paper.Item | null {
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
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer) continue
      for (const child of layer.children) {
        const found = walk(child as paper.Item)
        if (found) return found
      }
    }
    return null
  }

  /** Select one object-tree entry (shift extends the selection). */
  selectItemById(id: string, additive = false): void {
    const item = this.getItemById(id)
    if (!item || (item as any).locked) return
    if (!additive) this.project.deselectAll()
    item.selected = true
    this.syncSelectionToStore()
    this.scope.view.update()
  }

  /**
   * Select every visible unlocked top-level user item except the current
   * selection. Locked and hidden artwork stays out so follow-up commands
   * cannot touch it by accident. Selection-only change: no history entry.
   */
  invertSelection(): void {
    const candidates: paper.Item[] = []
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      for (const child of layer.children) {
        const item = child as paper.Item
        const data = (item.data as any) ?? {}
        if (!item.visible || (item as any).locked) continue
        if (data.isPreview || data.isChrome) continue
        candidates.push(item)
      }
    }
    const selected = new Set(this.getSelection())
    this.project.deselectAll()
    candidates.forEach((item) => {
      if (!selected.has(item)) item.selected = true
    })
    this.syncSelectionToStore()
    this.scope.view.update()
  }

  /** Toggle one object-tree entry visibility. */
  setItemVisible(id: string, visible: boolean): void {
    const item = this.getItemById(id)
    if (!item) return
    item.visible = visible
    this.pushHistory(visible ? 'Show' : 'Hide')
    this.scope.view.update()
  }

  /** Toggle one object-tree entry lock. */
  setItemLocked(id: string, locked: boolean): void {
    const item = this.getItemById(id)
    if (!item) return
    item.locked = locked
    this.pushHistory(locked ? 'Lock' : 'Unlock')
    this.scope.view.update()
  }

  /**
   * Fold or unfold an object-tree group entry. View-only paper metadata:
   * no history entry, the panel refreshes itself after toggling.
   */
  setTreeCollapsed(id: string, collapsed: boolean): void {
    const item = this.getItemById(id)
    if (!item || !(item instanceof this.scope.Group)) return
    if (collapsed) (item.data as any).treeCollapsed = true
    else delete (item.data as any).treeCollapsed
  }

  /** Fold or unfold every group/sublayer in the document (panel menu). */
  setAllTreeCollapsed(collapsed: boolean): void {
    for (const item of this.walkUserItems()) {
      if (item instanceof this.scope.Group && (item.data as any)?.id) {
        if (collapsed) (item.data as any).treeCollapsed = true
        else delete (item.data as any).treeCollapsed
      }
    }
    this.scope.view.update()
  }

  /** First unused "Sublayer N" name inside a parent container. */
  private nextSublayerName(parent: paper.Item): string {
    const names = new Set(
      ((parent as any).children as paper.Item[]).map(
        (c) => ((c as any).name as string | undefined) ?? ''
      )
    )
    let n = (parent as any).children.length + 1
    while (names.has(`Sublayer ${n}`)) n++
    return `Sublayer ${n}`
  }

  /**
   * Create an empty AI-style sublayer (a flagged group) inside the active
   * layer — or inside the selected group/sublayer when one is selected, so
   * nesting works like Illustrator. Selects the new sublayer.
   */
  createSublayer(): paper.Group | null {
    const scope = this.scope
    let parent: paper.Item = this.getActiveLayer()
    const sel = this.getSelection()
    if (sel.length === 1 && sel[0] instanceof scope.Group && sel[0].parent) {
      const data = (sel[0].data as any) ?? {}
      if (data.id && data.textMode !== 'path' && !this.isClipGroup(sel[0] as paper.Group)) {
        parent = sel[0]
      }
    }
    if ((parent as any).locked) {
      this.showStatus('Target is locked')
      return null
    }
    const group = new scope.Group({ insert: false }) as paper.Group
    group.data.id = this.genId()
    group.data.isUserItem = true
    group.data.isSublayer = true
    ;(group as any).name = this.nextSublayerName(parent)
    ;(parent as any).addChild(group)
    this.clearSelection()
    group.selected = true
    this.syncSelectionToStore()
    this.pushHistory('New Sublayer')
    this.scope.view.update()
    return group
  }

  /**
   * Collect the selection into a brand-new top user layer (AI's Collect in
   * New Layer). Works across layers; the new layer activates and the moved
   * artwork becomes the selection.
   */
  collectInNewLayer(): boolean {
    const items = this.getSelection().filter((item) => !item.locked && item.parent)
    if (items.length === 0) return false
    const ordered = items
      .slice()
      .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))
    const layer = new this.scope.Layer()
    const id = this.genId()
    layer.name = this.nextUserLayerName()
    layer.data.isUserLayer = true
    layer.data.layerId = id
    this.parkUserLayer(layer)
    for (const node of ordered) layer.addChild(node)
    layer.activate()
    this.syncLayersToStore()
    this.store.setActiveLayer(id)
    this.syncSelectionToStore()
    this.pushHistory('Collect in New Layer')
    this.scope.view.update()
    return true
  }

  /**
   * Release selected groups/sublayers to layers (AI's Release to Layers):
   * every direct child of each selected container moves into its own new
   * user layer named after the child. Empty containers dissolve.
   */
  releaseToLayers(): boolean {
    const scope = this.scope
    const groups = this.getSelection().filter(
      (item) =>
        !item.locked &&
        item.parent &&
        item instanceof scope.Group &&
        (item.data as any)?.id &&
        (item.data as any)?.textMode !== 'path' &&
        !this.isClipGroup(item as paper.Group)
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
        const id = this.genId()
        const label = ((kid as any).name as string | undefined)?.trim()
        layer.name = label || this.nextUserLayerName()
        layer.data.isUserLayer = true
        layer.data.layerId = id
        this.parkUserLayer(layer)
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
    this.syncLayersToStore()
    const users = this.project.layers.filter((l) => (l.data as any)?.isUserLayer)
    const last = users[users.length - 1]
    if (last) this.store.setActiveLayer((last.data as any)?.layerId as string)
    this.clearSelection()
    released.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.pushHistory('Release to Layers')
    this.scope.view.update()
    return true
  }

  /** Rename one object-tree entry (groups, sublayers and leaves). */
  renameTreeItem(id: string, name: string): boolean {
    const item = this.getItemById(id)
    if (!item) return false
    const clean = name.trim()
    if (!clean) return false
    // Labels render as `name (Kind)`; strip a pasted kind suffix so the
    // kind never doubles up after repeated renames.
    const bare = clean.replace(/\s*\((Sublayer|Group|Clipping Mask|Compound Path|Closed Path|Path|Path Text|Area Text|Vertical Text|Text|Image|Symbol|Pattern \w+|Object)\)\s*$/i, '').trim()
    if (!bare) return false
    ;(item as any).name = bare
    this.pushHistory('Rename')
    this.scope.view.update()
    return true
  }

  /** Whether `node` sits inside `ancestor` (cycle guard for moves). */
  private isDescendantOf(node: paper.Item, ancestor: paper.Item): boolean {
    let at = node.parent
    while (at) {
      if (at === ancestor) return true
      at = at.parent
    }
    return false
  }

  /** Whether the item or any ancestor up to the layer is locked. */
  private isEffectivelyLocked(item: paper.Item): boolean {
    let at: paper.Item | null = item
    while (at && !(at instanceof this.scope.Layer)) {
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
  moveTreeItem(
    itemId: string,
    destParentId: string,
    destLayerId: string,
    destIndex?: number
  ): boolean {
    const scope = this.scope
    const item = this.getItemById(itemId)
    if (!item || !item.parent) return false
    if (this.isEffectivelyLocked(item)) {
      this.showStatus('Item is locked')
      return false
    }
    let destParent: paper.Item
    if (destParentId) {
      const group = this.getItemById(destParentId)
      if (!group || !(group instanceof scope.Group) || !group.parent) return false
      const data = (group.data as any) ?? {}
      if (data.textMode === 'path' || this.isClipGroup(group)) return false
      if (group === item || this.isDescendantOf(group, item)) return false
      destParent = group
    } else {
      const layerId = destLayerId || this.getItemLayerId(itemId)
      const layer = this.project.layers.find((l) => (l.data as any)?.layerId === layerId)
      if (!layer || !(layer.data as any)?.isUserLayer) return false
      destParent = layer
    }
    if (this.isEffectivelyLocked(destParent)) {
      this.showStatus('Target is locked')
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
      this.syncSelectionToStore()
      return true
    }
    ;(destParent as any).insertChild(at, item)
    // Keep the layer activation in sync when crossing layers.
    const layerId = this.getItemLayerId(itemId)
    if (layerId) this.store.setActiveLayer(layerId)
    this.syncSelectionToStore()
    this.pushHistory('Rearrange')
    this.scope.view.update()
    return true
  }

  /**
   * Select all unlocked visible top-level artwork on a user layer (AI
   * target-circle parity). Returns how many were selected; no history
   * (selection-only, like marquee).
   */
  selectLayerArtwork(layerId: string): number {
    const layer = this.project.layers.find(
      (l) => (l.data as any)?.isUserLayer && (l.data as any)?.layerId === layerId
    )
    if (!layer || !layer.visible || layer.locked) return 0
    const tops = (layer.children as unknown as paper.Item[]).filter(
      (child) => child.visible && !(child as any).locked && !(child as any).data?.isPreview
    )
    this.clearSelection()
    tops.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.scope.view.update()
    return tops.length
  }

  /** Owning user-layer id of one tree entry (follows parents up). */
  getItemLayerId(id: string): string {
    const item = this.getItemById(id)
    if (!item) return ''
    let at: paper.Item | null = item
    while (at) {
      if (at instanceof this.scope.Layer && (at.data as any)?.isUserLayer) {
        return (at.data as any)?.layerId as string
      }
      at = at.parent
    }
    return ''
  }

  /** Direct parent group id of one tree entry ('' at layer top level). */
  getItemParentId(id: string): string {
    const item = this.getItemById(id)
    if (!item || !item.parent) return ''
    if (item.parent instanceof this.scope.Group) {
      return ((item.parent.data as any)?.id as string | undefined) ?? ''
    }
    return ''
  }

  // ===== Selection transform =====

  /** United axis-aligned bounds of the current selection, or null. */
  getSelectionBounds(): paper.Rectangle | null {
    return this.unitedBoundsOf(this.getSelection())
  }

  /** United axis-aligned bounds of the given items, or null. */
  private unitedBoundsOf(items: paper.Item[]): paper.Rectangle | null {
    let rect: paper.Rectangle | null = null
    for (const item of items) {
      const b = item.bounds
      if (!b) continue
      rect = rect ? rect.unite(b) : b.clone()
    }
    return rect
  }

  /** Position of a nine-point reference anchor within a rectangle. */
  referencePointForRect(rect: paper.Rectangle, point: ReferencePoint): paper.Point {
    const left = rect.x
    const centerX = rect.x + rect.width / 2
    const right = rect.x + rect.width
    const top = rect.y
    const centerY = rect.y + rect.height / 2
    const bottom = rect.y + rect.height
    switch (point) {
      case 'top-left': return new this.scope.Point(left, top)
      case 'top-center': return new this.scope.Point(centerX, top)
      case 'top-right': return new this.scope.Point(right, top)
      case 'middle-left': return new this.scope.Point(left, centerY)
      case 'middle-right': return new this.scope.Point(right, centerY)
      case 'bottom-left': return new this.scope.Point(left, bottom)
      case 'bottom-center': return new this.scope.Point(centerX, bottom)
      case 'bottom-right': return new this.scope.Point(right, bottom)
      case 'center':
      default: return new this.scope.Point(centerX, centerY)
    }
  }

  /** Pivot derived from the store reference point over the selection bounds. */
  selectionReferencePivot(): paper.Point | null {
    const bounds = this.getSelectionBounds()
    if (!bounds) return null
    return this.referencePointForRect(bounds, this.store.referencePoint)
  }

  /**
   * Rotate every unlocked selected item by an angle in degrees (clockwise
   * positive, matching screen coordinates) around a pivot. The pivot
   * defaults to the united selection bounds center; canvas rotation passes
   * the center explicitly while the property panel passes the
   * reference-point pivot. Callers record history.
   */
  rotateSelection(angleDeg: number, pivot?: paper.Point): void {
    if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) < 1e-9) return
    const full = this.getSelection()
    const items = full.filter((item) => !item.locked)
    if (items.length === 0) return
    const center = pivot ?? this.getSelectionBounds()?.center
    if (!center) return
    for (const item of items) {
      item.rotate(angleDeg, center)
      this.refreshItemGradient(item)
    }
    // The select tool's oriented frame rigidly follows (canvas drags and
    // the Properties panel share this path, so both stay in sync). When
    // locked members stay behind, the frame can't track — drop it so the
    // next paint rebuilds upright instead of drifting.
    const selectCtrl = this.controllers.get('select') as { frameRotated?: (delta: number, p: paper.Point) => void; dropFrame?: () => void } | undefined
    try {
      if (items.length !== full.length) selectCtrl?.dropFrame?.()
      else selectCtrl?.frameRotated?.(angleDeg, center)
    } catch {
      // Frame bookkeeping must never break document ops.
    }
    const next = (this.store.transform.rotation + angleDeg) % 360
    this.store.updateTransform({ rotation: (next + 360) % 360 })
    this.reflowTextsForItems(items)
    this.scope.view.update()
  }

  /**
   * Detached clone with fresh identity: new ids, no preview flags, thread
   * links stripped (copies stand alone), deselected. Callers insert it.
   */
  private freshClone(item: paper.Item): paper.Item {
    const clone = (item as any).clone({ insert: false }) as paper.Item
    const walk = (node: paper.Item) => {
      const data = (node as any).data ?? ((node as any).data = {})
      if (data.id || data.isUserItem) {
        data.id = this.genId()
        data.isUserItem = true
      }
      delete data.isPreview
      delete data.threadNext
      delete data.threadPrev
      ;(node as any).selected = false
      const children = (node as any).children as paper.Item[] | undefined
      if (children) for (const child of children) walk(child)
    }
    walk(clone)
    return clone
  }

  /**
   * Transform Each (beloved batch dialog): move/rotate/scale every
   * unlocked selected item about its own bounds center. With copies > 0
   * the originals stay and each copy accumulates the transform (copy c
   * gets c steps); random jitters per-item rotation/scale. One history.
   * Returns items transformed (copies included).
   */
  transformEach(opts: {
    dx?: number
    dy?: number
    rotate?: number
    scale?: number
    copies?: number
    random?: boolean
  }): number {
    const dx = Number.isFinite(opts.dx) ? Number(opts.dx) : 0
    const dy = Number.isFinite(opts.dy) ? Number(opts.dy) : 0
    const rotate = Number.isFinite(opts.rotate) ? Number(opts.rotate) : 0
    const scalePct = Number.isFinite(opts.scale) ? Number(opts.scale) : 100
    const copies = Math.min(50, Math.max(0, Math.round(Number(opts.copies) || 0)))
    const random = !!opts.random
    if (dx === 0 && dy === 0 && rotate === 0 && scalePct === 100 && copies === 0) return 0
    const sources = this.getSelection().filter((item) => !item.locked && item.parent)
    if (sources.length === 0) return 0
    const jitter = () => (random ? 0.5 + Math.random() : 1)
    const applyStep = (item: paper.Item, step: number) => {
      const b = (item as any).bounds as paper.Rectangle | undefined
      if (!b || !(b.width > 0) || !(b.height > 0)) return false
      const center = b.center.clone()
      if (dx !== 0 || dy !== 0) {
        item.position = (item.position as paper.Point).add(
          new this.scope.Point(dx * step, dy * step)
        )
      }
      const r = rotate * step * jitter()
      if (Math.abs(r) > 1e-9) item.rotate(r, center)
      const f = Math.pow(scalePct / 100, step)
      const fj = random ? 1 + (f - 1) * jitter() : f
      if (Math.abs(fj - 1) > 1e-9) item.scale(fj, fj, center)
      this.refreshItemGradient(item)
      return true
    }
    let done = 0
    if (copies > 0) {
      const made: paper.Item[] = []
      for (const item of sources) {
        const parent = item.parent ?? this.getActiveLayer()
        const at = parent.children.indexOf(item as any)
        for (let c = 1; c <= copies; c++) {
          const clone = this.freshClone(item)
          parent.insertChild(Math.min(at + c, parent.children.length), clone as any)
          if (applyStep(clone, c)) made.push(clone)
          else clone.remove()
        }
      }
      if (made.length === 0) return 0
      this.clearSelection()
      made.forEach((item) => {
        item.selected = true
      })
      this.syncSelectionToStore()
      this.reflowTextsForItems(made)
      done = made.length
    } else {
      for (const item of sources) {
        if (applyStep(item, 1)) done++
      }
      if (done === 0) return 0
      this.reflowTextsForItems(sources)
    }
    this.pushHistory('Transform Each')
    this.scope.view.update()
    return done
  }

  /**
   * Duplicate the unlocked selection in place, then rotate the copies
   * (AI Rotate-dialog Copy parity). Clones get fresh ids, thread links
   * are stripped so copies stand alone, and the copies become the new
   * selection. Returns false when there is nothing to copy.
   */
  rotateCopy(angleDeg: number, pivot?: paper.Point): boolean {
    if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) < 1e-9) return false
    const sources = this.getSelection().filter((item) => !item.locked && item.parent)
    if (sources.length === 0) return false
    const center = pivot ?? this.getSelectionBounds()?.center
    if (!center) return false
    const clones: paper.Item[] = []
    for (const item of sources) {
      const clone = this.freshClone(item)
      const parent = item.parent ?? this.getActiveLayer()
      parent.insertChild(parent.children.indexOf(item as any) + 1, clone as any)
      clones.push(clone)
    }
    for (const clone of clones) {
      clone.rotate(angleDeg, center)
      this.refreshItemGradient(clone)
    }
    this.clearSelection()
    clones.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.reflowTextsForItems(clones)
    this.pushHistory('Rotate Copy')
    this.scope.view.update()
    return true
  }

  /**
   * Duplicate the unlocked selection in place (CDR duplicate parity):
   * copies land exactly over their sources and become the selection.
   */
  duplicateInPlace(): boolean {
    const sources = this.getSelection().filter((item) => !item.locked && item.parent)
    if (sources.length === 0) return false
    const clones: paper.Item[] = []
    for (const item of sources) {
      const clone = this.freshClone(item)
      const parent = item.parent ?? this.getActiveLayer()
      parent.insertChild(parent.children.indexOf(item as any) + 1, clone as any)
      this.refreshItemGradient(clone)
      clones.push(clone)
    }
    this.clearSelection()
    clones.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.reflowTextsForItems(clones)
    this.pushHistory('Duplicate in Place')
    this.scope.view.update()
    return true
  }

  /**
   * Step-and-repeat the unlocked selection (layout staple): `count`
   * translated copies at (dx, dy) increments. Copies become the new
   * selection; one history entry. Returns copies made.
   */
  stepRepeat(count: number, dx: number, dy: number): number {
    const n = Math.min(100, Math.max(1, Math.round(Number(count) || 0)))
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return 0
    const step = new this.scope.Point(
      Math.min(5000, Math.max(-5000, dx)),
      Math.min(5000, Math.max(-5000, dy))
    )
    const sources = this.getSelection().filter((item) => !item.locked && item.parent)
    if (sources.length === 0 || n < 1) return 0
    const made: paper.Item[] = []
    for (const item of sources) {
      const parent = item.parent ?? this.getActiveLayer()
      const at = parent.children.indexOf(item as any)
      for (let i = 1; i <= n; i++) {
        const clone = this.freshClone(item)
        clone.position = (clone.position as paper.Point).add(step.multiply(i))
        parent.insertChild(Math.min(at + i, parent.children.length), clone as any)
        this.refreshItemGradient(clone)
        made.push(clone)
      }
    }
    if (made.length === 0) return 0
    this.clearSelection()
    made.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.reflowTextsForItems(made)
    this.pushHistory('Step and Repeat')
    this.scope.view.update()
    return made.length
  }

  /**
   * Radial repeat (clock faces, badges, rosettes): `count` rotated copies
   * at `angleDeg` steps about the reference pivot. Copies become the new
   * selection; one history entry. Returns copies made.
   */
  radialRepeat(count: number, angleDeg: number): number {
    const n = Math.min(120, Math.max(1, Math.round(Number(count) || 0)))
    if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) < 1e-9 || n < 1) return 0
    const angle = ((angleDeg % 360) + 360) % 360
    if (angle < 1e-9) return 0
    const sources = this.getSelection().filter((item) => !item.locked && item.parent)
    if (sources.length === 0) return 0
    const pivot = this.selectionReferencePivot() ?? this.getSelectionBounds()?.center
    if (!pivot) return 0
    const made: paper.Item[] = []
    for (const item of sources) {
      const parent = item.parent ?? this.getActiveLayer()
      const at = parent.children.indexOf(item as any)
      for (let i = 1; i <= n; i++) {
        const clone = this.freshClone(item)
        clone.rotate(angle * i, pivot)
        parent.insertChild(Math.min(at + i, parent.children.length), clone as any)
        this.refreshItemGradient(clone)
        made.push(clone)
      }
    }
    if (made.length === 0) return 0
    this.clearSelection()
    made.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.reflowTextsForItems(made)
    this.pushHistory('Radial Repeat')
    this.scope.view.update()
    return made.length
  }

  /**
   * Skew every unlocked selected item by degrees around a pivot (default:
   * united selection bounds center). Callers record history.
   */
  skewSelection(skewXDeg: number, skewYDeg: number, pivot?: paper.Point): void {
    if (!Number.isFinite(skewXDeg) || !Number.isFinite(skewYDeg)) return
    if (Math.abs(skewXDeg) < 1e-9 && Math.abs(skewYDeg) < 1e-9) return
    const items = this.getSelection().filter((item) => !item.locked)
    if (items.length === 0) return
    const center = pivot ?? this.getSelectionBounds()?.center
    if (!center) return
    const skew = new this.scope.Point(skewXDeg, skewYDeg)
    for (const item of items) {
      item.skew(skew, center)
      this.refreshItemGradient(item)
    }
    this.reflowTextsForItems(items)
    this.scope.view.update()
  }

  /**
   * Mirror every unlocked selected item across a pivot. Horizontal flips
   * left/right, vertical flips top/bottom. The pivot defaults to the
   * reference-point pivot. Callers record history.
   */
  flipSelection(direction: 'horizontal' | 'vertical', pivot?: paper.Point): void {
    const full = this.getSelection()
    const items = full.filter((item) => !item.locked)
    if (items.length === 0) return
    const center = pivot ?? this.selectionReferencePivot()
    if (!center) return
    for (const item of items) {
      if (direction === 'horizontal') item.scale(-1, 1, center)
      else item.scale(1, -1, center)
      this.refreshItemGradient(item)
    }
    // Mirroring negates the oriented frame's angle (both flip axes map
    // θ → −θ) and mirrors its center about the pivot — unless locked
    // members stay behind, in which case the frame is dropped.
    const selectCtrl = this.controllers.get('select') as { frameMirrored?: (p: paper.Point) => void; dropFrame?: () => void } | undefined
    try {
      if (items.length !== full.length) selectCtrl?.dropFrame?.()
      else selectCtrl?.frameMirrored?.(center)
    } catch {
      // Frame bookkeeping must never break document ops.
    }
    if (direction === 'horizontal') {
      this.store.updateTransform({ flipH: !this.store.transform.flipH })
    } else {
      this.store.updateTransform({ flipV: !this.store.transform.flipV })
    }
    this.reflowTextsForItems(items)
    this.scope.view.update()
  }

  /**
   * Revalidate the select tool's oriented frame against the current
   * geometry version (call after a tracked drag records history: the frame
   * already matches the final artwork, so only the version stamp updates
   * instead of rebuilding the frame axis-aligned).
   */
  stampSelectionFrame() {
    const selectCtrl = this.controllers.get('select') as { frameStamped?: () => void } | undefined
    try {
      selectCtrl?.frameStamped?.()
    } catch {
      // Frame bookkeeping must never break document ops.
    }
  }

  /** Drop the select tool's oriented frame (it rebuilds on next paint). */
  dropSelectionFrame() {
    const selectCtrl = this.controllers.get('select') as { dropFrame?: () => void } | undefined
    try {
      selectCtrl?.dropFrame?.()
    } catch {
      // Frame bookkeeping must never break document ops.
    }
  }

  /**
   * Move every unlocked selected item by a document-space delta (arrow-key
   * nudge). Returns false when there is nothing to move. Rapid consecutive
   * nudges share one history entry so holding an arrow key does not flood
   * the history panel.
   */
  nudgeSelection(dx: number, dy: number): boolean {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false
    if (dx === 0 && dy === 0) return false
    const full = this.getSelection()
    const items = full.filter((item) => !item.locked)
    if (items.length === 0) return false
    const delta = new this.scope.Point(dx, dy)
    items.forEach((item) => {
      item.position = item.position.add(delta)
      this.refreshItemGradient(item)
    })
    // Pure translation: the oriented frame slides along untouched — unless
    // locked members stay behind, in which case the frame is dropped.
    const selectCtrl = this.controllers.get('select') as { frameTranslated?: (dx: number, dy: number) => void; frameStamped?: () => void; dropFrame?: () => void } | undefined
    try {
      if (items.length !== full.length) selectCtrl?.dropFrame?.()
      else selectCtrl?.frameTranslated?.(dx, dy)
    } catch {
      // Frame bookkeeping must never break document ops.
    }
    this.scope.view.update()
    this.reflowTextsForItems(items)
    this.pushCoalescedHistory('Nudge')
    try {
      selectCtrl?.frameStamped?.()
    } catch {
      // Frame bookkeeping must never break document ops.
    }
    return true
  }

  /**
   * Record a history entry, coalescing with the previous one when it shares
   * the name and landed inside `windowMs`. Lets held-down keys (nudge)
   * share one undo step instead of flooding the history panel.
   */
  pushCoalescedHistory(name: string, windowMs = 1200) {
    const now = Date.now()
    const last = this.history[this.historyIndex]
    if (last && last.name === name && now - last.timestamp < windowMs) {
      this.historySnapshots[this.historyIndex] = this.snapshotProject()
      this.historyMeta[this.historyIndex] = this.captureDocMeta()
      last.timestamp = now
      this.store.setHistory(this.history, this.historyIndex)
    } else {
      this.pushHistory(name)
    }
  }

  /**
   * Align every unlocked selected item to an edge or center of a target
   * rectangle (explicit board target, or the united unlocked-selection
   * bounds which needs at least two items). Returns false when there is
   * nothing to align; callers record history only then.
   */
  alignSelection(mode: AlignMode, target?: paper.Rectangle): boolean {
    const items = this.getSelection().filter((item) => !item.locked)
    if (items.length === 0) return false
    const bounds = target ?? (items.length >= 2 ? this.unitedBoundsOf(items) : null)
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
        item.position = item.position.add(new this.scope.Point(dx, dy))
        this.refreshItemGradient(item)
        moved = true
      }
    }
    if (moved) this.reflowTextsForItems(items)
    this.scope.view.update()
    return moved
  }

  /** Active artboard rectangle, or null when none is usable. */
  getActiveArtboardRect(): paper.Rectangle | null {
    const board =
      this.store.artboards.find((b) => b.id === this.store.activeArtboardId) ??
      this.store.artboards[0]
    if (!board || !(board.width > 0) || !(board.height > 0)) return null
    return new this.scope.Rectangle(board.x, board.y, board.width, board.height)
  }

  /**
   * Spread unlocked selected items along an axis with equal gaps between
   * neighbors (first and last stay put; even overlap when cramped).
   * Needs at least three unlocked items. Callers record history.
   */
  distributeSpacing(axis: DistributeAxis): boolean {
    const items = this.getSelection().filter((item) => !item.locked && item.bounds)
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
          ? new this.scope.Point(delta, 0)
          : new this.scope.Point(0, delta)
        item.position = item.position.add(shift)
        this.refreshItemGradient(item)
        moved = true
      }
      cursor += sizeOf(item.bounds) + gap
    }
    if (moved) this.reflowTextsForItems(items)
    this.scope.view.update()
    return moved
  }

  /**
   * Spread unlocked selected items evenly along an axis by distributing
   * their centers between the extreme centers. The extreme items stay in
   * place. Needs at least three unlocked items with distinct extremes.
   * Returns whether anything moved; callers record history only then.
   */
  distributeSelection(axis: DistributeAxis): boolean {
    const items = this.getSelection().filter((item) => !item.locked && item.bounds)
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
        ? new this.scope.Point(delta, 0)
        : new this.scope.Point(0, delta)
      item.position = item.position.add(shift)
      this.refreshItemGradient(item)
      moved = true
    })
    if (moved) this.reflowTextsForItems(items)
    this.scope.view.update()
    return moved
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
  booleanOperation(op: BooleanOperation): boolean {
    const scope = this.scope
    const paths = this.getSelection().filter(
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
    const style = this.getStyleFromItem(base)
    const parent = base.parent ?? this.getActiveLayer()

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
    if (this.isEmptyPathResult(working)) {
      working.remove()
      this.clearSelection()
      this.pushHistory(historyLabel)
      this.scope.view.update()
      return true
    }
    parent.addChild(working)
    working.data.id = this.genId()
    working.data.isUserItem = true
    this.applyStyleToItem(working, style)
    this.clearSelection()
    working.selected = true
    this.syncSelectionToStore()
    this.pushHistory(historyLabel)
    this.scope.view.update()
    return true
  }

  /** Whether a boolean result carries no visible geometry. */
  private isEmptyPathResult(item: paper.PathItem): boolean {
    const scope = this.scope
    if (item instanceof scope.Path) return item.segments.length === 0
    if (item instanceof scope.CompoundPath) return item.children.length === 0
    return false
  }

  /**
   * Scale every unlocked selected item about a pivot (default: united
   * selection bounds center). Factors must be finite and non-zero.
   * Callers record history.
   */
  scaleSelection(sx: number, sy: number, pivot?: paper.Point): void {
    if (!Number.isFinite(sx) || !Number.isFinite(sy)) return
    if (Math.abs(sx) < 1e-9 || Math.abs(sy) < 1e-9) return
    const items = this.getSelection().filter((item) => !item.locked)
    if (items.length === 0) return
    const center = pivot ?? this.getSelectionBounds()?.center
    if (!center) return
    for (const item of items) {
      item.scale(sx, sy, center)
      this.refreshItemGradient(item)
    }
    this.reflowTextsForItems(items)
    this.scope.view.update()
  }

  /**
   * Distribute with an exact gap value (first item stays, the rest follow
   * with `gap` document units between neighbors). Needs 3+ unlocked items.
   */
  distributeSpacingExact(axis: DistributeAxis, gap: number): boolean {
    if (!Number.isFinite(gap) || gap < 0) return false
    const items = this.getSelection().filter((item) => !item.locked && item.bounds)
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
          ? new this.scope.Point(delta, 0)
          : new this.scope.Point(0, delta)
        item.position = item.position.add(shift)
        this.refreshItemGradient(item)
        moved = true
      }
      cursor += sizeOf(item.bounds) + gap
    }
    if (moved) this.reflowTextsForItems(items)
    this.scope.view.update()
    return moved
  }

  /** Bounds of the align key object, or null when unset/unusable. */
  getKeyObjectBounds(): paper.Rectangle | null {
    const id = (this.store as any).keyObjectId as string | undefined
    if (!id) return null
    const item = this.getItemById(id)
    if (!item || item.locked || !item.parent || !item.bounds) return null
    return item.bounds.clone()
  }

  /**
   * Extended shaper ops composed from the four boolean primitives.
   * - minusBack: top-most path minus everything below (keeps top style).
   * - divide: exactly two paths -> intersect + remainders (keeps per-piece styles).
   * - trim: exactly two paths -> back-minus-front plus the intact front.
   * - outline: alias for Outline Stroke (one history entry).
   * Returns false when the selection does not satisfy the op.
   */
  extendedBoolean(op: 'minusBack' | 'divide' | 'trim' | 'outline'): boolean {
    if (op === 'outline') return this.outlineStroke()
    const scope = this.scope
    const paths = this.getSelection().filter(
      (item) =>
        !item.locked &&
        item.parent &&
        (item instanceof scope.Path || item instanceof scope.CompoundPath)
    ) as paper.PathItem[]
    if (paths.length < 2) return false
    const ordered = paths
      .slice()
      .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))
    const parent = ordered[0].parent ?? this.getActiveLayer()
    const at = Math.max(0, parent.children.indexOf(ordered[0] as any))
    try {
      if (op === 'minusBack') {
        const top = ordered[ordered.length - 1]
        const style = this.getStyleFromItem(top)
        let working = (top.clone({ insert: false }) as paper.PathItem)
        for (let i = ordered.length - 2; i >= 0; i--) {
          const cutter = ordered[i].clone({ insert: false }) as paper.PathItem
          const next = (working.subtract(cutter, { insert: false } as any) as paper.PathItem)
          working.remove()
          cutter.remove()
          working = next
        }
        for (const o of ordered) o.remove()
        if (this.isEmptyPathResult(working)) {
          working.remove()
          this.clearSelection()
          this.pushHistory('Minus Back')
          this.scope.view.update()
          return true
        }
        parent.insertChild(Math.min(at, parent.children.length), working as any)
        working.data.id = this.genId()
        working.data.isUserItem = true
        this.applyStyleToItem(working, style)
        this.clearSelection()
        working.selected = true
        this.syncSelectionToStore()
        this.pushHistory('Minus Back')
        this.scope.view.update()
        return true
      }
      if (ordered.length !== 2) return false
      const back = ordered[0]
      const front = ordered[1]
      const backStyle = this.getStyleFromItem(back)
      const frontStyle = this.getStyleFromItem(front)
      if (op === 'divide') {
        const a = back.clone({ insert: false }) as paper.PathItem
        const b = front.clone({ insert: false }) as paper.PathItem
        const inter = (a.clone({ insert: false }) as paper.PathItem).intersect(b, { insert: false } as any) as paper.PathItem
        const aMinus = (a.subtract(b, { insert: false } as any) as paper.PathItem)
        const bMinus = ((front.clone({ insert: false }) as paper.PathItem).subtract(back.clone({ insert: false }) as paper.PathItem, { insert: false } as any) as paper.PathItem)
        a.remove()
        b.remove()
        const pieces: Array<{ node: paper.PathItem; style: ReturnType<EditorEngine['getStyleFromItem']> }> = []
        if (!this.isEmptyPathResult(aMinus)) pieces.push({ node: aMinus, style: backStyle })
        else aMinus.remove()
        if (!this.isEmptyPathResult(bMinus)) pieces.push({ node: bMinus, style: frontStyle })
        else bMinus.remove()
        if (!this.isEmptyPathResult(inter)) pieces.push({ node: inter, style: frontStyle })
        else inter.remove()
        back.remove()
        front.remove()
        if (pieces.length === 0) {
          this.clearSelection()
          this.pushHistory('Divide')
          this.scope.view.update()
          return true
        }
        this.clearSelection()
        pieces.forEach(({ node, style }, i) => {
          parent.insertChild(Math.min(at + i, parent.children.length), node as any)
          node.data.id = this.genId()
          node.data.isUserItem = true
          this.applyStyleToItem(node, style)
          node.selected = true
        })
        this.syncSelectionToStore()
        this.pushHistory('Divide')
        this.scope.view.update()
        return true
      }
      // trim: back gets cut by front, front stays intact on top.
      const cut = (back.clone({ insert: false }) as paper.PathItem).subtract(
        front.clone({ insert: false }) as paper.PathItem, { insert: false } as any
      ) as paper.PathItem
      const frontCopy = front.clone({ insert: false }) as paper.PathItem
      back.remove()
      front.remove()
      this.clearSelection()
      let idx = 0
      if (!this.isEmptyPathResult(cut)) {
        parent.insertChild(Math.min(at, parent.children.length), cut as any)
        cut.data.id = this.genId()
        cut.data.isUserItem = true
        this.applyStyleToItem(cut, backStyle)
        cut.selected = true
        idx++
      } else {
        cut.remove()
      }
      parent.insertChild(Math.min(at + idx, parent.children.length), frontCopy as any)
      frontCopy.data.id = this.genId()
      frontCopy.data.isUserItem = true
      this.applyStyleToItem(frontCopy, frontStyle)
      frontCopy.selected = true
      this.syncSelectionToStore()
      this.pushHistory('Trim')
      this.scope.view.update()
      return true
    } catch {
      return false
    }
  }

  /**
   * Spot-color placeholder names on the selection (first item wins on read;
   * empty strings clear). Names ride on `item.data` so they persist in
   * project JSON; paints still render/export with their RGB preview.
   */
  getSpotFromSelection(): { fill: string | null; stroke: string | null } {
    const first = this.getSelection()[0] as any
    if (!first) return { fill: null, stroke: null }
    const data = (first.data as any) ?? {}
    const clean = (v: unknown): string | null =>
      typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 60) : null
    return { fill: clean(data.spotFill), stroke: clean(data.spotStroke) }
  }

  /** Stamp spot names onto every selected top-level item (one history entry). */
  setSpotForSelection(fill: string | null, stroke: string | null): void {
    const items = this.getSelection().filter((i) => !i.locked && i.parent)
    if (items.length === 0) return
    const clean = (v: string | null): string | null =>
      typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 60) : null
    const nextFill = clean(fill)
    const nextStroke = clean(stroke)
    for (const item of items) {
      const data = (item.data as any) ?? ((item.data as any) = {})
      if (nextFill) data.spotFill = nextFill
      else delete data.spotFill
      if (nextStroke) data.spotStroke = nextStroke
      else delete data.spotStroke
    }
    this.pushHistory('Spot Color')
    this.scope.view.update()
  }

  // ===== Raster export =====

  /** Export bounds for an area keyword (selection / page / artwork). */
  private rasterBoundsFor(area: RasterExportOptions['area']): paper.Rectangle | null {
    if (area === 'selection') {
      return this.getSelectionBounds()
    } else if (area === 'page') {
      // The active artboard is the page; older files fall back to pageSize.
      const board =
        this.store.artboards.find((b) => b.id === this.store.activeArtboardId) ??
        this.store.artboards[0]
      const page = this.store.pageSize
      const rect = board ?? { x: 0, y: 0, width: page.width, height: page.height }
      return Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0
        ? new this.scope.Rectangle(rect.x, rect.y, rect.width, rect.height)
        : null
    }
    return this.unitedBoundsOf(this.getUserItems())
  }

  /**
   * Predicted pixel size for a raster export (null when there is nothing
   * to export). Lets callers explain size-guard failures precisely.
   */
  estimateRasterSize(area: RasterExportOptions['area'], scale: number): { width: number; height: number } | null {
    const bounds = this.rasterBoundsFor(area)
    if (!bounds || bounds.width < 1 || bounds.height < 1) return null
    const s = Number.isFinite(scale) ? Math.min(4, Math.max(0.5, scale)) : 1
    return { width: Math.ceil(bounds.width * s), height: Math.ceil(bounds.height * s) }
  }

  /**
   * Bake the unlocked selection into a 2x PNG placed at the same spot
   * (AI Object > Rasterize parity). Originals are removed only after the
   * raster loads; a load failure keeps them and reports false.
   */
  rasterizeSelection(): boolean {
    const items = this.getSelection().filter((item) => !item.locked && item.parent)
    if (items.length === 0) return false
    const bounds = this.getSelectionBounds()
    if (!bounds || bounds.width < 1 || bounds.height < 1) return false
    const url = this.exportRaster({ format: 'png', scale: 2, area: 'selection' })
    if (!url) return false
    const parent = items[0].parent ?? this.getActiveLayer()
    const raster = new this.scope.Raster({ source: url }) as paper.Raster
    parent.addChild(raster)
    raster.onLoad = () => {
      raster.position = bounds.center.clone()
      raster.data.id = this.genId()
      raster.data.isUserItem = true
      for (const item of items) {
        try {
          item.remove()
        } catch { /* already gone */ }
      }
      this.clearSelection()
      raster.selected = true
      this.syncSelectionToStore()
      this.pushHistory('Rasterize')
      this.scope.view.update()
      this.showStatus('Selection rasterized (2x PNG)')
    }
    raster.onError = () => {
      try {
        raster.remove()
      } catch { /* already gone */ }
      this.showStatus('Rasterize failed')
    }
    return true
  }

  /**
   * Rasterize artwork through the paper.js view into a data URL. The view
   * is pointed at the export bounds for exactly one synchronous render and
   * then restored, so no intermediate frame ever paints. Editor chrome
   * layers stay hidden like in SVG export. Returns null when there is
   * nothing to export or the output exceeds the size guard.
   */
  exportRaster(options: RasterExportOptions): string | null {
    const bounds = this.rasterBoundsFor(options.area)
    if (!bounds || bounds.width < 1 || bounds.height < 1) return null
    const scale = Number.isFinite(options.scale) ? Math.min(4, Math.max(0.5, options.scale)) : 1
    const mime =
      options.format === 'jpeg' ? 'image/jpeg' :
      options.format === 'webp' ? 'image/webp' : 'image/png'
    const quality = Number.isFinite(options.quality)
      ? Math.min(1, Math.max(0.1, Number(options.quality)))
      : 0.92
    return this.withCapturedView(bounds, scale, false, (canvas, width, height) => {
      if (options.format === 'png') {
        return canvas.toDataURL('image/png')
      }
      const output = document.createElement('canvas')
      output.width = width
      output.height = height
      const ctx = output.getContext('2d')
      if (!ctx) return null
      if (options.format === 'jpeg') {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
      }
      ctx.drawImage(canvas, 0, 0)
      return output.toDataURL(mime, quality)
    })
  }

  /**
   * Render a whole-scene thumbnail (artwork plus artboard sheets) for the
   * navigator, capped at maxPixels on the long edge. Returns the image
   * with the document bounds it covers, or null when the scene is empty.
   */
  renderThumbnail(maxPixels: number): { url: string; x: number; y: number; width: number; height: number } | null {
    let bounds = this.unitedBoundsOf(this.getUserItems())
    for (const board of this.store.artboards) {
      if (board.width > 0 && board.height > 0) {
        const rect = new this.scope.Rectangle(board.x, board.y, board.width, board.height)
        bounds = bounds ? bounds.unite(rect) : rect
      }
    }
    if (!bounds) return null
    const longest = Math.max(bounds.width, bounds.height)
    if (!(longest > 0)) return null
    const limit = maxPixels > 0 ? maxPixels : 320
    const scale = Math.min(2, limit / longest)
    const snapshot = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
    const url = this.withCapturedView(bounds, scale, true, (canvas) => canvas.toDataURL('image/png'))
    if (!url) return null
    return { url, ...snapshot }
  }

  /**
   * Point the view at bounds for exactly one synchronous render of `fn`,
   * then restore everything. The callback must be synchronous: restoring
   * resizes the canvas, which clears whatever was just drawn.
   */
  private withCapturedView<T>(
    bounds: paper.Rectangle,
    scale: number,
    keepArtboards: boolean,
    fn: (canvas: HTMLCanvasElement, width: number, height: number) => T | null
  ): T | null {
    if (!bounds || bounds.width < 1 || bounds.height < 1) return null
    const width = Math.max(1, Math.ceil(bounds.width * scale))
    const height = Math.max(1, Math.ceil(bounds.height * scale))
    if (width > 16384 || height > 16384) return null

    const view = this.scope.view
    const prevSize = view.viewSize.clone()
    const prevCenter = view.center.clone()
    const prevZoom = view.zoom

    // Temporarily hide non-user layers so editing chrome never leaks in.
    const hiddenLayers: paper.Layer[] = []
    for (const layer of this.project.layers) {
      const data = (layer.data as any) ?? {}
      if (!data.isUserLayer && layer.visible && !(keepArtboards && data.isArtboardLayer)) {
        layer.visible = false
        hiddenLayers.push(layer)
      }
    }

    try {
      view.viewSize = new this.scope.Size(width, height)
      view.zoom = scale
      view.center = bounds.center
      view.update()
      return fn(this.canvas, width, height)
    } finally {
      hiddenLayers.forEach((layer) => {
        layer.visible = true
      })
      view.viewSize = prevSize
      view.zoom = prevZoom
      view.center = prevCenter
      view.update()
      this.syncViewBookkeeping()
      this.refreshGrid()
      this.emitViewChange()
    }
  }

  /**
   * Export one artboard's artwork as a vector SVG element clipped to the
   * board (editor chrome layers hidden like raster export). The root
   * carries width/height/viewBox of the page plus a white page rect, so
   * vector-PDF renderers (svg2pdf) paint exactly one full-bleed page.
   * With `bleed > 0` the page grows by the bleed on every side and
   * `marks` draws hairline crop marks at the trim corners. Returns null
   * when the board is invalid or exports nothing.
   */
  exportBoardVectorSVG(
    board: { x: number; y: number; width: number; height: number },
    opts?: { bleed?: number; marks?: boolean }
  ): SVGSVGElement | null {
    if (!board || !(board.width > 0) || !(board.height > 0)) return null
    if (!Number.isFinite(board.x) || !Number.isFinite(board.y)) return null
    const bleed = Math.min(100, Math.max(0, Number(opts?.bleed) || 0))
    const page = {
      x: board.x - bleed,
      y: board.y - bleed,
      width: board.width + bleed * 2,
      height: board.height + bleed * 2,
    }
    const hiddenLayers: paper.Layer[] = []
    for (const layer of this.project.layers) {
      const data = (layer.data as any) ?? {}
      if (!data.isUserLayer && layer.visible) {
        layer.visible = false
        hiddenLayers.push(layer)
      }
    }
    try {
      this.scope.view.update()
      const exported = (this.project as any).exportSVG({ asString: false }) as unknown
      const root = exported as SVGSVGElement | null
      if (!root || typeof (root as any).setAttribute !== 'function') return null
      const fmt = (n: number): string => String(Math.round(n * 100) / 100)
      const ns = 'http://www.w3.org/2000/svg'
      root.setAttribute('xmlns', ns)
      root.setAttribute('width', fmt(page.width))
      root.setAttribute('height', fmt(page.height))
      root.setAttribute('viewBox', `${fmt(page.x)} ${fmt(page.y)} ${fmt(page.width)} ${fmt(page.height)}`)
      // White page sheet behind the artwork (raster PDF shows the sheet too).
      const sheet = document.createElementNS(ns, 'rect')
      sheet.setAttribute('x', fmt(page.x))
      sheet.setAttribute('y', fmt(page.y))
      sheet.setAttribute('width', fmt(page.width))
      sheet.setAttribute('height', fmt(page.height))
      sheet.setAttribute('fill', '#ffffff')
      root.insertBefore(sheet, root.firstChild)
      if (opts?.marks && bleed > 0) {
        this.appendCropMarks(root, ns, board, bleed)
      }
      return root
    } catch {
      return null
    } finally {
      hiddenLayers.forEach((layer) => {
        layer.visible = true
      })
      this.scope.view.update()
    }
  }

  /**
   * Hairline crop marks at the trim corners (drawn inside the bleed box,
   * flush to the page edges). Imposition stays one-up: every board is its
   * own PDF page.
   */
  private appendCropMarks(
    root: SVGSVGElement,
    ns: string,
    trim: { x: number; y: number; width: number; height: number },
    bleed: number
  ): void {
    const fmt = (n: number): string => String(Math.round(n * 100) / 100)
    const len = Math.min(12, Math.max(3, bleed * 0.8))
    const x0 = trim.x
    const x1 = trim.x + trim.width
    const y0 = trim.y
    const y1 = trim.y + trim.height
    const segs: Array<[number, number, number, number]> = [
      // Top-left corner.
      [x0 - bleed, y0, x0 - bleed + len, y0],
      [x0, y0 - bleed, x0, y0 - bleed + len],
      // Top-right corner.
      [x1 + bleed - len, y0, x1 + bleed, y0],
      [x1, y0 - bleed, x1, y0 - bleed + len],
      // Bottom-left corner.
      [x0 - bleed, y1, x0 - bleed + len, y1],
      [x0, y1 + bleed - len, x0, y1 + bleed],
      // Bottom-right corner.
      [x1 + bleed - len, y1, x1 + bleed, y1],
      [x1, y1 + bleed - len, x1, y1 + bleed],
    ]
    const group = document.createElementNS(ns, 'g')
    group.setAttribute('fill', 'none')
    group.setAttribute('stroke', '#000000')
    group.setAttribute('stroke-width', '0.5')
    for (const [ax, ay, bx, by] of segs) {
      const line = document.createElementNS(ns, 'line')
      line.setAttribute('x1', fmt(ax))
      line.setAttribute('y1', fmt(ay))
      line.setAttribute('x2', fmt(bx))
      line.setAttribute('y2', fmt(by))
      group.appendChild(line)
    }
    root.appendChild(group)
  }

  // ===== Object order / visibility / select-same =====

  /**
   * Bring the selection to the very front (top of each parent stack).
   * Returns false (no history) when nothing is selected.
   */
  bringSelectionToFront(): boolean {
    const items = this.getSelection().filter((i) => !i.locked)
    if (items.length === 0) return false
    items.forEach((i) => i.bringToFront())
    this.scope.view.update()
    this.pushHistory('Bring to Front')
    return true
  }

  /**
   * Send the selection to the very back. Returns false when empty.
   */
  sendSelectionToBack(): boolean {
    const items = this.getSelection().filter((i) => !i.locked)
    if (items.length === 0) return false
    items.forEach((i) => i.sendToBack())
    this.scope.view.update()
    this.pushHistory('Send to Back')
    return true
  }

  /**
   * Move every selected item one step towards the front within its parent.
   * Items move front-most first so multi-selections keep their order.
   */
  bringForward(): void {
    this.shiftSelectedOrder(1)
    this.pushHistory('Bring Forward')
    this.scope.view.update()
  }

  /** Move every selected item one step towards the back within its parent. */
  sendBackward(): void {
    this.shiftSelectedOrder(-1)
    this.pushHistory('Send Backward')
    this.scope.view.update()
  }

  /**
   * Group the selection (needs 2+ top-level members). The group is placed
   * explicitly — never via `new Group(items)`, which paper inserts into
   * `project.activeLayer` (often a chrome layer, hiding the group from the
   * panel). Shared parents keep the back-most member's slot so contiguous
   * ranges never jump; cross-parent selections collect into the front-most
   * member's parent, like Illustrator. Returns false when grouped nothing.
   */
  groupSelection(): boolean {
    const items = this.getSelection().filter((item) => item.parent)
    if (items.length < 2) return false
    // Back-to-front document order (isAbove/isBelow span layers).
    const ordered = items
      .slice()
      .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))
    const shared = ordered.every((item) => item.parent === ordered[0].parent)
    const anchor = shared ? ordered[0] : ordered[ordered.length - 1]
    const parent = anchor.parent ?? this.getActiveLayer()
    let at = parent.children.indexOf(anchor)
    if (at < 0) at = parent.children.length
    const group = new this.scope.Group({ insert: false }) as paper.Group
    for (const node of ordered) group.addChild(node)
    parent.insertChild(Math.min(at, parent.children.length), group)
    group.data.id = this.genId()
    group.data.isUserItem = true
    this.selectItem(group)
    this.pushHistory('Group')
    this.scope.view.update()
    return true
  }

  /**
   * Ungroup selected groups/sublayers (children keep slot, selection
   * clears). Clipping masks and path-text runs are skipped — they have
   * dedicated release commands. Returns false when nothing ungrouped.
   */
  ungroupSelection(): boolean {
    const groups = this.getSelection().filter(
      (i) =>
        i instanceof this.scope.Group &&
        (i.data as any)?.id &&
        (i.data as any)?.textMode !== 'path' &&
        !this.isClipGroup(i as paper.Group)
    ) as paper.Group[]
    if (groups.length === 0) return false
    const released: paper.Item[] = []
    groups.forEach((g) => {
      const children = g.children.slice()
      const parent = g.parent
      const at = parent ? parent.children.indexOf(g) : -1
      children.forEach((c: any) => {
        if (parent) parent.insertChild(at < 0 ? parent.children.length : at, c)
        released.push(c)
      })
      g.remove()
    })
    this.clearSelection()
    released.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.pushHistory('Ungroup')
    this.scope.view.update()
    return true
  }

  /**
   * Ungroup recursively until no selected group remains (cycle-guarded).
   * Each level records its own history entry, like repeated Ungroup.
   * Returns levels released.
   */
  ungroupAllSelected(): number {
    let levels = 0
    for (let i = 0; i < 100; i++) {
      if (!this.ungroupSelection()) break
      levels++
    }
    return levels
  }

  /**
   * Select every visible unlocked top-level user item across all layers.
   */
  selectAllArtwork(): void {
    this.project.deselectAll()
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      for (const child of layer.children) {
        const item = child as paper.Item
        if (!item.visible || (item as any).locked) continue
        item.selected = true
      }
    }
    this.syncSelectionToStore()
    this.scope.view.update()
  }

  /** Swap each selected item with the sibling beside it in `direction`. */
  private shiftSelectedOrder(direction: 1 | -1): void {
    const moving = new Set(this.getSelection())
    if (moving.size === 0) return
    const byParent = new Map<paper.Item, paper.Item[]>()
    for (const item of moving) {
      const parent = item.parent
      if (!parent) continue
      const list = byParent.get(parent) ?? []
      list.push(item)
      byParent.set(parent, list)
    }
    for (const [parent, items] of byParent) {
      const children = parent.children as paper.Item[]
      items.sort((a, b) =>
        direction > 0
          ? children.indexOf(b) - children.indexOf(a)
          : children.indexOf(a) - children.indexOf(b)
      )
      for (const item of items) {
        const at = children.indexOf(item)
        const target = at + direction
        if (target < 0 || target >= children.length) continue
        // A selected neighbor travels with the block: leave it in place.
        if (moving.has(children[target])) continue
        parent.insertChild(target, item)
      }
    }
  }

  /**
   * Lock or unlock the current selection (locked items skip most tools).
   * Uses the raw flagged set (not the top-most selection): lock checks
   * throughout the tools are per-item, so group members need their own
   * flags to actually stay unselectable.
   */
  setSelectedLocked(locked: boolean): void {
    const items = this.project.selectedItems as paper.Item[]
    if (items.length === 0) return
    items.forEach((item) => {
      item.locked = locked
    })
    this.pushHistory(locked ? 'Lock' : 'Unlock')
    this.scope.view.update()
  }

  /** Unlock every user item in the document. */
  unlockAll(): void {
    let changed = false
    for (const item of this.walkUserItems()) {
      if (item.locked) {
        item.locked = false
        changed = true
      }
    }
    if (changed) this.pushHistory('Unlock All')
    this.scope.view.update()
  }

  /** Hide or show the current selection. */
  setSelectedVisible(visible: boolean): void {
    const items = this.getSelection()
    if (items.length === 0) return
    items.forEach((item) => {
      item.visible = visible
    })
    this.pushHistory(visible ? 'Show' : 'Hide')
    this.scope.view.update()
  }

  /**
   * Lock every unlocked top-level user item outside the selection
   * (Unlock All restores). Returns newly locked count; one history.
   */
  lockOthers(): number {
    const selection = this.getSelection()
    if (selection.length === 0) return 0
    const keep = new Set<paper.Item>()
    for (const item of selection) {
      let at: paper.Item | null = item
      while (at) {
        keep.add(at)
        at = at.parent
      }
    }
    let locked = 0
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      for (const child of layer.children) {
        const c = child as paper.Item
        if (keep.has(c) || (c as any).locked) continue
        c.locked = true
        locked++
      }
    }
    if (locked > 0) {
      this.pushHistory('Lock Others')
      this.scope.view.update()
    }
    return locked
  }

  /**
   * Reverse the stacking order of the unlocked selection (keeps every
   * item in its own parent; cross-layer order untouched). One history.
   */
  reverseOrder(): number {
    const items = this.getSelection().filter((item) => !item.locked && item.parent)
    if (items.length < 2) return 0
    const byParent = new Map<paper.Item, paper.Item[]>()
    for (const item of items) {
      const parent = item.parent as paper.Item
      const list = byParent.get(parent) ?? []
      list.push(item)
      byParent.set(parent, list)
    }
    let moved = 0
    for (const [parent, group] of byParent) {
      if (group.length < 2) continue
      const kids = ((parent as any).children as paper.Item[]).slice()
      const slots = group
        .map((g) => kids.indexOf(g))
        .filter((s) => s >= 0)
        .sort((a, b) => a - b)
      if (slots.length < 2) continue
      const reversed = group
        .slice()
        .sort((a, b) => kids.indexOf(a) - kids.indexOf(b))
        .reverse()
      for (const g of group) {
        try {
          g.remove()
        } catch { /* already gone */ }
      }
      slots.forEach((slot, i) => {
        ;(parent as any).insertChild(Math.min(slot, (parent as any).children.length), reversed[i])
        moved++
      })
    }
    if (moved > 0) {
      this.pushHistory('Reverse Order')
      this.scope.view.update()
      return moved
    }
    return 0
  }

  /** Show every user item in the document. */
  showAll(): void {
    let changed = false
    for (const item of this.walkUserItems()) {
      if (!item.visible) {
        item.visible = true
        changed = true
      }
    }
    if (changed) this.pushHistory('Show All')
    this.scope.view.update()
  }

  /**
   * Hide everything except the selection (Show All restores). Top-level
   * user items carrying any selected descendant stay. Returns hidden
   * count; one history entry.
   */
  isolateVisible(): number {
    const selection = this.getSelection()
    if (selection.length === 0) return 0
    const keep = new Set<paper.Item>()
    for (const item of selection) {
      let at: paper.Item | null = item
      while (at) {
        keep.add(at)
        at = at.parent
      }
    }
    let hidden = 0
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      for (const child of layer.children) {
        const c = child as paper.Item
        if (keep.has(c) || !c.visible) continue
        c.visible = false
        hidden++
      }
    }
    if (hidden > 0) {
      this.pushHistory('Isolate Visible')
      this.scope.view.update()
    }
    return hidden
  }

  /**
   * Select every appearance leaf sharing an attribute of the
   * first selected leaf (fill / stroke color, stroke width, opacity or
   * blend mode). Tolerance applies to fill/stroke as an RGB distance
   * (wand slider). Returns how many items were selected. Additive mode
   * keeps the existing selection (wand Shift-click parity).
   */
  selectSame(
    attribute: 'fill' | 'stroke' | 'strokeWidth' | 'opacity' | 'blendMode',
    additive = false,
    tolerance = 0
  ): number {
    const leaves = this.appearanceLeaves()
    if (leaves.length === 0) return 0
    const reference = this.getSelection()
      .map((item) => this.firstLeaf(item))
      .find((leaf) => leaf !== null) as paper.Item | undefined
    if (!reference) return 0
    const tol = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 0
    let matches: paper.Item[]
    if (tol > 0 && (attribute === 'fill' || attribute === 'stroke')) {
      const paint = (reference as any)[attribute === 'fill' ? 'fillColor' : 'strokeColor'] as any
      if (paint?.gradient) return 0
      const refCss = this.colorToCSS(paint)
      const refRgba = refCss ? parseCssColor(refCss) : null
      if (!refRgba) return 0
      matches = leaves.filter((leaf) => {
        const other = (leaf as any)[attribute === 'fill' ? 'fillColor' : 'strokeColor'] as any
        if (!other || other.gradient) return refCss === 'none' && !other
        const css = this.colorToCSS(other)
        const rgba = css ? parseCssColor(css) : null
        if (!rgba) return false
        return colorDistanceRgb(refRgba, rgba) <= tol
      })
    } else {
      const key = this.appearanceKey(reference, attribute)
      matches = leaves.filter((leaf) => this.appearanceKey(leaf, attribute) === key)
    }
    if (!additive) this.clearSelection()
    matches.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.scope.view.update()
    return matches.length
  }

  /** Fill / stroke / width / opacity / blend key used by select-same. */
  private appearanceKey(item: paper.Item, attribute: 'fill' | 'stroke' | 'strokeWidth' | 'opacity' | 'blendMode'): string {
    if (attribute === 'strokeWidth') return `w:${Math.round((Number((item as any).strokeWidth) || 0) * 100) / 100}`
    if (attribute === 'opacity') return `o:${Math.round((Number((item as any).opacity ?? 1)) * 1000) / 1000}`
    if (attribute === 'blendMode') return `b:${String((item as any).blendMode ?? 'source-over')}`
    const color = (
      attribute === 'fill'
        ? (item as any).fillColor
        : (item as any).strokeColor
    ) as any
    if (color && color.gradient) return 'gradient'
    return this.colorToCSS(color) ?? 'none'
  }

  /** First style-carrying leaf under an item (itself when it is one). */
  private firstLeaf(item: paper.Item): paper.Item | null {
    const scope = this.scope
    if (
      item instanceof scope.Path ||
      item instanceof scope.CompoundPath ||
      item instanceof scope.PointText
    ) {
      return item
    }
    const children = (item as any).children as paper.Item[] | undefined
    if (children) {
      for (const child of children) {
        const found = this.firstLeaf(child)
        if (found) return found
      }
    }
    return null
  }

  /** Every selectable style-carrying leaf (locked / hidden art excluded). */
  private appearanceLeaves(): paper.Item[] {
    const scope = this.scope
    const out: paper.Item[] = []
    const walk = (item: paper.Item, hidden: boolean, locked: boolean) => {
      const data = (item.data as any) ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.annotation) return
      hidden = hidden || (item as any).visible === false
      locked = locked || !!(item as any).locked
      if (data.isPatternTile) return
      // Clip masks are scaffolding: match the visible content instead.
      if ((item as any).clipMask) return
      if (
        item instanceof scope.Path ||
        item instanceof scope.CompoundPath ||
        item instanceof scope.PointText
      ) {
        if (!hidden && !locked) out.push(item)
        return
      }
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) walk(child, hidden, locked)
      }
    }
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer) continue
      const layerHidden = (layer as any).visible === false
      const layerLocked = !!(layer as any).locked
      for (const child of layer.children) walk(child as paper.Item, layerHidden, layerLocked)
    }
    return out
  }

  /** Every user item including group descendants (lock / visibility sweeps). */
  private *walkUserItems(): Generator<paper.Item> {
    const walk = function* (item: paper.Item): Generator<paper.Item> {
      yield item
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) yield* walk(child)
      }
    }
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer) continue
      for (const child of layer.children) yield* walk(child as paper.Item)
    }
  }

  // ===== Path construction (compound / join / outline) =====

  /**
   * Merge unlocked selected paths into one compound path with even-odd
   * holes. Compound operands contribute their children so nesting never
   * stacks. The result takes the back operand style (painted onto every
   * leaf so rendering never depends on inheritance) and its stacking slot.
   */
  makeCompoundPath(): boolean {
    const scope = this.scope
    const operands = this.getSelection().filter(
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
    const style = this.getStyleFromItem(base)
    const parent = base.parent ?? this.getActiveLayer()
    const rawAt = parent.children.indexOf(base)
    const at = rawAt < 0 ? parent.children.length : rawAt
    const compound = new scope.CompoundPath({ insert: false }) as paper.CompoundPath
    for (const leaf of leaves) compound.addChild(leaf)
    for (const operand of ordered) operand.remove()
    parent.insertChild(Math.min(at, parent.children.length), compound)
    compound.data.id = this.genId()
    compound.data.isUserItem = true
    this.applyStyleToItem(compound, style)
    for (const leaf of leaves) {
      const node = leaf as any
      if (node.fillColor !== undefined) node.fillColor = style.fillColor
      if (node.strokeColor !== undefined) node.strokeColor = style.strokeColor
      if (node.strokeWidth !== undefined) node.strokeWidth = style.strokeWidth
    }
    compound.fillRule = 'evenodd'
    this.clearSelection()
    compound.selected = true
    this.syncSelectionToStore()
    this.pushHistory('Make Compound Path')
    this.scope.view.update()
    return true
  }

  /**
   * Release selected compound paths back into plain paths. Each child
   * keeps its stacking slot and inherits the compound style so the artwork
   * looks identical after the release.
   */
  releaseCompoundPath(): boolean {
    const scope = this.scope
    const compounds = this.getSelection().filter(
      (item) => !item.locked && item.parent && item instanceof scope.CompoundPath
    ) as paper.CompoundPath[]
    if (compounds.length === 0) return false
    const released: paper.Item[] = []
    for (const compound of compounds) {
      const style = this.getStyleFromItem(compound)
      const parent = compound.parent ?? this.getActiveLayer()
      let at = parent.children.indexOf(compound)
      if (at < 0) at = parent.children.length
      for (const child of compound.children.slice()) {
        const node = child as paper.Item
        parent.insertChild(Math.min(at, parent.children.length), node)
        at++
        node.data.id = this.genId()
        node.data.isUserItem = true
        this.applyStyleToItem(node, style)
        released.push(node)
      }
      compound.remove()
    }
    this.clearSelection()
    released.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.pushHistory('Release Compound Path')
    this.scope.view.update()
    return true
  }

  /**
   * Join exactly two unlocked open paths end to end. The closest endpoint
   * pair wins; a gap bridges with a straight span and coincident ends merge
   * cleanly. Curves keep their handles (reversed where the walk flips).
   */
  joinPaths(): boolean {
    const scope = this.scope
    const paths = this.getSelection().filter(
      (item) =>
        !item.locked &&
        item.parent &&
        item instanceof scope.Path &&
        !(item instanceof scope.CompoundPath) &&
        !item.closed &&
        item.segments.length > 0
    ) as paper.Path[]
    if (paths.length !== 2) return false
    const ordered = paths
      .slice()
      .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))
    const [first, second] = ordered
    const aEnds = [first.segments[0].point, first.segments[first.segments.length - 1].point]
    const bEnds = [second.segments[0].point, second.segments[second.segments.length - 1].point]
    // [aEnd, bEnd, aUsesFirst, bUsesFirst]
    const pairs: Array<[paper.Point, paper.Point, boolean, boolean]> = [
      [aEnds[1], bEnds[0], false, true],
      [aEnds[1], bEnds[1], false, false],
      [aEnds[0], bEnds[0], true, true],
      [aEnds[0], bEnds[1], true, false],
    ]
    let best = pairs[0]
    let bestDist = Infinity
    for (const pair of pairs) {
      const dist = pair[0].getDistance(pair[1])
      if (dist < bestDist) {
        bestDist = dist
        best = pair
      }
    }
    const style = this.getStyleFromItem(first)
    return this.mergePathsEndToEnd(first, second, best[2], best[3], style)
  }

  /**
   * Merge two open paths end to end with explicit orientations: each path
   * walks so the joined ends meet (useFirst reverses the walk). Shared by
   * auto nearest-pair join and sub-selection endpoint join.
   */
  mergePathsEndToEnd(
    first: paper.Path,
    second: paper.Path,
    firstUsesFirst: boolean,
    secondUsesFirst: boolean,
    style?: StyleState
  ): boolean {
    const scope = this.scope
    if (!first.parent || !second.parent) return false
    const paint = style ?? this.getStyleFromItem(first)
    const parent = first.parent ?? this.getActiveLayer()
    const rawAt = parent.children.indexOf(first)
    const at = rawAt < 0 ? parent.children.length : rawAt
    const merged = new scope.Path({ insert: false }) as paper.Path
    const pushOriented = (path: paper.Path, useFirst: boolean) => {
      const segs = path.segments
      if (!useFirst) {
        for (const seg of segs) merged.add(this.cloneSegment(seg))
      } else {
        for (let i = segs.length - 1; i >= 0; i--) merged.add(this.reversedSegment(segs[i]))
      }
    }
    pushOriented(first, firstUsesFirst)
    pushOriented(second, secondUsesFirst)
    merged.closed = false
    first.remove()
    second.remove()
    parent.insertChild(Math.min(at, parent.children.length), merged)
    merged.data.id = this.genId()
    merged.data.isUserItem = true
    this.applyStyleToItem(merged, paint)
    this.clearSelection()
    merged.selected = true
    this.syncSelectionToStore()
    this.pushHistory('Join Paths')
    this.scope.view.update()
    return true
  }

  /** Copy a segment (points and handles cloned). */
  private cloneSegment(seg: paper.Segment): paper.Segment {
    const scope = this.scope
    return new scope.Segment(
      seg.point.clone(),
      seg.handleIn ? seg.handleIn.clone() : undefined,
      seg.handleOut ? seg.handleOut.clone() : undefined
    )
  }

  /**
   * Copy a segment for backwards traversal: the anchor stays, handles swap
   * sides (no negation — a reversed bezier reuses the same offsets).
   */
  private reversedSegment(seg: paper.Segment): paper.Segment {
    const scope = this.scope
    return new scope.Segment(
      seg.point.clone(),
      seg.handleOut ? seg.handleOut.clone() : undefined,
      seg.handleIn ? seg.handleIn.clone() : undefined
    )
  }

  /**
   * Expand selected stroked paths into filled outlines (Illustrator Expand
   * for strokes). The outline takes the stroke color and opacity; when the
   * source also carries a fill, the two unite so nothing is lost. Dash
   * patterns expand along the centerline.
   */
  outlineStroke(): boolean {
    const scope = this.scope
    const targets = this.getSelection().filter(
      (item) =>
        !item.locked &&
        item.parent &&
        (item instanceof scope.Path || item instanceof scope.CompoundPath) &&
        (item as any).strokeColor &&
        Number((item as any).strokeWidth) > 0
    ) as Array<paper.Path | paper.CompoundPath>
    if (targets.length === 0) return false
    const expanded: paper.Item[] = []
    for (const target of targets) {
      const result = this.expandOneStroke(target)
      if (result) expanded.push(...result)
    }
    if (expanded.length === 0) return false
    this.clearSelection()
    expanded.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.pushHistory('Outline Stroke')
    this.scope.view.update()
    return true
  }

  /** Expand one stroked path; null when the geometry defeats the offset. */
  private expandOneStroke(target: paper.Path | paper.CompoundPath): paper.Item[] | null {
    const source = target as any
    const width = Number(source.strokeWidth) || 0
    if (!(width > 0) || !source.strokeColor) return null
    const join =
      source.strokeJoin === 'round' ? 'round' : source.strokeJoin === 'bevel' ? 'bevel' : 'miter'
    const cap = source.strokeCap === 'round' ? 'round' : 'butt'
    const limit = Number(source.miterLimit) || 10
    let outline: paper.Path | paper.CompoundPath
    try {
      outline = PaperOffset.offsetStroke(target, width / 2, { join, cap, limit, insert: false })
    } catch {
      return null
    }
    if (!outline) return null
    const parent = target.parent ?? this.getActiveLayer()
    const rawAt = parent.children.indexOf(target)
    const at = rawAt < 0 ? parent.children.length : rawAt
    target.remove()
    const paint = (node: paper.Item) => {
      node.data.id = this.genId()
      node.data.isUserItem = true
      if (source.opacity !== undefined) node.opacity = source.opacity
      if (source.blendMode !== undefined) (node as any).blendMode = source.blendMode
    }
    // The library already paints the outline with the stroke color.
    if (source.fillColor) {
      const fillShape = target.clone({ insert: false }) as paper.Item
      ;(fillShape as any).strokeColor = null
      try {
        const combined = (outline as paper.PathItem).unite(fillShape as paper.PathItem, {
          insert: false,
        })
        paint(combined as paper.Item)
        parent.insertChild(Math.min(at, parent.children.length), combined as paper.Item)
        return [combined as paper.Item]
      } catch {
        // Keep both pieces as siblings instead of losing the fill.
        paint(outline as paper.Item)
        paint(fillShape)
        parent.insertChild(Math.min(at, parent.children.length), outline as paper.Item)
        parent.insertChild(Math.min(at + 1, parent.children.length), fillShape)
        return [outline as paper.Item, fillShape]
      }
    }
    paint(outline as paper.Item)
    parent.insertChild(Math.min(at, parent.children.length), outline as paper.Item)
    return [outline as paper.Item]
  }

  // ===== Clipping masks =====

  /**
   * Make a clipping mask from the selection: the front-most unlocked path
   * masks everything else selected. Paper.js clips through the bottom
   * child of a group, so the mask is inserted first. The mask paint clears
   * (plain-color paints are stashed on the mask for release).
   */
  makeClippingMask(): boolean {
    const scope = this.scope
    const items = this.getSelection().filter((item) => !item.locked && item.parent)
    if (items.length < 2) return false
    const ordered = items
      .slice()
      .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))
    const mask = ordered[ordered.length - 1] as paper.PathItem
    if (!(mask instanceof scope.Path) && !(mask instanceof scope.CompoundPath)) return false
    const content = ordered.slice(0, -1)
    const parent = mask.parent ?? this.getActiveLayer()
    const rawAt = parent.children.indexOf(mask)
    const at = rawAt < 0 ? parent.children.length : rawAt

    const maskAny = mask as any
    maskAny.data.maskPaint = {
      fill: this.cssOrNull(maskAny.fillColor),
      stroke: this.cssOrNull(maskAny.strokeColor),
      width: Number(maskAny.strokeWidth) || 0,
    }

    const group = new scope.Group({ insert: false }) as paper.Group
    group.addChild(mask)
    for (const node of content) group.addChild(node)
    // The flag only takes on grouped paths: set it after inserting.
    mask.clipMask = true
    if (maskAny.fillColor !== undefined) maskAny.fillColor = null
    if (maskAny.strokeColor !== undefined) maskAny.strokeColor = null
    parent.insertChild(Math.min(at, parent.children.length), group)
    group.data.id = this.genId()
    group.data.isUserItem = true
    this.clearSelection()
    group.selected = true
    this.syncSelectionToStore()
    this.pushHistory('Make Clipping Mask')
    this.scope.view.update()
    return true
  }

  /**
   * Release selected clipping groups: mask paints restore, children keep
   * their stacking slots and the group dissolves. Pattern-fill groups take
   * the pattern path instead (tiles are dropped, the base path restores).
   */
  releaseClippingMask(): boolean {
    const scope = this.scope
    const groups = this.getSelection().filter(
      (item) =>
        !item.locked && item.parent && item instanceof scope.Group && this.isClipGroup(item)
    ) as paper.Group[]
    if (groups.length === 0) return false
    const released: paper.Item[] = []
    let releasedPattern = false
    for (const group of groups) {
      if (this.isPatternGroup(group)) {
        const base = this.releasePatternGroup(group)
        if (base) released.push(base)
        releasedPattern = true
        continue
      }
      const parent = group.parent ?? this.getActiveLayer()
      let at = parent.children.indexOf(group)
      if (at < 0) at = parent.children.length
      for (const child of group.children.slice()) {
        const node = child as any
        if (node.clipMask) {
          node.clipMask = false
          const paint = node.data?.maskPaint as
            | { fill: string | null; stroke: string | null; width: number }
            | undefined
          if (paint) {
            if (node.fillColor !== undefined) node.fillColor = paint.fill
            if (node.strokeColor !== undefined) node.strokeColor = paint.stroke
            if (node.strokeWidth !== undefined && Number.isFinite(paint.width)) {
              node.strokeWidth = paint.width
            }
          }
          if (node.data) delete node.data.maskPaint
        }
        parent.insertChild(Math.min(at, parent.children.length), node)
        at++
        released.push(node)
      }
      group.remove()
    }
    this.clearSelection()
    released.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    if (releasedPattern) this.store.updateStyle({ pattern: null })
    this.pushHistory('Release Clipping Mask')
    this.scope.view.update()
    return true
  }

  /** Whether a group clips through a masked child. */
  private isClipGroup(group: paper.Group): boolean {
    for (const child of group.children) {
      if ((child as any).clipMask) return true
    }
    return false
  }

  /** Plain CSS color string, or null for empty / gradient paints. */
  private cssOrNull(color: any): string | null {
    if (!color || color.gradient) return null
    return color.toCSS(true) as string
  }

  /**
   * CSS for a plain color that keeps translucency: toCSS(true) drops the
   * alpha channel, so translucent colors serialize as rgba() instead.
   * Opaque colors keep the short hex form (stable select-same keys).
   */
  private colorToCSS(color: any): string | null {
    if (!color || color.gradient) return null
    if ((color.alpha ?? 1) < 1) return color.toCSS(false) as string
    return color.toCSS(true) as string
  }

  /**
   * Place a bitmap image into the active layer, centered on the current
   * view. The data URL source embeds the pixels so the image survives
   * history and save/reload round-trips. Selection and history land once
   * the pixels load.
   */
  placeImage(dataUrl: string, at?: paper.Point): void {
    const raster = new this.scope.Raster({ source: dataUrl }) as paper.Raster
    this.getActiveLayer().addChild(raster)
    raster.onLoad = () => {
      raster.position = (at ?? this.scope.view.center).clone()
      raster.data.id = this.genId()
      raster.data.isUserItem = true
      this.selectItem(raster)
      this.pushHistory('Place Image')
      this.showStatus('Image placed')
    }
    raster.onError = () => {
      raster.remove()
      this.showStatus('Image placement failed')
    }
  }

  /**
   * First selected raster as a downloadable PNG (AI asset extraction
   * parity). Reads back the raster canvas, so cross-origin-tainted
   * images resolve null instead of throwing. No history (read-only).
   */
  extractSelectedImage(): { url: string; filename: string } | null {
    const scope = this.scope
    const find = (node: paper.Item): paper.Raster | null => {
      if ((node as any).locked) return null
      if (node instanceof scope.Raster) return node
      const children = (node as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) {
          const hit = find(child)
          if (hit) return hit
        }
      }
      return null
    }
    for (const item of this.getSelection()) {
      const raster = find(item)
      if (!raster) continue
      try {
        const url = (raster as any).canvas?.toDataURL?.('image/png') as string | undefined
        if (!url || typeof url !== 'string' || !url.startsWith('data:')) continue
        const data = (raster as any).data ?? {}
        const raw = (raster as any).name ?? data.name
        const stem = typeof raw === 'string' && raw.trim() ? raw.trim().replace(/[\\/:*?"<>|]+/g, '-') : 'image'
        return { url, filename: `${stem}.png` }
      } catch {
        continue
      }
    }
    return null
  }

  /**
   * Repaint the first selected raster through a canvas 2D filter
   * (bitmap-effects lite): grayscale / sepia / invert plus brightness.
   * The filtered copy replaces the original at the same slot (a no-op
   * preset at 100% brightness resolves false). Tainted sources fail
   * gracefully with a status message and no history.
   */
  adjustImage(preset: 'none' | 'gray' | 'sepia' | 'invert', brightness: number): boolean {
    const scope = this.scope
    const b = Number.isFinite(brightness) ? Math.min(150, Math.max(50, brightness)) : 100
    if (preset === 'none' && b === 100) return false
    const find = (node: paper.Item): paper.Raster | null => {
      if ((node as any).locked || !node.parent) return null
      if (node instanceof scope.Raster) return node
      const children = (node as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) {
          const hit = find(child)
          if (hit) return hit
        }
      }
      return null
    }
    let source: paper.Raster | null = null
    for (const item of this.getSelection()) {
      source = find(item)
      if (source) break
    }
    if (!source) return false
    const canvas = (source as any).canvas as HTMLCanvasElement | undefined
    if (!canvas || canvas.width < 1 || canvas.height < 1) return false
    const parts: string[] = []
    if (preset === 'gray') parts.push('grayscale(1)')
    else if (preset === 'sepia') parts.push('sepia(1)')
    else if (preset === 'invert') parts.push('invert(1)')
    if (b !== 100) parts.push(`brightness(${Math.round((b / 100) * 100) / 100})`)
    if (parts.length === 0) return false
    this.stashOriginalSource(source)
    let url: string | null = null
    try {
      const out = document.createElement('canvas')
      out.width = canvas.width
      out.height = canvas.height
      const ctx = out.getContext('2d')
      if (!ctx) return false
      ctx.filter = parts.join(' ')
      ctx.drawImage(canvas, 0, 0)
      url = out.toDataURL('image/png')
    } catch {
      this.showStatus('Image adjust failed (unreadable pixels)')
      return false
    }
    if (!url) return false
    const parent = source.parent ?? this.getActiveLayer()
    const at = parent.children.indexOf(source as any)
    const opacity = (source as any).opacity
    const next = new scope.Raster({ source: url }) as paper.Raster
    parent.insertChild(Math.min(Math.max(at, 0), parent.children.length), next as any)
    next.onLoad = () => {
      next.position = (source as paper.Raster).position.clone()
      next.opacity = opacity
      next.data.id = this.genId()
      next.data.isUserItem = true
      try {
        ;(source as paper.Raster).remove()
      } catch { /* already gone */ }
      this.clearSelection()
      next.selected = true
      this.syncSelectionToStore()
      this.pushHistory('Adjust Image')
      this.scope.view.update()
      this.showStatus('Image adjusted')
    }
    next.onError = () => {
      try {
        next.remove()
      } catch { /* already gone */ }
      this.showStatus('Image adjust failed')
    }
    return true
  }

  /**
   * Downsample every selected raster to a fraction of its pixels (file /
   * history diet for photo-heavy documents): each raster re-encodes at
   * `factor` and scales back into its old bounds at the same slot.
   * Tainted sources fail gracefully per item. Histories record once when
   * all loads settle. Returns rasters queued.
   */
  downsampleImages(factor: number): number {
    const scope = this.scope
    const f = Number.isFinite(factor) ? Math.min(0.75, Math.max(0.25, factor)) : 0.5
    const targets: paper.Raster[] = []
    const walk = (node: paper.Item) => {
      if ((node as any).locked || !node.parent) return
      if (node instanceof scope.Raster) {
        targets.push(node)
        return
      }
      const children = (node as any).children as paper.Item[] | undefined
      if (children) for (const child of children) walk(child)
    }
    for (const item of this.getSelection()) walk(item)
    if (targets.length === 0) return 0
    let pending = targets.length
    let done = 0
    const finished: paper.Item[] = []
    const settle = (ok: boolean) => {
      if (ok) done++
      pending--
      if (pending === 0) {
        if (done > 0) {
          this.pushHistory('Downsample Images')
          this.scope.view.update()
          this.showStatus(`Downsampled ${done} image${done === 1 ? '' : 's'}`)
        } else {
          this.showStatus('Downsample failed')
        }
      }
    }
    for (const source of targets) {
      const canvas = (source as any).canvas as HTMLCanvasElement | undefined
      const bounds = (source as any).bounds as paper.Rectangle | undefined
      if (!canvas || canvas.width < 2 || canvas.height < 2 || !bounds) {
        settle(false)
        continue
      }
      this.stashOriginalSource(source)
      let url: string | null = null
      try {
        const out = document.createElement('canvas')
        out.width = Math.max(1, Math.round(canvas.width * f))
        out.height = Math.max(1, Math.round(canvas.height * f))
        const ctx = out.getContext('2d')
        if (!ctx) {
          settle(false)
          continue
        }
        ctx.drawImage(canvas, 0, 0, out.width, out.height)
        url = out.toDataURL('image/png')
      } catch {
        settle(false)
        continue
      }
      const parent = source.parent ?? this.getActiveLayer()
      const at = parent.children.indexOf(source as any)
      const opacity = (source as any).opacity
      const next = new scope.Raster({ source: url }) as paper.Raster
      parent.insertChild(Math.min(Math.max(at, 0), parent.children.length), next as any)
      next.onLoad = () => {
        const nb = (next as any).bounds as paper.Rectangle | undefined
        if (nb && nb.width > 0 && nb.height > 0) {
          next.scale(bounds.width / nb.width, bounds.height / nb.height)
        }
        next.position = bounds.center.clone()
        next.opacity = opacity
        next.data.id = this.genId()
        next.data.isUserItem = true
        try {
          source.remove()
        } catch { /* already gone */ }
        finished.push(next as paper.Item)
        this.clearSelection()
        finished.forEach((item) => {
          item.selected = true
        })
        this.syncSelectionToStore()
        settle(true)
      }
      next.onError = () => {
        try {
          next.remove()
        } catch { /* already gone */ }
        settle(false)
      }
    }
    return targets.length
  }

  /**
   * Remember a raster's current pixels once, so destructive bitmap ops
   * (adjust / downsample / replace) stay reversible via Reset Image.
   * Tainted canvases simply stash nothing.
   */
  private stashOriginalSource(raster: paper.Raster): void {
    const data = (raster as any).data ?? {}
    if (typeof data.originalSource === 'string' && data.originalSource.startsWith('data:')) return
    try {
      const url = (raster as any).canvas?.toDataURL?.('image/png') as string | undefined
      if (typeof url === 'string' && url.startsWith('data:')) data.originalSource = url
    } catch { /* tainted: nothing to stash */ }
  }

  /**
   * Restore the stashed pre-edit pixels of the first selected raster
   * (one level). Returns false with nothing to restore.
   */
  resetImage(): boolean {
    const scope = this.scope
    const find = (node: paper.Item): paper.Raster | null => {
      if ((node as any).locked || !node.parent) return null
      if (node instanceof scope.Raster) {
        const url = (node as any).data?.originalSource
        return typeof url === 'string' && url.startsWith('data:') ? node : null
      }
      const children = (node as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) {
          const hit = find(child)
          if (hit) return hit
        }
      }
      return null
    }
    let source: paper.Raster | null = null
    for (const item of this.getSelection()) {
      source = find(item)
      if (source) break
    }
    if (!source) return false
    const url = (source as any).data.originalSource as string
    const bounds = (source as any).bounds as paper.Rectangle | undefined
    if (!bounds || bounds.width < 1 || bounds.height < 1) return false
    const parent = source.parent ?? this.getActiveLayer()
    const at = parent.children.indexOf(source as any)
    const opacity = (source as any).opacity
    const next = new scope.Raster({ source: url }) as paper.Raster
    parent.insertChild(Math.min(Math.max(at, 0), parent.children.length), next as any)
    next.onLoad = () => {
      const nb = (next as any).bounds as paper.Rectangle | undefined
      if (nb && nb.width > 0 && nb.height > 0) {
        next.scale(bounds.width / nb.width, bounds.height / nb.height)
      }
      next.position = bounds.center.clone()
      next.opacity = opacity
      next.data.id = this.genId()
      next.data.isUserItem = true
      try {
        ;(source as paper.Raster).remove()
      } catch { /* already gone */ }
      this.clearSelection()
      next.selected = true
      this.syncSelectionToStore()
      this.pushHistory('Reset Image')
      this.scope.view.update()
      this.showStatus('Image restored')
    }
    next.onError = () => {
      try {
        next.remove()
      } catch { /* already gone */ }
      this.showStatus('Image restore failed')
    }
    return true
  }

  /**
   * Swap the first selected raster's pixels for a new file (relink
   * parity): the replacement scales into the old bounds at the same
   * slot, opacity and selection carry over. Tainted/empty files fail
   * gracefully. Returns false when nothing was queued.
   */
  replaceSelectedImage(dataUrl: string): boolean {    const scope = this.scope
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return false
    const find = (node: paper.Item): paper.Raster | null => {
      if ((node as any).locked || !node.parent) return null
      if (node instanceof scope.Raster) return node
      const children = (node as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) {
          const hit = find(child)
          if (hit) return hit
        }
      }
      return null
    }
    let source: paper.Raster | null = null
    for (const item of this.getSelection()) {
      source = find(item)
      if (source) break
    }
    if (!source) return false
    const bounds = (source as any).bounds as paper.Rectangle | undefined
    if (!bounds || bounds.width < 1 || bounds.height < 1) return false
    this.stashOriginalSource(source)
    const parent = source.parent ?? this.getActiveLayer()
    const at = parent.children.indexOf(source as any)
    const opacity = (source as any).opacity
    const next = new scope.Raster({ source: dataUrl }) as paper.Raster
    parent.insertChild(Math.min(Math.max(at, 0), parent.children.length), next as any)
    next.onLoad = () => {
      const nb = (next as any).bounds as paper.Rectangle | undefined
      if (nb && nb.width > 0 && nb.height > 0) {
        next.scale(bounds.width / nb.width, bounds.height / nb.height)
      }
      next.position = bounds.center.clone()
      next.opacity = opacity
      next.data.id = this.genId()
      next.data.isUserItem = true
      try {
        ;(source as paper.Raster).remove()
      } catch { /* already gone */ }
      this.clearSelection()
      next.selected = true
      this.syncSelectionToStore()
      this.pushHistory('Replace Image')
      this.scope.view.update()
      this.showStatus('Image replaced')
    }
    next.onError = () => {
      try {
        next.remove()
      } catch { /* already gone */ }
      this.showStatus('Image replacement failed')
    }
    return true
  }

  // ===== Symbols =====
  /**
   * Symbol definitions live behind hidden keeper instances (one invisible
   * SymbolItem per definition on a locked non-user layer). Keepers keep
   * unused definitions referenced so they survive snapshots, undo and
   * save files; they never render, hit-test, export or list anywhere.
   */
  private getKeeperLayer(create = true): paper.Layer | null {
    const existing = this.project.layers.find(
      (l) => (l.data as any)?.isSymbolKeeper
    ) as paper.Layer | undefined
    if (existing) return existing
    if (!create) return null
    const layer = new this.scope.Layer()
    layer.name = 'symbols'
    layer.locked = true
    layer.visible = false
    layer.data.isUserLayer = false
    layer.data.isSymbolKeeper = true
    return layer
  }

  /** All symbol keepers (library entries) in creation order. */
  private getKeepers(): paper.SymbolItem[] {
    const layer = this.getKeeperLayer(false)
    if (!layer) return []
    return (layer.children as paper.Item[]).filter(
      (child) => (child.data as any)?.symbolId
    ) as paper.SymbolItem[]
  }

  /** First unused "Symbol N" name. */
  private nextSymbolName(): string {
    const names = new Set(this.getKeepers().map((k) => (k.data as any)?.symbolName as string))
    let n = this.getKeepers().length + 1
    while (names.has(`Symbol ${n}`)) n++
    return `Symbol ${n}`
  }

  /**
   * Library entries with live instance counts (keepers excluded from the
   * count). The panel rebuilds off history/selection changes.
   */
  listSymbols(): SymbolEntry[] {
    const keepers = this.getKeepers()
    if (keepers.length === 0) return []
    const counts = new Map<object, number>()
    const tally = (item: paper.Item) => {
      if (item instanceof this.scope.SymbolItem && !(item.data as any)?.isKeeper) {
        const definition = (item as any)._definition ?? (item as any).definition
        if (definition) counts.set(definition, (counts.get(definition) ?? 0) + 1)
      }
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) tally(child)
      }
    }
    for (const layer of this.project.layers) {
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
  defineSymbolFromSelection(): boolean {
    const scope = this.scope
    const items = this.getSelection().filter((item) => !item.locked && item.parent)
    if (items.length === 0) return false
    const root =
      items.length === 1 ? items[0] : (new scope.Group(items) as paper.Group)
    const definition = new scope.SymbolDefinition(root)
    const keeperLayer = this.getKeeperLayer()
    if (!keeperLayer) return false
    const keeper = definition.place(new scope.Point(0, 0)) as paper.SymbolItem
    keeper.visible = false
    keeper.data.symbolId = this.genId()
    keeper.data.symbolName = this.nextSymbolName()
    keeper.data.isKeeper = true
    const wasLocked = keeperLayer.locked
    keeperLayer.locked = false
    keeperLayer.addChild(keeper)
    keeperLayer.locked = wasLocked
    this.clearSelection()
    this.pushHistory('Make Symbol')
    this.scope.view.update()
    return true
  }

  /** Place a symbol instance at the view center and select it. */
  placeSymbol(id: string): boolean {
    const keeper = this.getKeepers().find((k) => (k.data as any)?.symbolId === id)
    if (!keeper) return false
    const definition = (keeper as any)._definition ?? (keeper as any).definition
    if (!definition) return false
    const instance = definition.place(this.scope.view.center.clone()) as paper.SymbolItem
    const layer = this.getActiveLayer()
    layer.addChild(instance)
    instance.data.id = this.genId()
    instance.data.isUserItem = true
    this.store.setSpraySymbol(id)
    this.selectItem(instance)
    this.pushHistory('Place Symbol')
    this.scope.view.update()
    return true
  }

  /**
   * Scatter one symbol instance for the sprayer (no history; the stroke
   * records once on release). Scale/rotation jitter around 1 / 0.
   * Returns the instance, or null for an unknown definition.
   */
  spraySymbol(id: string, point: paper.Point, scale: number, rotation: number): paper.SymbolItem | null {
    const keeper = this.getKeepers().find((k) => (k.data as any)?.symbolId === id)
    if (!keeper) return null
    const definition = (keeper as any)._definition ?? (keeper as any).definition
    if (!definition) return null
    const instance = definition.place(point.clone()) as paper.SymbolItem
    try {
      if (Number.isFinite(scale) && scale > 0) instance.scaling = new this.scope.Point(scale, scale)
      if (Number.isFinite(rotation) && rotation !== 0) instance.rotation = rotation
    } catch { /* jitter is best-effort; the dab still lands */ }
    this.getActiveLayer().addChild(instance)
    instance.data.id = this.genId()
    instance.data.isUserItem = true
    return instance
  }

  /** Delete a symbol definition (placed instances keep working). */
  deleteSymbol(id: string): boolean {
    const keeper = this.getKeepers().find((k) => (k.data as any)?.symbolId === id)
    if (!keeper) return false
    keeper.remove()
    this.pushHistory('Delete Symbol')
    this.scope.view.update()
    return true
  }

  /** Rename a symbol definition (metadata only, no history). */
  renameSymbol(id: string, name: string): void {
    const keeper = this.getKeepers().find((k) => (k.data as any)?.symbolId === id)
    if (!keeper) return
    ;(keeper.data as any).symbolName = name
    this.scope.view.update()
  }

  /**
   * Break selected symbol instances into plain artwork: definition content
   * cloned through the instance matrix, keeping slot, paint and stacking.
   */
  breakSymbolLinks(): boolean {
    const scope = this.scope
    const instances = this.getSelection().filter(
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
      const parent = instance.parent ?? this.getActiveLayer()
      const rawAt = parent.children.indexOf(instance)
      parent.insertChild(Math.min(Math.max(rawAt, 0), parent.children.length), content)
      content.data.id = this.genId()
      content.data.isUserItem = true
      instance.remove()
      released.push(content)
    }
    if (released.length === 0) return false
    this.clearSelection()
    released.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.pushHistory('Break Symbol Link')
    this.scope.view.update()
    return true
  }

  /**
   * Swap selected symbol instances to another definition (AI Replace
   * Symbol parity): position, rotation, scaling and opacity carry over,
   * slot and stacking stay. Returns instances swapped; one history entry.
   */
  swapSymbolInstances(symbolId: string): number {
    const scope = this.scope
    const keeper = this.getKeepers().find((k) => (k.data as any)?.symbolId === symbolId)
    if (!keeper) return 0
    const definition = (keeper as any)._definition ?? (keeper as any).definition
    if (!definition) return 0
    const instances = this.getSelection().filter(
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
      const parent = instance.parent ?? this.getActiveLayer()
      const rawAt = parent.children.indexOf(instance)
      parent.insertChild(Math.min(Math.max(rawAt, 0), parent.children.length), next as any)
      next.data.id = this.genId()
      next.data.isUserItem = true
      instance.remove()
      swapped.push(next as paper.Item)
    }
    if (swapped.length === 0) return 0
    this.clearSelection()
    swapped.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.pushHistory('Swap Symbol')
    this.scope.view.update()
    return swapped.length
  }

  /**
   * Select every placed instance of a symbol definition (locked ones
   * stay out, like every selection path). Returns instances selected.
   */
  selectSymbolInstances(symbolId: string): number {
    const scope = this.scope
    const keeper = this.getKeepers().find((k) => (k.data as any)?.symbolId === symbolId)
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
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible) continue
      for (const child of layer.children) walk(child as paper.Item)
    }
    this.clearSelection()
    hits.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.scope.view.update()
    return hits.length
  }

  // ===== Isolation mode =====

  /** Isolated group root (object identity; cleared on any snapshot). */
  private isolationRoot: paper.Group | null = null
  /** Pre-isolation visibility per hidden item. */
  private isolationBackup = new Map<paper.Item, boolean>()

  /**
   * Isolate a group for focused editing: everything outside its subtree
   * hides. Ephemeral UI state (like selection): no history entry, and any
   * snapshot restore drops the mode so the two can never disagree.
   */
  enterIsolation(root: paper.Group): boolean {
    if (!root.parent || !root.visible) return false
    if (this.isolationRoot) this.exitIsolation()
    const inside = new Set<paper.Item>()
    const collect = (item: paper.Item): void => {
      inside.add(item)
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) collect(child)
      }
    }
    collect(root)
    this.isolationBackup.clear()
    for (const item of this.walkUserItems()) {
      if (inside.has(item)) continue
      this.isolationBackup.set(item, item.visible)
      // Flag isolation-driven hides so snapshot restores can tell them
      // apart from user hides (data survives project JSON).
      if (item.visible) (item.data as any).isolationHidden = true
      item.visible = false
    }
    this.isolationRoot = root
    this.store.setIsolationActive(true)
    this.scope.view.update()
    return true
  }

  /** Leave isolation, restoring pre-isolation visibility (best effort). */
  exitIsolation(): void {
    for (const [item, wasVisible] of this.isolationBackup) {
      if (item.parent) item.visible = wasVisible
      if ((item.data as any)) delete (item.data as any).isolationHidden
    }
    this.clearIsolationState()
    this.scope.view.update()
  }

  /** Drop isolation state without touching visibility (snapshot truth wins). */
  private clearIsolationState(): void {
    this.isolationRoot = null
    this.isolationBackup.clear()
    this.store.setIsolationActive(false)
  }

  // ===== Edit operations =====

  copySelected(): paper.Item[] {
    const items = this.getSelection()
    const clones: paper.Item[] = []
    const activeLayer = this.getActiveLayer()
    if (!activeLayer) return clones
    for (const item of items) {
      const clone = item.clone()
      activeLayer.addChild(clone)
      this.restampCloneTree(clone)
      clone.data.id = this.genId()
      clone.data.isUserItem = true
      clone.selected = true
      clones.push(clone)
    }
    return clones
  }

  /**
   * Assign fresh document ids across a cloned tree. Paper clones deep-copy
   * `data`, so without this the clone's descendants collide with the
   * original's ids (layer tree, thumbnails and id lookups hit the wrong
   * item). Only items that already carry a string id are restamped —
   * id-less tiles/chrome must stay id-less.
   */
  restampCloneTree(root: paper.Item): void {
    const walk = (item: paper.Item): void => {
      const data = (item as any).data
      if (data && typeof data.id === 'string') data.id = this.genId()
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) walk(child)
      }
    }
    walk(root)
  }

  // ===== Clipboard =====

  /** Detached clones of the most recent copy / cut selection. */
  private clipboardItems: paper.Item[] = []
  /** Owning user-layer id per clipboard entry (AI paste-remembers-layer). */
  private clipboardLayerIds: string[] = []
  /** Active-board origin at copy time (paste-on-all-boards anchor). */
  private clipboardBoard: { x: number; y: number } = { x: 0, y: 0 }
  /** How many pastes have been made from the current clipboard content. */
  private pasteCount = 0

  /**
   * Copy the current selection onto the internal clipboard as detached
   * clones. Returns how many items were copied. This stays synchronous for
   * instant in-app use; system clipboard exchange lives in
   * copyToSystemClipboard / pasteWithSystemFallback.
   */
  copySelectedToClipboard(): number {
    const items = this.getSelection().filter((item) => (item.data as any)?.isUserItem)
    this.clipboardItems = items.map((item) => item.clone({ insert: false }))
    this.clipboardLayerIds = items.map((item) => this.getItemLayerId((item.data as any)?.id ?? ''))
    const board = this.store.activeArtboard
    this.clipboardBoard = board ? { x: board.x, y: board.y } : { x: 0, y: 0 }
    this.pasteCount = 0
    return this.clipboardItems.length
  }

  /** Cut = copy onto the clipboard, then delete the selection. */
  cutSelectedToClipboard(): void {
    if (this.copySelectedToClipboard() === 0) return
    this.deleteSelected()
  }

  /**
   * Resolve the paste target for a clipboard entry: its source layer when
   * that layer still exists, is visible and unlocked (AI remembers layers),
   * else the active layer.
   */
  private pasteTargetLayer(layerId: string): paper.Layer {
    const found = this.project.layers.find(
      (l) => (l.data as any)?.isUserLayer && (l.data as any)?.layerId === layerId
    ) as paper.Layer | undefined
    if (found && found.visible && !found.locked) return found
    return this.getActiveLayer()
  }

  /**
   * Paste the internal clipboard in place (no offset), stacked at the very
   * front or back of each entry's layer. Returns false when it is empty.
   */
  pasteInPlace(where: 'front' | 'back'): boolean {
    if (this.clipboardItems.length === 0) return false
    const pasted: paper.Item[] = []
    for (let i = 0; i < this.clipboardItems.length; i++) {
      const source = this.clipboardItems[i]
      const layer = this.pasteTargetLayer(this.clipboardLayerIds[i] ?? '')
      const clone = source.clone({ insert: false })
      layer.addChild(clone)
      this.restampCloneTree(clone)
      clone.data.id = this.genId()
      clone.data.isUserItem = true
      if (where === 'front') clone.bringToFront()
      else clone.sendToBack()
      pasted.push(clone)
    }
    this.clearSelection()
    pasted.forEach((item) => (item.selected = true))
    this.syncSelectionToStore()
    this.pushHistory(where === 'front' ? 'Paste in Front' : 'Paste in Back')
    this.scope.view.update()
    return true
  }

  /**
   * Paste the clipboard clones into their source layers. Each paste is
   * offset by a small step so repeated pastes do not stack exactly on top
   * of the source, and the pasted items become the new selection.
   */
  pasteClipboard(): void {
    if (this.clipboardItems.length === 0) return
    // Each paste steps one increment further from the source position.
    this.pasteCount++
    const offset = new this.scope.Point(10 * this.pasteCount, 10 * this.pasteCount)
    const pasted: paper.Item[] = []
    for (let i = 0; i < this.clipboardItems.length; i++) {
      const source = this.clipboardItems[i]
      const layer = this.pasteTargetLayer(this.clipboardLayerIds[i] ?? '')
      const clone = source.clone({ insert: false })
      layer.addChild(clone)
      this.restampCloneTree(clone)
      clone.data.id = this.genId()
      clone.data.isUserItem = true
      clone.position = (clone.position as paper.Point).add(offset)
      pasted.push(clone)
    }
    this.clearSelection()
    pasted.forEach((item) => (item.selected = true))
    this.syncSelectionToStore()
    this.pushHistory('Paste')
    this.scope.view.update()
  }

  /**
   * Paste the clipboard onto every artboard (AI Paste on All Artboards
   * parity): each board gets the copies shifted by its origin delta from
   * the copy-time board. All pastes become the selection; one history.
   * Returns pastes made.
   */
  pasteOnAllBoards(): number {
    if (this.clipboardItems.length === 0) return 0
    const boards = this.store.artboards.filter((b) => b.width > 0 && b.height > 0)
    if (boards.length === 0) return 0
    const pasted: paper.Item[] = []
    for (const board of boards) {
      const delta = new this.scope.Point(board.x - this.clipboardBoard.x, board.y - this.clipboardBoard.y)
      for (let i = 0; i < this.clipboardItems.length; i++) {
        const layer = this.pasteTargetLayer(this.clipboardLayerIds[i] ?? '')
        const clone = this.clipboardItems[i].clone({ insert: false })
        layer.addChild(clone)
        this.restampCloneTree(clone)
        clone.data.id = this.genId()
        clone.data.isUserItem = true
        clone.position = (clone.position as paper.Point).add(delta)
        pasted.push(clone)
      }
    }
    if (pasted.length === 0) return 0
    this.clearSelection()
    pasted.forEach((item) => (item.selected = true))
    this.syncSelectionToStore()
    this.pushHistory('Paste on All Artboards')
    this.scope.view.update()
    return pasted.length
  }

  // ===== System clipboard (SVG exchange) =====

  /** Serialize unlocked selected user items into a standalone SVG string. */
  exportSelectionSVG(): string | null {
    const items = this.getSelection().filter(
      (item) => (item.data as any)?.isUserItem && !item.locked
    )
    if (items.length === 0) return null
    const bodies = items.map((item) => {
      const exported = item.exportSVG()
      return typeof exported === 'string'
        ? exported
        : new XMLSerializer().serializeToString(exported)
    })
    return `<svg xmlns="http://www.w3.org/2000/svg">${bodies.join('')}</svg>`
  }

  /**
   * Import an SVG document string into the active layer and select it.
   * Shared by file import and system clipboard paste. Returns false when
   * the payload holds no importable artwork; throws on malformed input.
   */
  importSVGText(svgText: string, historyLabel: string): boolean {
    const imported = this.project.importSVG(svgText)
    const layer = this.getActiveLayer()
    const items = (Array.isArray(imported) ? imported : [imported]).filter(
      Boolean
    ) as paper.Item[]
    if (items.length === 0) return false
    for (const item of items) {
      this.restampCloneTree(item)
      if (!(item as any).data) (item as any).data = {}
      ;((item as any).data as any).id = this.genId()
      ;((item as any).data as any).isUserItem = true
      layer.addChild(item)
    }
    this.syncLayersToStore()
    this.clearSelection()
    items.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.scope.view.update()
    this.pushHistory(historyLabel)
    return true
  }

  /** OS clipboard handle, or null outside secure contexts. */
  private systemClipboard(): Clipboard | null {
    if (typeof navigator === 'undefined') return null
    return navigator.clipboard ?? null
  }

  /** Payload of our last OS clipboard write (external-copy detection). */
  private lastSystemWrite = ''

  /**
   * Best-effort copy of the current selection to the OS clipboard as SVG so
   * artwork can move to other applications. Falls back from the SVG MIME
   * type to plain text. Resolves false when nothing is selected, the API is
   * unavailable or the write is denied.
   */
  async copyToSystemClipboard(): Promise<boolean> {
    const svg = this.exportSelectionSVG()
    if (!svg) return false
    // Remember our own payload so pastes can tell external SVG copies
    // apart from the echo of our last in-app copy.
    this.lastSystemWrite = svg
    const clipboard = this.systemClipboard()
    if (!clipboard) return false
    try {
      if (typeof ClipboardItem !== 'undefined' && clipboard.write) {
        const clipboardItem = new ClipboardItem({
          'image/svg+xml': new Blob([svg], { type: 'image/svg+xml' }),
          'text/plain': new Blob([svg], { type: 'text/plain' }),
        })
        await clipboard.write([clipboardItem])
        return true
      }
    } catch {
      // Fall through to the plain-text write below.
    }
    try {
      await clipboard.writeText(svg)
      return true
    } catch {
      return false
    }
  }

  /**
   * Paste SVG artwork from the OS clipboard. Returns false when the
   * clipboard is unavailable, holds no SVG or the payload is unusable, in
   * which case callers fall back to the internal clipboard.
   */
  async pasteFromSystemClipboard(): Promise<boolean> {
    const clipboard = this.systemClipboard()
    if (!clipboard || !clipboard.readText) return false
    const text = await clipboard.readText()
    if (!text || !/<svg[\s>]/i.test(text.trim().slice(0, 4096))) return false
    try {
      return this.importSVGText(text, 'Paste')
    } catch {
      return false
    }
  }

  /**
   * Paste entry point: the lossless internal clipboard first (OS
   * round-tripping through SVG drops Paper-only state like pattern fills
   * and thread links), OS clipboard SVG for cross-app pastes, nothing when
   * both are empty. An OS SVG payload we never wrote shadows stale
   * internal content (copied in-app, then copied elsewhere). Denied OS
   * access silently falls through.
   */
  async pasteWithSystemFallback(): Promise<void> {
    if (this.clipboardItems.length > 0) {
      try {
        const clipboard = this.systemClipboard()
        if (clipboard?.readText) {
          const text = await clipboard.readText()
          if (
            text &&
            /<svg[\s>]/i.test(text.trim().slice(0, 4096)) &&
            text !== this.lastSystemWrite &&
            (await this.pasteFromSystemClipboard())
          ) {
            return
          }
        }
      } catch {
        // Denied or unavailable OS access -> internal paste below.
      }
      this.pasteClipboard()
      return
    }
    try {
      if (await this.pasteFromSystemClipboard()) return
    } catch {
      // Denied or unavailable OS access -> nothing to paste below.
    }
  }

  deleteSelected() {
    const items = this.getSelection().filter((item) => !item.locked)
    if (items.length === 0) return
    items.forEach((i) => i.remove())
    this.clearSelection()
    this.pushHistory('Delete')
    this.scope.view.update()
  }

  duplicateSelected() {
    const items = this.getSelection()
    if (items.length === 0) return
    const activeLayer = this.getActiveLayer()
    if (!activeLayer) return
    // Clone from a snapshot and reselect only the clones: reselecting the
    // sources too used to double the selection on every repeat (1→2→4→8).
    const clones: paper.Item[] = []
    for (const item of items) {
      const clone = item.clone()
      activeLayer.addChild(clone)
      this.restampCloneTree(clone)
      clone.data.id = this.genId()
      clone.data.isUserItem = true
      clones.push(clone)
    }
    this.clearSelection()
    if (clones.length > 0) {
      const dx = 10
      const dy = 10
      clones.forEach((c) => {
        c.position = c.position.add(new this.scope.Point(dx, dy))
        c.selected = true
      })
      this.syncSelectionToStore()
      this.pushHistory('Duplicate')
      this.scope.view.update()
    }
  }

  /**
   * Reduce anchor counts on unlocked selected plain paths with zoom-scaled
   * fitting tolerance. Returns how many paths lost anchors; records
   * history only then.
   */
  simplifyPaths(): number {
    const scope = this.scope
    const paths = this.getSelection().filter(
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
      this.pushHistory('Simplify')
      this.scope.view.update()
    }
    return changed
  }

  /**
   * Close open paths (connect ends) or open closed ones in the unlocked
   * selection. Returns how many paths changed; records history only then.
   */
  setPathsClosed(closed: boolean): number {
    const scope = this.scope
    const paths = this.getSelection().filter(
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
    this.pushHistory(closed ? 'Close Path' : 'Open Path')
    this.scope.view.update()
    return paths.length
  }

  /**
   * Offset every selected unlocked path by a distance (AI Offset Path
   * parity, powered by paperjs-offset like Outline Stroke). Positive
   * expands, negative insets. `steps` repeats at multiples (CDR contour
   * parity); `cap` shapes open-path ends (omitted = library default).
   * Results keep the source appearance, sit beside their sources
   * and become the new selection. Returns offsets made; one history entry.
   */
  offsetPaths(
    distance: number,
    join: 'miter' | 'round' | 'bevel' = 'miter',
    steps = 1,
    cap?: 'round' | 'butt'
  ): number {
    if (!Number.isFinite(distance) || Math.abs(distance) < 1e-9) return 0
    const dist = Math.min(2000, Math.max(-2000, distance))
    const reps = Math.min(20, Math.max(1, Math.round(Number(steps) || 1)))
    const scope = this.scope
    const targets = this.getSelection().filter(
      (item) =>
        !item.locked &&
        item.parent &&
        (item instanceof scope.Path || item instanceof scope.CompoundPath)
    ) as Array<paper.Path | paper.CompoundPath>
    if (targets.length === 0) return 0
    const made: paper.Item[] = []
    for (const target of targets) {
      const parent = target.parent ?? this.getActiveLayer()
      const at = parent.children.indexOf(target as any)
      for (let i = 1; i <= reps; i++) {
        let result: paper.Path | paper.CompoundPath | null = null
        try {
          result = PaperOffset.offset(target as any, dist * i, {
            join,
            limit: 10,
            insert: false,
            ...(cap ? { cap } : {}),
          }) as any
        } catch {
          result = null
        }
        if (!result) continue
        parent.insertChild(Math.min(at + i, parent.children.length), result as any)
        result.data.id = this.genId()
        result.data.isUserItem = true
        this.applyStyleToItem(result as paper.Item, this.getStyleFromItem(target as paper.Item))
        made.push(result as paper.Item)
      }
    }
    if (made.length === 0) return 0
    this.clearSelection()
    made.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.pushHistory(reps > 1 ? 'Contour Offset' : 'Offset Path')
    this.scope.view.update()
    return made.length
  }

  /**
   * Roughen / zigzag selected paths (AI Roughen parity, destructive).
   * Curves subdivide `detail` times, then anchors jitter by `size`
   * (roughen, endpoints of open paths stay put) or ridge perpendicular
   * alternating ±size with cornered handles (zigzag). Returns anchors
   * touched; one history entry.
   */
  stylizeRoughen(kind: 'roughen' | 'zigzag', size: number, detail: number): number {
    if (!Number.isFinite(size) || size <= 0) return 0
    const rounds = Math.min(10, Math.max(1, Math.round(Number(detail) || 3)))
    const scope = this.scope
    const paths: paper.Path[] = []
    for (const item of this.getSelection()) {
      if ((item as any).locked || !item.parent) continue
      if (item instanceof scope.CompoundPath) {
        for (const child of ((item as any).children ?? []) as paper.Item[]) {
          if (child instanceof scope.Path) paths.push(child)
        }
      } else if (item instanceof scope.Path) {
        paths.push(item)
      }
    }
    if (paths.length === 0) return 0
    const s = Math.min(500, size)
    let touched = 0
    for (const path of paths) {
      for (let r = 0; r < rounds; r++) {
        const curves = path.curves.slice()
        let split = false
        for (const curve of curves) {
          try {
            if (typeof (curve as any).divideAtTime === 'function' && (curve as any).divideAtTime(0.5)) split = true
          } catch { /* keep going */ }
        }
        if (!split) break
      }
      const n = path.segments.length
      for (let i = 0; i < n; i++) {
        const seg = path.segments[i]
        const isEnd = !path.closed && (i === 0 || i === n - 1)
        if (isEnd) continue
        if (kind === 'roughen') {
          seg.point = seg.point.add(new scope.Point((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s))
        } else {
          const prev = path.segments[(i - 1 + n) % n].point
          const next = path.segments[(i + 1) % n].point
          const tangent = next.subtract(prev)
          if (tangent.length < 1e-9) continue
          const normal = new scope.Point(-tangent.y, tangent.x).normalize()
          seg.point = seg.point.add(normal.multiply((i % 2 === 0 ? 1 : -1) * s))
          ;(seg as any).handleIn = new scope.Point(0, 0)
          ;(seg as any).handleOut = new scope.Point(0, 0)
        }
        touched++
      }
      this.refreshItemGradient(path as paper.Item)
    }
    if (touched > 0) {
      this.pushHistory(kind === 'roughen' ? 'Roughen' : 'Zig Zag')
      this.scope.view.update()
    }
    return touched
  }

  /**
   * Add a midpoint anchor to every curve of the selected unlocked paths
   * (AI Add Anchor Points parity). Returns anchors added; one history.
   */
  addAnchorPoints(): number {
    const scope = this.scope
    const paths: paper.Path[] = []
    for (const item of this.getSelection()) {
      if ((item as any).locked || !item.parent) continue
      if (item instanceof scope.CompoundPath) {
        for (const child of ((item as any).children ?? []) as paper.Item[]) {
          if (child instanceof scope.Path) paths.push(child)
        }
      } else if (item instanceof scope.Path) {
        paths.push(item)
      }
    }
    if (paths.length === 0) return 0
    let added = 0
    for (const path of paths) {
      const curves = path.curves.slice()
      for (const curve of curves) {
        try {
          const c = curve as any
          const seg = typeof c.divideAtTime === 'function'
            ? c.divideAtTime(0.5)
            : typeof c.divide === 'function'
              ? c.divide(0.5)
              : null
          if (seg) added++
        } catch {
          continue
        }
      }
      this.refreshItemGradient(path as paper.Item)
    }
    if (added > 0) {
      this.pushHistory('Add Anchor Points')
      this.scope.view.update()
    }
    return added
  }

  /**
   * Reverse selected unlocked paths (winding/draw direction, matters for
   * compound and subtract operand order). Returns paths reversed.
   */
  reversePaths(): number {
    const scope = this.scope
    const targets = this.getSelection().filter(
      (item) =>
        !(item as any).locked &&
        item.parent &&
        (item instanceof scope.Path || item instanceof scope.CompoundPath)
    )
    if (targets.length === 0) return 0
    for (const item of targets) {
      try {
        if (typeof (item as any).reverse === 'function') (item as any).reverse()
        else {
          const kids = (item as any).children as paper.Item[] | undefined
          if (kids) for (const k of kids) (k as any).reverse?.()
        }
      } catch {
        continue
      }
      this.refreshItemGradient(item)
    }
    this.reflowTextsForItems(targets)
    this.pushHistory('Reverse Path')
    this.scope.view.update()
    return targets.length
  }

  /**
   * Remove stray geometry: empty paths/compounds, blank point text and
   * groups emptied by the sweep (pattern tiles, clip scaffolding and
   * annotations are never touched). Returns items removed.
   */
  cleanUp(): number {
    const scope = this.scope
    let removed = 0
    const isEmptyText = (item: paper.Item): boolean =>
      item instanceof scope.PointText &&
      !(item as any).data?.annotation &&
      String((item as any).content ?? '') === ''
    const isEmptyPath = (item: paper.Item): boolean =>
      (item instanceof scope.Path && !(item instanceof scope.CompoundPath) && item.segments.length === 0) ||
      (item instanceof scope.CompoundPath && ((item as any).children?.length ?? 0) === 0)
    const sweep = (node: paper.Item): boolean => {
      const data = (node as any).data ?? {}
      if (data.isPatternTile || data.annotation || (node as any).clipMask) return false
      if ((node as any).locked) return false
      const children = (node as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children.slice()) {
          if (sweep(child)) removed++
        }
        const left = (node as any).children as paper.Item[] | undefined
        // Prune emptied plain groups (never user layers or text runs).
        if (
          node instanceof scope.Group &&
          !(data as any).isUserItem &&
          !(data as any).textMode &&
          (left?.length ?? 1) === 0
        ) {
          node.remove()
          return true
        }
        return false
      }
      if (isEmptyPath(node) || isEmptyText(node)) {
        node.remove()
        return true
      }
      return false
    }
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer) continue
      for (const child of (layer.children as unknown as paper.Item[]).slice()) {
        // Top-level user items keep their slot (AI never deletes layers
        // here); only their contents sweep.
        if ((child as any).data?.isUserItem && ((child as any).children as paper.Item[] | undefined)) {
          const before = removed
          for (const grand of (((child as any).children as paper.Item[]) ?? []).slice()) {
            if (sweep(grand)) removed++
          }
          void before
        } else if (sweep(child)) {
          removed++
        }
      }
    }
    if (removed > 0) {
      this.clearSelection()
      this.pushHistory('Clean Up')
      this.scope.view.update()
    }
    return removed
  }

  /**
   * Match every unlocked selected item to the first one's width and/or
   * height (layout staple), scaling about each item's own center so
   * positions hold. Returns items resized; one history entry.
   */
  matchSize(mode: 'width' | 'height' | 'both'): number {
    const items = this.getSelection().filter((item) => !item.locked && item.parent)
    if (items.length < 2) return 0
    const ref = (items[0] as any).bounds as paper.Rectangle | undefined
    if (!ref || !(ref.width > 0) || !(ref.height > 0)) return 0
    let changed = 0
    for (let i = 1; i < items.length; i++) {
      const b = (items[i] as any).bounds as paper.Rectangle | undefined
      if (!b || !(b.width > 0) || !(b.height > 0)) continue
      const sx = mode === 'height' ? 1 : ref.width / b.width
      const sy = mode === 'width' ? 1 : ref.height / b.height
      if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue
      if (Math.abs(sx - 1) < 1e-9 && Math.abs(sy - 1) < 1e-9) continue
      items[i].scale(sx, sy, b.center.clone())
      this.refreshItemGradient(items[i])
      changed++
    }
    if (changed > 0) {
      this.reflowTextsForItems(items)
      this.pushHistory(mode === 'width' ? 'Same Width' : mode === 'height' ? 'Same Height' : 'Same Size')
      this.scope.view.update()
    }
    return changed
  }

  /**
   * Fill selected text runs with placeholder copy (AI Fill with
   * Placeholder Text parity): a sentence for point text, a passage for
   * area/path frames. Annotation labels excluded. One history entry.
   */
  fillPlaceholder(): number {
    const scope = this.scope
    const sentence = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'
    const passage =
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor ' +
      'incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud ' +
      'exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'
    let changed = 0
    for (const item of this.getSelection()) {
      if ((item as any).locked || !(item instanceof scope.PointText)) continue
      if ((item as any).data?.annotation) continue
      const mode = (item as any).data?.textMode as string | undefined
      ;(item as any).content = mode && mode !== 'point' ? passage : sentence
      changed++
    }
    if (changed > 0) {
      this.pushHistory('Fill Placeholder Text')
      this.scope.view.update()
    }
    return changed
  }

  /**
   * Drop a guide through the selection center (vertical = X, horizontal =
   * Y). Respects the guides lock. Returns false with no selection.
   */
  guideAtSelection(orientation: GuideOrientation): boolean {
    if (this.store.view.guidesLocked) return false
    const bounds = this.getSelectionBounds()
    if (!bounds) return false
    const pos = orientation === 'vertical' ? bounds.x + bounds.width / 2 : bounds.y + bounds.height / 2
    if (!Number.isFinite(pos)) return false
    const guide = this.createGuide(pos, orientation)
    if (!guide) return false
    this.pushHistory('Add Guide')
    return true
  }

  /**
   * Inset margin guides on a board (print-layout staple): two vertical +
   * two horizontal guides at `margin` inside the sheet. Respects the
   * guides lock. Returns guides created.
   */
  addMarginGuides(boardId: string, margin: number): number {
    if (this.store.view.guidesLocked) return 0
    const board = this.store.artboards.find((b) => b.id === boardId)
    if (!board || !(board.width > 0) || !(board.height > 0)) return 0
    const m = Number.isFinite(margin) ? Math.min(Math.min(board.width, board.height) / 2 - 1, Math.max(0, margin)) : 0
    if (!(m > 0)) return 0
    let made = 0
    const specs: Array<[number, GuideOrientation]> = [
      [board.x + m, 'vertical'],
      [board.x + board.width - m, 'vertical'],
      [board.y + m, 'horizontal'],
      [board.y + board.height - m, 'horizontal'],
    ]
    for (const [pos, orientation] of specs) {
      if (this.createGuide(pos, orientation)) made++
    }
    if (made > 0) this.pushHistory('Add Margin Guides')
    return made
  }

  /**
   * UPPER / lower / Title Case selected point text (AI Change Case
   * parity, annotation labels excluded). Returns runs changed.
   */
  changeCase(mode: 'upper' | 'lower' | 'title'): number {
    const scope = this.scope
    let changed = 0
    for (const item of this.getSelection()) {
      if ((item as any).locked || !(item instanceof scope.PointText)) continue
      if ((item as any).data?.annotation) continue
      const before = String((item as any).content ?? '')
      const after = changeCaseText(before, mode)
      if (after !== before) {
        ;(item as any).content = after
        changed++
      }
    }
    if (changed > 0) {
      this.pushHistory('Change Case')
      this.scope.view.update()
    }
    return changed
  }

  /**
   * Break thread links on selected text frames (both directions): linked
   * siblings forget the frame, the frame forgets them. Content stays put.
   * Returns frames unlinked; one history entry.
   */
  unlinkTextFrames(): number {
    const scope = this.scope
    let changed = 0
    for (const item of this.getSelection()) {
      if ((item as any).locked || !(item instanceof scope.PointText)) continue
      const data = (item as any).data ?? {}
      const links = [data.threadNext, data.threadPrev].filter(
        (id): id is string => typeof id === 'string' && id.length > 0
      )
      if (links.length === 0) continue
      for (const id of links) {
        const other = this.getItemById(id) as any
        if (!other?.data) continue
        if (other.data.threadNext === data.id) delete other.data.threadNext
        if (other.data.threadPrev === data.id) delete other.data.threadPrev
      }
      delete data.threadNext
      delete data.threadPrev
      changed++
    }
    if (changed > 0) {
      this.pushHistory('Unlink Text')
      this.scope.view.update()
    }
    return changed
  }

  /**
   * Thread selected area frames left-to-right (AI thread-text parity):
   * each frame links to the next, replacing existing links on the chain.
   * Needs 2+ unlocked area frames. One history entry.
   */
  threadSelectedFrames(): number {
    const scope = this.scope
    const frames = this.getSelection().filter(
      (item) =>
        !(item as any).locked &&
        item.parent &&
        item instanceof scope.PointText &&
        (item as any).data?.textMode === 'area' &&
        !(item as any).data?.annotation
    ) as paper.PointText[]
    if (frames.length < 2) return 0
    const ordered = frames.slice().sort((a, b) => {
      const fa = (a as any).data?.frame
      const fb = (b as any).data?.frame
      const ax = Number(fa?.x) || 0
      const bx = Number(fb?.x) || 0
      if (ax !== bx) return ax - bx
      return (Number(fa?.y) || 0) - (Number(fb?.y) || 0)
    })
    // Detach the chain members first so no stale cross-links survive.
    for (const frame of ordered) {
      const data = (frame as any).data ?? ((frame as any).data = {})
      if (typeof data.id !== 'string' || !data.id) data.id = this.genId()
      for (const id of [data.threadNext, data.threadPrev]) {
        if (typeof id !== 'string' || !id) continue
        const other = this.getItemById(id) as any
        if (!other?.data) continue
        if (other.data.threadNext === data.id) delete other.data.threadNext
        if (other.data.threadPrev === data.id) delete other.data.threadPrev
      }
      delete data.threadNext
      delete data.threadPrev
    }
    for (let i = 0; i + 1 < ordered.length; i++) {
      const a = (ordered[i] as any).data
      const b = (ordered[i + 1] as any).data
      a.threadNext = b.id
      b.threadPrev = a.id
    }
    this.pushHistory('Thread Text')
    this.scope.view.update()
    return ordered.length
  }

  /**
   * Jump the selection along a thread chain (prev/next frame). Needs a
   * single selected area frame with that link. No history (selection).
   */
  selectThreadNeighbor(direction: 'next' | 'prev'): boolean {
    const scope = this.scope
    const items = this.getSelection()
    if (items.length !== 1) return false
    const item = items[0]
    if (!(item instanceof scope.PointText) || (item as any).data?.textMode !== 'area') return false
    const id = (item as any).data?.[direction === 'next' ? 'threadNext' : 'threadPrev']
    if (typeof id !== 'string' || !id) return false
    const other = this.getItemById(id)
    if (!other) return false
    this.clearSelection()
    other.selected = true
    this.syncSelectionToStore()
    this.scope.view.update()
    return true
  }

  /**
   * Load the first selected item's appearance into the store defaults
   * (future shapes; the document is untouched, so no history). Returns
   * false with an empty selection.
   */
  setDefaultsFromSelection(): boolean {
    const first = this.getSelection()[0]
    if (!first) return false
    this.store.updateStyle({ ...this.getStyleFromItem(first) })
    this.showStatus('Defaults loaded from selection')
    return true
  }

  /**
   * Reset the unlocked selection to the default appearance. Returns
   * items reset; one history entry.
   */
  clearAppearance(): number {
    const items = this.getSelection().filter((item) => !item.locked && item.parent)
    if (items.length === 0) return 0
    const defaults = createDefaultStyle()
    for (const item of items) {
      this.applyStyleToItem(item, defaults)
      this.refreshItemGradient(item)
    }
    this.pushHistory('Clear Appearance')
    this.scope.view.update()
    return items.length
  }

  /** Every text run in the document (annotation labels excluded). */
  private allTextRuns(): paper.PointText[] {
    const scope = this.scope
    const out: paper.PointText[] = []
    const walk = (node: paper.Item) => {
      const data = (node as any).data ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard || data.annotation) return
      if (node instanceof scope.PointText) {
        out.push(node)
        return
      }
      const children = (node as any).children as paper.Item[] | undefined
      if (children) for (const child of children) walk(child)
    }
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer) continue
      for (const child of layer.children) walk(child as paper.Item)
    }
    return out
  }

  /**
   * Text runs whose content contains the query (AI Find parity).
   * Empty queries match nothing; matching is case-sensitive and
   * whole-word on demand.
   */
  findText(query: string, matchCase = false, wholeWord = false): paper.PointText[] {
    if (!query) return []
    const test = (content: string): boolean => {
      if (wholeWord) {
        const flags = matchCase ? 'g' : 'gi'
        try {
          return new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, flags).test(content)
        } catch {
          return false
        }
      }
      const needle = matchCase ? query : query.toLowerCase()
      return matchCase ? content.includes(needle) : content.toLowerCase().includes(needle)
    }
    return this.allTextRuns().filter((item) => test(String((item as any).content ?? '')))
  }

  /**
   * Replace the query across selected text runs (AI Change/Change All
   * parity). Returns runs changed; one history entry.
   */
  replaceText(find: string, replace: string, matchCase = false, wholeWord = false): number {
    if (!find) return 0
    const scope = this.scope
    const pattern = wholeWord
      ? new RegExp(`\\b${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, matchCase ? 'g' : 'gi')
      : null
    let changed = 0
    for (const item of this.getSelection()) {
      if ((item as any).locked || !(item instanceof scope.PointText)) continue
      if ((item as any).data?.annotation) continue
      const before = String((item as any).content ?? '')
      let after = before
      try {
        after = pattern
          ? before.replace(pattern, replace)
          : matchCase
            ? before.split(find).join(replace)
            : before.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replace)
      } catch {
        continue
      }
      if (after !== before) {
        ;(item as any).content = after
        changed++
      }
    }
    if (changed > 0) {
      this.pushHistory('Replace Text')
      this.scope.view.update()
    }
    return changed
  }

  /** Word/character totals over the selection (else the document). */
  textStats(): { words: number; chars: number; runs: number } {
    const scope = this.scope
    const sel = this.getSelection().filter(
      (item) => !(item as any).locked && item instanceof scope.PointText && !(item as any).data?.annotation
    ) as paper.PointText[]
    const runs = sel.length > 0 ? sel : this.allTextRuns()
    let words = 0
    let chars = 0
    for (const item of runs) {
      const content = String((item as any).content ?? '')
      chars += content.length
      words += content.trim().split(/\s+/).filter(Boolean).length
    }
    return { words, chars, runs: runs.length }
  }

  /** One preflight finding (print-readiness check). */
  preflight(): Array<{ kind: 'overflow' | 'gamut' | 'tac' | 'small' | 'hairline' | 'dpi' | 'empty-layer'; message: string; itemId: string }> {
    const scope = this.scope
    const out: Array<{ kind: 'overflow' | 'gamut' | 'tac' | 'small' | 'hairline' | 'dpi' | 'empty-layer'; message: string; itemId: string }> = []
    const labelOf = (item: paper.Item): string => {
      const data = (item as any).data ?? {}
      const raw = (item as any).name ?? data.name
      const name = typeof raw === 'string' && raw.trim() ? raw.trim() : ''
      if (name) return name
      const cls = String((item as any).className ?? 'Object')
      return `${cls} ${(data.id ?? '').toString().slice(0, 6)}`
    }
    const tc = this.getController('type') as {
      areaOverflow?: (item: any) => { lines: number; fits: number; overflowChars: number }
    } | null
    const walk = (node: paper.Item) => {
      const data = (node as any).data ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard || data.annotation) return
      if (data.isPatternTile || (node as any).clipMask) return
      if (node instanceof scope.PointText) {
        if ((data as any).textMode === 'area' && tc?.areaOverflow) {
          try {
            const over = tc.areaOverflow(node as paper.PointText)
            if (over.overflowChars > 0) {
              out.push({
                kind: 'overflow',
                message: `"${labelOf(node)}" overflows by ${over.overflowChars} chars`,
                itemId: String(data.id ?? ''),
              })
            }
          } catch { /* unreadable frames are not findings */ }
        }
        const pt = Number((node as any).fontSize) || 0
        if (pt > 0 && pt < 6) {
          out.push({
            kind: 'small',
            message: `"${labelOf(node)}" is ${Math.round(pt * 10) / 10}pt text (under 6pt)`,
            itemId: String(data.id ?? ''),
          })
        }
        return
      }
      if (node instanceof scope.Raster) {
        try {
          const px = Number((node as any).width) || 0
          const w = Number((node as any).bounds?.width) || 0
          if (px > 0 && w > 0) {
            const dpi = (px / w) * 96
            if (dpi < 150) {
              out.push({
                kind: 'dpi',
                message: `"${labelOf(node)}" is ${Math.round(dpi)} dpi (under 150)`,
                itemId: String(data.id ?? ''),
              })
            }
          }
        } catch { /* unreadable rasters are not findings */ }
        return
      }
      if (node instanceof scope.Path || node instanceof scope.CompoundPath) {
        const w = Number((node as any).strokeWidth) || 0
        if ((node as any).strokeColor && w > 0 && w < 0.5) {
          out.push({
            kind: 'hairline',
            message: `"${labelOf(node)}" has a ${w} hairline stroke (under 0.5)`,
            itemId: String(data.id ?? ''),
          })
          return
        }
        for (const key of ['fillColor', 'strokeColor'] as const) {
          const paint = (node as any)[key]
          if (!paint || paint.gradient) continue
          const css = this.colorToCSS(paint)
          if (!css) continue
          const rgba = parseCssColor(css)
          if (rgba) {
            const { c, m, y, k } = rgbToCmyk(rgba.r, rgba.g, rgba.b)
            if (c + m + y + k > 280) {
              out.push({
                kind: 'tac',
                message: `"${labelOf(node)}" totals ${c + m + y + k}% ink (over 280%)`,
                itemId: String(data.id ?? ''),
              })
              return
            }
          }
          if (css && isOutOfCmykGamut(css)) {
            out.push({
              kind: 'gamut',
              message: `"${labelOf(node)}" uses out-of-gamut ${key === 'fillColor' ? 'fill' : 'stroke'} ${css}`,
              itemId: String(data.id ?? ''),
            })
            break
          }
        }
        return
      }
      const children = (node as any).children as paper.Item[] | undefined
      if (children) for (const child of children) walk(child)
    }
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer) continue
      if (layer.children.length === 0) {
        out.push({ kind: 'empty-layer', message: `Layer "${(layer as any).name ?? 'Layer'}" is empty`, itemId: '' })
        continue
      }
      for (const child of layer.children) walk(child as paper.Item)
    }
    return out.slice(0, 50)
  }

  /**
   * Shift selected artwork through HSL (Recolor-lite: hue rotates by
   * degrees, saturation/lightness move by percent points). Solid fills
   * and strokes repaint; gradients, patterns and unparseable paints are
   * skipped. Returns leaves repainted; one history entry.
   */
  adjustColors(dh: number, ds: number, dl: number): number {
    if (![dh, ds, dl].every(Number.isFinite)) return 0
    if (Math.abs(dh) < 1e-9 && Math.abs(ds) < 1e-9 && Math.abs(dl) < 1e-9) return 0
    const scope = this.scope
    let changed = 0
    const repaint = (leaf: paper.Item) => {
      const anyLeaf = leaf as any
      let touched = false
      for (const key of ['fillColor', 'strokeColor'] as const) {
        const paint = anyLeaf[key]
        if (!paint || paint.gradient) continue
        const css = this.colorToCSS(paint)
        if (!css) continue
        try {
          anyLeaf[key] = new scope.Color(shiftCssColor(css, dh, ds, dl))
          touched = true
        } catch {
          continue
        }
      }
      if (touched) {
        changed++
        this.refreshItemGradient(leaf)
      }
    }
    for (const item of this.getSelection()) {
      if ((item as any).locked) continue
      const children = (item as any).children as paper.Item[] | undefined
      if (children && (item instanceof scope.Group)) {
        // Groups repaint every unlocked leaf (exactly once).
        const walk = (node: paper.Item) => {
          if ((node as any).locked) return
          if (node instanceof scope.Path || node instanceof scope.CompoundPath || node instanceof scope.PointText) {
            repaint(node)
          } else {
            const kids = (node as any).children as paper.Item[] | undefined
            if (kids) for (const k of kids) walk(k)
          }
        }
        for (const child of children) walk(child)
      } else {
        const leaf = this.firstLeaf(item)
        if (leaf) repaint(leaf)
      }
    }
    if (changed > 0) {
      this.reflowTextsForItems(this.getSelection())
      this.pushHistory('Adjust Colors')
      this.scope.view.update()
    }
    return changed
  }

  /**
   * Channel-invert solid fills and strokes on the unlocked selection
   * (gradients skipped). Returns leaves repainted; one history entry.
   */
  invertPaints(): number {
    const scope = this.scope
    let changed = 0
    const repaint = (leaf: paper.Item) => {
      const anyLeaf = leaf as any
      let touched = false
      for (const key of ['fillColor', 'strokeColor'] as const) {
        const paint = anyLeaf[key]
        if (!paint || paint.gradient) continue
        const css = this.colorToCSS(paint)
        if (!css) continue
        try {
          anyLeaf[key] = new scope.Color(invertCssColor(css))
          touched = true
        } catch {
          continue
        }
      }
      if (touched) changed++
    }
    for (const item of this.getSelection()) {
      if ((item as any).locked) continue
      const leaf = this.firstLeaf(item)
      if (!leaf) continue
      if (leaf !== item && item instanceof scope.Group) {
        const walk = (node: paper.Item) => {
          if ((node as any).locked) return
          if (node instanceof scope.Path || node instanceof scope.CompoundPath || node instanceof scope.PointText) {
            repaint(node)
          } else {
            const kids = (node as any).children as paper.Item[] | undefined
            if (kids) for (const k of kids) walk(k)
          }
        }
        for (const child of ((item as any).children ?? []) as paper.Item[]) walk(child)
      } else {
        repaint(leaf)
      }
    }
    if (changed > 0) {
      this.reflowTextsForItems(this.getSelection())
      this.pushHistory('Invert Colors')
      this.scope.view.update()
    }
    return changed
  }

  /**
   * Swap fill and stroke everywhere: store defaults plus every unlocked
   * selected item (AI Shift+X parity, same per-item semantics the color
   * bar always had). One history entry when art changes.
   */
  swapFillStroke(): void {
    const f = this.store.style.fillColor
    const s = this.store.style.strokeColor
    this.store.updateStyle({ fillColor: s, strokeColor: f })
    const items = this.getSelection().filter((item) => !item.locked && item.parent)
    for (const item of items) {
      const anyItem = item as any
      const pf = anyItem.fillColor
      anyItem.fillColor = anyItem.strokeColor ?? null
      if (anyItem.strokeColor !== undefined) anyItem.strokeColor = pf ?? null
    }
    this.scope.view.update()
    if (items.length > 0) this.pushHistory('Swap Fill Stroke')
    else this.showStatus('Fill and stroke swapped')
  }

  /**
   * Stamp triangular arrowheads on open selected paths (AI Stroke
   * arrowheads, destructive v1: markers are plain filled siblings, so
   * later stroke edits do not follow them). Length is absolute document
   * units; paint follows the stroke (else fill, else black). Returns
   * markers created; one history entry.
   */
  addArrowheads(start: boolean, end: boolean, length: number): number {
    if (!start && !end) return 0
    if (!Number.isFinite(length) || length <= 0) return 0
    const len = Math.min(200, length)
    const scope = this.scope
    const targets = this.getSelection().filter(
      (item) =>
        !(item as any).locked &&
        item.parent &&
        item instanceof scope.Path &&
        !(item instanceof scope.CompoundPath) &&
        item.segments.length >= 2 &&
        !item.closed
    ) as paper.Path[]
    if (targets.length === 0) return 0
    const made: paper.Item[] = []
    for (const path of targets) {
      const paint = (path as any).strokeColor ?? (path as any).fillColor
      const segs = path.segments
      const ends: Array<{ tip: paper.Point; dir: paper.Point }> = []
      if (start) {
        const tip = segs[0].point
        const prev = segs[1].point
        ends.push({ tip, dir: tip.subtract(prev) })
      }
      if (end) {
        const tip = segs[segs.length - 1].point
        const prev = segs[segs.length - 2].point
        ends.push({ tip, dir: tip.subtract(prev) })
      }
      for (const { tip, dir } of ends) {
        if (dir.length < 1e-9) continue
        const d = dir.normalize()
        const n = new scope.Point(-d.y, d.x)
        const base = tip.subtract(d.multiply(len))
        const half = len * 0.42
        const head = new scope.Path([
          tip.clone(),
          base.add(n.multiply(half)),
          base.subtract(n.multiply(half)),
        ]) as paper.Path
        head.closed = true
        try {
          head.fillColor = paint ? (paint.clone ? paint.clone() : new scope.Color(paint)) : new scope.Color('#000000')
        } catch {
          head.fillColor = new scope.Color('#000000')
        }
        head.strokeColor = null
        const parent = path.parent ?? this.getActiveLayer()
        parent.insertChild(parent.children.indexOf(path as any) + 1, head as any)
        head.data.id = this.genId()
        head.data.isUserItem = true
        made.push(head as paper.Item)
      }
    }
    if (made.length === 0) return 0
    this.clearSelection()
    made.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.pushHistory('Add Arrowheads')
    this.scope.view.update()
    return made.length
  }

  /**
   * Select stray points (paths with at most one anchor) across all
   * unlocked visible artwork. Returns how many were selected.
   */
  selectStrays(): number {
    const scope = this.scope
    const strays: paper.Item[] = []
    const walk = (node: paper.Item) => {
      const data = (node as any).data ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard || data.annotation) return
      if (data.isPatternTile || (node as any).clipMask) return
      if ((node as any).visible === false || (node as any).locked) return
      if (node instanceof scope.Path && !(node instanceof scope.CompoundPath)) {
        if (node.segments.length <= 1) strays.push(node)
        return
      }
      const children = (node as any).children as paper.Item[] | undefined
      if (children) for (const child of children) walk(child)
    }
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible) continue
      for (const child of layer.children) walk(child as paper.Item)
    }
    this.clearSelection()
    strays.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.scope.view.update()
    return strays.length
  }

  /**
   * Select every text object (annotation labels excluded). Returns count.
   */
  selectTextObjects(): number {
    const scope = this.scope
    const texts: paper.Item[] = []
    const walk = (node: paper.Item) => {
      const data = (node as any).data ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard || data.annotation) return
      if ((node as any).visible === false || (node as any).locked) return
      if (node instanceof scope.PointText) {
        texts.push(node)
        return
      }
      const children = (node as any).children as paper.Item[] | undefined
      if (children) for (const child of children) walk(child)
    }
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible) continue
      for (const child of layer.children) walk(child as paper.Item)
    }
    this.clearSelection()
    texts.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.scope.view.update()
    return texts.length
  }

  /**
   * Best-effort copy of the selection (else all artwork) to the OS
   * clipboard as PNG. Resolves false when there is nothing to paint,
   * the API is unavailable or the write is denied.
   */
  async copyRasterToClipboard(scale = 2): Promise<boolean> {
    const s = Number.isFinite(scale) ? Math.min(3, Math.max(1, scale)) : 2
    const area = this.getSelection().length > 0 ? 'selection' : 'artwork'
    const url = this.exportRaster({ format: 'png', scale: s, area })
    if (!url) return false
    const clipboard = this.systemClipboard()
    if (!clipboard || typeof ClipboardItem === 'undefined' || !clipboard.write) return false
    try {
      const blob = await (await fetch(url)).blob()
      await clipboard.write([new ClipboardItem({ 'image/png': blob })])
      return true
    } catch {
      return false
    }
  }

  /**
   * Destructively warp selected paths through an envelope preset (arc,
   * bulge, wave). Each path warps in its own bounds; anchors and handles
   * map through the same function so curves stay coherent. Text, patterns
   * and clip content are skipped. Returns how many paths warped.
   */
  envelopeDistort(preset: EnvelopePreset): number {
    const scope = this.scope
    const leaves = this.getSelection().flatMap((item) => this.envelopeLeaves(item))
    if (leaves.length === 0) return 0
    let changed = 0
    for (const leaf of leaves) {
      const bounds = (leaf as any).bounds as paper.Rectangle | undefined
      if (!bounds || !(bounds.width > 1e-6) || !(bounds.height > 1e-6)) continue
      const paths =
        leaf instanceof scope.CompoundPath
          ? ((leaf.children as unknown as paper.Path[]) ?? [])
          : [leaf as paper.Path]
      for (const path of paths) {
        if (!path.segments || path.segments.length === 0) continue
        for (const seg of path.segments) {
          const anchor = (seg.point as paper.Point).clone()
          const mapped = this.envelopePoint(anchor, bounds, preset)
          // Handles are relative to the anchor: map the absolute handle
          // position, then store the relative remainder.
          for (const key of ['handleIn', 'handleOut'] as const) {
            const handle = (seg as any)[key] as paper.Point | undefined
            if (handle && (handle as paper.Point).length > 1e-9) {
              const absolute = anchor.add(handle as paper.Point)
              const warped = this.envelopePoint(absolute, bounds, preset)
              ;(seg as any)[key] = warped.subtract(mapped)
            }
          }
          seg.point = mapped
        }
        changed++
      }
      this.refreshItemGradient(leaf)
    }
    if (changed > 0) {
      const label =
        preset === 'arc-upper' ? 'Envelope Arc Upper' :
        preset === 'arc-lower' ? 'Envelope Arc Lower' :
        preset === 'bulge' ? 'Envelope Bulge' :
        preset === 'wave' ? 'Envelope Wave' :
        preset === 'flag' ? 'Envelope Flag' :
        preset === 'fisheye' ? 'Envelope Fisheye' : 'Envelope Squeeze'
      this.reflowTextsForItems(this.getSelection())
      this.pushHistory(label)
      this.scope.view.update()
    }
    return changed
  }

  /** Plain warpable path leaves under an item (groups descended into). */
  private envelopeLeaves(item: paper.Item): Array<paper.Path | paper.CompoundPath> {
    const scope = this.scope
    const out: Array<paper.Path | paper.CompoundPath> = []
    const walk = (node: paper.Item): void => {
      if ((node as any).locked) return
      const data = (node.data as any) ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.annotation) return
      if (data.isPatternTile || data.isPatternFill || data.textMode) return
      if (node instanceof scope.Group) {
        const kids = (node as any).children as Array<any> | undefined
        if (kids && kids.some((k) => k && k.clipMask)) return
        for (const child of node.children) walk(child as paper.Item)
        return
      }
      if (
        (node instanceof scope.Path || node instanceof scope.CompoundPath) &&
        (node.data as any)?.id &&
        node.parent
      ) {
        out.push(node as paper.Path | paper.CompoundPath)
      }
    }
    walk(item)
    return out
  }

  /** Map one absolute point through an envelope preset within bounds. */
  private envelopePoint(p: paper.Point, b: paper.Rectangle, preset: EnvelopePreset): paper.Point {
    const scope = this.scope
    const nx = (p.x - b.x) / b.width
    const ny = (p.y - b.y) / b.height
    switch (preset) {
      case 'arc-upper':
        return new scope.Point(p.x, p.y - Math.sin(Math.PI * nx) * 0.25 * b.height)
      case 'arc-lower':
        return new scope.Point(p.x, p.y + Math.sin(Math.PI * nx) * 0.25 * b.height)
      case 'bulge': {
        const cx = b.x + b.width / 2
        return new scope.Point(cx + (p.x - cx) * (1 + 0.3 * Math.sin(Math.PI * ny)), p.y)
      }
      case 'wave':
        return new scope.Point(p.x, p.y + Math.sin(2 * Math.PI * nx) * 0.08 * b.height)
      case 'flag':
        // One-sided wave growing toward the right edge.
        return new scope.Point(p.x, p.y + Math.sin(Math.PI * nx) * nx * 0.3 * b.height)
      case 'fisheye': {
        // Magnify toward the center, compress toward the corners.
        const cx = b.x + b.width / 2
        const cy = b.y + b.height / 2
        const rx = (nx - 0.5) * 2
        const ry = (ny - 0.5) * 2
        const f = 1 + 0.4 * Math.max(0, 1 - (rx * rx + ry * ry) / 2)
        return new scope.Point(cx + (p.x - cx) * f, cy + (p.y - cy) * f)
      }
      case 'squeeze':
        // Pinch the middle horizontally (inverse bulge).
        return new scope.Point(b.x + b.width / 2 + (p.x - (b.x + b.width / 2)) * (1 - 0.3 * Math.sin(Math.PI * ny)), p.y)
    }
  }

  showStatus(message: string) {
    this.store.setStatusMessage(message)
  }

  destroy() {
    if (this.project) {
      this.project.remove()
    }
    // PaperScope has no remove method; just clear references
    this.scope = null as any
    this.project = null as any
  }
}
