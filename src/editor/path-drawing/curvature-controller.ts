/**
 * Curvature tool controller.
 *
 * Behaves like Adobe Illustrator's Curvature tool: the user clicks a few
 * points and the editor keeps the stroke as one continuous smooth curve that
 * passes through every clicked point. The curve is recomputed live using a
 * Catmull-Rom to cubic-Bezier conversion.
 *
 * Interactions:
 *  - Click to add a curve point.
 *  - Double-click an existing point to delete it.
 *  - Click on the starting point to close the shape.
 *  - Enter or right-click finishes an open curve; Escape cancels.
 */
import { EditorEngine } from '../engine'

export class CurvatureController {
  engine: EditorEngine | null = null

  private isDrawing = false
  private path: paper.Path | null = null
  private previewPath: paper.Path | null = null
  private lastClickTime = 0
  private lastClickIndex = -1

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.setupTool()
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
      if (native && native.button === 2) {
        this.finish()
        return
      }
      if (native && native.button === 1) return

      const point = event.point
      const now = Date.now()

      if (!this.isDrawing) {
        this.begin(point)
        engine.store.setDragging(true)
        return
      }

      // If we are near the starting point, close the curve.
      if (this.shouldClose(point)) {
        this.finishClosed()
        engine.store.setDragging(false)
        return
      }

      // Double-click an existing point to delete it.
      const hitIdx = this.hitAnchor(point)
      if (hitIdx >= 0) {
        if (now - this.lastClickTime < 350 && this.lastClickIndex === hitIdx) {
          this.removePoint(hitIdx)
          this.lastClickIndex = -1
          this.lastClickTime = 0
        } else {
          this.lastClickIndex = hitIdx
          this.lastClickTime = now
        }
        return
      }

