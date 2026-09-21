/**
 * EditorEngine - Vue/Pinia ↔ Paper.js bridge hub
 */
import paper from 'paper'
import { PaperOffset } from 'paperjs-offset'
import type { ToolName, StyleState, LayerMeta, LayerItemNode, ArtboardMeta, SymbolEntry, HistoryEntry, GuideOrientation, ProjectFileData, ReferencePoint, AlignMode, DistributeAxis, BooleanOperation, RasterExportOptions, GradientState, PatternFillState, EnvelopePreset, AppearanceState, AppearanceFill, AppearanceStroke, OpacityMaskState, MeshGradientState, MeshGradientVertex } from './types'
import { createDefaultStyle } from './store'
import { cursorForTool } from './cursors'
import { gradientAngleFromVector } from './geometry'
import { alignSampledPoints, lerp, lerpRgba, rgbaToCss, sampleCountFor } from './blend/blend'
import type { Rgba } from './color'
import { colorDistanceRgb, invertCssColor, isOutOfCmykGamut, parseCssColor, rgbToCmyk, shiftCssColor } from './color'
import { parseProjectFile } from './project-file'
import { recordRecentProject } from './recent-files'
import type { EditorStore } from './store-types'
import { SnapService } from './snap/snap-service'
import {
  parseCdrBytes,
  cdrMmToPx,
  cdrSvgToImportSvg,
  cdrViewBoxScale,
  countCdrUrlFills,
  scaleCdrImportedStrokes,
} from './cdr/cdr-to-svg'
import { yieldToUI, type ProgressReport } from './busy'
import { alignToPixel } from './pixel'
import { MAX_MERGE_ROWS, mergeTemplate } from './data-merge'
import { inflateHistoryImages, slimHistoryImages } from './history-images'
import * as artboards from './engine-artboards'
import * as guides from './engine-guides'
import * as layers from './engine-layers'
import * as pathfinder from './engine-pathfinder'
import * as join from './engine-join'
import * as compound from './engine-compound'
import * as appearance from './engine-appearance'
import * as symbols from './engine-symbols'
import * as view from './engine-view'
import * as select from './engine-select'
import * as text from './engine-text'
import {
  TRACE_MIN_DIM,
  cleanTraceOptions,
  countTracePaths,
  fitTraceSize,
  traceImageData,
  type TraceImage,
  type TraceOptions,
} from './trace'
import type { ImageTracerInstance } from 'imagetracerjs'

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

/** Result of a CDR open/import operation. */
export interface CdrImportResult {
  pages: number
  warnings: string[]
  skippedPages: number
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

