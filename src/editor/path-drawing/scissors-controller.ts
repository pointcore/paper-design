/**
 * Scissors tool controller.
 *
 * Click a path to cut it at the nearest curve location: open paths split
 * into two (both parts stay selected), closed paths open up at the click.
 * Clicks on endpoints are no-ops with a status hint; locked, compound and
 * non-path artwork cannot be cut.
 */
import { EditorEngine } from '../engine'
import { applyToolCursor } from '../cursors'

export class ScissorsController {
  engine: EditorEngine | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.setupTool()
    applyToolCursor(this.engine.canvas, 'scissors')
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
    if (data.annotation || data.isChrome || data.isPreview || data.isGuide || data.isArtboard) return null
    // Pattern tiles and clip masks hold their hosts together; cut the host
    // shape instead of its scaffolding.
    if (data.isPatternTile || (item as any).clipMask) return null
    if (item instanceof scope.Path && !(item instanceof scope.CompoundPath)) {
      return item.segments.length >= 2 ? (item as paper.Path) : null
    }
    return null
  }

  /** Split a path at the curve location nearest a point. */
  private cutAt(path: paper.Path, point: paper.Point) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const location = path.getLocationOf(point)
    // getLocationOf answers even for far fill clicks: only cut near the
    // actual stroke, or fills would split at surprising places.
    if (
      !location ||
      !location.point ||
      location.point.getDistance(point) > 4 / scope.view.zoom
    ) {
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
    if (!second) {
      // Endpoint clicks (or defeated geometry) change nothing — for closed
      // paths too, since a clean split always yields a second part.
      engine.store.setStatusMessage(
        wasClosed ? 'Click away from anchors to open the path' : 'Click away from endpoints to cut'
      )
      return
    }
    const parts: paper.Item[] = [path]
    // The kept part shrank: re-anchor its gradient to the new bounds.
    engine.refreshItemGradient(path)
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
