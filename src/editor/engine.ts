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
import { colorDistanceRgb, colorToCSS, invertCssColor, isOutOfCmykGamut, parseCssColor, rgbToCmyk, shiftCssColor } from './color'
import { parseProjectFile } from './project-file'
import { recordRecentProject } from './recent-files'
import type { EditorStore } from './store-types'
import { yieldToUI, type ProgressReport } from './busy'
import { alignToPixel, normalizePixelRatio, pixelGridStep } from './pixel'
import * as history from './engine-history'
import * as artboards from './engine-artboards'
import * as guides from './engine-guides'
import * as layers from './engine-layers'
import * as tree from './engine-tree'
import * as pathfinder from './engine-pathfinder'
import * as join from './engine-join'
import * as compound from './engine-compound'
import * as appearance from './engine-appearance'
import * as appearancePasses from './engine-appearance-passes'
import * as symbols from './engine-symbols'
import * as view from './engine-view'
import * as select from './engine-select'
import * as text from './engine-text'
import * as exporter from './engine-export'
import * as images from './engine-images'
import * as transforms from './engine-transforms'
import * as pathops from './engine-pathops'
import * as clipboard from './engine-clipboard'
import * as cdrimport from './engine-cdrimport'
import * as aiimport from './engine-aiimport'
import * as separationsModule from './engine-separations'
import * as svg from './engine-svg'
import * as datamerge from './engine-datamerge'
import * as arrange from './engine-arrange'
import * as envelope from './engine-envelope'
import * as masks from './engine-masks'
import * as patterns from './engine-patterns'
import * as mesh from './engine-mesh'
import * as blend from './engine-blend'
import * as edit from './engine-edit'
import * as preflight from './engine-preflight'
import type { TraceOptions } from './trace'