  // Font registry for PDF embedding: maps font family name → { data: ArrayBuffer, style: string }
  private static fontRegistry = new Map<string, { data: ArrayBuffer; style: string; weight: number }>()

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
    // Seed a baseline history entry: without it the first edit lands at
    // index 0, where undo() (which requires index > 0) silently refuses,
    // so the very first operation could never be taken back.
    this.history = [{ name: 'New Document', icon: '', timestamp: Date.now() }]
    this.historySnapshots = [this.snapshotProject()]
    this.historyMeta = [this.captureDocMeta()]
    this.historyIndex = 0
    this.store.setHistory(this.history, this.historyIndex)
    this.markSaved()
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
    // Reuse the flagged layer; never rely on `layer.parent` (top-level
    // Paper.js layers have no parent, so that check orphaned a fresh
    // visuals layer on every call). Drop stale duplicates left by older
    // revisions or snapshot restores.
    const flagged = this.project.layers.filter(
      (l) => (l.data as any)?.isArtboardLayer
    ) as paper.Layer[]
    let layer = flagged[0]
    for (const dup of flagged.slice(1)) {
      try {
        dup.remove()
      } catch {
        // Best effort: a stuck duplicate is invisible, not fatal.
      }
    }
    if (!layer) {
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

  /** See engine-artboards.ts. */
  renameArtboard(boardId: string, name: string): boolean {
    return artboards.renameArtboard(this, boardId, name)
  }

  /** See engine-artboards.ts. */
  moveArtboard(boardId: string, x: number, y: number, opts?: { withArtwork?: boolean }): boolean {
    return artboards.moveArtboard(this, boardId, x, y, opts)
  }

  /** See engine-artboards.ts. */
  resizeArtboard(boardId: string, width: number, height: number): boolean {
    return artboards.resizeArtboard(this, boardId, width, height)
  }

  /** See engine-artboards.ts. */
  duplicateArtboard(boardId: string): boolean {
    return artboards.duplicateArtboard(this, boardId)
  }

  /** See engine-artboards.ts. */
  fitArtboardToArtwork(boardId: string, padding = 20): boolean {
    return artboards.fitArtboardToArtwork(this, boardId, padding)
  }

  /** See engine-artboards.ts. */
  arrangeArtboards(spacing = 100): boolean {
    return artboards.arrangeArtboards(this, spacing)
  }

  /** See engine-view.ts. */
  panViewTo(point: paper.Point): void {
    view.panViewTo(this, point)
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
    // Let the outgoing controller unwind an in-flight gesture first: its
    // mouse-up will never arrive once the paper Tool is replaced, so a
    // half-finished drag (Width tool hides its target while dragging) would
    // otherwise leave the document in a state nothing ever commits.
    if (this.toolName !== tool) {
      const outgoing = this.controllers.get(this.toolName)
      try {
        outgoing?.deactivate?.()
      } catch {
        // Never block a tool switch on gesture cleanup.
      }
    }
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
    // Preview items parked on the overlay layer belong to a gesture that was
    // interrupted by the tool switch (its mouse-up never ran, so the
    // controller never cleaned up): eraser/pencil/brush strokes, blob-brush
    // footprints, zoom rubber bands, gradient / measure / reshape previews.
    const overlay = this.overlayLayer
    if (overlay) {
      for (const child of (overlay as any).children.slice() as paper.Item[]) {
        const data = (child as any).data ?? {}
        if (data.isPreview || data.isChrome) {
          try {
            child.remove()
          } catch { /* already gone */ }
        }
      }
    }
    for (const layer of this.project.layers) {
      const data = (layer.data as any) ?? {}
      if (data.isChromeRoot || data.isPreview) {
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
    this.store.clearCharSelection()
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
    // Mirror the united selection bounds into the store: the status bar
    // reads transform.width/height, and the Properties panel re-reads X/Y/W/H
    // off this same selection change, so both stay honest after a canvas
    // move (nothing else ever wrote width/height — the readout was 0×0).
    const bounds = ids.length > 0 ? this.getSelectionBounds() : null
    this.store.updateTransform({
      x: bounds ? Math.round(bounds.x * 10) / 10 : 0,
      y: bounds ? Math.round(bounds.y * 10) / 10 : 0,
      width: bounds ? Math.round(bounds.width * 10) / 10 : 0,
      height: bounds ? Math.round(bounds.height * 10) / 10 : 0,
    })
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
          color: (layer.data as any).layerColor || undefined,
          // Keep the panel fold state across syncs (undo/import/duplicates
          // rebuild the list from the project and would expand everything).
          expand: prevExpand.get(id) ?? true,
        })
      }
    }
    this.store.syncLayers(layers)
  }

  /**
   * Custom accent color for a user layer, used by the panel strip and the
   * selection chrome (AI Layer Options). Null clears back to the palette.
   */
  setLayerColor(layerId: string, color: string | null): void {
    const layer = this.project.layers.find(
      (l) => (l.data as any)?.layerId === layerId && (l.data as any)?.isUserLayer
    )
    if (!layer) return
    const clean = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null
    if (clean) (layer.data as any).layerColor = clean
    else delete (layer.data as any).layerColor
    this.syncLayersToStore()
    const select = this.controllers.get('select') as {
      refreshSelectionChrome?: () => void
    } | null
    try {
      select?.refreshSelectionChrome?.()
    } catch { /* chrome repaint is best effort */ }
    this.pushHistory('Layer Color')
    this.scope.view.update()
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
    layers.parkUserLayer(this, layer)
    layer.activate()
    this.syncLayersToStore()
    this.store.setActiveLayer(layer.data.layerId as string)
    return layer
  }

  /** See engine-layers.ts. */
  createLayer(name?: string): paper.Layer {
    return layers.createLayer(this, name)
  }

  /** See engine-layers.ts. */
  duplicateLayer(layerId: string): void {
    layers.duplicateLayer(this, layerId)
  }

  /** See engine-layers.ts. */
  deleteLayer(layerId: string): boolean {
    return layers.deleteLayer(this, layerId)
  }

  /** See engine-layers.ts. */
  setUserLayerVisible(layerId: string, visible: boolean): boolean {
    return layers.setUserLayerVisible(this, layerId, visible)
  }

  /** See engine-layers.ts. */
  setUserLayerLocked(layerId: string, locked: boolean): boolean {
    return layers.setUserLayerLocked(this, layerId, locked)
  }

  /** See engine-layers.ts. */
  renameUserLayer(layerId: string, name: string): boolean {
    return layers.renameUserLayer(this, layerId, name)
  }

  /** See engine-layers.ts. */
  soloUserLayer(layerId: string, mode: 'visible' | 'locked'): boolean {
    return layers.soloUserLayer(this, layerId, mode)
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

  /** See engine-guides.ts. */
  isGuide(item: paper.Item): boolean {
    return guides.isGuide(this, item)
  }

  /** See engine-guides.ts. */
  getGuides(): paper.Path[] {
    return guides.getGuides(this)
  }

  /** See engine-guides.ts. */
  getGuideOrientation(item: paper.Item): GuideOrientation | null {
    return guides.getGuideOrientation(this, item)
  }

  /** See engine-guides.ts. */
  getGuidePosition(item: paper.Item): number {
    return guides.getGuidePosition(this, item)
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

  /** See engine-guides.ts. */
  moveGuide(item: paper.Item, position: number) {
    guides.moveGuide(this, item, position)
  }

  /** See engine-guides.ts. */
  createGuide(position: number, orientation: GuideOrientation): paper.Path | null {
    return guides.createGuide(this, position, orientation)
  }

  /** See engine-guides.ts. */
  deleteGuide(guide: paper.Path) {
    guides.deleteGuide(this, guide)
  }

  /** See engine-guides.ts. */
  listGuides(): Array<{ id: string; orientation: GuideOrientation; position: number }> {
    return guides.listGuides(this)
  }

  /** See engine-guides.ts. */
  moveGuideById(id: string, position: number): boolean {
    return guides.moveGuideById(this, id, position)
  }

  /** See engine-guides.ts. */
  deleteGuideById(id: string): boolean {
    return guides.deleteGuideById(this, id)
  }

  /** See engine-guides.ts. */
  clearGuides() {
    guides.clearGuides(this)
  }

  /** See engine-guides.ts. */
  refreshGuides() {
    guides.refreshGuides(this)
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
    // Membership, not `parent`: top-level Paper.js layers never have one,
    // so the old parent check rebuilt (and orphaned) the grid layer call
    // after call. Consolidate duplicates the same way refreshArtboards does.
    let layer =
      this.gridLayer && this.project.layers.includes(this.gridLayer)
        ? this.gridLayer
        : (flagged[0] as paper.Layer | undefined) ?? null
    for (const dup of flagged) {
      if (dup !== layer) dup.remove()
    }
    if (!layer) {
      const prevActive = this.project.activeLayer
      layer = new this.scope.Layer()
      layer.name = 'grid'
      layer.locked = true
      layer.data.isUserLayer = false
      layer.data.isGridLayer = true
      if (prevActive && this.project.layers.includes(prevActive)) prevActive.activate()
      else {
        const fallback = this.getActiveLayer()
        if (fallback && this.project.layers.includes(fallback)) fallback.activate()
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

  /** See engine-view.ts. */
  panBy(dx: number, dy: number) {
    view.panBy(this, dx, dy)
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

  /** See engine-view.ts. */
  zoomAt(scale: number, canvasX?: number, canvasY?: number) {
    view.zoomAt(this, scale, canvasX, canvasY)
  }

  fitToContent() {
    this.fitBounds(this.unitedBoundsOf(this.getUserItems()))
  }

  /** Fit the view to the current selection bounds (View menu). */
  /** See engine-select.ts. */
  moveSelectionToActiveLayer(): number {
    return select.moveSelectionToActiveLayer(this)
  }

  /** See engine-view.ts. */
  navigateArtboards(step: number): boolean {
    return view.navigateArtboards(this, step)
  }

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
    // Colors convert to paper objects: bulk item.set() stores raw strings
    // verbatim and paper later crashes on the stale string (see
    // paperColorFor in engine-appearance.ts).
    if (this.isPatternGroup(item)) {
      const paperStyle: any = {}
      if (style.strokeColor) paperStyle.strokeColor = appearance.paperColorFor(this.scope, style.strokeColor)
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
    const gradientFill = appearance.gradientFillForItem(this, item, style)
    if (gradientFill) paperStyle.fillColor = gradientFill
    else if (style.fillColor) paperStyle.fillColor = appearance.paperColorFor(this.scope, style.fillColor)
    else paperStyle.fillColor = null
    if (style.fillRule) paperStyle.fillRule = style.fillRule
    if (style.strokeColor) paperStyle.strokeColor = appearance.paperColorFor(this.scope, style.strokeColor)
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
    const rebuilt = appearance.gradientFillForItem(this, item, { gradient: params } as StyleState)
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

  // ===== Multi-appearance (AI Appearance panel parity) =====

  /** Create a default empty appearance (single fill + stroke). */
  /** See engine-appearance.ts. */
  createDefaultAppearance(): AppearanceState {
    return appearance.createDefaultAppearance(this)
  }

  /** See engine-appearance.ts. */
  getAppearanceFromItem(item: paper.Item): AppearanceState {
    return appearance.getAppearanceFromItem(this, item)
  }

  /** See engine-appearance.ts. */
  setAppearanceOnItem(item: paper.Item, appearanceState: AppearanceState) {
    appearance.setAppearanceOnItem(this, item, appearanceState)
  }

  /** See engine-appearance.ts. */
  addAppearanceFill(item: paper.Item, fill?: Partial<AppearanceFill>): AppearanceFill {
    return appearance.addAppearanceFill(this, item, fill)
  }

  /** See engine-appearance.ts. */
  addAppearanceStroke(item: paper.Item, stroke?: Partial<AppearanceStroke>): AppearanceStroke {
    return appearance.addAppearanceStroke(this, item, stroke)
  }

  /** See engine-appearance.ts. */
  removeAppearanceFill(item: paper.Item, fillId: string) {
    appearance.removeAppearanceFill(this, item, fillId)
  }

  /** See engine-appearance.ts. */
  removeAppearanceStroke(item: paper.Item, strokeId: string) {
    appearance.removeAppearanceStroke(this, item, strokeId)
  }

  /** See engine-appearance.ts. */
  updateAppearanceFill(item: paper.Item, fillId: string, patch: Partial<AppearanceFill>) {
    appearance.updateAppearanceFill(this, item, fillId, patch)
  }

  /** See engine-appearance.ts. */
  updateAppearanceStroke(item: paper.Item, strokeId: string, patch: Partial<AppearanceStroke>) {
    appearance.updateAppearanceStroke(this, item, strokeId, patch)
  }

  /** See engine-appearance.ts. */
  reorderAppearanceFills(item: paper.Item, fromIndex: number, toIndex: number) {
    appearance.reorderAppearanceFills(this, item, fromIndex, toIndex)
  }

  /** See engine-appearance.ts. */
  reorderAppearanceStrokes(item: paper.Item, fromIndex: number, toIndex: number) {
    appearance.reorderAppearanceStrokes(this, item, fromIndex, toIndex)
  }

  // ===== Global colors (AI Swatches parity, one-change-all) =====

  /** See engine-appearance.ts. */
  applyGlobalColorToSelection(color: string, toStroke: boolean): number {
    return appearance.applyGlobalColorToSelection(this, color, toStroke)
  }

  /**
   * Repaint every user item using `oldColor` with `newColor`.
   * Powers the global-color "edit once, update everywhere" contract.
   * Returns the number of paints touched (fill + stroke counted separately).
   */
  recolorGlobalUsages(oldColor: string, newColor: string): number {
    const oldN = (oldColor || '').trim().toLowerCase()
    const newN = (newColor || '').trim().toLowerCase()
    if (!oldN || oldN === newN) return 0
    let n = 0
    const items = this.project.getItems({ match: () => true })
    for (const item of items) {
      const data = (item.data as any) ?? {}
      if (!data.isUserItem) continue
      const s = item as any
      if (s.fillColor !== undefined) {
        const css = this.colorToCSS(s.fillColor)
        if (typeof css === 'string' && css.trim().toLowerCase() === oldN) {
          s.fillColor = newColor
          n++
        }
      }
      if (s.strokeColor !== undefined) {
        const css = this.colorToCSS(s.strokeColor)
        if (typeof css === 'string' && css.trim().toLowerCase() === oldN) {
          s.strokeColor = newColor
          n++
        }
      }
    }
    if (n > 0) this.scope.view.update()
    return n
  }

  /**
   * Snap the unlocked selection onto the device-pixel grid (D2).
   * Positions move by whole device pixels; geometry is untouched.
   * Ratio defaults to the pixel-preview density. Returns moved items.
   */
  alignSelectionToPixel(ratio?: 1 | 2): number {
    const r = (ratio === 2 || ratio === 1 ? ratio : this.store.view.pixelRatio === 2 ? 2 : 1) as 1 | 2
    let n = 0
    for (const item of this.getSelection() as any[]) {
      if (item.locked || !item.position) continue
      const nx = alignToPixel(item.position.x, r)
      const ny = alignToPixel(item.position.y, r)
      if (nx !== item.position.x || ny !== item.position.y) {
        item.position = new this.scope.Point(nx, ny)
        n++
      }
    }
    if (n > 0) {
      this.scope.view.update()
      this.syncSelectionToStore()
    }
    return n
  }

  // ===== Opacity masks (AI/CDR parity) =====

  /** Get opacity mask from an item (or null). */
  getOpacityMask(item: paper.Item): OpacityMaskState | null {
    const data = (item.data as any) ?? {}
    return data.opacityMask ?? null
  }

  /** Create a default opacity mask state. */
  private createDefaultOpacityMask(): OpacityMaskState {
    return {
      enabled: true,
      invert: false,
      contentJson: null,
      bounds: null,
    }
  }

  /**
   * Apply an opacity mask to an item. The mask content is a Paper.js item
   * whose luminance controls the alpha channel. For live preview, we use
   * a simplified approach: the mask is stored and applied during export.
   */
  applyOpacityMask(target: paper.Item, maskContent: paper.Item | null): void {
    const data = (target.data as any) ?? {}
    if (!maskContent) {
      // Remove mask.
      delete data.opacityMask
      target.data = data
      // Remove mask group if it exists.
      if (target.parent instanceof this.scope.Group && (target.parent as any).data?.isOpacityMaskGroup) {
        const group = target.parent
        const parent = group.parent ?? this.getActiveLayer()
        const at = parent.children.indexOf(group)
        // Move target out of the group.
        for (const child of group.children.slice()) {
          if (child !== target) {
            parent.insertChild(Math.min(at, parent.children.length), child)
          }
        }
        group.remove()
        target.selected = true
      }
      return
    }

    // Serialize the mask content for storage.
    const contentJson = maskContent.exportJSON({ asString: true })
    const bounds = maskContent.bounds ? {
      x: maskContent.bounds.x,
      y: maskContent.bounds.y,
      width: maskContent.bounds.width,
      height: maskContent.bounds.height,
    } : null

    const maskState: OpacityMaskState = {
      enabled: true,
      invert: false,
      contentJson,
      bounds,
    }
    data.opacityMask = maskState
    target.data = data

    // For live preview: wrap in a group with the mask applied via alpha.
    // This is a simplified preview; full mask is applied during SVG export.
    this.applyOpacityMaskPreview(target, maskContent)
  }

  /**
   * Simplified live preview of opacity mask using Paper.js group compositing.
   * The full mask is applied during SVG/PDF export.
   */
  private applyOpacityMaskPreview(target: paper.Item, maskContent: paper.Item): void {
    const scope = this.scope
    const parent = target.parent ?? this.getActiveLayer()
    const at = parent.children.indexOf(target)

    // Create a group to hold the masked content.
    const group = new scope.Group({ insert: false }) as paper.Group
    ;(group as any).data = { isOpacityMaskGroup: true, id: this.genId(), isUserItem: true }

    // Clone the target for the masked version.
    const clone = target.clone({ insert: false }) as paper.Item
    clone.data = { ...clone.data, isOpacityMaskClone: true }

    // Create the mask shape (white fill = opaque, black = transparent).
    const maskClone = maskContent.clone({ insert: false }) as paper.Item
    maskClone.fillColor = new scope.Color(1, 1, 1) // White = opaque
    maskClone.opacity = 0.5 // Semi-transparent for preview
    ;(maskClone as any).data = { isOpacityMaskPreview: true }

    group.addChild(clone)
    group.addChild(maskClone)

    // Replace the original with the group.
    parent.insertChild(Math.min(at, parent.children.length), group)
    target.remove()

    // Store reference for cleanup.
    const groupData = (group as any).data
    groupData.maskedItemId = (clone as any).data?.id

    this.scope.view.update()
  }

  /** Remove opacity mask from an item. */
  removeOpacityMask(item: paper.Item): void {
    this.applyOpacityMask(item, null)
  }

  /** Toggle opacity mask enabled state. */
  toggleOpacityMask(item: paper.Item, enabled: boolean): void {
    const data = (item.data as any) ?? {}
    const mask = data.opacityMask as OpacityMaskState | undefined
    if (mask) {
      mask.enabled = enabled
      item.data = data
    }
  }

  /** Toggle opacity mask invert. */
  toggleOpacityMaskInvert(item: paper.Item, invert: boolean): void {
    const data = (item.data as any) ?? {}
    const mask = data.opacityMask as OpacityMaskState | undefined
    if (mask) {
      mask.invert = invert
      item.data = data
    }
  }

  // ===== Mesh gradients (simulated via triangle tessellation) =====
  //
  // Paper.js has no native mesh gradient. We simulate one by:
  // 1. Creating a grid of control vertices with per-vertex colors
  // 2. Tessellating the grid into triangles
  // 3. Rendering each triangle as a 3-stop linear gradient (barycentric interpolation)

  /** Get mesh gradient state from item, or null. */
  getMeshGradient(item: paper.Item): MeshGradientState | null {
    const data = (item.data as any) ?? {}
    return (data.meshGradient as MeshGradientState) ?? null
  }

  /** Create a default mesh gradient (2×2 grid, 4 vertices). */
  createDefaultMeshGradient(item: paper.Item): MeshGradientState {
    const bounds = item.bounds
    if (!bounds) {
      return { cols: 2, rows: 2, vertices: [] }
    }
    const w = bounds.width
    const h = bounds.height
    const vertices: MeshGradientVertex[] = [
      { x: 0, y: 0, color: '#ff0000' },
      { x: w, y: 0, color: '#ffff00' },
      { x: 0, y: h, color: '#0000ff' },
      { x: w, y: h, color: '#00ff00' },
    ]
    return { cols: 2, rows: 2, vertices }
  }

  /** Apply a mesh gradient to an item by tessellating into gradient-filled triangles. */
  applyMeshGradient(item: paper.Item, mesh: MeshGradientState): void {
    const data = (item.data as any) ?? {}
    data.meshGradient = mesh
    item.data = data

    // Remove old mesh children
    this.clearMeshGradientChildren(item)

    // Tessellate and render
    const bounds = item.bounds
    if (!bounds || mesh.vertices.length === 0) return

    const originX = bounds.x
    const originY = bounds.y
    const cellW = bounds.width / Math.max(mesh.cols - 1, 1)
    const cellH = bounds.height / Math.max(mesh.rows - 1, 1)

    const group = new this.scope.Group()
    ;(group as any).data = { isMeshGradientGroup: true, id: this.genId(), isUserItem: true }

    for (let r = 0; r < mesh.rows - 1; r++) {
      for (let c = 0; c < mesh.cols - 1; c++) {
        const tl = mesh.vertices[r * mesh.cols + c]
        const tr = mesh.vertices[r * mesh.cols + c + 1]
        const bl = mesh.vertices[(r + 1) * mesh.cols + c]
        const br = mesh.vertices[(r + 1) * mesh.cols + c + 1]

        // Upper-left triangle: tl, tr, bl
        this.renderMeshTriangle(group, originX, originY, tl, tr, bl)
        // Lower-right triangle: tr, br, bl
        this.renderMeshTriangle(group, originX, originY, tr, br, bl)
      }
    }

    item.parent?.insertChild(item.parent.children.length, group)
  }

  private renderMeshTriangle(
    parent: paper.Group,
    ox: number, oy: number,
    v0: MeshGradientVertex, v1: MeshGradientVertex, v2: MeshGradientVertex,
  ) {
    const scope = this.scope
    const path = new scope.Path({
      segments: [
        [ox + v0.x, oy + v0.y],
        [ox + v1.x, oy + v1.y],
        [ox + v2.x, oy + v2.y],
      ],
      closed: true,
      insert: false,
    })

    // Compute centroid for gradient center
    const cx = (v0.x + v1.x + v2.x) / 3
    const cy = (v0.y + v1.y + v2.y) / 3

    // Use a linear gradient from v0→v2 blending the 3 vertex colors
    // This is an approximation; full barycentric would require per-pixel rendering
    const grad = new scope.Gradient()
    grad.stops = [
      new scope.GradientStop(new scope.Color(v0.color), 0),
      new scope.GradientStop(new scope.Color(v1.color), 0.5),
      new scope.GradientStop(new scope.Color(v2.color), 1),
    ]
    grad.radial = false

    const origin = new scope.Point(ox + v0.x, oy + v0.y)
    const destination = new scope.Point(ox + v2.x, oy + v2.y)
    path.fillColor = new scope.Color(grad, origin, destination)
    path.strokeWidth = 0
    ;(path as any).data = { isMeshTriangle: true }
    parent.addChild(path)
  }

  /** Remove all mesh gradient child triangles from an item. */
  private clearMeshGradientChildren(item: paper.Item): void {
    const children = item.parent?.children ?? []
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]
      const d = (child.data as any) ?? {}
      if (d.isMeshGradientGroup) {
        child.remove()
      }
    }
  }

  /** Remove mesh gradient from an item. */
  removeMeshGradient(item: paper.Item): void {
    const data = (item.data as any) ?? {}
    delete data.meshGradient
    item.data = data
    this.clearMeshGradientChildren(item)
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
    // History diet (C5): inline bitmap pixels are replaced by sidecar
    // tokens so 100 snapshots share one copy of each distinct image.
    // Project files (snapshotProjectObject) stay self-contained.
    const obj = this.withCleanScene(
      () => (this.project as any).exportJSON({ asString: false }) as unknown,
    )
    return JSON.stringify(slimHistoryImages(obj, this.historyImageStore))
  }

  /**
   * Session sidecar for history-snapshot bitmaps: content-hash -> dataURL.
   * Never pruned within a session (distinct images only, so it stays
   * bounded); snapshots reference it by token, files embed pixels directly.
   */
  private historyImageStore = new Map<string, string>()

  /** Snapshot as a plain object for v2 project files (no double encoding). */
  snapshotProjectObject(): Record<string, unknown> | unknown[] {
    return this.withCleanScene(
      () => (this.project as any).exportJSON({ asString: false }) as Record<string, unknown> | unknown[]
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

  restoreSnapshot(snapshot: string | Record<string, unknown> | unknown[]) {
    this.restoreSnapshotWithMeta(snapshot, null)
  }

  /**
   * Restore paper state plus, when provided, the document metadata riding
   * alongside history entries (artboards, bleed, page size) so board ops
   * participate in undo/redo like artwork ops do.
   */
  private restoreSnapshotWithMeta(
    snapshot: string | Record<string, unknown> | unknown[],
    meta: HistoryDocMeta | null
  ) {
    // Project#importJSON appends a fresh layer stack whenever it runs (its
    // layer-merge path only triggers for an empty active layer of matching
    // type), so the project must be cleared first or every undo/redo would
    // duplicate the whole document.
    this.clearIsolationState()
    this.project.clear()
    // History snapshots carry image tokens (see snapshotProject): inflate
    // them from the session sidecar. Full-fidelity payloads (project files,
    // pre-diet snapshots) pass through untouched.
    const raw = typeof snapshot === 'string' ? (JSON.parse(snapshot) as unknown) : snapshot
    this.project.importJSON(inflateHistoryImages(raw, this.historyImageStore) as string)
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

  /**
   * Last committed selection transform, replayed by transformAgain()
   * (AI Transform Again parity). Pivots are recorded as explicit points so
   * replaying against a changed selection keeps the original origin.
   */
  private lastTransform:
    | { kind: 'move'; dx: number; dy: number }
    | { kind: 'rotate'; angle: number; pivot: paper.Point }
    | { kind: 'scale'; sx: number; sy: number; pivot: paper.Point }
    | null = null

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

  /** Shared snap service for invalidating the document-wide cache. */
  private static readonly snapService = new SnapService()

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
    this.store.bumpRevision()
    if (!EditorEngine.FRAME_SAFE_HISTORY.has(name)) {
      this.geometryVersion++
      // Invalidate snap cache when document geometry changes.
      EditorEngine.snapService.invalidateCache()
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
      this.store.bumpRevision()
      // Invalidate snap cache after undo (document geometry may have changed).
      EditorEngine.snapService.invalidateCache()
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
      this.store.bumpRevision()
      // Invalidate snap cache after redo (document geometry may have changed).
      EditorEngine.snapService.invalidateCache()
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
    this.store.bumpRevision()
  }

  /** Drop the whole history stack (history panel clear action). */
  clearHistory(): void {
    this.history = []
    this.historySnapshots = []
    this.historyMeta = []
    this.historyIndex = -1
    this.store.setHistory([], -1)
    // Clearing drops undo history; the document content itself is untouched,
    // so the dirty flag must keep its previous value. It used to call
    // markSaved() here, which reported an edited document as saved and
    // suppressed the New/Open/reload warnings right after losing undo.
    this.clearSelection()
    this.clearIsolationState()
    this.thumbCache?.clear?.()
  }

  /** Mark the current revision as the saved (clean) one. */
  markSaved(): void {
    this.store.markRevisionSaved()
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
    if (filename) this.store.setDocumentName(stem)
    // Mirror into the File > Recent list (best effort, non-blocking).
    void recordRecentProject(stem, fileText)
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
      // v1 snapshots are JSON strings, v2+ are nested Paper tuples; Paper
      // imports both, so old files keep opening.
      this.restoreSnapshot(rawSnapshot as string | Record<string, unknown> | unknown[])
    } catch {
      try {
        this.restoreSnapshot(backup)
      } catch {
        // The backup came from our own exporter; a second failure means
        // the project itself is unusable, so surface the file error.
      }
      throw new Error('Invalid project file: snapshot unreadable')
    }
    const rawPage = parsed.pageSize
    const pageSize =
      rawPage &&
      Number.isFinite(rawPage.width) &&
      Number.isFinite(rawPage.height) &&
      rawPage.width > 0 &&
      rawPage.height > 0
        ? { width: rawPage.width, height: rawPage.height }
        : undefined
    if (pageSize) {
      this.store.setPageSize(pageSize.width, pageSize.height)
    } else {
      // Files without a page size (v1 has no field) must not inherit the
      // outgoing document's page; fall back to the same default New uses.
      this.store.setPageSize(1920, 1080)
    }
    // Same for bleed: absent means "none", not "whatever was open before".
    this.store.setBleed(Number.isFinite(parsed.bleed) ? Math.max(0, Number(parsed.bleed)) : 0)
    // The key object id never survives a document switch: the old item is gone.
    this.store.setKeyObject('')
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
    this.store.setBleed(0)
    this.store.setKeyObject('')
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
    layers.pointActiveLayerAtRestoredStack(this)
  }

  /** Drop the whole history stack and start over with a single entry. */
  private resetHistory(name: string): void {
    this.history = []
    this.historySnapshots = []
    this.historyMeta = []
    this.historyIndex = -1
    this.store.setHistory([], -1)
    // Bitmap stash is keyed by item id and belongs to the outgoing document.
    this.imageStash.clear()
    // Same for the history image sidecar: the new baseline snapshot
    // re-registers the live document's pixels on the pushHistory below.
    this.historyImageStore.clear()
    this.pushHistory(name)
    this.markSaved()
  }

  /** See engine-layers.ts. */
  moveUserLayer(layerId: string, toUserIndex: number): boolean {
    return layers.moveUserLayer(this, layerId, toUserIndex)
  }

  /** See engine-layers.ts. */
  setActiveLayerOpacity(opacity: number): void {
    layers.setActiveLayerOpacity(this, opacity)
  }

  /** See engine-layers.ts. */
  mergeLayerBelow(): boolean {
    return layers.mergeLayerBelow(this)
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

  /** See engine-select.ts. */
  invertSelection(): void {
    select.invertSelection(this)
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
    layer.name = layers.nextUserLayerName(this)
    layer.data.isUserLayer = true
    layer.data.layerId = id
    layers.parkUserLayer(this, layer)
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
        layer.name = label || layers.nextUserLayerName(this)
        layer.data.isUserLayer = true
        layer.data.layerId = id
        layers.parkUserLayer(this, layer)
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
    this.lastTransform = { kind: 'rotate', angle: angleDeg, pivot: center.clone() }
  }

  /**
   * Replay the last committed selection transform on the current unlocked
   * selection (AI Transform Again). Applies the transform and records one
   * 'Transform Again' history entry. Returns false when nothing has been
   * recorded or nothing can be transformed.
   */
  transformAgain(): boolean {
    const t = this.lastTransform
    if (!t) return false
    const full = this.getSelection()
    const items = full.filter((item) => !item.locked)
    if (items.length === 0) return false
    if (t.kind === 'rotate') {
      this.rotateSelection(t.angle, t.pivot)
    } else if (t.kind === 'scale') {
      this.scaleSelection(t.sx, t.sy, t.pivot)
    } else {
      const delta = new this.scope.Point(t.dx, t.dy)
      items.forEach((item) => {
        item.position = item.position.add(delta)
        this.refreshItemGradient(item)
      })
      // Same frame bookkeeping as nudgeSelection: pure translation slides
      // the oriented frame, locked members behind force a rebuild.
      const selectCtrl = this.controllers.get('select') as { frameTranslated?: (dx: number, dy: number) => void; frameStamped?: () => void; dropFrame?: () => void } | undefined
      try {
        if (items.length !== full.length) selectCtrl?.dropFrame?.()
        else selectCtrl?.frameTranslated?.(t.dx, t.dy)
      } catch {
        // Frame bookkeeping must never break document ops.
      }
      this.scope.view.update()
      this.reflowTextsForItems(items)
      try {
        selectCtrl?.frameStamped?.()
      } catch {
        // Frame bookkeeping must never break document ops.
      }
      this.syncSelectionToStore()
    }
    this.pushHistory('Transform Again')
    return true
  }

  /** Remember a committed whole-selection move delta (drag commit path). */
  recordTransformMove(dx: number, dy: number): void {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
    if (dx === 0 && dy === 0) return
    this.lastTransform = { kind: 'move', dx, dy }
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
   * AI Path > Split Into Grid: replace the single unlocked selected item
   * with rows x cols rectangular cells tiling its axis-aligned bounds
   * (optional gutters), styled like the source. Cells become the new
   * selection; one history entry. Returns the cell count, 0 when nothing
   * usable is selected or the bounds do not fit the gutters.
   */
  splitSelectionGrid(rows: number, cols: number, gutterX: number, gutterY: number): number {
    const r = Math.round(Number(rows))
    const c = Math.round(Number(cols))
    const gx = Number(gutterX)
    const gy = Number(gutterY)
    if (!Number.isFinite(r) || !Number.isFinite(c) || r < 1 || c < 1) return 0
    if (!Number.isFinite(gx) || !Number.isFinite(gy) || gx < 0 || gy < 0) return 0
    if (r * c > 1000) return 0
    const selected = this.getSelection().filter((item) => !item.locked && item.parent)
    if (selected.length !== 1) return 0
    const source = selected[0]
    const b = source.bounds
    const cellW = (b.width - (c - 1) * gx) / c
    const cellH = (b.height - (r - 1) * gy) / r
    if (!(cellW > 0) || !(cellH > 0)) return 0

    const parent = source.parent ?? this.getActiveLayer()
    const at = parent.children.indexOf(source as any)
    const src = source as any
    const cells: paper.Item[] = []
    for (let row = 0; row < r; row++) {
      for (let col = 0; col < c; col++) {
        const x = b.x + col * (cellW + gx)
        const y = b.y + row * (cellH + gy)
        const cell = new this.scope.Path.Rectangle({
          from: [x, y, x + cellW, y + cellH],
          insert: false,
        }) as paper.Path
        cell.data.id = this.genId()
        cell.data.isUserItem = true
        // Cells inherit the source appearance (paint, dash, blend, opacity).
        ;(cell as any).fillColor = src.fillColor ?? null
        ;(cell as any).strokeColor = src.strokeColor ?? null
        if (src.strokeColor !== null && src.strokeColor !== undefined) {
          cell.strokeWidth = src.strokeWidth ?? 1
          cell.strokeCap = src.strokeCap
          cell.strokeJoin = src.strokeJoin
          cell.miterLimit = src.miterLimit
          cell.dashArray = src.dashArray
          cell.dashOffset = src.dashOffset
        }
        ;(cell as any).fillRule = src.fillRule
        ;(cell as any).blendMode = src.blendMode
        ;(cell as any).opacity = src.opacity
        this.refreshItemGradient(cell)
        parent.insertChild(Math.min(at + 1 + cells.length, parent.children.length), cell)
        cells.push(cell)
      }
    }
    source.remove()
    this.clearSelection()
    cells.forEach((cell) => {
      cell.selected = true
    })
    this.syncSelectionToStore()
    this.reflowTextsForItems(cells)
    this.pushHistory('Split Into Grid')
    this.scope.view.update()
    return cells.length
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
    // Skew is non-rigid: the oriented selection frame cannot track it, so
    // invalidate the frame like any other untracked geometry change.
    this.bumpGeometryVersion()
  }

  /**
   * Reflect every unlocked selected item across an axis line through the
   * pivot (AI Object > Transform > Reflect). The axis angle is in degrees:
   * 0 mirrors top/bottom (horizontal axis), 90 mirrors left/right. With
   * `copy`, reflected duplicates are created and selected instead. Callers
   * record history. Returns false when nothing can be reflected.
   */
  reflectSelection(axisAngleDeg: number, copy = false, pivot?: paper.Point): boolean {
    if (!Number.isFinite(axisAngleDeg)) return false
    const full = this.getSelection()
    const items = full.filter((item) => !item.locked)
    if (items.length === 0) return false
    const center = pivot ?? this.selectionReferencePivot() ?? this.getSelectionBounds()?.center
    if (!center) return false
    // Reflection about the angle-th axis = rotate(-angle) -> mirror Y ->
    // rotate(angle), the same proven rotate/scale primitives the flip and
    // mirror paths use.
    const reflect = (item: paper.Item) => {
      item.rotate(-axisAngleDeg, center)
      item.scale(1, -1, center)
      item.rotate(axisAngleDeg, center)
    }
    const targets: paper.Item[] = []
    if (copy) {
      for (const item of items) {
        const clone = this.freshClone(item)
        reflect(clone)
        const parent = item.parent ?? this.getActiveLayer()
        parent.insertChild(parent.children.indexOf(item as any) + 1, clone)
        this.refreshItemGradient(clone)
        targets.push(clone)
      }
    } else {
      for (const item of items) {
        reflect(item)
        this.refreshItemGradient(item)
        targets.push(item)
      }
    }
    this.clearSelection()
    targets.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.reflowTextsForItems(targets)
    // Reflection is non-rigid: the oriented frame cannot track it.
    this.bumpGeometryVersion()
    this.scope.view.update()
    return true
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
    // Position changed with an unchanged id set: refresh the mirrored bounds
    // so the Properties panel does not edit against a pre-nudge anchor.
    this.syncSelectionToStore()
    this.lastTransform = { kind: 'move', dx, dy }
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
    // Only coalesce with the top of the stack. After an undo the cursor sits
    // mid-stack, and merging into that past entry overwrote its snapshot
    // while the redo branch behind it stayed — redo then jumped to a state
    // that no longer matched its own baseline.
    const atTop = this.historyIndex === this.history.length - 1
    if (atTop && last && last.name === name && now - last.timestamp < windowMs) {
      this.historySnapshots[this.historyIndex] = this.snapshotProject()
      this.historyMeta[this.historyIndex] = this.captureDocMeta()
      last.timestamp = now
      this.store.setHistory(this.history, this.historyIndex)
      this.store.bumpRevision()
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

  /** See engine-pathfinder.ts. */
  booleanOperation(op: BooleanOperation): boolean {
    return pathfinder.booleanOperation(this, op)
  }

  /**
   * Sample `count` vertices evenly along a path's arc length (closed
   * outlines wrap without repeating the first vertex; open outlines include
   * both endpoints). Returns null for degenerate geometry.
   */
  private resamplePathPoints(
    path: paper.Path,
    count: number,
    closed: boolean
  ): paper.Point[] | null {
    const len = path.length
    if (!Number.isFinite(len) || len <= 0) return null
    const pts: paper.Point[] = []
    if (closed) {
      for (let i = 0; i < count; i++) {
        const pt = path.getPointAt((len * i) / count)
        if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null
        pts.push(pt)
      }
    } else {
      for (let i = 0; i <= count; i++) {
        const pt = path.getPointAt(Math.min(len, (len * i) / count))
        if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null
        pts.push(pt)
      }
    }
    return pts
  }

  /** Solid paint of an item as 8-bit channels, null for gradients/none. */
  private solidPaintOf(item: paper.Item, key: 'fillColor' | 'strokeColor'): Rgba | null {
    const paint = (item as any)[key] as any
    if (!paint || paint.gradient) return null
    return parseCssColor(this.colorToCSS(paint))
  }

  /**
   * AI/CDR "Smooth Color" blend: auto-calculate the number of steps needed
   * for a smooth color transition between two selected paths. Returns up to
   * 256 steps (enough for 8-bit-per-channel gradients).
   */
  autoBlendSteps(): number {
    const scope = this.scope
    const paths = this.getSelection().filter(
      (item) => !item.locked && item.parent && item instanceof scope.Path
    ) as paper.Path[]
    if (paths.length !== 2) return 8
    const [a, b] = paths
    const fa = this.solidPaintOf(a, 'fillColor')
    const fb = this.solidPaintOf(b, 'fillColor')
    const sa = this.solidPaintOf(a, 'strokeColor')
    const sb = this.solidPaintOf(b, 'strokeColor')
    let maxDist = 0
    if (fa && fb) {
      const d = Math.abs(fa.r - fb.r) + Math.abs(fa.g - fb.g) + Math.abs(fa.b - fb.b) + Math.abs(fa.a - fb.a)
      maxDist = Math.max(maxDist, d)
    }
    if (sa && sb) {
      const d = Math.abs(sa.r - sb.r) + Math.abs(sa.g - sb.g) + Math.abs(sa.b - sb.b) + Math.abs(sa.a - sb.a)
      maxDist = Math.max(maxDist, d)
    }
    // Also factor in opacity difference
    const opa = a.opacity ?? 1
    const opb = b.opacity ?? 1
    maxDist = Math.max(maxDist, Math.abs(opa - opb) * 4)
    // Map 0..4 color distance to 8..256 steps
    const steps = Math.min(256, Math.max(8, Math.round(maxDist * 64)))
    return steps
  }

  /**
   * AI/CDR Object > Blend: build `steps` shapes interpolated between two
   * unlocked selected paths (blending runs back-to-front). Both outlines
   * resample to a shared vertex budget, align start/winding, then every step
   * lerps the geometry plus solid fill/stroke colors, stroke widths and
   * opacity — gradient paints or a paint present on only one end leave the
   * matching step paint empty. Shared-parent operands group the whole run at
   * the back operand's z slot; otherwise the steps stack above the back
   * operand. One history entry. Returns the steps built, 0 when the
   * selection or geometry cannot blend.
   */
  blendSelection(steps: number): number {
    const scope = this.scope
    const count = Math.round(Number(steps))
    if (!Number.isFinite(count) || count < 1 || count > 200) return 0
    const paths = this.getSelection().filter(
      (item) => !item.locked && item.parent && item instanceof scope.Path
    ) as paper.Path[]
    if (paths.length !== 2) return 0
    const [back, front] = paths
      .slice()
      .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))

    // One closure convention for both operands so the vertex streams line up
    // (a mixed closed/open pair resamples as open).
    const closed = back.closed && front.closed
    const budget = sampleCountFor([back.segments.length, front.segments.length])
    const backPts = this.resamplePathPoints(back, budget, closed)
    const frontPts = this.resamplePathPoints(front, budget, closed)
    if (!backPts || !frontPts || backPts.length !== frontPts.length) return 0
    const alignedFront = alignSampledPoints(backPts, frontPts, closed)

    const fillBack = this.solidPaintOf(back, 'fillColor')
    const fillFront = this.solidPaintOf(front, 'fillColor')
    const strokeBack = this.solidPaintOf(back, 'strokeColor')
    const strokeFront = this.solidPaintOf(front, 'strokeColor')
    const widthBack = Number.isFinite(back.strokeWidth as number) ? (back.strokeWidth as number) : null
    const widthFront = Number.isFinite(front.strokeWidth as number) ? (front.strokeWidth as number) : null

    const steps_: paper.Path[] = []
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1)
      const segs: paper.Point[] = []
      for (let j = 0; j < backPts.length; j++) {
        segs.push(
          new scope.Point(
            lerp(backPts[j].x, alignedFront[j].x, t),
            lerp(backPts[j].y, alignedFront[j].y, t)
          )
        )
      }
      const step = new scope.Path({ segments: segs, closed, insert: false }) as paper.Path
      try {
        step.smooth({ type: 'catmull-rom', factor: 0.5 })
      } catch {
        // Straight-segment steps beat aborting the whole blend.
      }
      if (fillBack && fillFront) {
        step.fillColor = new scope.Color(rgbaToCss(lerpRgba(fillBack, fillFront, t)))
      }
      if (strokeBack && strokeFront) {
        step.strokeColor = new scope.Color(rgbaToCss(lerpRgba(strokeBack, strokeFront, t)))
      }
      if (widthBack !== null && widthFront !== null) step.strokeWidth = lerp(widthBack, widthFront, t)
      step.strokeCap = back.strokeCap
      step.strokeJoin = back.strokeJoin
      step.opacity = lerp(back.opacity, front.opacity, t)
      step.data.id = this.genId()
      step.data.isUserItem = true
      steps_.push(step)
    }

    const parent = back.parent as paper.Item
    if (front.parent === back.parent) {
      const at = parent.children.indexOf(back)
      const group = new scope.Group({ insert: false }) as paper.Group
      group.addChild(back)
      for (const step of steps_) group.addChild(step)
      group.addChild(front)
      parent.insertChild(Math.min(Math.max(0, at), parent.children.length), group)
      group.data.id = this.genId()
      group.data.isUserItem = true
      this.selectItem(group)
    } else {
      const at = parent.children.indexOf(back)
      let k = 1
      for (const step of steps_) {
        parent.insertChild(Math.min(at + k, parent.children.length), step)
        k++
      }
      this.clearSelection()
      for (const item of [back, ...steps_, front]) item.selected = true
      this.syncSelectionToStore()
    }
    this.pushHistory('Blend')
    this.scope.view.update()
    return count
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
    this.lastTransform = { kind: 'scale', sx, sy, pivot: center.clone() }
  }

  /**
   * AI Object > Repeat > Grid: duplicate every unlocked selected item into
   * a rows x cols grid offset by dx/dy document units per cell (the
   * original occupies the 0,0 cell). Copies become the new selection; one
   * history entry. Returns the copies made, 0 when nothing can repeat.
   */
  gridRepeat(rows: number, cols: number, dx: number, dy: number): number {
    const r = Math.round(Number(rows))
    const c = Math.round(Number(cols))
    const stepX = Number(dx)
    const stepY = Number(dy)
    if (!Number.isFinite(r) || !Number.isFinite(c) || r < 1 || c < 1 || r * c < 2) return 0
    if (!Number.isFinite(stepX) || !Number.isFinite(stepY) || stepX <= 0 || stepY <= 0) return 0
    const sources = this.getSelection().filter((item) => !item.locked && item.parent)
    if (sources.length === 0) return 0
    const made: paper.Item[] = []
    for (const item of sources) {
      const parent = item.parent ?? this.getActiveLayer()
      const at = parent.children.indexOf(item as any)
      let k = 0
      for (let row = 0; row < r; row++) {
        for (let col = 0; col < c; col++) {
          if (row === 0 && col === 0) continue
          const clone = this.freshClone(item)
          clone.position = (clone.position as paper.Point).add(
            new this.scope.Point(col * stepX, row * stepY)
          )
          parent.insertChild(Math.min(at + 1 + k, parent.children.length), clone)
          this.refreshItemGradient(clone)
          made.push(clone)
          k++
        }
      }
    }
    if (made.length === 0) return 0
    this.clearSelection()
    made.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.reflowTextsForItems(made)
    this.pushHistory('Grid Repeat')
    this.scope.view.update()
    return made.length
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

  /** See engine-pathfinder.ts. */
  extendedBoolean(op: 'minusBack' | 'divide' | 'trim' | 'outline'): boolean {
    return pathfinder.extendedBoolean(this, op)
  }

  /** See engine-appearance.ts. */
  getSpotFromSelection(): { fill: string | null; stroke: string | null } {
    return appearance.getSpotFromSelection(this)
  }

  /** See engine-appearance.ts. */
  setSpotForSelection(fill: string | null, stroke: string | null): void {
    appearance.setSpotForSelection(this, fill, stroke)
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
    this.stampRasterIdentity(raster)
    raster.onLoad = () => {
      // exportRaster ran at 2x, so the bitmap lands at twice the selection
      // size (a data URL carries no DPI): scale it back into the original
      // bounds before placing it.
      const nb = (raster as any).bounds as paper.Rectangle | undefined
      if (nb && nb.width > 0 && nb.height > 0) {
        raster.scale(bounds.width / nb.width, bounds.height / nb.height)
      }
      raster.position = bounds.center.clone()
      this.stampRasterIdentity(raster)
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
      // Convert opacity-mask groups to SVG <mask> elements
      this.applySvgMasks(root)
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

  /**
   * Post-process exported SVG to convert opacity-mask groups into proper
   * SVG `<mask>` elements. Paper.js has no native mask export, so we
   * detect groups with `data-isOpacityMaskGroup` and rewrite them.
   */
  private applySvgMasks(root: SVGSVGElement): void {
    const ns = 'http://www.w3.org/2000/svg'
    const defs = document.createElementNS(ns, 'defs')
    let defsInserted = false
    let maskId = 0

    const groups = root.querySelectorAll('g')
    for (const g of Array.from(groups)) {
      const dataStr = g.getAttribute('data-isOpacityMaskGroup')
      if (dataStr !== 'true') continue

      const children = Array.from(g.children)
      if (children.length < 1) continue

      // The first child is the masked content, second (if present) is the mask shape
      const maskedContent = children[0]
      const maskShape = children.length > 1 ? children[1] : null

      if (!maskShape) continue

      const id = `vve-mask-${maskId++}`

      // Build a <mask> element with the mask shape
      const mask = document.createElementNS(ns, 'mask')
      mask.setAttribute('id', id)
      mask.setAttribute('maskUnits', 'userSpaceOnUse')

      // Copy the mask shape into the mask (luminance mask = white=opaque)
      const maskContent = maskShape.cloneNode(true) as SVGElement
      // Ensure the mask shape renders in luminance
      if (maskContent.tagName === 'path' || maskContent.tagName === 'rect' ||
          maskContent.tagName === 'ellipse' || maskContent.tagName === 'circle') {
        maskContent.removeAttribute('fill')
        maskContent.setAttribute('fill', 'white')
      }
      mask.appendChild(maskContent)

      // Insert defs if not done yet
      if (!defsInserted) {
        root.insertBefore(defs, root.firstChild)
        defsInserted = true
      }
      defs.appendChild(mask)

      // Get the masked content's existing attributes
      const transform = g.getAttribute('transform') || ''

      // Replace the group with the masked content wrapped in mask reference
      const wrapper = document.createElementNS(ns, 'g')
      if (transform) wrapper.setAttribute('transform', transform)
      wrapper.setAttribute('mask', `url(#${id})`)

      // Move all children of the original masked content into the wrapper
      while (maskedContent.firstChild) {
        wrapper.appendChild(maskedContent.firstChild)
      }
      // If maskedContent has attributes (like transform), copy them
      for (const attr of Array.from(maskedContent.attributes)) {
        if (attr.name !== 'transform') {
          wrapper.setAttribute(attr.name, attr.value)
        }
      }

      g.parentNode?.replaceChild(wrapper, g)
    }
  }

  // ===== N-up imposition (multi-page → single sheet layout) =====

  /**
   * Compute an N-up imposition layout. Returns a list of { page, x, y }
   * describing where each board goes on the imposition sheet.
   * @param boards - array of artboard dimensions
   * @param upCount - number of pages per sheet (e.g. 2, 4, 6, 9, 16)
   * @param spacing - gap between imposed pages (pt)
   * @param margin - sheet margin (pt)
   * @param landscape - force sheet orientation
   */
  computeNUpLayout(
    boards: Array<{ width: number; height: number }>,
    upCount: number = 4,
    spacing: number = 12,
    margin: number = 36,
    landscape?: boolean,
  ): Array<{ pageIndex: number; x: number; y: number; scale: number }> {
    if (boards.length === 0 || upCount < 1) return []

    // Find max board dimensions to determine sheet size
    const maxW = Math.max(...boards.map((b) => b.width))
    const maxH = Math.max(...boards.map((b) => b.height))

    // Compute grid dimensions (rows × cols) to fit upCount
    const cols = Math.ceil(Math.sqrt(upCount))
    const rows = Math.ceil(upCount / cols)

    const useLandscape = landscape ?? (maxW >= maxH)
    const sheetW = useLandscape ? Math.max(maxW, maxH) : Math.min(maxW, maxH)
    const sheetH = useLandscape ? Math.min(maxW, maxH) : Math.max(maxW, maxH)

    // Available area per cell
    const cellW = (sheetW * 2 - margin * 2 - spacing * (cols - 1)) / cols
    const cellH = (sheetH * 2 - margin * 2 - spacing * (rows - 1)) / rows

    const result: Array<{ pageIndex: number; x: number; y: number; scale: number }> = []

    for (let i = 0; i < Math.min(boards.length, upCount); i++) {
      const row = Math.floor(i / cols)
      const col = i % cols
      const board = boards[i]

      // Scale board to fit within cell while maintaining aspect ratio
      const scaleX = cellW / board.width
      const scaleY = cellH / board.height
      const scale = Math.min(scaleX, scaleY, 1) // Never upscale

      // Center board within cell
      const drawW = board.width * scale
      const drawH = board.height * scale
      const cellX = margin + col * (cellW + spacing)
      const cellY = margin + row * (cellH + spacing)
      const x = cellX + (cellW - drawW) / 2
      const y = cellY + (cellH - drawH) / 2

      result.push({ pageIndex: i, x, y, scale })
    }

    return result
  }

  /**
   * Create an N-up imposition SVG. Each board's artwork is placed on
   * the sheet according to the computed layout, scaled to fit.
   */
  exportNUpSVG(
    boards: Array<{ x: number; y: number; width: number; height: number; name?: string }>,
    opts?: { upCount?: number; spacing?: number; margin?: number; landscape?: boolean; bleed?: number }
  ): SVGSVGElement | null {
    const upCount = opts?.upCount ?? 4
    const spacing = opts?.spacing ?? 12
    const margin = opts?.margin ?? 36
    const bleed = opts?.bleed ?? 0

    const layout = this.computeNUpLayout(boards, upCount, spacing, margin, opts?.landscape)
    if (layout.length === 0) return null

    // Compute sheet size from layout
    const maxCellX = Math.max(...layout.map((l) => l.x))
    const maxCellY = Math.max(...layout.map((l) => l.y))
    const lastBoard = boards[layout[layout.length - 1].pageIndex]
    const sheetW = maxCellX + lastBoard.width * layout[layout.length - 1].scale + margin
    const sheetH = maxCellY + lastBoard.height * layout[layout.length - 1].scale + margin

    const ns = 'http://www.w3.org/2000/svg'
    const root = document.createElementNS(ns, 'svg') as SVGSVGElement
    root.setAttribute('xmlns', ns)
    root.setAttribute('width', String(Math.round(sheetW * 100) / 100))
    root.setAttribute('height', String(Math.round(sheetH * 100) / 100))
    root.setAttribute('viewBox', `0 0 ${Math.round(sheetW * 100) / 100} ${Math.round(sheetH * 100) / 100}`)

    // White sheet background
    const sheet = document.createElementNS(ns, 'rect')
    sheet.setAttribute('width', '100%')
    sheet.setAttribute('height', '100%')
    sheet.setAttribute('fill', '#ffffff')
    root.appendChild(sheet)

    // Place each board's artwork
    for (const item of layout) {
      const board = boards[item.pageIndex]
      const svg = this.exportBoardVectorSVG(board, { bleed, marks: false })
      if (!svg) continue

      // Create a group for this positioned board
      const g = document.createElementNS(ns, 'g')
      g.setAttribute('transform', `translate(${item.x},${item.y}) scale(${item.scale})`)

      // Copy all children from the board SVG
      while (svg.firstChild) {
        g.appendChild(svg.firstChild)
      }
      root.appendChild(g)
    }

    return root
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

  /** See engine-select.ts. */
  selectAllArtwork(): void {
    select.selectAllArtwork(this)
  }

  /** See engine-select.ts. */
  selectAllOnActiveArtboard(): number {
    return select.selectAllOnActiveArtboard(this)
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

  /** See engine-select.ts. */
  setSelectedLocked(locked: boolean): void {
    select.setSelectedLocked(this, locked)
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

  /** See engine-select.ts. */
  setSelectedVisible(visible: boolean): void {
    select.setSelectedVisible(this, visible)
  }

  /** See engine-select.ts. */
  lockOthers(): number {
    return select.lockOthers(this)
  }

  /** See engine-select.ts. */
  reverseOrder(): number {
    return select.reverseOrder(this)
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

  /**
   * AI Select > Same > Font Family / Font Size: select every unlocked text
   * item sharing the first selected text item's font family (or size).
   * Returns the match count; 0 when the selection holds no text.
   */
  selectSameTextFont(by: 'family' | 'size'): number {
    const scope = this.scope
    const reference = this.getSelection().find(
      (item) => item instanceof scope.PointText && !item.locked
    ) as paper.PointText | undefined
    if (!reference) return 0
    const refValue = by === 'family'
      ? String(reference.fontFamily || '')
      : Math.round((Number(reference.fontSize) || 0) * 100) / 100
    const matches: paper.PointText[] = []
    for (const item of this.walkUserItems()) {
      if (!(item instanceof scope.PointText) || (item as any).locked) continue
      if (item === reference) continue
      const value = by === 'family'
        ? String(item.fontFamily || '')
        : Math.round((Number(item.fontSize) || 0) * 100) / 100
      if (value === refValue) matches.push(item)
    }
    if (matches.length === 0) return 0
    this.clearSelection()
    reference.selected = true
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

  /** See engine-compound.ts. */
  makeCompoundPath(): boolean {
    return compound.makeCompoundPath(this)
  }

  /** See engine-compound.ts. */
  releaseCompoundPath(): boolean {
    return compound.releaseCompoundPath(this)
  }

  /** See engine-join.ts. */
  joinPaths(): boolean {
    return join.joinPaths(this)
  }

  /** See engine-join.ts. */
  mergePathsEndToEnd(
    first: paper.Path,
    second: paper.Path,
    firstUsesFirst: boolean,
    secondUsesFirst: boolean,
    style?: StyleState
  ): boolean {
    return join.mergePathsEndToEnd(this, first, second, firstUsesFirst, secondUsesFirst, style)
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
    this.stampRasterIdentity(raster)
    raster.onLoad = () => {
      raster.position = (at ?? this.scope.view.center).clone()
      this.stampRasterIdentity(raster)
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
    this.stampRasterIdentity(next)
    next.onLoad = () => {
      next.position = (source as paper.Raster).position.clone()
      next.opacity = opacity
      this.stampRasterIdentity(next)
      this.carryImageStash(source as paper.Raster, next)
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
      this.stampRasterIdentity(next)
      next.onLoad = () => {
        const nb = (next as any).bounds as paper.Rectangle | undefined
        if (nb && nb.width > 0 && nb.height > 0) {
          next.scale(bounds.width / nb.width, bounds.height / nb.height)
        }
        next.position = bounds.center.clone()
        next.opacity = opacity
        this.stampRasterIdentity(next)
        this.carryImageStash(source, next)
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
   * Stamp identity synchronously on a fresh raster. DataURL decode lands
   * in onLoad on a later turn; snapshots, saves, selection syncs and the
   * layer tree taken in between must see a legal placeholder instead of
   * an id-less ghost. Keeps a pre-stamped id so mid-decode snapshots keep
   * referring to the item that onLoad finalizes.
   */
  private stampRasterIdentity(raster: paper.Raster): void {
    const data = (((raster as any).data ?? {}) as Record<string, unknown>)
    if (typeof data.id !== 'string' || !data.id) data.id = this.genId()
    data.isUserItem = true
    ;(raster as any).data = data
  }

  /**
   * Pre-edit pixels of destructively edited rasters, keyed by item id.
   * Deliberately session-only (never written into item.data): item data is
   * serialized into every history snapshot and project file, so stashing a
   * full PNG there would double the bitmap payload of each edited image.
   */
  private imageStash = new Map<string, string>()

  /**
   * Remember a raster's current pixels once, so destructive bitmap ops
   * (adjust / downsample / replace) stay reversible via Reset Image.
   * Tainted canvases simply stash nothing.
   */
  private stashOriginalSource(raster: paper.Raster): void {
    const id = (raster as any).data?.id as string | undefined
    if (!id || this.imageStash.has(id)) return
    try {
      const url = (raster as any).canvas?.toDataURL?.('image/png') as string | undefined
      if (typeof url === 'string' && url.startsWith('data:')) this.imageStash.set(id, url)
    } catch { /* tainted: nothing to stash */ }
  }

  /**
   * Hand the stash entry of a replaced raster to its replacement. Must run
   * after the replacement has its own data.id; otherwise the original is
   * dropped together with the item it belonged to.
   */
  private carryImageStash(from: paper.Raster, to: paper.Raster): void {
    const fromId = (from as any).data?.id as string | undefined
    const toId = (to as any).data?.id as string | undefined
    if (!fromId || !toId) return
    const url = this.imageStash.get(fromId)
    if (url && !this.imageStash.has(toId)) this.imageStash.set(toId, url)
  }

  /**
   * Restore the stashed pre-edit pixels of the first selected raster
   * (one level). Returns false with nothing to restore. The stash is
   * session-only, so this survives undo/redo of the destructive op but not
   * a save + reload (the op itself is still undoable through history).
   */
  resetImage(): boolean {
    const scope = this.scope
    const stashedId = (node: paper.Item): string | null => {
      const id = (node as any).data?.id as string | undefined
      return id && this.imageStash.has(id) ? id : null
    }
    const find = (node: paper.Item): paper.Raster | null => {
      if ((node as any).locked || !node.parent) return null
      if (node instanceof scope.Raster) return stashedId(node) ? node : null
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
    const url = this.imageStash.get(stashedId(source) as string)
    if (!url) return false
    const bounds = (source as any).bounds as paper.Rectangle | undefined
    if (!bounds || bounds.width < 1 || bounds.height < 1) return false
    const parent = source.parent ?? this.getActiveLayer()
    const at = parent.children.indexOf(source as any)
    const opacity = (source as any).opacity
    const next = new scope.Raster({ source: url }) as paper.Raster
    parent.insertChild(Math.min(Math.max(at, 0), parent.children.length), next as any)
    this.stampRasterIdentity(next)
    next.onLoad = () => {
      const nb = (next as any).bounds as paper.Rectangle | undefined
      if (nb && nb.width > 0 && nb.height > 0) {
        next.scale(bounds.width / nb.width, bounds.height / nb.height)
      }
      next.position = bounds.center.clone()
      next.opacity = opacity
      this.stampRasterIdentity(next)
      // Keep the stash reachable under the new id so Reset Image stays
      // repeatable instead of burning itself on the first use.
      this.carryImageStash(source as paper.Raster, next)
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
  replaceSelectedImage(dataUrl: string): boolean {
    const scope = this.scope
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
    this.stampRasterIdentity(next)
    next.onLoad = () => {
      const nb = (next as any).bounds as paper.Rectangle | undefined
      if (nb && nb.width > 0 && nb.height > 0) {
        next.scale(bounds.width / nb.width, bounds.height / nb.height)
      }
      next.position = bounds.center.clone()
      next.opacity = opacity
      this.stampRasterIdentity(next)
      this.carryImageStash(source as paper.Raster, next)
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
  // Symbol keepers live in engine-symbols.ts (module functions).

  /** See engine-symbols.ts. */
  listSymbols(): SymbolEntry[] {
    return symbols.listSymbols(this)
  }

  /** See engine-symbols.ts. */
  defineSymbolFromSelection(): boolean {
    return symbols.defineSymbolFromSelection(this)
  }

  /** See engine-symbols.ts. */
  placeSymbol(id: string): boolean {
    return symbols.placeSymbol(this, id)
  }

  /** See engine-symbols.ts. */
  spraySymbol(id: string, point: paper.Point, scale: number, rotation: number): paper.SymbolItem | null {
    return symbols.spraySymbol(this, id, point, scale, rotation)
  }

  /** See engine-symbols.ts. */
  deleteSymbol(id: string): boolean {
    return symbols.deleteSymbol(this, id)
  }

  /** See engine-symbols.ts. */
  renameSymbol(id: string, name: string): void {
    symbols.renameSymbol(this, id, name)
  }

  /** See engine-symbols.ts. */
  breakSymbolLinks(): boolean {
    return symbols.breakSymbolLinks(this)
  }

  /** See engine-symbols.ts. */
  swapSymbolInstances(symbolId: string): number {
    return symbols.swapSymbolInstances(this, symbolId)
  }

  /** See engine-symbols.ts. */
  selectSymbolInstances(symbolId: string): number {
    return symbols.selectSymbolInstances(this, symbolId)
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
    // AI Layers-panel option: off means every paste lands on the active
    // layer regardless of where the copy was taken from.
    if (!this.store.pasteRemembersLayers) return this.getActiveLayer()
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

  // ===== Data merge (CSV -> one artboard per row, D5) =====

  /**
   * Generate one artboard per record with merged title/body text.
   * Boards extend the row to the right (same size as the active board);
   * every text item is a regular user item (selectable, undoable).
   * Returns board/item counts; 0 boards when there is nothing to merge.
   */
  dataMerge(
    records: Array<Record<string, string>>,
    opts: { titleTemplate: string; bodyTemplate: string }
  ): { boards: number; items: number } {
    const rows = (Array.isArray(records) ? records : []).slice(0, MAX_MERGE_ROWS)
    if (rows.length === 0) return { boards: 0, items: 0 }
    const active = this.store.activeArtboard
    const GAP = 100
    let cursorX = active ? active.x + active.width + GAP : 0
    const cursorY = active ? active.y : 0
    const bw = active ? active.width : this.store.pageSize.width
    const bh = active ? active.height : this.store.pageSize.height
    const fontFamily = this.store.charStyle.fontFamily || 'Arial'
    const layer = this.getActiveLayer()
    const made: paper.Item[] = []
    let boards = 0
    rows.forEach((rec, i) => {
      const title = mergeTemplate(opts.titleTemplate || '{{name}}', rec).slice(0, 120) || `Row ${i + 1}`
      const body = mergeTemplate(opts.bodyTemplate || '', rec).slice(0, 2000)
      const board = {
        id: this.genId(),
        name: title.slice(0, 40),
        x: Math.round(cursorX * 10) / 10,
        y: cursorY,
        width: bw,
        height: bh,
      }
      this.store.addArtboard(board)
      const titleItem = new this.scope.PointText({
        point: new this.scope.Point(board.x + 48, board.y + 84),
        content: title,
        fontFamily,
        fontSize: 26,
        justification: 'left',
        fillColor: '#1a1a1a',
      }) as paper.PointText
      ;(titleItem as any).data = { id: this.genId(), isUserItem: true }
      layer.addChild(titleItem)
      made.push(titleItem)
      if (body) {
        const bodyItem = new this.scope.PointText({
          point: new this.scope.Point(board.x + 48, board.y + 128),
          content: body,
          fontFamily,
          fontSize: 13,
          justification: 'left',
          fillColor: '#333333',
        }) as paper.PointText
        ;(bodyItem as any).data = { id: this.genId(), isUserItem: true }
        layer.addChild(bodyItem)
        made.push(bodyItem)
      }
      cursorX += bw + GAP
      boards++
    })
    const last = this.store.artboards[this.store.artboards.length - 1]
    if (last) this.store.setActiveArtboard(last.id)
    this.refreshArtboards()
    this.clearSelection()
    for (const item of made) item.selected = true
    this.syncSelectionToStore()
    this.pushHistory('Data Merge')
    this.scope.view.update()
    return { boards, items: made.length }
  }

  // ===== Bitmap trace (placed raster -> vector paths, D6) =====

  /**
   * Trace the single selected bitmap into vector paths with the local
   * imagetracerjs build (lazy-loaded, so the main bundle stays untouched).
   * The traced artwork replaces the raster at its bounds with one history
   * entry. Returns the traced path count, or null when nothing traceable
   * is selected, pixels are unreadable, or the trace yields no paths —
   * failures never modify the document.
   */
  async traceSelectedRaster(opts: TraceOptions): Promise<{ paths: number } | null> {
    const scope = this.scope
    const rasters = this.getSelection().filter(
      (item) => !item.locked && item.parent && item instanceof scope.Raster
    ) as paper.Raster[]
    if (rasters.length !== 1) return null
    const raster = rasters[0]
    const options = cleanTraceOptions(opts)
    // Read (and downscale past the cap) off the raster's own canvas, so
    // the trace sees exactly the placed pixels at their placed aspect.
    let img: TraceImage | null = null
    try {
      const canvas = (raster as unknown as { canvas?: HTMLCanvasElement }).canvas
      if (!canvas || canvas.width < TRACE_MIN_DIM || canvas.height < TRACE_MIN_DIM) return null
      const fit = fitTraceSize(canvas.width, canvas.height)
      if (fit.width < TRACE_MIN_DIM || fit.height < TRACE_MIN_DIM) return null
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      if (fit.width === canvas.width && fit.height === canvas.height) {
        const full = ctx.getImageData(0, 0, canvas.width, canvas.height)
        img = { width: full.width, height: full.height, data: full.data }
      } else {
        const tmp = document.createElement('canvas')
        tmp.width = fit.width
        tmp.height = fit.height
        const tctx = tmp.getContext('2d')
        if (!tctx) return null
        tctx.drawImage(canvas, 0, 0, fit.width, fit.height)
        const small = tctx.getImageData(0, 0, fit.width, fit.height)
        img = { width: small.width, height: small.height, data: small.data }
      }
    } catch {
      // Tainted or otherwise unreadable canvas: leave the document alone.
      return null
    }
    if (!img) return null
    await yieldToUI()
    let svg: string
    try {
      const mod = await import('imagetracerjs')
      const tracer = ((mod as unknown as { default?: unknown }).default ?? mod) as ImageTracerInstance
      if (!tracer || typeof tracer.imagedataToSVG !== 'function') return null
      svg = traceImageData(img, options, (pixels, itOpts) => tracer.imagedataToSVG(pixels, itOpts))
    } catch {
      return null
    }
    const paths = countTracePaths(svg)
    if (paths === 0) return null
    const bounds = raster.bounds ? raster.bounds.clone() : null
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
    const parent = raster.parent ?? this.getActiveLayer()
    const rawAt = parent.children.indexOf(raster as unknown as paper.Item)
    const at = rawAt < 0 ? parent.children.length : rawAt
    let imported: paper.Item | paper.Item[]
    try {
      imported = this.project.importSVG(svg)
    } catch {
      return null
    }
    const items = (Array.isArray(imported) ? imported : [imported]).filter(Boolean) as paper.Item[]
    if (items.length === 0) return null
    // Refit input-px artwork onto the raster bounds: normalize to the
    // origin, scale to the placed size, then move into place.
    const united = this.unitedBoundsOf(items)
    if (!united || united.width <= 0 || united.height <= 0) {
      for (const item of items) item.remove()
      return null
    }
    const toOrigin = new scope.Point(-united.x, -united.y)
    const sx = bounds.width / united.width
    const sy = bounds.height / united.height
    const toPlace = new scope.Point(bounds.x, bounds.y)
    for (const item of items) {
      item.translate(toOrigin)
      item.scale(sx, sy, new scope.Point(0, 0))
      item.translate(toPlace)
      this.restampCloneTree(item)
      if (!(item as unknown as { data?: unknown }).data) {
        ;((item as unknown as { data?: unknown }).data as Record<string, unknown>) = {}
      }
      const data = (item as unknown as { data: Record<string, unknown> }).data
      data.id = this.genId()
      data.isUserItem = true
    }
    raster.remove()
    items.forEach((item, i) => {
      parent.insertChild(Math.min(at + i, parent.children.length), item as unknown as paper.Item)
    })
    this.syncLayersToStore()
    this.clearSelection()
    items.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.pushHistory('Trace Bitmap')
    this.scope.view.update()
    return { paths }
  }

  // ===== CDR import (CDR -> SVG -> Paper.js) =====

  /**
   * Open a .cdr file as a new document (multi-page -> multi-artboard row).
   * Parses locally via src/editor/cdr (ZIP CDR + 16-bit CDRX/CMX), converts
   * each page to SVG at 96dpi and imports onto its own artboard.
   * Replaces the current document; throws with an English message on failure.
   */
  async openCdrBytes(
    input: Uint8Array | ArrayBuffer,
    baseName = 'CDR',
    onProgress?: ProgressReport
  ): Promise<CdrImportResult> {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
    if (bytes.length > 150 * 1024 * 1024) throw new Error('CDR file too large (150 MB max)')
    const report = onProgress ?? ((): void => {})
    let doc
    try {
      report(0.05, 'Extracting CDR…')
      await yieldToUI()
      // Parser takes 0-60%: unzip + object tree + per-page SVG conversion.
      doc = await parseCdrBytes(bytes, (f) => report(0.05 + 0.55 * f, 'Parsing CDR objects…'))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'CDR parse failed')
    }
    if (!doc.pages.length) throw new Error('No convertible pages found')

    const stem = (baseName || 'CDR').replace(/\.cdr$/i, '').slice(0, 80) || 'CDR'
    // Snapshot first: per-page canvas import can still fail after the parse
    // succeeded, and the old document must survive that path untouched.
    const backup = this.snapshotProject()
    const prevBoards = this.store.artboards.map((b) => ({ ...b }))
    const prevActiveBoard = this.store.activeArtboardId
    const prevPageSize = { ...this.store.pageSize }
    this.clearIsolationState()
    this.project.clear()
    this.setupProject()
    this.initLayers()
    this.pointActiveLayerAtRestoredStack()

    const GAP = 100
    let cursorX = 0
    const boards: ArtboardMeta[] = []
    const allItems: paper.Item[] = []
    let skippedPages = 0
    let patternApprox = 0
    for (let k = 0; k < doc.pages.length; k++) {
      const page = doc.pages[k]
      const wPx = Math.min(16384, Math.max(1, Math.round(cdrMmToPx(page.width))))
      const hPx = Math.min(16384, Math.max(1, Math.round(cdrMmToPx(page.height))))
      const board = {
        id: this.genId(),
        name: doc.pages.length > 1 ? `${stem} p${k + 1}` : stem,
        x: Math.round(cursorX * 10) / 10,
        y: 0,
        width: wPx,
        height: hPx,
      }
      try {
        // Canvas import takes 60-90% (Paper.js importSVG is synchronous).
        report(0.6 + (0.3 * k) / Math.max(1, doc.pages.length), `Importing page ${k + 1}…`)
        await yieldToUI()
        const items = this.importCdrPageSvg(page.svg, page.width, page.height, board.x, board.y)
        // Only successful pages take a board and advance the row: failed
        // pages leave neither a blank sheet nor a gap behind.
        boards.push(board)
        cursorX += wPx + GAP
        allItems.push(...items)
        // Pattern fills import as solid approximations (Paper.js has no
        // <pattern> support and would render them opaque black instead).
        patternApprox += countCdrUrlFills(page.svg)
      } catch {
        skippedPages++
      }
    }
    if (allItems.length === 0) {
      // Nothing convertible: restore the previous document instead of
      // leaving an empty one behind (and never mark it as saved).
      try {
        this.restoreSnapshot(backup)
      } catch {
        // The backup came from our own exporter; keep the original error.
      }
      this.store.setArtboards(prevBoards)
      this.store.setActiveArtboard(prevActiveBoard)
      this.store.setPageSize(prevPageSize.width, prevPageSize.height)
      this.pointActiveLayerAtRestoredStack()
      this.syncLayersToStore()
      this.clearSelection()
      this.refreshArtboards()
      this.refreshGrid()
      this.refreshGuides()
      this.scope.view.update()
      this.emitViewChange()
      throw new Error('No convertible pages found')
    }
    report(0.92, 'Arranging artboards…')
    await yieldToUI()
    const first = boards[0]
    this.store.setPageSize(first.width, first.height)
    this.store.setBleed(0)
    this.store.setKeyObject('')
    this.store.setArtboards(boards)
    this.store.setActiveArtboard(first.id)
    this.pointActiveLayerAtRestoredStack()
    this.syncLayersToStore()
    this.clearSelection()
    allItems.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.clipboardItems = []
    this.pasteCount = 0
    this.resetHistory('Open CDR')
    this.store.setDocumentName(stem)
    this.refreshArtboards()
    this.refreshGrid()
    this.refreshGuides()
    this.scope.view.update()
    this.zoomToArtboard()
    this.emitViewChange()
    const warnings = [...(doc.warnings ?? [])]
    if (patternApprox > 0) warnings.push(`Pattern fills approximated as solid (${patternApprox})`)
    return { pages: boards.length, warnings, skippedPages }
  }

  /**
   * Import a .cdr file into the current document (multi-page appends one
   * artboard per page in a row after existing boards). Unlike openCdrBytes
   * the current artwork/history is kept; one history entry is pushed.
   */
  async importCdrBytes(
    input: Uint8Array | ArrayBuffer,
    baseName = 'CDR',
    onProgress?: ProgressReport
  ): Promise<CdrImportResult> {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
    if (bytes.length > 150 * 1024 * 1024) throw new Error('CDR file too large (150 MB max)')
    const report = onProgress ?? ((): void => {})
    let doc
    try {
      report(0.05, 'Extracting CDR…')
      await yieldToUI()
      doc = await parseCdrBytes(bytes, (f) => report(0.05 + 0.55 * f, 'Parsing CDR objects…'))
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'CDR parse failed')
    }
    if (!doc.pages.length) throw new Error('No convertible pages found')

    const stem = (baseName || 'CDR').replace(/\.cdr$/i, '').slice(0, 80) || 'CDR'
    const GAP = 100
    let cursorX = 0
    for (const b of this.store.artboards) {
      cursorX = Math.max(cursorX, b.x + b.width + GAP)
    }
    const boards = this.store.artboards.slice()
    const initialBoards = boards.length
    const allItems: paper.Item[] = []
    let skippedPages = 0
    let patternApprox = 0
    for (let k = 0; k < doc.pages.length; k++) {
      const page = doc.pages[k]
      const wPx = Math.min(16384, Math.max(1, Math.round(cdrMmToPx(page.width))))
      const hPx = Math.min(16384, Math.max(1, Math.round(cdrMmToPx(page.height))))
      const board = {
        id: this.genId(),
        name: doc.pages.length > 1 ? `${stem} p${k + 1}` : stem,
        x: Math.round(cursorX * 10) / 10,
        y: 0,
        width: wPx,
        height: hPx,
      }
      try {
        report(0.6 + (0.3 * k) / Math.max(1, doc.pages.length), `Importing page ${k + 1}…`)
        await yieldToUI()
        const items = this.importCdrPageSvg(page.svg, page.width, page.height, board.x, board.y)
        boards.push(board)
        cursorX += wPx + GAP
        allItems.push(...items)
        patternApprox += countCdrUrlFills(page.svg)
      } catch {
        skippedPages++
      }
    }
    if (allItems.length === 0) throw new Error('No convertible pages found')
    this.store.setArtboards(boards)
    this.syncLayersToStore()
    this.clearSelection()
    allItems.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    report(0.92, 'Arranging artboards…')
    await yieldToUI()
    this.pushHistory('Import CDR')
    this.refreshArtboards()
    this.scope.view.update()
    this.emitViewChange()
    const warnings = [...(doc.warnings ?? [])]
    if (patternApprox > 0) warnings.push(`Pattern fills approximated as solid (${patternApprox})`)
    return { pages: boards.length - initialBoards, warnings, skippedPages }
  }

  /**
   * Convert one CDR page SVG (CDR units viewBox, 300dpi header) to 96dpi and
   * import onto the given board origin. Returns the placed top-level items.
   */
  private importCdrPageSvg(
    pageSvg: string,
    widthMm: number,
    heightMm: number,
    boardX: number,
    boardY: number
  ): paper.Item[] {
    const svgText = cdrSvgToImportSvg(pageSvg, widthMm, heightMm)
    // Paper.js bakes the viewBox scale into coordinates but keeps raw
    // user-unit stroke widths: rescale them so CDR strokes (thousands of
    // CDR units) do not render thousands of px wide and bury every fill.
    const strokeScale = cdrViewBoxScale(svgText)
    const imported = this.project.importSVG(svgText)
    const layer = this.getActiveLayer()
    const items = (Array.isArray(imported) ? imported : [imported]).filter(
      Boolean
    ) as paper.Item[]
    if (items.length === 0) throw new Error('Empty CDR page')
    const placed: paper.Item[] = []
    for (const item of items) {
      this.restampCloneTree(item)
      if (!(item as any).data) (item as any).data = {}
      ;((item as any).data as any).id = this.genId()
      ;((item as any).data as any).isUserItem = true
      layer.addChild(item)
      scaleCdrImportedStrokes(item, strokeScale)
      item.translate(new this.scope.Point(boardX, boardY))
      placed.push(item)
    }
    return placed
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
  /** See engine-text.ts. */
  fillPlaceholder(): number {
    return text.fillPlaceholder(this)
  }

  /** See engine-guides.ts. */
  guideAtSelection(orientation: GuideOrientation): boolean {
    return guides.guideAtSelection(this, orientation)
  }

  /** See engine-guides.ts. */
  addMarginGuides(boardId: string, margin: number): number {
    return guides.addMarginGuides(this, boardId, margin)
  }

  /** See engine-text.ts. */
  changeCase(mode: 'upper' | 'lower' | 'title'): number {
    return text.changeCase(this, mode)
  }

  /** See engine-text.ts. */
  unlinkTextFrames(): number {
    return text.unlinkTextFrames(this)
  }

  /** See engine-text.ts. */
  threadSelectedFrames(): number {
    return text.threadSelectedFrames(this)
  }

  /** See engine-text.ts. */
  selectThreadNeighbor(direction: 'next' | 'prev'): boolean {
    return text.selectThreadNeighbor(this, direction)
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

  /** See engine-appearance.ts. */
  clearAppearance(): number {
    return appearance.clearAppearance(this)
  }

  /** See engine-text.ts. */
  findText(query: string, matchCase = false, wholeWord = false): paper.PointText[] {
    return text.findText(this, query, matchCase, wholeWord)
  }

  /** See engine-text.ts. */
  replaceText(find: string, replace: string, matchCase = false, wholeWord = false): number {
    return text.replaceText(this, find, replace, matchCase, wholeWord)
  }

  /** See engine-text.ts. */
  textStats(): { words: number; chars: number; runs: number } {
    return text.textStats(this)
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
        preset === 'fisheye' ? 'Envelope Fisheye' :
        preset === 'pinch' ? 'Envelope Pinch' :
        preset === 'rise' ? 'Envelope Rise' :
        preset === 'fish' ? 'Envelope Fish' : 'Envelope Squeeze'
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
      case 'pinch': {
        // Contract toward the center (inverse fisheye).
        const pcx = b.x + b.width / 2
        const pcy = b.y + b.height / 2
        const prx = (nx - 0.5) * 2
        const pry = (ny - 0.5) * 2
        const pf = 1 - 0.35 * Math.max(0, 1 - (prx * prx + pry * pry) / 2)
        return new scope.Point(pcx + (p.x - pcx) * pf, pcy + (p.y - pcy) * pf)
      }
      case 'rise': {
        // Perspective rise: wider at the bottom, narrower at the top.
        const ry2 = 1 - 0.3 * ny  // ny=0 top → scale 1, ny=1 bottom → scale 0.7
        const rcx = b.x + b.width / 2
        return new scope.Point(rcx + (p.x - rcx) * ry2, p.y)
      }
      case 'fish': {
        // Asymmetric horizontal stretch: stronger on the right side.
        const fx = nx < 0.5
          ? 1 + 0.15 * Math.sin(Math.PI * nx * 2)
          : 1 + 0.35 * Math.sin(Math.PI * (nx - 0.5) * 2)
        return new scope.Point(b.x + b.width / 2 + (p.x - (b.x + b.width / 2)) * fx, p.y)
      }
    }
  }

  showStatus(message: string) {
    this.store.setStatusMessage(message)
  }

  // ===== Font registry for PDF embedding =====

  /**
   * Register a font file (TTF/OTF) for PDF embedding.
   * @param family - Font family name (e.g., 'Arial', 'Helvetica')
   * @param data - Raw font file data as ArrayBuffer
   * @param style - 'normal' | 'italic' (default: 'normal')
   * @param weight - Font weight (400=normal, 700=bold)
   */
  static registerFont(
    family: string,
    data: ArrayBuffer,
    style: string = 'normal',
    weight: number = 400,
  ): void {
    const key = `${family.toLowerCase()}-${style}-${weight}`
    EditorEngine.fontRegistry.set(key, { data, style, weight })
  }

  /**
   * Get all registered fonts as an array of { family, style, weight }.
   */
  static getRegisteredFonts(): Array<{ family: string; style: string; weight: number }> {
    const result: Array<{ family: string; style: string; weight: number }> = []
    for (const [key, entry] of EditorEngine.fontRegistry) {
      const [family, style, weight] = key.split('-')
      result.push({ family, style, weight: Number(weight) })
    }
    return result
  }

  /**
   * Check if a font family is registered.
   */
  static isFontRegistered(family: string, style: string = 'normal', weight: number = 400): boolean {
    const key = `${family.toLowerCase()}-${style}-${weight}`
    return EditorEngine.fontRegistry.has(key)
  }

  /**
   * Collect all unique font families used in the document.
   * Returns a Set of font family names.
   */
  collectDocumentFonts(): Set<string> {
    const fonts = new Set<string>()
    const items = this.project.getItems({ match: () => true })
    for (const item of items) {
      const data = (item.data as any) ?? {}
      // Check for text items with font family
      if ('fontFamily' in item) {
        const ff = (item as any).fontFamily
        if (ff && typeof ff === 'string') {
          fonts.add(ff)
        }
      }
      // Check appearance fills/strokes
      const app = data.appearance as { fills?: Array<{ fontFamily?: string }> } | undefined
      if (app?.fills) {
        for (const fill of app.fills) {
          if (fill.fontFamily) fonts.add(fill.fontFamily)
        }
      }
    }
    return fonts
  }

  /**
   * Apply registered fonts to a jsPDF document before svg2pdf conversion.
   * This embeds font data into the PDF so text renders correctly on any system.
   */
  async applyFontsToPdf(doc: InstanceType<typeof import('jspdf').jsPDF>): Promise<void> {
    if (EditorEngine.fontRegistry.size === 0) return

    for (const [key, entry] of EditorEngine.fontRegistry) {
      try {
        const fontName = key.split('-')[0]
        // jsPDF expects base64-encoded font data
        const base64 = this.arrayBufferToBase64(entry.data)
        doc.addFileToVFS(`${fontName}.ttf`, base64)
        doc.addFont(`${fontName}.ttf`, fontName, entry.style as 'normal' | 'italic')
      } catch {
        // Font registration failed, continue with remaining fonts
      }
    }
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
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
