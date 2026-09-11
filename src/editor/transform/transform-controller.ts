/**
 * Transform tool controller (AI Rotate / Scale / Mirror parity).
 *
 * - rotate (Shift+R): drag around the selection pivot to rotate; Shift snaps
 *   to 45-degree steps. Uses engine.rotateSelection so the select frame stays
 *   in sync.
 * - scale (Shift+S): drag away/toward the pivot to scale uniformly about the
 *   reference pivot; Shift snaps the factor to 10% steps.
 * - mirror (Shift+O): click flips horizontal, Shift-click flips vertical.
 * - free-transform reuses the Select controller (bbox handles), so it is
 *   registered to the shared select instance in register-controllers.
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'

export class TransformController {
  engine: EditorEngine | null = null
  private mode: 'rotate' | 'scale' | 'mirror' = 'rotate'
  private dragging = false
  private pivot: paper.Point | null = null
  private startAngle = 0
  private accAngle = 0
  private startDist = 0
  private accFactor = 1
  private moved = false

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    const tool = this.engine.store.tool
    this.mode = tool === 'scale' ? 'scale' : tool === 'mirror' ? 'mirror' : 'rotate'
    this.dragging = false
    this.moved = false
    this.accAngle = 0
    this.accFactor = 1
    applyToolCursor(this.engine.canvas, tool)
    this.setupTool()
  }

  private setupTool() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    if (scope.tool) scope.tool.remove()
    new scope.Tool()

    scope.tool.onMouseDown = (event: paper.ToolEvent) => {
      const native = (event as any).event as MouseEvent
      if (native.button !== 0) return
      if (engine.getSelection().length === 0) {
        engine.store.setStatusMessage('Select objects to transform')
        return
      }
      if (this.mode === 'mirror') {
        const dir = native.shiftKey ? 'vertical' : 'horizontal'
        const pivot = engine.selectionReferencePivot() ?? engine.getSelectionBounds()?.center
        if (!pivot) return
        engine.flipSelection(dir, pivot)
        engine.pushHistory(dir === 'horizontal' ? 'Flip Horizontal' : 'Flip Vertical')
        engine.stampSelectionFrame()
        return
      }
      this.pivot = engine.selectionReferencePivot() ?? engine.getSelectionBounds()?.center ?? null
      if (!this.pivot) return
      this.dragging = true
      this.moved = false
      this.accAngle = 0
      this.accFactor = 1
      this.startAngle = Math.atan2(event.point.y - this.pivot.y, event.point.x - this.pivot.x)
      this.startDist = Math.max(1, Math.hypot(event.point.x - this.pivot.x, event.point.y - this.pivot.y))
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.dragging || !this.pivot) return
      if (this.mode === 'rotate') {
        const a = Math.atan2(event.point.y - this.pivot.y, event.point.x - this.pivot.x)
        let delta = ((a - this.startAngle) * 180) / Math.PI
        if (event.modifiers.shift) delta = Math.round(delta / 45) * 45
        const step = delta - this.accAngle
        if (Math.abs(step) > 1e-9) {
          engine.rotateSelection(step, this.pivot)
          this.accAngle = delta
          this.moved = true
        }
      } else {
        const dist = Math.max(1, Math.hypot(event.point.x - this.pivot.x, event.point.y - this.pivot.y))
        let factor = dist / this.startDist
        if (!Number.isFinite(factor) || factor <= 0) return
        if (event.modifiers.shift) factor = Math.max(0.1, Math.round(factor * 10) / 10)
        const step = factor / this.accFactor
        if (Math.abs(step - 1) > 1e-6) {
          engine.scaleSelection(step, step, this.pivot)
          this.accFactor = factor
          this.moved = true
        }
      }
    }

    scope.tool.onMouseUp = () => {
      if (!this.dragging) return
      this.dragging = false
      if (this.moved) {
        engine.pushHistory(this.mode === 'rotate' ? 'Rotate' : 'Scale')
        // rotateSelection rigidly syncs the oriented frame; scaleSelection
        // has no frame counterpart, so stamping here (which only writes
        // frame.version) froze the frame at its pre-scale size and offset.
        // Drop it instead so it rebuilds from the live bounds.
        if (this.mode === 'rotate') engine.stampSelectionFrame()
        else engine.dropSelectionFrame()
        engine.syncSelectionToStore()
      }
      this.moved = false
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'escape' && this.dragging) {
        // Roll back the in-progress drag incrementally.
        if (this.moved && this.pivot) {
          if (this.mode === 'rotate') engine.rotateSelection(-this.accAngle, this.pivot)
          else if (this.accFactor !== 1) engine.scaleSelection(1 / this.accFactor, 1 / this.accFactor, this.pivot)
        }
        this.dragging = false
        this.moved = false
      }
    }
    scope.view.update()
  }
}
