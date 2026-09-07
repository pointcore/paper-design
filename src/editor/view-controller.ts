/**
 * View controller - zoom and pan.
 *
 * Zoom tool: click steps the zoom (Alt / right-click steps out), drag
 * draws a rubber band that zooms to fit. Hand tool (and Space-pan) drags
 * to pan; middle-drag pan lives in CanvasHost for every tool.
 */
import { EditorEngine } from './engine'

export class ViewController {
  engine: EditorEngine | null = null
  private mode: 'none' | 'pan' | 'zoom' = 'none'
  private lastPoint: { x: number; y: number } = { x: 0, y: 0 }
  private isZoomTool = false
  // Zoom rubber band (document-space corners + preview rectangle).
  private zoomStart: { x: number; y: number } | null = null
  private zoomRect: paper.Path | null = null
  private zoomButton = 0
  private zoomAlt = false

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    const store = this.engine.store
    // Determine the current tool mode
    this.isZoomTool = store.tool === 'zoom'
    this.setupTool()
  }

  private setupTool() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    // Remove existing tool if any, then create a fresh tool.
    if (scope.tool) {
      scope.tool.remove()
    }
    // Creating a Tool automatically activates it on the scope.
    new scope.Tool()

    scope.tool.onMouseDown = (event: paper.ToolEvent) => {
      const native = (event as any).event as MouseEvent

      if (this.isZoomTool) {
        // Defer to mouse-up: a press-drag becomes a zoom box, a plain
        // click steps the zoom instead.
        this.mode = 'zoom'
        this.zoomStart = { x: event.point.x, y: event.point.y }
        this.zoomButton = native.button ?? 0
        this.zoomAlt = !!event.modifiers.alt
      } else {
        // Hand / pan
        this.mode = 'pan'
        this.lastPoint = { x: event.point.x, y: event.point.y }
      }
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (this.mode === 'pan') {
        const dx = event.point.x - this.lastPoint.x
        const dy = event.point.y - this.lastPoint.y
        engine.panBy(dx, dy)
        this.lastPoint = { x: event.point.x, y: event.point.y }
      } else if (this.mode === 'zoom' && this.zoomStart) {
        this.updateZoomRect(event.point.x, event.point.y)
      }
    }

    scope.tool.onMouseUp = (event: paper.ToolEvent) => {
      if (this.mode === 'zoom' && this.zoomStart) {
        const zoom = engine.scope.view.zoom || 1
        const moved =
          Math.hypot(
            (event.point.x - this.zoomStart.x) * zoom,
            (event.point.y - this.zoomStart.y) * zoom
          ) > 4
        if (moved) {
          this.zoomToRect(this.zoomStart.x, this.zoomStart.y, event.point.x, event.point.y)
        } else {
          const zoomFactor = this.zoomButton === 2 || this.zoomAlt ? 0.8 : 1.2
          engine.zoomAt(zoomFactor, event.point.x, event.point.y)
        }
        this.removeZoomRect()
        this.zoomStart = null
      }
      this.mode = 'none'
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (event.key === 'space') {
        this.mode = 'pan'
      } else if (event.key === 'escape' && this.mode === 'zoom') {
        this.removeZoomRect()
        this.zoomStart = null
        this.mode = 'none'
      }
    }

    scope.tool.onKeyUp = (event: paper.KeyEvent) => {
      if (event.key === 'space') {
        this.mode = 'none'
      }
    }

    scope.view.update()
  }

  /** Redraw the zoom rubber band for the current drag corner. */
  private updateZoomRect(x: number, y: number) {
    const engine = this.engine
    if (!engine || !this.zoomStart) return
    const scope = engine.scope
    this.removeZoomRect()
    const start = this.zoomStart
    this.zoomRect = new scope.Path.Rectangle({
      from: [Math.min(start.x, x), Math.min(start.y, y)],
      to: [Math.max(start.x, x), Math.max(start.y, y)],
      strokeColor: '#4a90d9',
      strokeWidth: 1 / scope.view.zoom,
      dashArray: [4 / scope.view.zoom, 2 / scope.view.zoom],
      fillColor: 'rgba(74, 144, 217, 0.1)',
    }) as paper.Path
    this.zoomRect.data.isPreview = true
    engine.getOverlayLayer().addChild(this.zoomRect)
    scope.view.update()
  }

  /** Remove the zoom rubber band without zooming. */
  private removeZoomRect() {
    if (this.zoomRect) {
      this.zoomRect.remove()
      this.zoomRect = null
    }
    this.engine?.scope.view.update()
  }

  /**
   * Fit a document rectangle to the canvas. Bookkeeping mirrors zoomAt
   * so later zoom steps anchor correctly.
   */
  private zoomToRect(x1: number, y1: number, x2: number, y2: number) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const v = scope.view
    const width = Math.abs(x2 - x1)
    const height = Math.abs(y2 - y1)
    if (width < 1e-6 || height < 1e-6) return
    const newZoom = Math.max(
      0.01,
      Math.min(64, Math.min(engine.canvas.width / width, engine.canvas.height / height))
    )
    v.zoom = newZoom
    v.center = new scope.Point(Math.min(x1, x2) + width / 2, Math.min(y1, y2) + height / 2)
    engine.zoom = newZoom
    const bounds = v.bounds
    engine.center = {
      x: v.center.x - bounds.width / 2 / newZoom,
      y: v.center.y - bounds.height / 2 / newZoom,
    }
    v.update()
    engine.refreshGrid()
    engine.store.updateView({ zoom: newZoom })
    engine.emitViewChange()
  }
}
