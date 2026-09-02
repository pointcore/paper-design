/**
 * EditorEngine - Vue/Pinia ↔ Paper.js bridge hub
 */
import paper from 'paper'
import type { ToolName, StyleState, LayerMeta, HistoryEntry } from './types'
import { createDefaultStyle } from './store'
import type { EditorStore } from './store-types'

export class EditorEngine {
  project!: paper.Project
  scope!: paper.PaperScope
  canvas!: HTMLCanvasElement
  store: EditorStore

  private toolName: ToolName = 'select'

  private overlayLayer: paper.Layer | null = null
  private annotationLayer: paper.Layer | null = null
  private guideLayer: paper.Layer | null = null

  zoom = 1
  center = { x: 0, y: 0 }

  private controllers: Map<ToolName, any> = new Map()

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
      this.guideLayer = new this.scope.Layer()
      this.guideLayer.name = 'guides'
      this.guideLayer.locked = true
    }
    return this.guideLayer
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

  zoomAt(scale: number, canvasX: number, canvasY: number) {
    this.zoom = Math.max(0.01, Math.min(64, this.zoom * scale))
    this.scope.view.zoom = this.zoom
    this.scope.view.update()
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
    if (style.fillColor) paperStyle.fillColor = style.fillColor
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

  getStyleFromItem(item: paper.Item): StyleState {
    const style = createDefaultStyle()
    const s = item as any
    style.fillColor = s.fillColor ? s.fillColor.toCSS(true) : null
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
