/**
 * Lasso selection tool (AI Lasso / CDR freehand-pick parity, object level).
 *
 * Drag a freehand loop on the overlay; on release every top-level user item
 * with its bounds center inside the loop (or whose path crosses the loop
 * edge) joins the selection. Plain drag replaces, Shift adds, Alt removes.
 * Escape cancels. Selection changes record no history (like marquee).
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'

export class LassoController {
  engine: EditorEngine | null = null
  private isDrawing = false
  private loop: paper.Path | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.cancelLoop()
    this.setupTool()
    applyToolCursor(this.engine.canvas, 'lasso')
  }

  /**
   * Tool switch: the paper Tool is replaced so the loop's mouse-up never
   * arrives — drop the loop instead of finishing it (replaying without the
   * live Shift/Alt modifiers would lose the add/remove intent).
   */
  deactivate() {
    if (this.isDrawing) this.cancelLoop()
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
      if (this.isDrawing) return
      const loop = new scope.Path() as paper.Path
      loop.add(new scope.Segment(event.point.clone()))
      ;(loop as any).strokeColor = new scope.Color('#4a90d9')
      loop.strokeWidth = 1 / scope.view.zoom
      loop.dashArray = [4 / scope.view.zoom, 3 / scope.view.zoom]
      loop.data.isPreview = true
      engine.getOverlayLayer().addChild(loop)
      this.loop = loop
      this.isDrawing = true
      engine.store.setDragging(true)
      scope.view.update()
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isDrawing || !this.loop) return
      const segments = this.loop.segments
      const last = segments[segments.length - 1].point
      if (last.getDistance(event.point) < 1.5 / scope.view.zoom) return
      this.loop.add(new scope.Segment(event.point.clone()))
      engine.store.setCursorPos(event.point.x, event.point.y)
      scope.view.update()
    }

    scope.tool.onMouseUp = (event: paper.ToolEvent) => {
      if (!this.isDrawing) return
      const native = (event as any).event as MouseEvent | undefined
      this.finishLoop({ add: !!native?.shiftKey, remove: !!native?.altKey })
      engine.store.setDragging(false)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'escape' && this.isDrawing) {
        this.cancelLoop()
        engine.store.setDragging(false)
      }
    }
    scope.view.update()
  }

  private finishLoop(mode: { add: boolean; remove: boolean }) {
    const engine = this.engine
    const loop = this.loop
    this.isDrawing = false
    this.loop = null
    if (!engine || !loop) return
    if (loop.segments.length < 3 || loop.length < 8) {
      loop.remove()
      engine.scope.view.update()
      engine.store.setStatusMessage('Drag a loop to select')
      return
    }
    const closed = loop.clone({ insert: false }) as paper.Path
    closed.closed = true
    loop.remove()
    const hits: paper.Item[] = []
    for (const item of engine.getUserItems()) {
      if ((item as any).locked) continue
      if (this.itemInLoop(item, closed)) hits.push(item)
    }
    closed.remove()
    if (mode.remove) {
      for (const item of hits) item.selected = false
    } else if (mode.add) {
      for (const item of hits) item.selected = true
    } else {
      engine.project.deselectAll()
      for (const item of hits) item.selected = true
    }
    engine.syncSelectionToStore()
    engine.scope.view.update()
    engine.store.setStatusMessage(
      hits.length > 0
        ? `Lasso selected ${hits.length} object${hits.length === 1 ? '' : 's'}`
        : 'Lasso found nothing'
    )
  }

  /** Object-level hit test (groups match when any descendant matches). */
  private itemInLoop(item: paper.Item, closed: paper.Path): boolean {
    const engine = this.engine
    if (!engine) return false
    const scope = engine.scope
    if (item instanceof scope.Group) {
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) {
          if ((child as any).locked) continue
          if (this.itemInLoop(child, closed)) return true
        }
      }
      return false
    }
    const bounds = (item as any).bounds as paper.Rectangle | undefined
    if (!bounds) return false
    try {
      if (closed.contains(bounds.center)) return true
    } catch { /* degenerate loop: fall through to edge test */ }
    if (item instanceof scope.Path || item instanceof scope.CompoundPath) {
      try {
        return closed.getIntersections(item as paper.PathItem).length > 0
      } catch {
        return false
      }
    }
    return false
  }

  private cancelLoop() {
    if (this.loop) {
      this.loop.remove()
      this.loop = null
    }
    this.isDrawing = false
    if (this.engine) {
      this.engine.store.setDragging(false)
      this.engine.scope.view.update()
    }
  }
}
