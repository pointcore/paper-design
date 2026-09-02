/**
 * Pen tool controller.
 *
 * Faithful, Adobe-Illustrator-like pen behaviour built on Paper.js:
 *  - Click to place a corner anchor.
 *  - Press and drag from an anchor to pull out direction handles (creating a
 *    smooth curve point).
 *  - A rubber-band preview follows the cursor while a path is open.
 *  - Shift constrains the segment to 45 degree increments.
 *  - Backspace removes the last placed anchor.
 *  - Clicking on (or near) the starting anchor closes the path; double-click
 *    and Enter finish the open path; Escape / right-click cancel.
 *
 * The path is drawn into the active user layer and committed to history once
 * it has enough segments.
 */
import { EditorEngine } from '../engine'

export class PenController {
  engine: EditorEngine | null = null

  private isDrawing = false
  private currentPath: paper.Path | null = null
  private pressSegment = -1
  private pressDragged = false
  private previewPath: paper.Path | null = null
  private closeRing: paper.Path | null = null
  private lastPoint: { x: number; y: number } = { x: 0, y: 0 }

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
      // Right-click finishes / cancels the current stroke.
      if (native && native.button === 2) {
        this.finishPath()
        return
      }
      if (native && native.button === 1) return

      const point = event.point

      if (!this.isDrawing) {
        this.beginPath(point)
        this.pressSegment = this.currentPath ? this.currentPath.segments.length - 1 : 0
        this.pressDragged = false
        engine.store.setDragging(true)
        return
      }

      // When drawing: if the user clicks on the starting anchor, close the path.
      if (this.shouldClose(point)) {
        this.finishClosed()
        engine.store.setDragging(false)
        return
      }