      // Otherwise add a new curve point.
      this.addPoint(point)
      this.lastClickIndex = -1
      this.lastClickTime = now
      engine.store.setDragging(true)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
      if (this.isDrawing && this.path) {
        this.updatePreview(event.point)
      }
    }

    scope.tool.onMouseUp = () => {
      engine.store.setDragging(false)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      switch (event.key) {
        case 'escape':
          if (this.isDrawing) this.cancel()
          else engine.clearSelection()
          break
        case 'enter':
          this.finish()
          break
      }
    }

    scope.view.update()
  }

  private begin(point: paper.Point) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const layer = engine.getActiveLayer()
    const path = new scope.Path() as paper.Path
    path.add(new scope.Segment(point))
    layer.addChild(path)
    const style = engine.store.style
    engine.applyStyleToItem(path, style)
    this.path = path
    this.isDrawing = true
    scope.view.update()
  }

  private addPoint(point: paper.Point) {
    if (!this.path || !this.engine) return
    const scope = this.engine.scope
    this.clearPreview()
    this.path.add(new scope.Segment(point))
    this.smooth()
    this.updatePreview(point)
    scope.view.update()
  }

  private removePoint(index: number) {
    if (!this.path || !this.engine) return
    const scope = this.engine.scope
    if (this.path.segments.length <= 2) {
      // Not enough points to keep a meaningful curve.
      this.path.remove()
      this.reset()
      scope.view.update()
      return
    }
    this.path.removeSegment(index)
    this.smooth()
    this.updatePreview(this.lastPoint())
    scope.view.update()
  }

  private lastPoint(): paper.Point {
    const scope = this.engine!.scope
    const segs = this.path ? this.path.segments : []
    if (segs.length > 0) return segs[segs.length - 1].point
    return new scope.Point(0, 0)
  }

  private shouldClose(point: paper.Point): boolean {
    if (!this.path || !this.engine) return false
    const scope = this.engine.scope
    if (this.path.segments.length < 3) return false
    const first = this.path.segments[0].point
    const tol = 8 / scope.view.zoom
    return first.getDistance(point) <= tol
  }

  private hitAnchor(point: paper.Point): number {
    if (!this.path || !this.engine) return -1
    const scope = this.engine.scope
    const tol = 6 / scope.view.zoom
    const segs = this.path.segments
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].point.getDistance(point) <= tol) return i
    }
    return -1
  }

  /**
   * Convert the raw anchor points into a smooth continuous curve using
   * Catmull-Rom style handle computation (through-point smoothing).
   */
  private smooth() {
    if (!this.path || !this.engine) return
    const scope = this.engine.scope
    const segs = this.path.segments
    const n = segs.length
    if (n < 3) return

    const pts = segs.map((s) => s.point)
    const closed = this.path.closed

    for (let i = 0; i < n; i++) {
      const prev = closed
        ? pts[(i - 1 + n) % n]
        : (i === 0 ? pts[i] : pts[i - 1])
      const curr = pts[i]
      const next = closed
        ? pts[(i + 1) % n]
        : (i === n - 1 ? pts[i] : pts[i + 1])

      // Tangent direction (Catmull-Rom style) scaled to produce gentle curves.
      const tx = (next.x - prev.x) / 6
      const ty = (next.y - prev.y) / 6
      segs[i].handleOut = new scope.Point(tx, ty)
      segs[i].handleIn = new scope.Point(-tx, -ty)
    }

    if (closed) {
      // Fully smooth closed loop: adjust boundary points as well.
      const p0 = pts[0]
      const p1 = pts[1]
      const pN = pts[n - 1]
      const out0 = new scope.Point((p1.x - pN.x) / 6, (p1.y - pN.y) / 6)
      segs[0].handleIn = new scope.Point(-out0.x, -out0.y)
      segs[0].handleOut = out0
    }
    scope.view.update()
  }

  private updatePreview(point: paper.Point) {
    if (!this.path || !this.engine) return
    const engine = this.engine
    const scope = engine.scope
    this.clearPreview()
    const last = this.path.segments[this.path.segments.length - 1].point
    const line = new scope.Path.Line(last, point) as paper.Path
    line.strokeColor = new scope.Color('#4a90d9')
    line.strokeWidth = 1 / scope.view.zoom
    line.dashArray = [4 / scope.view.zoom, 3 / scope.view.zoom]
    line.data.isPreview = true
    const overlay = engine.getOverlayLayer()
    overlay.addChild(line)
    this.previewPath = line
    scope.view.update()
  }

  private clearPreview() {
    if (this.previewPath) {
      this.previewPath.remove()
      this.previewPath = null
    }
  }

  private finishClosed() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    this.clearPreview()
    if (this.path) {
      const path = this.path
      if (path.segments.length >= 3) {
        // Drop the anchor that was clicked as a closing point if it duplicated
        // the start anchor; then close the loop.
        path.removeSegment(path.segments.length - 1)
        path.closed = true
        this.smooth()
        path.data.id = engine.genId()
        path.data.isUserItem = true
        engine.pushHistory('Curvature Path')
        engine.clearSelection()
        engine.selectItem(path)
      } else {
        path.remove()
      }
    }
    this.reset()
    scope.view.update()
  }

  private finish() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    this.clearPreview()
    if (this.path) {
      const path = this.path
      if (path.segments.length >= 3) {
        this.smooth()
        path.data.id = engine.genId()
        path.data.isUserItem = true
        engine.pushHistory('Curvature Path')
        engine.clearSelection()
        engine.selectItem(path)
      } else {
        path.remove()
      }
    }
    this.reset()
    scope.view.update()
  }

  private cancel() {
    const engine = this.engine
    if (!engine) return
    this.clearPreview()
    if (this.path) this.path.remove()
    this.reset()
    engine.store.setDragging(false)
    engine.scope.view.update()
  }

  private reset() {
    this.path = null
    this.isDrawing = false
    this.lastClickIndex = -1
    this.lastClickTime = 0
  }
}
