/**
 * Symbol sprayer (AI Symbol Sprayer parity, v1).
 *
 * Drag to scatter instances of the spray symbol (the last placed/swapped
 * definition, else the first library entry) every 24 document units, with
 * scale/rotation jitter. Release records one history entry and selects
 * the scattered instances; Escape ends the stroke the same way.
 * Without a library entry the tool reports how to make one.
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'

/** Dab spacing in document units. */
const SPRAY_SPACING = 24

export class SprayController {
  engine: EditorEngine | null = null
  private spraying = false
  private last: { x: number; y: number } | null = null
  private carry = 0
  private placed: paper.SymbolItem[] = []

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.cancelStroke()
    this.setupTool()
    applyToolCursor(this.engine.canvas, 'spray')
  }

  /** Definition id to scatter, or '' when the library is empty. */
  private sprayId(): string {
    const engine = this.engine
    if (!engine) return ''
    const wanted = (engine.store as any).spraySymbolId as string | undefined
    const entries = engine.listSymbols()
    if (wanted && entries.some((s) => s.id === wanted)) return wanted
    return entries.length > 0 ? entries[0].id : ''
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
      const id = this.sprayId()
      if (!id) {
        engine.store.setStatusMessage('Create a symbol first (Symbols panel > New Symbol)')
        return
      }
      this.spraying = true
      this.placed = []
      this.last = { x: event.point.x, y: event.point.y }
      this.carry = SPRAY_SPACING
      this.dab(event.point)
      engine.store.setDragging(true)
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.spraying || !this.last) return
      this.carry += Math.hypot(event.point.x - this.last.x, event.point.y - this.last.y)
      this.last = { x: event.point.x, y: event.point.y }
      while (this.carry >= SPRAY_SPACING) {
        this.carry -= SPRAY_SPACING
        this.dab(event.point)
      }
      engine.store.setCursorPos(event.point.x, event.point.y)
      scope.view.update()
    }

    const finish = () => {
      if (!this.spraying) return
      this.spraying = false
      this.last = null
      engine.store.setDragging(false)
      if (this.placed.length > 0) {
        engine.clearSelection()
        this.placed.forEach((item) => {
          item.selected = true
        })
        engine.syncSelectionToStore()
        engine.pushHistory('Spray Symbols')
        engine.store.setStatusMessage(`Sprayed ${this.placed.length} instance${this.placed.length === 1 ? '' : 's'}`)
        this.placed = []
      }
      scope.view.update()
    }
    scope.tool.onMouseUp = finish

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'escape' && this.spraying) finish()
    }
    scope.view.update()
  }

  private dab(point: paper.Point) {
    const engine = this.engine
    if (!engine) return
    const id = this.sprayId()
    if (!id) return
    const placed = engine.spraySymbol(
      id,
      point,
      0.7 + Math.random() * 0.6,
      Math.random() * 360
    )
    if (placed) this.placed.push(placed)
  }

  private cancelStroke() {
    this.spraying = false
    this.last = null
    this.placed = []
    if (this.engine) {
      this.engine.store.setDragging(false)
      this.engine.scope.view.update()
    }
  }
}
