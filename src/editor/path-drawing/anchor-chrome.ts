/**
 * Anchor chrome helpers.
 *
 * Renders the editing affordances (anchor squares, handle lines and control
 * handles) that Adobe-Illustrator-like editors show on top of the selected
 * path. The visuals are lightweight Path items pushed onto the overlay layer
 * and are not persisted into the document.
 *
 * All drawing is kept in document space so it scales correctly with the view;
 * stroke sizes are divided by the current zoom to remain 1 px on screen.
 */
import { EditorEngine } from '../engine'

export interface AnchorVisual {
  square: paper.Path
}

/**
 * Small editable "chrome" manager bound to one engine. It groups every visual
 * under a dedicated layer so it can be cleared and refreshed cheaply.
 */
export class AnchorChrome {
  engine: EditorEngine | null = null
  private layer: paper.Layer | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  /** Lazily create (or reuse) the chrome layer used for anchor visuals. */
  private ensureLayer(): paper.Layer | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    if (!this.layer || !this.layer.parent) {
      const layer = new scope.Layer()
      layer.name = 'anchor-chrome'
      layer.locked = true
      layer.data.isUserLayer = false
      layer.data.isChromeRoot = true
      this.layer = layer
    }
    return this.layer
  }

  /** Remove all rendered chrome visuals. */
  clear() {
    if (this.layer && this.layer.parent) {
      this.layer.remove()
      this.layer = null
    }
  }

  /**
   * Draw one anchor marker. Filled when selected, hollow when not.
   */
  drawAnchor(point: paper.Point, selected = false): AnchorVisual | null {
    const engine = this.engine
    const layer = this.ensureLayer()
    if (!engine || !layer) return null
    const scope = engine.scope
    const size = 3 / scope.view.zoom
    const rect = new scope.Path.Rectangle(
      new scope.Rectangle(point.x - size, point.y - size, size * 2, size * 2)
    ) as paper.Path
    if (selected) {
      rect.fillColor = new scope.Color('#4a90d9')
      rect.strokeColor = new scope.Color('#ffffff')
      rect.strokeWidth = 1 / scope.view.zoom
    } else {
      rect.fillColor = new scope.Color('#ffffff')
      rect.strokeColor = new scope.Color('#4a90d9')
      rect.strokeWidth = 1 / scope.view.zoom
    }
    rect.data.isChrome = true
    layer.addChild(rect)
    layer.bringToFront()
    return { square: rect }
  }

  /**
   * Draw a control handle line between an anchor and its control handle point.
   */
  drawHandle(anchor: paper.Point, handle: paper.Point): paper.Path | null {
    const engine = this.engine
    const layer = this.ensureLayer()
    if (!engine || !layer) return null
    const scope = engine.scope
    const line = new scope.Path.Line(anchor, handle) as paper.Path
    line.strokeColor = new scope.Color('#4a90d9')
    line.strokeWidth = 1 / scope.view.zoom
    line.data.isChrome = true
    layer.addChild(line)

    // Circle marker for the control handle itself.
    const r = 3.5 / scope.view.zoom
    const circle = new scope.Path.Circle(handle, r) as paper.Path
    circle.fillColor = new scope.Color('#ffffff')
    circle.strokeColor = new scope.Color('#4a90d9')
    circle.strokeWidth = 1 / scope.view.zoom
    circle.data.isChrome = true
    layer.addChild(circle)
    layer.bringToFront()
    return line
  }

  /**
   * Draw a small crosshair marker (used by the add-anchor hover preview).
   */
  drawCrosshair(point: paper.Point): paper.Path | null {
    const engine = this.engine
    const layer = this.ensureLayer()
    if (!engine || !layer) return null
    const scope = engine.scope
    const r = 5 / scope.view.zoom
    const g = new scope.Path()
    g.strokeColor = new scope.Color('#4a90d9')
    g.strokeWidth = 1 / scope.view.zoom
    g.add(new scope.Segment(new scope.Point(point.x - r, point.y)))
    g.add(new scope.Segment(new scope.Point(point.x + r, point.y)))
    g.add(new scope.Segment(new scope.Point(point.x, point.y - r)))
    g.add(new scope.Segment(new scope.Point(point.x, point.y + r)))
    g.data.isChrome = true
    layer.addChild(g)
    layer.bringToFront()
    return g
  }

  /** Draw a segment highlight between two anchors (hover on a segment). */
  drawSegmentHighlight(from: paper.Point, to: paper.Point): paper.Path | null {
    const engine = this.engine
    const layer = this.ensureLayer()
    if (!engine || !layer) return null
    const scope = engine.scope
    const line = new scope.Path.Line(from, to) as paper.Path
    line.strokeColor = new scope.Color('#4a90d9')
    line.strokeWidth = 2 / scope.view.zoom
    line.data.isChrome = true
    layer.addChild(line)
    layer.bringToFront()
    return line
  }
}
