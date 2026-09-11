/**
 * Gradient tool (AI Gradient-tool parity, angle only).
 *
 * Drag across the selection to set the linear-gradient angle from the drag
 * vector (Shift snaps to 45°). The endpoint span always covers the bounds,
 * so only the angle is stored. When the selection carries no gradient, a
 * default black→white linear gradient is created first; radial gradients
 * keep their type and only gain the drag angle for a later switch back to
 * linear. Release records one history entry; Escape cancels the drag.
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'
import { gradientAngleFromVector, normalizeAngleDeg } from '../geometry'

export class GradientController {
  engine: EditorEngine | null = null
  private dragging = false
  private start: { x: number; y: number } | null = null
  private preview: paper.Path | null = null
  private committed = false
  /** Whether ensureLinearGradient() already ran for this gesture. */
  private gradientEnsured = false
  private savedGradient: { type: 'linear' | 'radial'; stops: Array<{ offset: number; color: string }>; angle?: number } | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.cancelDrag()
    this.setupTool()
    applyToolCursor(this.engine.canvas, 'gradient')
  }

  private setupTool() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    if (scope.tool) scope.tool.remove()
    new scope.Tool()

    scope.tool.onMouseDown = (event: paper.ToolEvent) => {
      const native = (event as any).event as MouseEvent
      if (native && native.button !== 0) return
      if (engine.getSelection().length === 0) {
        engine.store.setStatusMessage('Select objects to edit their gradient')
        return
      }
      // Snapshot the appearance BEFORE touching it. ensureLinearGradient()
      // rewrites the style, so capturing afterwards made Escape restore the
      // freshly auto-created gradient instead of the user's original state.
      const g = engine.store.style.gradient
      this.savedGradient = g
        ? { type: g.type, stops: g.stops.map((s) => ({ ...s })), angle: g.angle }
        : null
      this.dragging = true
      this.committed = false
      this.gradientEnsured = false
      this.start = { x: event.point.x, y: event.point.y }
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.dragging || !this.start) return
      // Materialize the gradient only once a real drag starts: doing it on
      // mouse-down repainted the selection on a plain click, with no history
      // entry to undo it.
      if (!this.gradientEnsured) {
        this.ensureLinearGradient()
        this.gradientEnsured = true
      }
      let angle = gradientAngleFromVector(event.point.x - this.start.x, event.point.y - this.start.y)
      if (event.modifiers.shift) angle = Math.round(angle / 45) * 45
      this.applyAngle(normalizeAngleDeg(angle), false)
      this.drawPreview(this.start, { x: event.point.x, y: event.point.y })
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onMouseUp = () => {
      if (!this.dragging) return
      this.dragging = false
      this.clearPreview()
      if (this.committed) engine.pushHistory('Change Gradient')
      this.committed = false
      this.gradientEnsured = false
      this.savedGradient = null
      this.start = null
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'escape' && this.dragging) this.cancelDrag()
    }
    scope.view.update()
  }

  /** Guarantee a linear gradient on the store + selection to drag from. */
  private ensureLinearGradient() {
    const engine = this.engine
    if (!engine) return
    const current = engine.store.style.gradient
    if (current && current.type === 'linear' && current.stops.length > 0) return
    const stops = current && current.stops.length > 0
      ? current.stops.map((s) => ({ ...s }))
      : [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }]
    engine.store.updateStyle({ gradient: { type: 'linear', stops, angle: 0 } })
    engine.getSelection().forEach((item: any) => {
      engine.applyStyleToItem(item, engine.store.style)
    })
    engine.scope.view.update()
  }

  private applyAngle(angle: number, record: boolean) {
    const engine = this.engine
    if (!engine) return
    const current = engine.store.style.gradient
    if (!current) return
    engine.store.updateStyle({ gradient: { ...current, type: 'linear', angle } })
    engine.getSelection().forEach((item: any) => {
      engine.applyStyleToItem(item, engine.store.style)
    })
    engine.scope.view.update()
    this.committed = true
    void record
  }

  private drawPreview(from: { x: number; y: number }, to: { x: number; y: number }) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    this.clearPreview()
    const line = new scope.Path.Line(
      new scope.Point(from.x, from.y),
      new scope.Point(to.x, to.y)
    ) as paper.Path
    line.strokeColor = new scope.Color('#ffffff')
    line.strokeWidth = 1.5 / scope.view.zoom
    line.dashArray = [5 / scope.view.zoom, 4 / scope.view.zoom]
    line.data.isPreview = true
    engine.getOverlayLayer().addChild(line)
    this.preview = line
    scope.view.update()
  }

  private clearPreview() {
    if (this.preview) {
      this.preview.remove()
      this.preview = null
    }
    this.engine?.scope.view.update()
  }

  private cancelDrag() {
    const engine = this.engine
    this.dragging = false
    this.start = null
    this.clearPreview()
    if (engine && this.committed) {
      // Roll back the live preview edits (they recorded no history yet) to
      // the appearance captured on mouse-down; null means "had no gradient".
      engine.store.updateStyle({ gradient: this.savedGradient ? { ...this.savedGradient } : null })
      engine.getSelection().forEach((item: any) => {
        engine.applyStyleToItem(item, engine.store.style)
      })
      engine.scope.view.update()
    }
    this.committed = false
    this.savedGradient = null
    if (engine) engine.store.setDragging(false)
  }
}
