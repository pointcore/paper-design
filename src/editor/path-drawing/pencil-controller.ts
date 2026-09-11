/**
 * Pencil tool controller.
 *
 * Freehand drawing: press and drag to lay raw points on the overlay layer,
 * release to smooth the stroke with path.simplify() and commit it to the
 * active layer. Sub-pixel jitter is skipped while drawing (1.5 screen px
 * minimum spacing) and the smoothing tolerance scales with the inverse
 * zoom so strokes feel identical at any magnification. Escape cancels the
 * in-progress stroke; single clicks (dots) are discarded.
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'

export class PencilController {
  engine: EditorEngine | null = null
  private isDrawing = false
  private stroke: paper.Path | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.cancelStroke()
    this.setupTool()
    applyToolCursor(this.engine.canvas, 'pencil')
  }

  private getNativeEvent(event: paper.ToolEvent): MouseEvent | null {
    return ((event as any).event as MouseEvent) ?? null
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
      if (this.isDrawing) return
      const stroke = new scope.Path() as paper.Path
      stroke.add(new scope.Segment(event.point.clone()))
      engine.applyStyleToItem(stroke, engine.store.style)
      stroke.data.isPreview = true
      engine.getOverlayLayer().addChild(stroke)
      this.stroke = stroke
      this.isDrawing = true
      engine.store.setDragging(true)
      scope.view.update()
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isDrawing || !this.stroke) return
      const segments = this.stroke.segments
      const last = segments[segments.length - 1].point
      if (last.getDistance(event.point) < 1.5 / scope.view.zoom) return
      this.stroke.add(new scope.Segment(event.point.clone()))
      engine.store.setCursorPos(event.point.x, event.point.y)
      scope.view.update()
    }

    scope.tool.onMouseUp = () => {
      if (!this.isDrawing) return
      this.finishStroke()
      engine.store.setDragging(false)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      // Never steal keystrokes typed into panel inputs or dialogs.
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'escape' && this.isDrawing) {
        this.cancelStroke()
        engine.store.setDragging(false)
      }
    }

    scope.view.update()
  }

  /** Smooth and commit the stroke, or discard dots and empty strokes. */
  private finishStroke() {
    const engine = this.engine
    const stroke = this.stroke
    this.isDrawing = false
    this.stroke = null
    if (!engine || !stroke) return
    if (stroke.segments.length >= 2 && stroke.length > 0.5) {
      // Auto-close when the tail lands back on the head (AI pencil parity).
      const segs = stroke.segments
      if (segs.length >= 3) {
        const gap = segs[0].point.getDistance(segs[segs.length - 1].point)
        if (gap < 8 / engine.scope.view.zoom) stroke.closed = true
      }
      const smooth = Number((engine.store as any).pencilSmooth)
      stroke.simplify((Number.isFinite(smooth) ? smooth : 2.5) / engine.scope.view.zoom)
      const layer = engine.getActiveLayer()
      layer.addChild(stroke)
      stroke.data.id = engine.genId()
      stroke.data.isUserItem = true
      delete stroke.data.isPreview
      // Re-apply the style now that bounds exist (gradients anchor to them).
      engine.applyStyleToItem(stroke, engine.store.style)
      engine.selectItem(stroke)
      engine.pushHistory('Pencil')
    } else {
      stroke.remove()
    }
    engine.scope.view.update()
  }

  /** Drop the in-progress stroke without committing. */
  private cancelStroke() {
    if (this.stroke) {
      this.stroke.remove()
      this.stroke = null
    }
    this.isDrawing = false
    if (this.engine) {
      this.engine.store.setDragging(false)
      this.engine.scope.view.update()
    }
  }
}