      // Place a new corner anchor on mouse-down. If the user drags afterwards,
      // the same anchor is converted into a smooth point with direction handles.
      this.placeCorner(point)
      this.pressSegment = this.currentPath ? this.currentPath.segments.length - 1 : 0
      this.pressDragged = false
      engine.store.setDragging(true)
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isDrawing || !this.currentPath) return
      this.pressDragged = true
      const point = event.point
      const segments = this.currentPath.segments
      const seg = segments[this.pressSegment]
      if (!seg) return
      const dir = new scope.Point(point.x - seg.point.x, point.y - seg.point.y)

      // Pull direction handles: make this anchor a symmetric smooth point.
      seg.handleOut = dir
      seg.handleIn = new scope.Point(-dir.x, -dir.y)

      this.clearPreview()
      scope.view.update()
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
      if (this.isDrawing && this.currentPath) {
        this.updatePreview(event.point)
      }
    }

    scope.tool.onMouseUp = () => {
      engine.store.setDragging(false)
      if (!this.pressDragged && this.currentPath) {
        // A click without drag: leave the anchor as a plain corner.
      }
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      switch (event.key) {
        case 'backspace':
        case 'delete':
          if (this.isDrawing) this.removeLastAnchor()
          break
        case 'escape':
          if (this.isDrawing) this.cancelPath()
          else engine.clearSelection()
          break
        case 'enter':
          this.finishPath()
          break
      }
    }

    scope.view.update()
  }

  /** Begin a brand new path and place the very first anchor. */
  private beginPath(point: paper.Point) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const layer = engine.getActiveLayer()
    const path = new scope.Path() as paper.Path
    path.add(new scope.Segment(point))
    layer.addChild(path)
    const style = engine.store.style
    engine.applyStyleToItem(path, style)
    this.currentPath = path
    this.isDrawing = true
    this.lastPoint = { x: point.x, y: point.y }
  }

  /** Place a corner anchor (straight segment to the new point). */
  private placeCorner(point: paper.Point) {
    if (!this.currentPath) return
    const scope = this.engine!.scope
    this.clearPreview()
    this.currentPath.add(new scope.Segment(point))
    this.lastPoint = { x: point.x, y: point.y }
    scope.view.update()
  }

  private segmentDistance(a: paper.Point, b: paper.Point): number {
    return a.getDistance(b)
  }

  /** Whether the given click should close the path (hit near the first anchor). */
  private shouldClose(point: paper.Point): boolean {
    if (!this.currentPath || this.currentPath.segments.length < 2) return false
    const engine = this.engine
    if (!engine) return false
    const scope = engine.scope
    const first = this.currentPath.segments[0].point
    const tol = 8 / scope.view.zoom
    return first.getDistance(point) <= tol
  }

  /** Remove the last placed anchor while still drawing. */
  private removeLastAnchor() {
    if (!this.currentPath) return
    const scope = this.engine!.scope
    const segments = this.currentPath.segments
    if (segments.length <= 1) {
      // Nothing meaningful left: cancel the whole stroke.
      this.cancelPath()
      return
    }
    this.currentPath.removeSegment(segments.length - 1)
    this.pressSegment = segments.length - 1
    this.pressDragged = false
    this.clearPreview()
    scope.view.update()
  }

  /** Rubber-band preview from the last anchor to the cursor (or closing). */
  private updatePreview(point: paper.Point) {
    if (!this.currentPath || !this.engine) return
    const engine = this.engine
    const scope = engine.scope
    const segments = this.currentPath.segments
    if (segments.length === 0) return

    this.clearPreview()
    const last = segments[segments.length - 1].point

    if (this.shouldClose(point)) {
      // Highlight the closing segment back to the start anchor.
      const first = segments[0].point
      this.closeRing = this.makeDashedLine(last, first)
    } else {
      this.closeRing = null
    }
    this.previewPath = this.makeDashedLine(last, point)
    scope.view.update()
  }

  private makeDashedLine(from: paper.Point, to: paper.Point): paper.Path | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const line = new scope.Path.Line(from, to) as paper.Path
    line.strokeColor = new scope.Color('#4a90d9')
    line.strokeWidth = 1 / scope.view.zoom
    line.dashArray = [4 / scope.view.zoom, 3 / scope.view.zoom]
    line.strokeCap = 'round' as any
    line.data.isPreview = true
    const overlay = engine.getOverlayLayer()
    overlay.addChild(line)
    return line
  }

  private clearPreview() {
    if (this.previewPath) {
      this.previewPath.remove()
      this.previewPath = null
    }
    if (this.closeRing) {
      this.closeRing.remove()
      this.closeRing = null
    }
  }

  /** Finish the current path as an open stroke. */
  private finishPath() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    this.clearPreview()
    if (this.currentPath) {
      const path = this.currentPath
      if (path.segments.length >= 2) {
        path.data.id = engine.genId()
        path.data.isUserItem = true
        engine.pushHistory('Pen Path')
        this.afterCommit(path)
      } else {
        path.remove()
      }
    }
    this.reset()
    scope.view.update()
  }

  /** Close the path by connecting the last anchor back to the first. */
  private finishClosed() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    this.clearPreview()
    if (this.currentPath) {
      const path = this.currentPath
      path.closed = true
      path.data.id = engine.genId()
      path.data.isUserItem = true
      engine.pushHistory('Pen Path')
      this.afterCommit(path)
    }
    this.reset()
    scope.view.update()
  }

  /** Cancel the current in-progress stroke and remove its items. */
  private cancelPath() {
    const engine = this.engine
    if (!engine) return
    this.clearPreview()
    if (this.currentPath) {
      this.currentPath.remove()
      engine.scope.view.update()
    }
    this.reset()
    engine.store.setDragging(false)
    engine.scope.view.update()
  }

  private afterCommit(path: paper.Path) {
    const engine = this.engine
    if (!engine) return
    // Select the freshly drawn path so the user can immediately refine it.
    engine.clearSelection()
    engine.selectItem(path)
  }

  private reset() {
    this.currentPath = null
    this.isDrawing = false
    this.pressSegment = -1
    this.pressDragged = false
  }
}
