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
    // Reuse an existing chrome layer when possible. Repeatedly creating fresh
    // layers while a control handle is dragged (clear + redraw on every mouse
    // move) otherwise leaves orphaned layers behind, which then pile up on the
    // canvas as spurious anchor squares / handle markers.
    let layer = this.layer && this.layer.parent
      ? this.layer
      : (scope.project.layers.find((l) => (l as any).name === 'anchor-chrome') as paper.Layer | undefined)
    if (!layer) {
      layer = new scope.Layer()
      layer.name = 'anchor-chrome'
      layer.locked = true
      layer.data.isUserLayer = false
      layer.data.isChromeRoot = true
    }
    this.layer = layer
    return layer
  }

  /** Remove all rendered chrome visuals. */
  clear() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    // Detach the tracked chrome layer first.
    if (this.layer && this.layer.parent) {
      this.layer.remove()
      this.layer = null
    }
    // Purge any orphaned chrome visuals that were created while another layer
    // was active and could not be attached to the (locked) chrome layer. Left
    // unchecked these accumulate on screen as unwanted anchor squares while a
    // handle is being dragged out, exactly as if many extra anchors appeared.
    for (const it of scope.project.getItems({ class: scope.Path })) {
      if ((it.data as any)?.isChrome) it.remove()
    }
  }

  /**
   * Draw one anchor marker. Unselected anchors are filled, selected ones
   * become hollow — matching Illustrator so selected anchors read as
   * "picked up" regardless of how many anchors are selected at once.
   */
  drawAnchor(point: paper.Point, selected = false): AnchorVisual | null {
    const engine = this.engine
    const layer = this.ensureLayer()
    if (!engine || !layer) return null
    const scope = engine.scope
    const size = 3.5 / scope.view.zoom
    const rect = new scope.Path.Rectangle(
      new scope.Rectangle(point.x - size, point.y - size, size * 2, size * 2)
    ) as paper.Path
    if (selected) {
      rect.fillColor = null
      rect.strokeColor = new scope.Color('#4a90d9')
      rect.strokeWidth = 1.2 / scope.view.zoom
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
   * Draw a control handle line between an anchor and its control handle point,
   * plus a circular handle marker at the free end.
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
  drawCrosshair(point: paper.Point, color: string = '#4a90d9'): paper.Path | null {
    const engine = this.engine
    const layer = this.ensureLayer()
    if (!engine || !layer) return null
    const scope = engine.scope
    const r = 5 / scope.view.zoom
    const g = new scope.Path()
    g.strokeColor = new scope.Color(color)
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

  /**
   * Draw a highlight along the actual Bezier curve between two anchors.
   * This properly shows the curve shape, unlike a plain straight line.
   *
   * @param path  The path whose curve segment should be highlighted
   * @param curveIndex  The index of the curve within the path to highlight
   */
  drawCurveHighlight(path: paper.Path, curveIndex: number): paper.Path | null {
    const engine = this.engine
    const layer = this.ensureLayer()
    if (!engine || !layer) return null
    const scope = engine.scope
    const n = path.curves.length
    if (n === 0 || curveIndex < 0 || curveIndex >= n) return null
    const curve = path.curves[curveIndex] as any
    if (!curve) return null

    const p1 = curve.point1
    const p2 = curve.point1.add(curve.handle1)
    const p3 = curve.point2.add(curve.handle2)
    const p4 = curve.point2

    // Build a polyline approximation of the curve for highlighting.
    const hl = new scope.Path() as paper.Path
    const steps = 24
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const mt = 1 - t
      const x = mt * mt * mt * p1.x + 3 * mt * mt * t * p2.x + 3 * mt * t * t * p3.x + t * t * t * p4.x
      const y = mt * mt * mt * p1.y + 3 * mt * mt * t * p2.y + 3 * mt * t * t * p3.y + t * t * t * p4.y
      hl.add(new scope.Segment(new scope.Point(x, y)))
    }
    hl.strokeColor = new scope.Color('#4a90d9')
    hl.strokeWidth = 2.5 / scope.view.zoom
    hl.strokeCap = 'round' as any
    hl.data.isChrome = true
    layer.addChild(hl)
    layer.bringToFront()
    return hl
  }

  /**
   * Draw a hollow ring marker (used by the delete-anchor hover preview).
   */
  drawRingMarker(point: paper.Point, color: string = '#e5484d'): paper.Path | null {
    const engine = this.engine
    const layer = this.ensureLayer()
    if (!engine || !layer) return null
    const scope = engine.scope
    const r = 6 / scope.view.zoom
    const circle = new scope.Path.Circle(point, r) as paper.Path
    circle.fillColor = new scope.Color(color)
    circle.fillColor.alpha = 0.15
    circle.strokeColor = new scope.Color(color)
    circle.strokeWidth = 1.5 / scope.view.zoom
    circle.data.isChrome = true
    layer.addChild(circle)
    layer.bringToFront()
    return circle
  }
}
