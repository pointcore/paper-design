/**
 * View controller - zoom and pan.
 *
 * Zoom tool: click steps the zoom (Alt / right-click steps out), drag
 * draws a rubber band that zooms to fit. Hand tool (and Space-pan) drags
 * to pan; middle-drag pan lives in CanvasHost for every tool.
 */
import { EditorEngine } from './engine'
import { isEditableTarget } from './shortcuts'
import { handCursor, zoomCursor } from './cursors'

export class ViewController {
  engine: EditorEngine | null = null
  private mode: 'none' | 'pan' | 'zoom' = 'none'
  private lastPoint: { x: number; y: number } = { x: 0, y: 0 }
  // Screen-space anchor for pan drags (client px). Doc-space diffs would feed
  // the just-moved view back into the next measurement and judder in place.
  private lastClient: { x: number; y: number } | null = null
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
    // AI-aligned defaults: open hand for pan, magnifier for zoom.
    this.engine.canvas.style.cursor = this.isZoomTool ? zoomCursor(false) : handCursor(false)
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
        // AI: right-click / Alt previews zoom-out while pressed.
        if (this.zoomButton === 2 || this.zoomAlt) {
          engine.canvas.style.cursor = zoomCursor(true)
        }
      } else {
        // Hand / pan — closed fist while dragging (AI hand behavior).
        this.mode = 'pan'
        this.lastPoint = { x: event.point.x, y: event.point.y }
        this.lastClient = { x: native.clientX, y: native.clientY }
        engine.canvas.style.cursor = handCursor(true)
      }
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (this.mode === 'pan') {
        const dragNative = (event as any).event as MouseEvent | undefined
        if (dragNative && typeof dragNative.clientX === 'number' && this.lastClient) {
          // Screen-space deltas are immune to the view shift applied by the
          // previous step: the canvas follows the pointer 1:1 at any zoom.
          const zoom = engine.scope.view.zoom || 1
          engine.panBy(
            (dragNative.clientX - this.lastClient.x) / zoom,
            (dragNative.clientY - this.lastClient.y) / zoom
          )
          this.lastClient = { x: dragNative.clientX, y: dragNative.clientY }
        } else {
          const dx = event.point.x - this.lastPoint.x
          const dy = event.point.y - this.lastPoint.y
          engine.panBy(dx, dy)
          this.lastPoint = { x: event.point.x, y: event.point.y }
        }
        scope.view.update()
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
          // zoomAt expects canvas pixels — convert the document point via
          // the view. Passing document coords directly would teleport the
          // center (values in the thousands as pixels) and make the next
          // pan look frozen off-screen.
          const screen = engine.scope.view.projectToView(event.point)
          const zoomFactor = this.zoomButton === 2 || this.zoomAlt ? 0.8 : 1.2
          engine.zoomAt(zoomFactor, screen.x, screen.y)
        }
        this.removeZoomRect()
        this.zoomStart = null
      }
      this.mode = 'none'
      this.lastClient = null
      // Restore the resting cursor for the active view tool.
      engine.canvas.style.cursor = this.isZoomTool
        ? zoomCursor(!!(event.modifiers?.alt))
        : handCursor(false)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
      // AI zoom convention: holding Alt flips the magnifier to zoom-out.
      if (this.isZoomTool && this.mode === 'none') {
        engine.canvas.style.cursor = zoomCursor(!!event.modifiers?.alt)
      }
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      // Never steal keystrokes typed into panel inputs or dialogs.
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      // NOTE: Space-pan parking is owned by the global shortcut handler
      // (shortcuts.ts swaps in the hand tool). Toggling drag mode here as
      // well would clobber an in-progress zoom rubber band and fight the
      // parked tool with stale anchors, which showed up as flicker.
      if (event.key === 'escape' && this.mode === 'zoom') {
        this.removeZoomRect()
        this.zoomStart = null
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
   * Fit a document rectangle to the canvas. Bookkeeping goes through the
   * engine sync so later pan/zoom steps anchor correctly.
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
    engine.syncViewBookkeeping()
    v.update()
    engine.refreshGrid()
    engine.refreshGuideWidths()
    engine.store.updateView({ zoom: newZoom })
    engine.emitViewChange()
  }
}
