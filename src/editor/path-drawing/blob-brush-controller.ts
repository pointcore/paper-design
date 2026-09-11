/**
 * Blob brush controller.
 *
 * Drag paints a fat preview centerline; on release the stroke expands into
 * a filled outline (round caps and joins via paperjs-offset, circular dot
 * for clicks) that joins the artwork with the current style. One history
 * entry covers the whole drag; Escape cancels the preview. Same-color blob
 * merging is out of scope: overlapping blobs stay separate items.
 */
import { PaperOffset } from 'paperjs-offset'
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { ringCursor, setCanvasCursor } from '../cursors'

/** Fallback blob diameter in screen pixels (store.brushSize wins). */
const BLOB_SCREEN_SIZE = 20

export class BlobBrushController {
  engine: EditorEngine | null = null
  private isPainting = false
  private stroke: paper.Path | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  /** Screen-px footprint (store-driven, [ ] resizable). */
  brushScreenSize(): number {
    const n = Number((this.engine?.store as any)?.brushSize)
    return Number.isFinite(n) && n > 0 ? Math.min(200, Math.max(1, Math.round(n))) : BLOB_SCREEN_SIZE
  }

  /** Repaint the precision ring after a size change. */
  refreshCursor() {
    if (!this.engine) return
    setCanvasCursor(this.engine.canvas, ringCursor(this.brushScreenSize()))
  }

  activate() {
    if (!this.engine) return
    this.cancelStroke()
    this.setupTool()
    this.refreshCursor()
  }

  private getNativeEvent(event: paper.ToolEvent): MouseEvent | null {
    return ((event as any).event as MouseEvent) ?? null
  }

  /** Blob diameter in document units at the current zoom. */
  private diameter(): number {
    const engine = this.engine
    return this.brushScreenSize() / (engine?.scope.view.zoom || 1)
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
      const native = this.getNativeEvent(event)
      if (native && native.button !== 0) return
      if (this.isPainting) return
      const stroke = new scope.Path() as paper.Path
      stroke.add(new scope.Segment(event.point.clone()))
      stroke.strokeColor = new scope.Color(engine.store.style.fillColor || '#000000')
      stroke.strokeWidth = this.diameter()
      stroke.strokeCap = 'round'
      stroke.strokeJoin = 'round'
      stroke.opacity = 0.85
      stroke.data.isPreview = true
      engine.getOverlayLayer().addChild(stroke)
      this.stroke = stroke
      this.isPainting = true
      engine.store.setDragging(true)
      scope.view.update()
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isPainting || !this.stroke) return
      const segments = this.stroke.segments
      const last = segments[segments.length - 1].point
      if (last.getDistance(event.point) < 1.5 / scope.view.zoom) return
      this.stroke.add(new scope.Segment(event.point.clone()))
      engine.store.setCursorPos(event.point.x, event.point.y)
      scope.view.update()
    }

    scope.tool.onMouseUp = () => {
      if (!this.isPainting) return
      this.commitStroke()
      engine.store.setDragging(false)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      // Never steal keystrokes typed into panel inputs or dialogs.
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'escape' && this.isPainting) {
        this.cancelStroke()
        engine.store.setDragging(false)
      }
    }

    scope.view.update()
  }

  /** Expand the finished stroke into a filled blob on the active layer. */
  private commitStroke() {
    const engine = this.engine
    const stroke = this.stroke
    this.isPainting = false
    this.stroke = null
    if (!engine || !stroke) return
    stroke.remove()

    let blob: paper.Path | paper.CompoundPath | null = null
    try {
      const radius = this.diameter() / 2
      if (stroke.segments.length < 2 || stroke.length < 1e-6) {
        const at = stroke.segments[0]?.point ?? new engine.scope.Point(0, 0)
        blob = new engine.scope.Path.Circle(at, radius) as paper.Path
      } else {
        blob = PaperOffset.offsetStroke(stroke, radius, {
          join: 'round',
          cap: 'round',
          insert: false,
        }) as paper.Path | paper.CompoundPath
      }
    } catch {
      blob = null
    }
    if (!blob) {
      engine.scope.view.update()
      return
    }

    const layer = engine.getActiveLayer()
    layer.addChild(blob)
    blob.data.id = engine.genId()
    blob.data.isUserItem = true
    engine.applyStyleToItem(blob, engine.store.style)
    engine.selectItem(blob)
    engine.pushHistory('Blob Brush')
    engine.scope.view.update()
  }

  /** Drop the in-progress stroke without painting. */
  private cancelStroke() {
    if (this.stroke) {
      this.stroke.remove()
      this.stroke = null
    }
    this.isPainting = false
    if (this.engine) {
      this.engine.store.setDragging(false)
      this.engine.scope.view.update()
    }
  }
}
