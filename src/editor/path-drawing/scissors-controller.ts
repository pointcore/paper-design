/**
 * Scissors tool controller.
 *
 * Click a path to cut it at the nearest curve location: open paths split
 * into two (both parts stay selected), closed paths open up at the click.
 * Clicks on endpoints are no-ops with a status hint; locked, compound and
 * non-path artwork cannot be cut.
 */
import { EditorEngine } from '../engine'

export class ScissorsController {
  engine: EditorEngine | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.setupTool()
    this.engine.canvas.style.cursor = 'crosshair'
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
      if (native.button !== 0) return
      const target = this.cutTarget(event.point)
      if (!target) {
        engine.store.setStatusMessage('Click an unlocked path to cut')
        return
      }
      this.cutAt(target, event.point)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.view.update()
  }

  /** Cuttable unlocked plain path under a point, or null. */
  private cutTarget(point: paper.Point): paper.Path | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const hit = engine.project.hitTest(point, {
      fill: true,
      stroke: true,
      segments: false,
      tolerance: 3 / scope.view.zoom,
    })
    const item = hit?.item
    if (!item || (item as any).locked) return null
    const data = (item.data as any) ?? {}
    if (data.annotation || data.isChrome || data.isPreview || data.isGuide) return null
    if (item instanceof scope.Path && !(item instanceof scope.CompoundPath)) {
      return item.segments.length >= 2 ? (item as paper.Path) : null
    }
    return null
  }

  /** Split a path at the curve location nearest a point. */
  private cutAt(path: paper.Path, point: paper.Point) {
    const engine = this.engine
    if (!engine) return
    const location = path.getLocationOf(point)
    if (!location) {
      engine.store.setStatusMessage('Click closer to the path to cut')
      return
    }
    const wasClosed = path.closed
    let second: paper.Path | null = null
    try {
      second = path.splitAt(location)
    } catch {
      second = null
    }
    if (second && second.segments.length === 0) {
      second.remove()
      second = null
    }
    if (!wasClosed && !second) {
      // Endpoint clicks (or defeated geometry) change nothing.
      engine.store.setStatusMessage('Click away from endpoints to cut')
      return
    }
    const parts: paper.Item[] = [path]
    if (second && second.parent) {
      // The split part inherits styling; re-anchor it explicitly so
      // gradients follow the new bounds.
      engine.applyStyleToItem(second, engine.getStyleFromItem(path))
      second.data.id = engine.genId()
      second.data.isUserItem = true
      parts.push(second)
    }
    engine.clearSelection()
    parts.forEach((item) => {
      item.selected = true
    })
    engine.syncSelectionToStore()
    engine.pushHistory('Cut Path')
    engine.scope.view.update()
  }
}
