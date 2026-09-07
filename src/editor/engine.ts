/**
 * EditorEngine - Vue/Pinia ↔ Paper.js bridge hub
 */
import paper from 'paper'
import { PaperOffset } from 'paperjs-offset'
import type { ToolName, StyleState, LayerMeta, LayerItemNode, HistoryEntry, GuideOrientation, ProjectFileData, ReferencePoint, AlignMode, DistributeAxis, BooleanOperation, RasterExportOptions, GradientState } from './types'
import { createDefaultStyle } from './store'
import type { EditorStore } from './store-types'

/** Identifier stamped into every saved project file. */
const PROJECT_FILE_APP = 'vue-vector-editor'
/** Current project file format version. */
const PROJECT_FILE_VERSION = 1

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

  constructor(canvas: HTMLCanvasElement, store: EditorStore) {
    this.canvas = canvas
    this.store = store

    this.scope = new paper.PaperScope()
    this.scope.setup(canvas)
    this.project = this.scope.project

    this.setupProject()
    this.initLayers()
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

  setTool(tool: ToolName) {
    this.toolName = tool
    // Remove any transient editing chrome (e.g. anchor overlays) left over
    // by the previously active tool so it does not linger after switching.
    this.clearTransientChrome()
    // Reset an inline cursor left by the previous tool so the canvas returns
    // to its default (CSS-driven) cursor for the newly activated tool.
    this.canvas.style.cursor = ''
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

  getSelection(): paper.Item[] {
    return this.project.selectedItems as paper.Item[]
  }

  clearSelection() {
    this.project.deselectAll()
    this.store.clearSelection()
  }

  selectItem(item: paper.Item, addToSelection = false) {
    if (!addToSelection) {
      this.project.deselectAll()
    }
    item.selected = true
    this.syncSelectionToStore()
  }

  syncSelectionToStore() {
    const ids = this.project.selectedItems.map((item) => (item as any).data?.id as string)
    this.store.setSelection(ids.filter(Boolean))
  }

  syncLayersToStore() {
    const layers: LayerMeta[] = []
    for (const layer of this.project.layers) {
      if (layer.data?.isUserLayer) {
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

  getActiveLayer(): paper.Layer {
    const activeId = this.store.activeLayerId
    if (activeId) {
      const layer = this.project.layers.find((l) => (l.data as any)?.layerId === activeId)
      if (layer) return layer
    }
    const userLayers = this.project.layers.filter((l) => (l.data as any)?.isUserLayer)
    return userLayers[userLayers.length - 1]
  }

  createLayer(name = 'Layer'): paper.Layer {
    const layer = new this.scope.Layer()
    layer.name = name
    layer.data.isUserLayer = true
    layer.data.layerId = this.genId()
    layer.activate()
    this.syncLayersToStore()
    return layer
  }

  deleteLayer(layerId: string) {
    const layer = this.project.layers.find((l) => (l.data as any)?.layerId === layerId)
    if (layer) {
      layer.remove()
      this.syncLayersToStore()
    }
  }

  getOverlayLayer(): paper.Layer {
    if (!this.overlayLayer || !this.overlayLayer.parent) {
      this.overlayLayer = new this.scope.Layer()
      this.overlayLayer.name = 'overlay'
      this.overlayLayer.locked = true
    }
    return this.overlayLayer
  }

  getAnnotationLayer(): paper.Layer {
    if (!this.annotationLayer || !this.annotationLayer.parent) {
      this.annotationLayer = new this.scope.Layer()
      this.annotationLayer.name = 'annotation'
      this.annotationLayer.locked = true
    }
    return this.annotationLayer
  }

  getGuideLayer(): paper.Layer {
    if (!this.guideLayer || !this.guideLayer.parent) {
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
    if (orientation === 'vertical') {
      return ((item as paper.Path).segments[0] as any).point.x
    }
    return ((item as paper.Path).segments[0] as any).point.y
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

    if (orientation === 'horizontal') {
      // Horizontal guide: line is (a, y) - (b, y); update y.
      ;(s0 as any).point.y = position
      ;(s1 as any).point.y = position
    } else if (orientation === 'vertical') {
      ;(s0 as any).point.x = position
      ;(s1 as any).point.x = position
    }

    if (layer) layer.locked = wasLocked
    this.scope.view.update()
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
    layer.addChild(line)
    layer.locked = true

    this.scope.view.update()
    return line
  }

  /** Delete a guide item from the guide layer. */
  deleteGuide(guide: paper.Path) {
    const layer = this.getGuideLayer()
    if (!layer) return
    layer.locked = false
    guide.remove()
    layer.locked = true
    this.scope.view.update()
  }

  /** Remove all guides from the guide layer. */
  clearGuides() {
    const layer = this.getGuideLayer()
    if (!layer) return
    layer.locked = false
    layer.removeChildren()
    layer.locked = true
    this.scope.view.update()
  }

  /** Set guide-layer visibility according to the current store setting. */
  refreshGuides() {
    const layer = this.getGuideLayer()
    if (!layer) return
    layer.visible = this.store.view.showGuides
    this.scope.view.update()
  }

  /**
   * Show / hide the grid and (re)draw the grid lines if needed.
   * The grid is drawn on a dedicated layer at the bottom of the stack
   * so it sits behind all user artwork.
   */
  setGridVisible(visible: boolean, gridSize: number = 10) {
    if (!this.gridLayer || !this.gridLayer.parent) {
      this.gridLayer = new this.scope.Layer()
      this.gridLayer.name = 'grid'
      this.gridLayer.locked = true
      this.gridLayer.data.isUserLayer = false
      this.gridLayer.data.isGridLayer = true
      // Ensure the grid layer sits at the very bottom of the stack
      this.gridLayer.sendToBack()
    }

    this.gridLayer.visible = visible
    if (visible) {
      this.drawGrid(gridSize)
    } else {
      this.gridLayer.removeChildren()
    }
    this.scope.view.update()
  }

  /** Draw a dot or line grid using gridSize pixels (in document units). */
  private drawGrid(gridSize: number) {
    if (!this.gridLayer) return
    this.gridLayer.removeChildren()

    const v = this.scope.view
    const viewBounds = v.bounds
    // Extend drawing area so the grid covers the entire viewport regardless of pan
    const margin = 100
    const left = viewBounds.x - margin
    const top = viewBounds.y - margin
    const right = viewBounds.x + viewBounds.width + margin
    const bottom = viewBounds.y + viewBounds.height + margin

    // Convert viewBounds to project coordinates
    const p1 = v.viewToProject(new this.scope.Point(left, top))
    const p2 = v.viewToProject(new this.scope.Point(right, bottom))

    const gridColor = new this.scope.Color('#555555')
    gridColor.alpha = 0.25
    const style = {
      strokeColor: gridColor,
      strokeWidth: 1 / this.zoom,
      strokeCap: 'round' as 'round' | 'square' | 'butt',
    }

    // Draw vertical grid lines
    const startX = Math.floor(p1.x / gridSize) * gridSize
    for (let x = startX; x <= p2.x; x += gridSize) {
      const line = new this.scope.Path.Line(
        new this.scope.Point(x, p1.y),
        new this.scope.Point(x, p2.y)
      )
      line.set(style)
      line.data.isGridItem = true
      this.gridLayer.addChild(line)
    }

    // Draw horizontal grid lines
    const startY = Math.floor(p1.y / gridSize) * gridSize
    for (let y = startY; y <= p2.y; y += gridSize) {
      const line = new this.scope.Path.Line(
        new this.scope.Point(p1.x, y),
        new this.scope.Point(p2.x, y)
      )
      line.set(style)
      line.data.isGridItem = true
      this.gridLayer.addChild(line)
    }

    this.gridLayer.locked = true
  }

  /** Redraw the grid based on current zoom and view settings. */
  refreshGrid() {
    const visible = this.store.view.showGrid
    const gridSize = this.store.snap.gridSize || 10
    this.setGridVisible(visible, gridSize)
  }

  /** Notify listeners that the view has changed (zoom / pan). */
  emitViewChange() {
    this.onViewChange?.()
  }

  screenToCanvas(point: paper.Point): paper.Point {
    return new this.scope.Point(
      point.x - this.center.x,
      point.y - this.center.y
    )
  }

  canvasToScreen(point: paper.Point): paper.Point {
    return new this.scope.Point(
      point.x + this.center.x,
      point.y + this.center.y
    )
  }

  panBy(dx: number, dy: number) {
    this.center.x -= dx / this.zoom
    this.center.y -= dy / this.zoom
    this.updateViewCenter()
    this.refreshGrid()
    this.emitViewChange()
  }

  private updateViewCenter() {
    const v = this.scope.view
    // Compute the document coordinates of the canvas center
    const bounds = v.bounds
    const center = new this.scope.Point(
      this.center.x + bounds.width / 2 / this.zoom,
      this.center.y + bounds.height / 2 / this.zoom
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
    // Sync this.center (view top-left in document coords) with view.center.
    const bounds = v.bounds
    this.center = {
      x: v.center.x - bounds.width / 2 / newZoom,
      y: v.center.y - bounds.height / 2 / newZoom,
    }

    v.update()
    this.refreshGrid()
    this.store.updateView({ zoom: newZoom })
    this.emitViewChange()
  }

  fitToContent() {
    const items = this.getUserItems()
    if (items.length === 0) return
    const bounds = items[0].bounds
    items.forEach((item, i) => {
      if (i > 0) bounds.include(item.bounds)
    })
    if (bounds.width > 0 && bounds.height > 0) {
      const padding = 50
      const zoom = Math.min(
        (this.canvas.width - padding * 2) / bounds.width,
        (this.canvas.height - padding * 2) / bounds.height,
        100
      )
      this.zoom = zoom
      this.scope.view.zoom = zoom
      this.center = { x: -bounds.center.x * zoom + this.canvas.width / 2, y: -bounds.center.y * zoom + this.canvas.height / 2 }
      this.scope.view.update()
      this.refreshGrid()
      this.store.updateView({ zoom: this.zoom })
      this.emitViewChange()
    }
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
    const paperStyle: any = {}
    const gradientFill = this.gradientFillForItem(item, style)
    if (gradientFill) paperStyle.fillColor = gradientFill
    else if (style.fillColor) paperStyle.fillColor = style.fillColor
    else paperStyle.fillColor = null
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
  }

  /**
   * Build a gradient fill anchored to the item bounds (linear runs
   * left-center to right-center, radial spans the larger half-extent), or
   * null when no gradient applies. Radial colors always carry an explicit
   * highlight so linear vs radial stays detectable on readback.
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
    const origin = new scope.Point(bounds.x, bounds.y + bounds.height / 2)
    const destination = new scope.Point(bounds.x + bounds.width, bounds.y + bounds.height / 2)
    return new scope.Color(paperGradient, origin, destination) as paper.Color
  }

  /** Read a baked gradient back into parameters (stops survive the trip). */
  private gradientFromItem(item: paper.Item): GradientState | null {
    const fill = (item as any).fillColor as any
    if (!fill || !fill.gradient) return null
    const stops = (fill.gradient.stops as any[]).map((stop) => ({
      offset: Number(stop.offset ?? 0),
      color: stop.color ? stop.color.toCSS(true) : '#000000',
    }))
    if (stops.length === 0) return null
    return { type: fill.highlight ? 'radial' : 'linear', stops }
  }

  getStyleFromItem(item: paper.Item): StyleState {
    const style = createDefaultStyle()
    const s = item as any
    const baked = this.gradientFromItem(item)
    if (baked) {
      style.fillColor = null
      style.gradient = baked
    } else {
      style.fillColor = s.fillColor ? s.fillColor.toCSS(true) : null
    }
    style.strokeColor = s.strokeColor ? s.strokeColor.toCSS(true) : null
    style.strokeWidth = s.strokeWidth ?? style.strokeWidth
    style.lineCap = (s.strokeCap as any) ?? style.lineCap
    style.lineJoin = (s.strokeJoin as any) ?? style.lineJoin
    style.opacity = s.opacity ?? style.opacity
    return style
  }

  // ===== History =====

  snapshotProject(): string {
    return this.project.exportJSON({ asString: true })
  }

  restoreSnapshot(snapshot: string) {
    // Project#importJSON appends a fresh layer stack whenever it runs (its
    // layer-merge path only triggers for an empty active layer of matching
    // type), so the project must be cleared first or every undo/redo would
    // duplicate the whole document.
    this.project.clear()
    this.project.importJSON(snapshot)
    this.syncLayersToStore()
    this.syncSelectionToStore()
    this.scope.view.update()
  }

  pushHistory(name: string, icon: string = '') {
    const snapshot = this.snapshotProject()
    this.history = this.history.slice(0, this.historyIndex + 1)
    this.historySnapshots = this.historySnapshots.slice(0, this.historyIndex + 1)
    this.history.push({ name, icon, timestamp: Date.now() })
    this.historySnapshots.push(snapshot)
    const limit = this.store.historyLimit || 100
    if (this.history.length > limit) {
      this.history.shift()
      this.historySnapshots.shift()
    }
    this.historyIndex = this.history.length - 1
    this.store.setHistory(this.history, this.historyIndex)
    this.store.lastOperation = name
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--
      this.restoreSnapshot(this.historySnapshots[this.historyIndex])
      this.store.setHistoryIndex(this.historyIndex)
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++
      this.restoreSnapshot(this.historySnapshots[this.historyIndex])
      this.store.setHistoryIndex(this.historyIndex)
    }
  }

  // ===== Document (Save/Open/New) =====

  /** Serialize the whole document into a versioned project file string. */
  exportProjectFile(): string {
    const data: ProjectFileData = {
      app: PROJECT_FILE_APP,
      version: PROJECT_FILE_VERSION,
      pageSize: { ...this.store.pageSize },
      snapshot: this.snapshotProject(),
    }
    return JSON.stringify(data)
  }

  /**
   * Replace the current document with the content of a project file string.
   * Throws an Error with an English message when the file is invalid.
   */
  importProjectFile(fileText: string): void {
    let parsed: ProjectFileData
    try {
      parsed = JSON.parse(fileText) as ProjectFileData
    } catch {
      throw new Error('Invalid project file: not valid JSON')
    }
    if (!parsed || typeof parsed.snapshot !== 'string' || parsed.snapshot.length === 0) {
      throw new Error('Invalid project file: missing snapshot')
    }
    if (typeof parsed.version === 'number' && parsed.version > PROJECT_FILE_VERSION) {
      throw new Error('Unsupported project file version')
    }
    this.restoreSnapshot(parsed.snapshot)
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
    this.pointActiveLayerAtRestoredStack()
    this.clearSelection()
    this.clipboardItems = []
    this.pasteCount = 0
    this.resetHistory('Open Project')
    this.refreshGrid()
    this.refreshGuides()
    this.scope.view.update()
    this.emitViewChange()
  }

  /** Reset the document to an empty state with the given page size. */
  newDocument(width: number, height: number): void {
    this.project.clear()
    this.setupProject()
    this.initLayers()
    this.pointActiveLayerAtRestoredStack()
    this.store.setPageSize(width, height)
    this.clearSelection()
    this.clipboardItems = []
    this.pasteCount = 0
    this.resetHistory('New Document')
    this.refreshGrid()
    this.refreshGuides()
    this.scope.view.update()
    this.emitViewChange()
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
    this.historyIndex = -1
    this.store.setHistory([], -1)
    this.pushHistory(name)
  }

  /**
   * Move a user layer to a position in the user band (0 = bottom).
   * Only permutes user layers via pairwise stacking, so the grid, guide
   * and overlay layers keep their slots. Callers mirror the store order.
   */
  moveUserLayer(layerId: string, toUserIndex: number): void {
    const users = this.project.layers.filter((l) => (l.data as any)?.isUserLayer)
    const from = users.findIndex((l) => (l.data as any)?.layerId === layerId)
    if (from < 0) return
    const clamped = Math.min(users.length - 1, Math.max(0, toUserIndex))
    const [moved] = users.splice(from, 1)
    users.splice(clamped, 0, moved)
    for (let i = 1; i < users.length; i++) {
      users[i].insertAbove(users[i - 1])
    }
    this.scope.view.update()
  }

  /** Set the active user layer opacity (store stays in sync, no history). */
  setActiveLayerOpacity(opacity: number): void {
    const layer = this.getActiveLayer()
    if (!layer) return
    const clamped = Math.min(1, Math.max(0, opacity))
    layer.opacity = clamped
    const id = (layer.data as any)?.layerId as string | undefined
    if (id) this.store.updateLayer(id, { opacity: clamped })
    this.scope.view.update()
  }

  // ===== Layer object tree =====

  /**
   * Flat depth-first object entries for one user layer. Path-text glyph
   * runs stay whole (their group is the entry); untagged plain groups are
   * transparent containers whose children list at the same depth.
   */
  listLayerItems(layerId: string): LayerItemNode[] {
    const out: LayerItemNode[] = []
    const scope = this.scope
    const layer = this.project.layers.find((l) => (l.data as any)?.layerId === layerId)
    if (!layer) return out
    const walk = (item: paper.Item, depth: number): void => {
      const data = (item.data as any) ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.annotation) return
      if (
        item instanceof scope.CompoundPath ||
        item instanceof scope.Path ||
        item instanceof scope.PointText
      ) {
        if (data.id) {
          out.push({
            id: data.id as string,
            name: this.itemTreeLabel(item),
            depth,
            visible: item.visible,
            locked: item.locked,
          })
        }
        return
      }
      if (item instanceof scope.Group) {
        if (data.id) {
          out.push({
            id: data.id as string,
            name: this.itemTreeLabel(item),
            depth,
            visible: item.visible,
            locked: item.locked,
          })
          if (data.textMode === 'path') return
          for (const child of item.children) walk(child as paper.Item, depth + 1)
        } else {
          for (const child of item.children) walk(child as paper.Item, depth)
        }
        return
      }
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) walk(child, depth)
      }
    }
    for (const child of layer.children) walk(child as paper.Item, 0)
    return out
  }

  /** Display label for an object-tree entry (imported names win). */
  private itemTreeLabel(item: paper.Item): string {
    const scope = this.scope
    const data = (item.data as any) ?? {}
    const named = (item as any).name as string | undefined
    let kind: string
    if (data.textMode === 'path') kind = 'Path Text'
    else if (data.textMode === 'area') kind = 'Area Text'
    else if (data.textMode === 'vertical') kind = 'Vertical Text'
    else if (item instanceof scope.Group && this.isClipGroup(item)) kind = 'Clipping Mask'
    else if (item instanceof scope.PointText) kind = 'Text'
    else if (item instanceof scope.CompoundPath) kind = 'Compound Path'
    else if (item instanceof scope.Raster) kind = 'Image'
    else if (item instanceof scope.Group) kind = 'Group'
    else if (item instanceof scope.Path) kind = item.closed ? 'Closed Path' : 'Path'
    else kind = 'Object'
    return named ? `${named} (${kind})` : kind
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
    if (!item) return
    if (!additive) this.project.deselectAll()
    item.selected = true
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
    const items = this.getSelection().filter((item) => !item.locked)
    if (items.length === 0) return
    const center = pivot ?? this.getSelectionBounds()?.center
    if (!center) return
    for (const item of items) {
      item.rotate(angleDeg, center)
    }
    const next = (this.store.transform.rotation + angleDeg) % 360
    this.store.updateTransform({ rotation: (next + 360) % 360 })
    this.scope.view.update()
  }

  /**
   * Mirror every unlocked selected item across a pivot. Horizontal flips
   * left/right, vertical flips top/bottom. The pivot defaults to the
   * reference-point pivot. Callers record history.
   */
  flipSelection(direction: 'horizontal' | 'vertical', pivot?: paper.Point): void {
    const items = this.getSelection().filter((item) => !item.locked)
    if (items.length === 0) return
    const center = pivot ?? this.selectionReferencePivot()
    if (!center) return
    for (const item of items) {
      if (direction === 'horizontal') item.scale(-1, 1, center)
      else item.scale(1, -1, center)
    }
    if (direction === 'horizontal') {
      this.store.updateTransform({ flipH: !this.store.transform.flipH })
    } else {
      this.store.updateTransform({ flipV: !this.store.transform.flipV })
    }
    this.scope.view.update()
  }

  /**
   * Align every unlocked selected item to an edge or center of the united
   * bounds of the unlocked selection. Needs at least two unlocked items.
   * Callers record history.
   */
  alignSelection(mode: AlignMode): void {
    const items = this.getSelection().filter((item) => !item.locked)
    if (items.length < 2) return
    const bounds = this.unitedBoundsOf(items)
    if (!bounds) return
    const targetLeft = bounds.x
    const targetCenterX = bounds.x + bounds.width / 2
    const targetRight = bounds.x + bounds.width
    const targetTop = bounds.y
    const targetCenterY = bounds.y + bounds.height / 2
    const targetBottom = bounds.y + bounds.height
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
      }
    }
    this.scope.view.update()
  }

  /**
   * Spread unlocked selected items evenly along an axis by distributing
   * their centers between the extreme centers. The extreme items stay in
   * place. Needs at least three unlocked items with distinct extremes.
   * Callers record history.
   */
  distributeSelection(axis: DistributeAxis): void {
    const items = this.getSelection().filter((item) => !item.locked && item.bounds)
    if (items.length < 3) return
    const horizontal = axis === 'horizontal'
    const centers = items.map((item) => {
      const b = item.bounds
      return horizontal ? b.x + b.width / 2 : b.y + b.height / 2
    })
    const order = items.map((_, index) => index).sort((a, b) => centers[a] - centers[b])
    const first = centers[order[0]]
    const last = centers[order[order.length - 1]]
    if (!Number.isFinite(first) || !Number.isFinite(last)) return
    if (Math.abs(last - first) < 1e-9) return
    const step = (last - first) / (items.length - 1)
    order.forEach((itemIndex, rank) => {
      const delta = first + step * rank - centers[itemIndex]
      if (Math.abs(delta) < 1e-9) return
      const item = items[itemIndex]
      const shift = horizontal
        ? new this.scope.Point(delta, 0)
        : new this.scope.Point(0, delta)
      item.position = item.position.add(shift)
    })
    this.scope.view.update()
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

  // ===== Raster export =====

  /**
   * Rasterize artwork through the paper.js view into a data URL. The view
   * is pointed at the export bounds for exactly one synchronous render and
   * then restored, so no intermediate frame ever paints. Editor chrome
   * layers stay hidden like in SVG export. Returns null when there is
   * nothing to export or the output exceeds the size guard.
   */
  exportRaster(options: RasterExportOptions): string | null {
    let bounds: paper.Rectangle | null
    if (options.area === 'selection') {
      bounds = this.getSelectionBounds()
    } else if (options.area === 'page') {
      const page = this.store.pageSize
      bounds =
        Number.isFinite(page.width) && Number.isFinite(page.height) && page.width > 0 && page.height > 0
          ? new this.scope.Rectangle(0, 0, page.width, page.height)
          : null
    } else {
      bounds = this.unitedBoundsOf(this.getUserItems())
    }
    if (!bounds || bounds.width < 1 || bounds.height < 1) return null
    const scale = Number.isFinite(options.scale) ? Math.min(4, Math.max(0.5, options.scale)) : 1
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
      if (!(layer.data as any)?.isUserLayer && layer.visible) {
        layer.visible = false
        hiddenLayers.push(layer)
      }
    }

    try {
      view.viewSize = new this.scope.Size(width, height)
      view.zoom = scale
      view.center = bounds.center
      view.update()

      const mime =
        options.format === 'jpeg' ? 'image/jpeg' :
        options.format === 'webp' ? 'image/webp' : 'image/png'
      if (options.format === 'png') {
        return this.canvas.toDataURL('image/png')
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
      ctx.drawImage(this.canvas, 0, 0)
      return output.toDataURL(mime, 0.92)
    } finally {
      hiddenLayers.forEach((layer) => {
        layer.visible = true
      })
      view.viewSize = prevSize
      view.zoom = prevZoom
      view.center = prevCenter
      view.update()
      this.refreshGrid()
      this.emitViewChange()
    }
  }

  // ===== Object order / visibility / select-same =====

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

  /** Lock or unlock the current selection (locked items skip most tools). */
  setSelectedLocked(locked: boolean): void {
    const items = this.getSelection()
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
   * Select every appearance leaf sharing the fill or stroke color of the
   * first selected leaf. Returns how many items were selected.
   */
  selectSame(attribute: 'fill' | 'stroke'): number {
    const leaves = this.appearanceLeaves()
    if (leaves.length === 0) return 0
    const reference = this.getSelection()
      .map((item) => this.firstLeaf(item))
      .find((leaf) => leaf !== null) as paper.Item | undefined
    if (!reference) return 0
    const key = this.appearanceKey(reference, attribute)
    const matches = leaves.filter((leaf) => this.appearanceKey(leaf, attribute) === key)
    this.clearSelection()
    matches.forEach((item) => {
      item.selected = true
    })
    this.syncSelectionToStore()
    this.scope.view.update()
    return matches.length
  }

  /** Fill / stroke color key used by select-same (`none` when unset). */
  private appearanceKey(item: paper.Item, attribute: 'fill' | 'stroke'): string {
    const color = (
      attribute === 'fill'
        ? (item as any).fillColor
        : (item as any).strokeColor
    ) as any
    if (color && color.gradient) return 'gradient'
    return color ? color.toCSS(true) : 'none'
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

  /** Every style-carrying leaf of user artwork (groups descended into). */
  private appearanceLeaves(): paper.Item[] {
    const scope = this.scope
    const out: paper.Item[] = []
    const walk = (item: paper.Item) => {
      const data = (item.data as any) ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.annotation) return
      if (
        item instanceof scope.Path ||
        item instanceof scope.CompoundPath ||
        item instanceof scope.PointText
      ) {
        out.push(item)
        return
      }
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) walk(child)
      }
    }
    for (const layer of this.project.layers) {
      if (!(layer.data as any)?.isUserLayer) continue
      for (const child of layer.children) walk(child as paper.Item)
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
    pushOriented(first, best[2])
    pushOriented(second, best[3])
    merged.closed = false
    first.remove()
    second.remove()
    parent.insertChild(Math.min(at, parent.children.length), merged)
    merged.data.id = this.genId()
    merged.data.isUserItem = true
    this.applyStyleToItem(merged, style)
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
   * their stacking slots and the group dissolves.
   */
  releaseClippingMask(): boolean {
    const scope = this.scope
    const groups = this.getSelection().filter(
      (item) =>
        !item.locked && item.parent && item instanceof scope.Group && this.isClipGroup(item)
    ) as paper.Group[]
    if (groups.length === 0) return false
    const released: paper.Item[] = []
    for (const group of groups) {
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
   * Place a bitmap image into the active layer, centered on the current
   * view. The data URL source embeds the pixels so the image survives
   * history and save/reload round-trips. Selection and history land once
   * the pixels load.
   */
  placeImage(dataUrl: string): void {
    const raster = new this.scope.Raster({ source: dataUrl }) as paper.Raster
    this.getActiveLayer().addChild(raster)
    raster.onLoad = () => {
      raster.position = this.scope.view.center.clone()
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

  // ===== Edit operations =====

  copySelected(): paper.Item[] {
    const items = this.getSelection()
    const clones: paper.Item[] = []
    const activeLayer = this.getActiveLayer()
    for (const item of items) {
      const clone = item.clone()
      activeLayer.addChild(clone)
      clone.data.id = this.genId()
      clone.data.isUserItem = true
      clone.selected = true
      clones.push(clone)
    }
    return clones
  }

  // ===== Clipboard =====

  /** Detached clones of the most recent copy / cut selection. */
  private clipboardItems: paper.Item[] = []
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
    this.pasteCount = 0
    return this.clipboardItems.length
  }

  /** Cut = copy onto the clipboard, then delete the selection. */
  cutSelectedToClipboard(): void {
    if (this.copySelectedToClipboard() === 0) return
    this.deleteSelected()
  }

  /**
   * Paste the internal clipboard in place (no offset), stacked at the very
   * front or back of the active layer. Returns false when it is empty.
   */
  pasteInPlace(where: 'front' | 'back'): boolean {
    if (this.clipboardItems.length === 0) return false
    const layer = this.getActiveLayer()
    const pasted: paper.Item[] = []
    for (const source of this.clipboardItems) {
      const clone = source.clone({ insert: false })
      layer.addChild(clone)
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
   * Paste the clipboard clones into the active layer. Each paste is offset
   * by a small step so repeated pastes do not stack exactly on top of the
   * source, and the pasted items become the new selection.
   */
  pasteClipboard(): void {
    if (this.clipboardItems.length === 0) return
    const layer = this.getActiveLayer()
    // Each paste steps one increment further from the source position.
    this.pasteCount++
    const offset = new this.scope.Point(10 * this.pasteCount, 10 * this.pasteCount)
    const pasted: paper.Item[] = []
    for (const source of this.clipboardItems) {
      const clone = source.clone({ insert: false })
      layer.addChild(clone)
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
      item.data.id = this.genId()
      item.data.isUserItem = true
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

  /**
   * Best-effort copy of the current selection to the OS clipboard as SVG so
   * artwork can move to other applications. Falls back from the SVG MIME
   * type to plain text. Resolves false when nothing is selected, the API is
   * unavailable or the write is denied.
   */
  async copyToSystemClipboard(): Promise<boolean> {
    const svg = this.exportSelectionSVG()
    if (!svg) return false
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
   * Paste entry point: OS clipboard SVG first, internal clipboard fallback.
   * Denied or unavailable OS access silently falls back so in-app
   * copy/paste keeps working everywhere.
   */
  async pasteWithSystemFallback(): Promise<void> {
    try {
      if (await this.pasteFromSystemClipboard()) return
    } catch {
      // Denied or unavailable OS access -> internal fallback below.
    }
    this.pasteClipboard()
  }

  deleteSelected() {
    const items = this.getSelection()
    items.forEach((i) => i.remove())
    this.clearSelection()
    this.pushHistory('Delete')
    this.scope.view.update()
  }

  duplicateSelected() {
    const items = this.getSelection()
    const clones = this.copySelected()
    if (clones.length > 0) {
      const dx = 10
      const dy = 10
      clones.forEach((c) => {
        c.position = c.position.add(new this.scope.Point(dx, dy))
      })
      this.pushHistory('Duplicate')
      this.scope.view.update()
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