/** Identifier stamped into every saved project file. */
const PROJECT_FILE_APP = 'vue-vector-editor'
/** Current project file format version. */
const PROJECT_FILE_VERSION = 2

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
  /** Internal: engine-history detaches this during snapshots (regenerable view cache). */
  gridLayer: paper.Layer | null = null

  zoom = 1
  center = { x: 0, y: 0 }

  private controllers: Map<ToolName, any> = new Map()

  /** Callback invoked whenever view changes (zoom, pan, etc). */
  onViewChange: (() => void) | null = null

  history: HistoryEntry[] = []
  historyIndex = -1
  /** Internal: snapshot strings, owned by engine-history.ts. */
  historySnapshots: string[] = []
  /** Document metadata riding alongside each paper snapshot (undoable). */
  historyMeta: Array<history.HistoryDocMeta | null> = []
  /** Byte length of each snapshot; drives the memory-budget eviction. */
  historySizes: number[] = []

  // Font registry for PDF embedding: maps font family name → { data: ArrayBuffer, style: string }
  private static fontRegistry = new Map<string, { data: ArrayBuffer; style: string; weight: number }>()

  constructor(canvas: HTMLCanvasElement, store: EditorStore) {
    this.canvas = canvas
    this.store = store

    this.scope = new paper.PaperScope()
    this.scope.setup(canvas)
    this.project = this.scope.project
    // Before the first paint: stacked items need their paint passes standing
    // before anything is drawn, and the hook is what keeps them in step.
    appearancePasses.installAppearancePassHook(this)

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
    const seed = history.snapshotProject(this)
    this.historySnapshots = [seed]
    this.historySizes = [seed?.length ?? 0]
    this.historyMeta = [history.captureDocMeta(this)]
    this.historyIndex = 0
    this.store.setHistory(this.history, this.historyIndex)
    this.markSaved()
    // Seed the cached transform from Paper's authoritative view so the
    // first pan/zoom never starts from a stale (0,0) origin.
    this.syncViewBookkeeping()
  }

  /** Internal-public (engine-cdrimport reaches it); see F4 slice pattern. */
  setupProject() {
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

  /** Internal-public (engine-cdrimport reaches it); see F4 slice pattern. */
  initLayers() {
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
   * Unwind after an uncaught error so the canvas is not stranded mid-gesture.
   *
   * A throw inside a mouse handler skips the rest of that handler, so the
   * mouse-up that would normally commit the gesture never runs: drag flags
   * stay set, the pointer is left in capture, and transient chrome (rubber
   * bands, previews) survives. Every controller already implements
   * `deactivate()` for exactly this teardown (setTool calls it on switch), so
   * reuse that contract instead of duplicating per-tool cleanup.
   *
   * Best-effort by design: this runs while handling a failure, so it must not
   * throw a second time and mask the original error.
   */
  recoverFromError(): void {
    // Drop any pointer capture the canvas is holding. Releasing is only legal
    // while captured, so probe first: hasPointerCapture returning false is
    // the normal case and must not throw.
    try {
      const holder = this.canvas as unknown as {
        hasPointerCapture?: (id: number) => boolean
        releasePointerCapture?: (id: number) => void
      }
      if (typeof holder.hasPointerCapture === 'function' && typeof holder.releasePointerCapture === 'function') {
        for (let id = 1; id <= 5; id++) {
          if (holder.hasPointerCapture(id)) holder.releasePointerCapture(id)
        }
      }
    } catch { /* recovery must not throw */ }

    // Unwind the active controller's in-flight gesture.
    try {
      this.controllers.get(this.toolName)?.deactivate?.()
    } catch { /* recovery must not throw */ }

    // Hand paper.js back its native decoration and sweep leftover chrome.
    try {
      const selectCtrl = this.controllers.get('select') as { releaseNativeSuppressions?: () => void } | undefined
      selectCtrl?.releaseNativeSuppressions?.()
    } catch { /* recovery must not throw */ }
    try {
      this.clearTransientChrome()
    } catch { /* recovery must not throw */ }

    // Clear the drag flag so panels stop rendering a transform readout for a
    // gesture that no longer exists.
    try {
      this.store.setDragging(false)
    } catch { /* recovery must not throw */ }
  }

  /** See engine-select.ts. */
  getSelection(): paper.Item[] {
    return select.getSelection(this)
  }

  clearSelection() {
    this.project.deselectAll()
    this.store.clearSelection()
    this.store.clearCharSelection()
    this.refreshSelectionChrome()
  }

  /** See engine-select.ts. */
  selectItem(item: paper.Item, addToSelection = false) {
    select.selectItem(this, item, addToSelection)
  }

  /** See engine-select.ts. */
  selectByIds(ids: string[]): number {
    return select.selectByIds(this, ids)
  }

  /** See engine-select.ts. */
  reselect(): number {
    return select.reselect(this)
  }

  syncSelectionToStore() {
    const ids = select.topmostItems(this.project.selectedItems as paper.Item[]).map(
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

  /** See engine-layers.ts. */
  getActiveLayer(): paper.Layer {
    return layers.getActiveLayer(this)
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
  getGuideGeometry(item: paper.Item): guides.GuideGeometry | null {
    return guides.getGuideGeometry(this, item)
  }

  /** See engine-guides.ts. */
  setGuideGeometry(item: paper.Item, geometry: guides.GuideGeometry) {
    guides.setGuideGeometry(this, item, geometry)
  }

  /** See engine-guides.ts. */
  updateGuideById(
    id: string,
    patch: { position?: number; cross?: number; angle?: number }
  ): boolean {
    return guides.updateGuideById(this, id, patch)
  }

  /** See engine-guides.ts. */
  createGuide(
    position: number,
    orientation: GuideOrientation,
    options?: { angle?: number; y?: number }
  ): paper.Path | null {
    return guides.createGuide(this, position, orientation, options)
  }

  /** See engine-guides.ts. */
  deleteGuide(guide: paper.Path) {
    guides.deleteGuide(this, guide)
  }

  /** See engine-guides.ts. */
  listGuides(): Array<{
    id: string
    orientation: GuideOrientation
    position: number
    cross: number
    angle: number
  }> {
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
   * real grid) to cap the total line count when zoomed out. Lines append
   * to the (freshly cleared) grid layer; rebuild policy lives in
   * refreshGrid's combined key.
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
   * Pixel Preview overlay (D2): one line per device pixel (1 doc unit at
   * 1x, 0.5 at 2x), origin-aligned. Only rendered once a device pixel is
   * several screen pixels wide — zoomed out it would be both unreadable
   * and thousands of lines, so the view just stays clean.
   */
  private drawPixelGrid() {
    if (!this.gridLayer) return
    const v = this.scope.view
    const b = v.bounds
    if (!(b.width > 0) || !(b.height > 0)) return

    const step = pixelGridStep(normalizePixelRatio(this.store.view.pixelRatio))
    if (!(v.zoom * step >= 4)) return

    const color = new this.scope.Color('#4a90d9')
    color.alpha = 0.25
    const style = {
      strokeColor: color,
      strokeWidth: 1 / (v.zoom || 1),
      strokeCap: 'round' as 'round' | 'square' | 'butt',
    }

    const left = Math.floor(b.x / step) * step
    const right = b.x + b.width
    const top = Math.floor(b.y / step) * step
    const bottom = b.y + b.height

    for (let x = left; x <= right; x += step) {
      const line = new this.scope.Path.Line(
        new this.scope.Point(x, top),
        new this.scope.Point(x, bottom)
      )
      line.set(style)
      line.data.isGridItem = true
      this.gridLayer.addChild(line)
    }
    for (let y = top; y <= bottom; y += step) {
      const line = new this.scope.Path.Line(
        new this.scope.Point(left, y),
        new this.scope.Point(right, y)
      )
      line.set(style)
      line.data.isGridItem = true
      this.gridLayer.addChild(line)
    }

    this.gridLayer.locked = true
  }

  /**
   * Combined rebuild key for everything the grid layer currently renders
   * (document grid, pixel preview): a change in either view, the step or
   * the visible window rebuilds the whole layer in one pass.
   */
  private viewGridsKey(): string {
    const b = this.scope.view.bounds
    const parts: string[] = []
    if (this.store.view.showGrid) {
      const base = this.store.snap.gridSize || 10
      let step = base > 0 ? base : 10
      while ((b.width / step + b.height / step) > 600) step *= 2
      parts.push(
        `g${step},${Math.floor(b.x / step)},${Math.floor(b.y / step)},` +
        `${Math.ceil((b.x + b.width) / step)},${Math.ceil((b.y + b.height) / step)}`
      )
    }
    if (this.store.view.pixelPreview) {
      const step = pixelGridStep(normalizePixelRatio(this.store.view.pixelRatio))
      const on = this.scope.view.zoom * step >= 4
      parts.push(
        `p${on ? step : 'off'},${Math.floor(b.x / step)},${Math.floor(b.y / step)},` +
        `${Math.ceil((b.x + b.width) / step)},${Math.ceil((b.y + b.height) / step)}`
      )
    }
    return parts.join('|')
  }

  /**
   * Redraw the grid based on current zoom and view settings.
   * Rebuilds are coalesced to one per animation frame so wheel-zoom and
   * pan gestures (dozens of ticks per second) never rebuild the grid
   * more than the screen can display. Hiding applies immediately.
   */
  refreshGrid() {
    if (!this.store.view.showGrid && !this.store.view.pixelPreview) {
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
      if (!this.store.view.showGrid && !this.store.view.pixelPreview) return
      const layer = this.ensureGridLayer()
      layer.visible = true
      // One combined rebuild for the document grid and the pixel preview:
      // they share the layer, so either change redraws both.
      const key = this.viewGridsKey()
      if (key !== this.lastGridKey) {
        this.lastGridKey = key
        layer.removeChildren()
        if (this.store.view.showGrid) this.drawGrid(this.store.snap.gridSize || 10)
        if (this.store.view.pixelPreview) this.drawPixelGrid()
      }
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

  /** See engine-view.ts. */
  fitToContent() {
    view.fitToContent(this)
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

  /** See engine-view.ts. */
  zoomToSelection(): void {
    view.zoomToSelection(this)
  }

  /** See engine-view.ts. */
  zoomToArtboard(): void {
    view.zoomToArtboard(this)
  }

  /** See engine-view.ts. */
  zoomToActualSize(): void {
    view.zoomToActualSize(this)
  }

  /** See engine-layers.ts. */
  getUserItems(): paper.Item[] {
    return layers.getUserItems(this)
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
      color: (stop.color && colorToCSS(stop.color)) || '#000000',
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
        style.fillColor = colorToCSS(s.fillColor)
      }
    }
    style.strokeColor = colorToCSS(s.strokeColor)
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
    // The stack just changed shape: rebuild the passes now rather than at the
    // next paint, so a caller that inspects the tree right after sees the
    // passes that belong to the new stack.
    appearancePasses.syncAppearancePasses(this)
  }

  /** See engine-appearance-passes.ts. */
  syncAppearancePasses(): void {
    appearancePasses.syncAppearancePasses(this)
  }

  /** See engine-appearance-passes.ts. */
  appearancePassCount(): number {
    return appearancePasses.appearancePassCount(this)
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
        const css = colorToCSS(s.fillColor)
        if (typeof css === 'string' && css.trim().toLowerCase() === oldN) {
          s.fillColor = newColor
          n++
        }
      }
      if (s.strokeColor !== undefined) {
        const css = colorToCSS(s.strokeColor)
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
  /** See engine-masks.ts. */
  getOpacityMask(item: paper.Item): OpacityMaskState | null {
    return masks.getOpacityMask(this, item)
  }

  /** See engine-masks.ts. */
  applyOpacityMask(target: paper.Item, maskContent: paper.Item | null): void {
    masks.applyOpacityMask(this, target, maskContent)
  }

  /** See engine-masks.ts. */
  removeOpacityMask(item: paper.Item): void {
    masks.removeOpacityMask(this, item)
  }

  /** See engine-masks.ts. */
  toggleOpacityMask(item: paper.Item, enabled: boolean): void {
    masks.toggleOpacityMask(this, item, enabled)
  }

  /** See engine-masks.ts. */
  toggleOpacityMaskInvert(item: paper.Item, invert: boolean): void {
    masks.toggleOpacityMaskInvert(this, item, invert)
  }

  // ===== Mesh gradients (simulated via triangle tessellation) =====
  //
  // Paper.js has no native mesh gradient. We simulate one by:
  // 1. Creating a grid of control vertices with per-vertex colors
  // 2. Tessellating the grid into triangles
  // 3. Rendering each triangle as a 3-stop linear gradient (barycentric interpolation)

  /** Get mesh gradient state from item, or null. */
  /** See engine-mesh.ts. */
  getMeshGradient(item: paper.Item): MeshGradientState | null {
    return mesh.getMeshGradient(this, item)
  }

  /** See engine-mesh.ts. */
  createDefaultMeshGradient(item: paper.Item): MeshGradientState {
    return mesh.createDefaultMeshGradient(this, item)
  }

  /** See engine-mesh.ts. */
  applyMeshGradient(item: paper.Item, meshState: MeshGradientState): void {
    mesh.applyMeshGradient(this, item, meshState)
  }

  /** See engine-mesh.ts. */
  removeMeshGradient(item: paper.Item): void {
    mesh.removeMeshGradient(this, item)
  }

  // ===== Pattern fills (AI-style swatches via clipped tile groups) =====
  //
  // Paper.js has no native pattern paint, so a pattern fill is a plain
  // Group: [mask path (clipMask, paint stashed in data.maskPaint),
  // background clone (optional), motif tiles (no data.id so the layer tree
  // skips them)]. The group carries data.isPatternFill + data.pattern, so
  // it survives JSON snapshots, Save/Open and SVG export as clipped art.

  /** See engine-patterns.ts. */
  getPatternFromItem(item: paper.Item): PatternFillState | null {
    return patterns.getPatternFromItem(this, item)
  }

  /** See engine-patterns.ts. */
  isPatternGroup(item: paper.Item): boolean {
    return patterns.isPatternGroup(this, item)
  }

  /** See engine-patterns.ts. */
  applyPatternFill(pattern: PatternFillState): number {
    return patterns.applyPatternFill(this, pattern)
  }

  /** See engine-patterns.ts. */
  removePatternFill(): number {
    return patterns.removePatternFill(this)
  }

  // Pattern group builders live in engine-patterns.ts.

  // Pattern group builders live in engine-patterns.ts.

  // ===== History =====
  //
  // Bodies live in engine-history.ts; these facades keep the public API
  // stable for the controllers and panels that call them.

  /** See engine-history.ts. */
  snapshotProject(): string {
    return history.snapshotProject(this)
  }

  /** See engine-history.ts. */
  snapshotProjectObject(): Record<string, unknown> | unknown[] {
    return history.snapshotProjectObject(this)
  }

  /**
   * Session sidecar for history-snapshot bitmaps: content-hash -> dataURL.
   * Never pruned within a session (distinct images only, so it stays
   * bounded); snapshots reference it by token, files embed pixels directly.
   * Internal: owned by engine-history.ts.
   */
  historyImageStore = new Map<string, string>()

  /** See engine-history.ts. */
  restoreSnapshot(snapshot: string | Record<string, unknown> | unknown[]) {
    history.restoreSnapshot(this, snapshot)
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
  /** Internal-public (engine-transforms reaches it); see F4 slice pattern. */
  lastTransform:
    | { kind: 'move'; dx: number; dy: number }
    | { kind: 'rotate'; angle: number; pivot: paper.Point }
    | { kind: 'scale'; sx: number; sy: number; pivot: paper.Point }
    | null = null

  /** Bump the geometry version (invalidates untracked selection frames). */
  bumpGeometryVersion() {
    this.geometryVersion++
  }

  /** See engine-history.ts. */
  pushHistory(name: string, icon: string = '') {
    history.pushHistory(this, name, icon)
  }

  /** See engine-history.ts. */
  undo() {
    history.undo(this)
  }

  /** See engine-history.ts. */
  redo() {
    history.redo(this)
  }

  /** See engine-history.ts. */
  jumpToHistory(index: number): void {
    history.jumpToHistory(this, index)
  }

  /** See engine-history.ts. */
  clearHistory(): void {
    history.clearHistory(this)
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
    history.resetHistory(this, 'Open Project')
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
    history.resetHistory(this, 'New Document')
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
  /** Internal-public (engine-cdrimport reaches it); see F4 slice pattern. */
  pointActiveLayerAtRestoredStack(): void {
    layers.pointActiveLayerAtRestoredStack(this)
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

  // Tree builders live in engine-tree.ts.

  /** See engine-tree.ts. */
  listLayerTree(layerId: string): LayerItemNode[] {
    return tree.listLayerTree(this, layerId)
  }

  /** See engine-tree.ts. */
  listLayerItems(layerId: string): LayerItemNode[] {
    return tree.listLayerItems(this, layerId)
  }

  /** Thumbnail cache: `${structureEpoch}:${isolation}:${itemId}` -> data URL. */
  private thumbCache = new Map<string, string>()

  /** Drop cached layer-tree thumbnails (structure/pixel changes bump the epoch). */
  clearThumbCache(): void {
    this.thumbCache.clear()
  }

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
    const key = `${this.store.structureEpoch}:${this.store.isolationActive ? 1 : 0}:${id}`
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
  /** See engine-layers.ts. */
  getItemById(id: string): paper.Item | null {
    return layers.getItemById(this, id)
  }

  /** See engine-layers.ts. */
  selectItemById(id: string, additive = false): void {
    layers.selectItemById(this, id, additive)
  }

  /** See engine-select.ts. */
  invertSelection(): void {
    select.invertSelection(this)
  }

  /** See engine-layers.ts. */
  setItemVisible(id: string, visible: boolean): void {
    layers.setItemVisible(this, id, visible)
  }

  /** See engine-layers.ts. */
  setItemLocked(id: string, locked: boolean): void {
    layers.setItemLocked(this, id, locked)
  }

  /** See engine-layers.ts. */
  setTreeCollapsed(id: string, collapsed: boolean): void {
    layers.setTreeCollapsed(this, id, collapsed)
  }

  /** Fold or unfold every group/sublayer in the document (panel menu). */
  /** See engine-layers.ts. */
  setAllTreeCollapsed(collapsed: boolean): void {
    layers.setAllTreeCollapsed(this, collapsed)
  }

  /** See engine-layers.ts. */
  createSublayer(): paper.Group | null {
    return layers.createSublayer(this)
  }

  /** See engine-layers.ts. */
  collectInNewLayer(): boolean {
    return layers.collectInNewLayer(this)
  }

  /** See engine-layers.ts. */
  releaseToLayers(): boolean {
    return layers.releaseToLayers(this)
  }

  /** See engine-layers.ts. */
  renameTreeItem(id: string, name: string): boolean {
    return layers.renameTreeItem(this, id, name)
  }

  // Tree-move guards live in engine-layers.ts.

  /** See engine-layers.ts. */
  moveTreeItem(
    itemId: string,
    destParentId: string,
    destLayerId: string,
    destIndex?: number
  ): boolean {
    return layers.moveTreeItem(this, itemId, destParentId, destLayerId, destIndex)
  }

  /** See engine-layers.ts. */
  selectLayerArtwork(layerId: string): number {
    return layers.selectLayerArtwork(this, layerId)
  }

  /** See engine-layers.ts. */
  getItemLayerId(id: string): string {
    return layers.getItemLayerId(this, id)
  }

  /** See engine-layers.ts. */
  getItemParentId(id: string): string {
    return layers.getItemParentId(this, id)
  }

  // ===== Selection transform =====

  /** See engine-arrange.ts. */
  getSelectionBounds(): paper.Rectangle | null {
    return arrange.getSelectionBounds(this)
  }

  /** See engine-arrange.ts. */
  referencePointForRect(rect: paper.Rectangle, point: ReferencePoint): paper.Point {
    return arrange.referencePointForRect(this, rect, point)
  }

  /** See engine-arrange.ts. */
  selectionReferencePivot(): paper.Point | null {
    return arrange.selectionReferencePivot(this)
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

  // ===== Object transforms / repeats (see engine-transforms.ts) =====

  /** See engine-transforms.ts. */
  transformEach(opts: {
    dx?: number
    dy?: number
    rotate?: number
    scale?: number
    copies?: number
    random?: boolean
  }): number {
    return transforms.transformEach(this, opts)
  }

  /** See engine-transforms.ts. */
  rotateCopy(angleDeg: number, pivot?: paper.Point): boolean {
    return transforms.rotateCopy(this, angleDeg, pivot)
  }

  /** See engine-transforms.ts. */
  duplicateInPlace(): boolean {
    return transforms.duplicateInPlace(this)
  }

  /** See engine-transforms.ts. */
  stepRepeat(count: number, dx: number, dy: number): number {
    return transforms.stepRepeat(this, count, dx, dy)
  }

  /** See engine-transforms.ts. */
  splitSelectionGrid(rows: number, cols: number, gutterX: number, gutterY: number): number {
    return transforms.splitSelectionGrid(this, rows, cols, gutterX, gutterY)
  }

  /** See engine-transforms.ts. */
  radialRepeat(count: number, angleDeg: number): number {
    return transforms.radialRepeat(this, count, angleDeg)
  }

  /** See engine-transforms.ts. */
  skewSelection(skewXDeg: number, skewYDeg: number, pivot?: paper.Point): void {
    transforms.skewSelection(this, skewXDeg, skewYDeg, pivot)
  }

  /** See engine-transforms.ts. */
  reflectSelection(axisAngleDeg: number, copy = false, pivot?: paper.Point): boolean {
    return transforms.reflectSelection(this, axisAngleDeg, copy, pivot)
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
   * See engine-history.ts.
   */
  pushCoalescedHistory(name: string, windowMs = 1200) {
    history.pushCoalescedHistory(this, name, windowMs)
  }

  /** See engine-arrange.ts. */
  alignSelection(mode: AlignMode, target?: paper.Rectangle): boolean {
    return arrange.alignSelection(this, mode, target)
  }

  /** Active artboard rectangle, or null when none is usable. */
  getActiveArtboardRect(): paper.Rectangle | null {
    const board =
      this.store.artboards.find((b) => b.id === this.store.activeArtboardId) ??
      this.store.artboards[0]
    if (!board || !(board.width > 0) || !(board.height > 0)) return null
    return new this.scope.Rectangle(board.x, board.y, board.width, board.height)
  }

  /** See engine-arrange.ts. */
  distributeSpacing(axis: DistributeAxis): boolean {
    return arrange.distributeSpacing(this, axis)
  }

  /** See engine-arrange.ts. */
  distributeSelection(axis: DistributeAxis): boolean {
    return arrange.distributeSelection(this, axis)
  }

  /** See engine-pathfinder.ts. */
  booleanOperation(op: BooleanOperation): boolean {
    return pathfinder.booleanOperation(this, op)
  }

  // Blend vertex math lives in engine-blend.ts.

  /** See engine-blend.ts. */
  autoBlendSteps(): number {
    return blend.autoBlendSteps(this)
  }

  /** See engine-blend.ts. */
  blendSelection(steps: number): number {
    return blend.blendSelection(this, steps)
  }

  /** See engine-transforms.ts. */
  scaleSelection(sx: number, sy: number, pivot?: paper.Point): void {
    transforms.scaleSelection(this, sx, sy, pivot)
  }

  /** See engine-transforms.ts. */
  gridRepeat(rows: number, cols: number, dx: number, dy: number): number {
    return transforms.gridRepeat(this, rows, cols, dx, dy)
  }

  /** See engine-arrange.ts. */
  distributeSpacingExact(axis: DistributeAxis, gap: number): boolean {
    return arrange.distributeSpacingExact(this, axis, gap)
  }

  /** See engine-arrange.ts. */
  getKeyObjectBounds(): paper.Rectangle | null {
    return arrange.getKeyObjectBounds(this)
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

  // ===== Raster export / thumbnails / N-up (see engine-export.ts) =====

  /** See engine-export.ts. */
  estimateRasterSize(area: RasterExportOptions['area'], scale: number): { width: number; height: number } | null {
    return exporter.estimateRasterSize(this, area, scale)
  }

  /** See engine-export.ts. */
  rasterizeSelection(): boolean {
    return exporter.rasterizeSelection(this)
  }

  /** See engine-export.ts. */
  exportRaster(options: RasterExportOptions): string | null {
    return exporter.exportRaster(this, options)
  }

  /** See engine-export.ts. */
  renderThumbnail(maxPixels: number): { url: string; x: number; y: number; width: number; height: number } | null {
    return exporter.renderThumbnail(this, maxPixels)
  }

  /** See engine-export.ts. */
  exportBoardVectorSVG(
    board: { x: number; y: number; width: number; height: number },
    opts?: { bleed?: number; marks?: boolean }
  ): SVGSVGElement | null {
    return exporter.exportBoardVectorSVG(this, board, opts)
  }

  /** See engine-export.ts. */
  computeNUpLayout(
    boards: Array<{ width: number; height: number }>,
    upCount: number = 4,
    spacing: number = 12,
    margin: number = 36,
    landscape?: boolean,
  ): Array<{ pageIndex: number; x: number; y: number; scale: number }> {
    return exporter.computeNUpLayout(boards, upCount, spacing, margin, landscape)
  }

  /** See engine-export.ts. */
  exportNUpSVG(
    boards: Array<{ x: number; y: number; width: number; height: number; name?: string }>,
    opts?: { upCount?: number; spacing?: number; margin?: number; landscape?: boolean; bleed?: number }
  ): SVGSVGElement | null {
    return exporter.exportNUpSVG(this, boards, opts)
  }

  // ===== Object order / visibility / select-same =====

  /** See engine-select.ts. */
  bringSelectionToFront(): boolean {
    return select.bringSelectionToFront(this)
  }

  /** See engine-select.ts. */
  sendSelectionToBack(): boolean {
    return select.sendSelectionToBack(this)
  }

  /** See engine-select.ts. */
  bringForward(): void {
    select.bringForward(this)
  }

  /** See engine-select.ts. */
  sendBackward(): void {
    select.sendBackward(this)
  }

  /** See engine-select.ts. */
  groupSelection(): boolean {
    return select.groupSelection(this)
  }

  /** See engine-select.ts. */
  ungroupSelection(): boolean {
    return select.ungroupSelection(this)
  }

  /** See engine-select.ts. */
  ungroupAllSelected(): number {
    return select.ungroupAllSelected(this)
  }

  /** See engine-select.ts. */
  selectAllArtwork(): void {
    select.selectAllArtwork(this)
  }

  /** See engine-select.ts. */
  selectAllOnActiveArtboard(): number {
    return select.selectAllOnActiveArtboard(this)
  }

  /** See engine-select.ts. */
  setSelectedLocked(locked: boolean): void {
    select.setSelectedLocked(this, locked)
  }

  /** See engine-layers.ts. */
  unlockAll(): void {
    layers.unlockAll(this)
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

  /** See engine-layers.ts. */
  showAll(): void {
    layers.showAll(this)
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
  /** See engine-select.ts. */
  selectSame(
    attribute: 'fill' | 'stroke' | 'strokeWidth' | 'opacity' | 'blendMode',
    additive = false,
    tolerance = 0
  ): number {
    return select.selectSame(this, attribute, additive, tolerance)
  }

  /** See engine-select.ts. */
  selectSameTextFont(by: 'family' | 'size'): number {
    return select.selectSameTextFont(this, by)
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
  /** See engine-masks.ts. */
  makeClippingMask(): boolean {
    return masks.makeClippingMask(this)
  }

  /** See engine-masks.ts. */
  releaseClippingMask(): boolean {
    return masks.releaseClippingMask(this)
  }

  // ===== Placed images (see engine-images.ts) =====

  /** See engine-images.ts. */
  placeImage(dataUrl: string, at?: paper.Point): void {
    images.placeImage(this, dataUrl, at)
  }

  /** See engine-images.ts. */
  extractSelectedImage(): { url: string; filename: string } | null {
    return images.extractSelectedImage(this)
  }

  /** See engine-images.ts. */
  adjustImage(preset: 'none' | 'gray' | 'sepia' | 'invert', brightness: number): boolean {
    return images.adjustImage(this, preset, brightness)
  }

  /** See engine-images.ts. */
  downsampleImages(factor: number): number {
    return images.downsampleImages(this, factor)
  }

  /** See engine-images.ts. */
  resetImage(): boolean {
    return images.resetImage(this)
  }

  /** See engine-images.ts. */
  replaceSelectedImage(dataUrl: string): boolean {
    return images.replaceSelectedImage(this, dataUrl)
  }

  /**
   * Stamp identity synchronously on a fresh raster. DataURL decode lands
   * in onLoad on a later turn; snapshots, saves, selection syncs and the
   * layer tree taken in between must see a legal placeholder instead of
   * an id-less ghost. Keeps a pre-stamped id so mid-decode snapshots keep
   * referring to the item that onLoad finalizes.
   */
  /** Internal-public (engine-images / engine-export reach it); see F4 slice pattern. */
  stampRasterIdentity(raster: paper.Raster): void {
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
  /** Internal-public (engine-images reaches it); see F4 slice pattern. */
  imageStash = new Map<string, string>()

  /** Drop stashed pre-edit pixels (the document they belonged to is gone). */
  clearImageStash(): void {
    this.imageStash.clear()
  }

  /**
   * Remember a raster's current pixels once, so destructive bitmap ops
   * (adjust / downsample / replace) stay reversible via Reset Image.
   * Tainted canvases simply stash nothing.
   */
  /** Internal-public (engine-images reaches it); see F4 slice pattern. */
  stashOriginalSource(raster: paper.Raster): void {
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
  /** Internal-public (engine-images reaches it); see F4 slice pattern. */
  carryImageStash(from: paper.Raster, to: paper.Raster): void {
    const fromId = (from as any).data?.id as string | undefined
    const toId = (to as any).data?.id as string | undefined
    if (!fromId || !toId) return
    const url = this.imageStash.get(fromId)
    if (url && !this.imageStash.has(toId)) this.imageStash.set(toId, url)
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
    for (const item of layers.walkUserItems(this)) {
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

  /** Drop isolation state without touching visibility (snapshot truth wins). Also used by engine-history restores. */
  clearIsolationState(): void {
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
  /** Internal-public (engine-clipboard reaches it); see F4 slice pattern. */
  clipboardItems: paper.Item[] = []
  /** Owning user-layer id per clipboard entry (AI paste-remembers-layer). */
  /** Internal-public (engine-clipboard reaches it); see F4 slice pattern. */
  clipboardLayerIds: string[] = []
  /** Active-board origin at copy time (paste-on-all-boards anchor). */
  /** Internal-public (engine-clipboard reaches it); see F4 slice pattern. */
  clipboardBoard: { x: number; y: number } = { x: 0, y: 0 }
  /** How many pastes have been made from the current clipboard content. */
  /** Internal-public (engine-clipboard reaches it); see F4 slice pattern. */
  pasteCount = 0

  /** See engine-clipboard.ts. */
  resetPasteOffset(): void {
    clipboard.resetPasteOffset(this)
  }

  /** See engine-clipboard.ts. */
  copySelectedToClipboard(): number {
    return clipboard.copySelectedToClipboard(this)
  }

  /** See engine-clipboard.ts. */
  cutSelectedToClipboard(): void {
    clipboard.cutSelectedToClipboard(this)
  }

  /** See engine-clipboard.ts. */
  pasteInPlace(where: 'front' | 'back'): boolean {
    return clipboard.pasteInPlace(this, where)
  }

  /** See engine-clipboard.ts. */
  pasteClipboard(): void {
    clipboard.pasteClipboard(this)
  }

  /** See engine-clipboard.ts. */
  pasteOnAllBoards(): number {
    return clipboard.pasteOnAllBoards(this)
  }

  // ===== System clipboard (SVG exchange) =====

  /** See engine-export.ts. */
  exportSelectionSVG(): string | null {
    return exporter.exportSelectionSVG(this)
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

  /** See engine-separations.ts. */
  collectSeparations(): import('./separations').Separation[] {
    return separationsModule.collectSeparations(this)
  }

  /** See engine-separations.ts. */
  exportSeparations(options?: {
    area?: import('./types').RasterExportArea
    dpi?: number
    maxPixels?: number
  }) {
    return separationsModule.exportSeparations(this, options)
  }

  /** See engine-svg.ts. */
  openSvgText(svgText: string, fileName = 'SVG'): boolean {
    return svg.openSvgText(this, svgText, fileName)
  }

  /** See engine-datamerge.ts. */
  dataMerge(
    records: Array<Record<string, string>>,
    opts: { titleTemplate: string; bodyTemplate: string }
  ): { boards: number; items: number } {
    return datamerge.dataMerge(this, records, opts)
  }

  /** See engine-images.ts. */
  async traceSelectedRaster(opts: TraceOptions): Promise<{ paths: number } | null> {
    return images.traceSelectedRaster(this, opts)
  }

  /** See engine-cdrimport.ts. */
  async openCdrBytes(
    input: Uint8Array | ArrayBuffer,
    baseName = 'CDR',
    onProgress?: ProgressReport,
    signal?: AbortSignal
  ): Promise<CdrImportResult> {
    return cdrimport.openCdrBytes(this, input, baseName, onProgress, signal)
  }

  /** See engine-cdrimport.ts. */
  async importCdrBytes(
    input: Uint8Array | ArrayBuffer,
    baseName = 'CDR',
    onProgress?: ProgressReport,
    signal?: AbortSignal
  ): Promise<CdrImportResult> {
    return cdrimport.importCdrBytes(this, input, baseName, onProgress, signal)
  }

  /** See engine-aiimport.ts. */
  async openAiBytes(
    input: Uint8Array | ArrayBuffer,
    baseName = 'AI',
    onProgress?: ProgressReport,
    signal?: AbortSignal
  ): Promise<CdrImportResult> {
    return aiimport.openAiBytes(this, input, baseName, onProgress, signal)
  }

  /** See engine-aiimport.ts. */
  async importAiBytes(
    input: Uint8Array | ArrayBuffer,
    baseName = 'AI',
    onProgress?: ProgressReport,
    signal?: AbortSignal
  ): Promise<CdrImportResult> {
    return aiimport.importAiBytes(this, input, baseName, onProgress, signal)
  }

  /** Payload of our last OS clipboard write (external-copy detection). */
  /** Internal-public (engine-clipboard reaches it); see F4 slice pattern. */
  lastSystemWrite = ''

  /** OS clipboard handle, or null outside secure contexts. */
  private systemClipboard(): Clipboard | null {
    if (typeof navigator === 'undefined') return null
    return navigator.clipboard ?? null
  }

  /** See engine-clipboard.ts. */
  async copyToSystemClipboard(): Promise<boolean> {
    return clipboard.copyToSystemClipboard(this)
  }

  /** See engine-clipboard.ts. */
  async pasteFromSystemClipboard(): Promise<boolean> {
    return clipboard.pasteFromSystemClipboard(this)
  }

  /** See engine-clipboard.ts. */
  async pasteWithSystemFallback(): Promise<void> {
    return clipboard.pasteWithSystemFallback(this)
  }

  /** See engine-edit.ts. */
  deleteSelected() {
    edit.deleteSelected(this)
  }

  /** See engine-edit.ts. */
  duplicateSelected(): boolean {
    return edit.duplicateSelected(this)
  }

  /** See engine-edit.ts. */
  simplifyPaths(): number {
    return edit.simplifyPaths(this)
  }

  /** See engine-edit.ts. */
  setPathsClosed(closed: boolean): number {
    return edit.setPathsClosed(this, closed)
  }

  /** See engine-pathops.ts. */
  offsetPaths(
    distance: number,
    join: 'miter' | 'round' | 'bevel' = 'miter',
    steps = 1,
    cap?: 'round' | 'butt'
  ): number {
    return pathops.offsetPaths(this, distance, join, steps, cap)
  }

  /** See engine-pathops.ts. */
  stylizeRoughen(kind: 'roughen' | 'zigzag', size: number, detail: number): number {
    return pathops.stylizeRoughen(this, kind, size, detail)
  }

  /** See engine-pathops.ts. */
  addAnchorPoints(): number {
    return pathops.addAnchorPoints(this)
  }

  /** See engine-pathops.ts. */
  reversePaths(): number {
    return pathops.reversePaths(this)
  }

  /** See engine-pathops.ts. */
  cleanUp(): number {
    return pathops.cleanUp(this)
  }

  /**
   * Match every unlocked selected item to the first one's width and/or
   * height (layout staple), scaling about each item's own center so
   * positions hold. Returns items resized; one history entry.
   */
  /** See engine-arrange.ts. */
  matchSize(mode: 'width' | 'height' | 'both'): number {
    return arrange.matchSize(this, mode)
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

  /** See engine-appearance.ts. */
  setDefaultsFromSelection(): boolean {
    return appearance.setDefaultsFromSelection(this)
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
  /** See engine-preflight.ts. */
  preflight(): Array<{ kind: 'overflow' | 'gamut' | 'tac' | 'small' | 'hairline' | 'dpi' | 'empty-layer'; message: string; itemId: string }> {
    return preflight.preflight(this)
  }

  /** See engine-appearance.ts. */
  adjustColors(dh: number, ds: number, dl: number): number {
    return appearance.adjustColors(this, dh, ds, dl)
  }

  /** See engine-appearance.ts. */
  invertPaints(): number {
    return appearance.invertPaints(this)
  }

  /** See engine-appearance.ts. */
  swapFillStroke(): void {
    appearance.swapFillStroke(this)
  }

  /** See engine-appearance.ts. */
  collectSelectionColors(): string[] {
    return appearance.collectSelectionColors(this)
  }

  /** See engine-appearance.ts. */
  applyColorMap(mapping: Map<string, string>): number {
    return appearance.applyColorMap(this, mapping)
  }

  /** See engine-pathops.ts. */
  addArrowheads(start: boolean, end: boolean, length: number): number {
    return pathops.addArrowheads(this, start, end, length)
  }

  /** See engine-select.ts. */
  selectStrays(): number {
    return select.selectStrays(this)
  }

  /** See engine-select.ts. */
  selectTextObjects(): number {
    return select.selectTextObjects(this)
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

  /** See engine-envelope.ts. */
  envelopeDistort(preset: EnvelopePreset): number {
    return envelope.envelopeDistort(this, preset)
  }

  // Envelope leaf/point math lives in engine-envelope.ts.

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
