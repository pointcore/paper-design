/**
 * Live shape tool controller.
 *
 * Drag draws a live preview on the overlay layer. Modifier keys match the
 * Illustrator / CorelDRAW conventions:
 * - Shift constrains rectangles / rounded rectangles / ellipses to square /
 *   circle proportions and snaps line segments to 45° increments.
 * - Alt (Option) draws from the center: the start point stays the shape's
 *   center instead of its corner.
 */
import { EditorEngine } from '../engine'
import type { LiveShapeParams } from '../types'

export class ShapeController {
  engine: EditorEngine | null = null
  private isDrawing = false
  private startPoint: { x: number; y: number } = { x: 0, y: 0 }
  private previewShape: paper.Path | null = null
  private shapeKind: LiveShapeParams['kind'] = 'rect'

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.shapeKind = this.getShapeKind()
    this.setupTool()
  }

  private getNativeEvent(event: paper.ToolEvent): MouseEvent {
    return (event as any).event as MouseEvent
  }

  private getShapeKind(): LiveShapeParams['kind'] {
    const tool = this.engine!.store.tool
    switch (tool) {
      case 'rect': return 'rect'
      case 'rounded-rect': return 'rounded-rect'
      case 'ellipse': return 'ellipse'
      case 'polygon': return 'polygon'
      case 'line': return 'line'
      default: return 'rect'
    }
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
      if (native.button !== 0) return
      this.startPoint = { x: event.point.x, y: event.point.y }
      this.isDrawing = true
      engine.store.setDragging(true)
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isDrawing) return
      this.updatePreview(event.point, event.modifiers)
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onMouseUp = () => {
      if (!this.isDrawing) return
      this.finishShape()
      engine.store.setDragging(false)
    }

    scope.tool.onMouseUp = () => {
      if (!this.isDrawing) return
      this.finishShape()
      engine.store.setDragging(false)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (event.key === 'escape' && this.isDrawing) {
        this.cancelShape()
        engine.store.setDragging(false)
      }
    }

    scope.view.update()
  }

  /**
   * Resolve the drag rectangle from the start / current points, honoring the
   * Shift (constrain proportions) and Alt (draw from center) modifiers.
   */
  private resolveDragRect(
    point: paper.Point, modifiers: any
  ): paper.Rectangle {
    const scope = this.engine!.scope
    let dx = point.x - this.startPoint.x
    let dy = point.y - this.startPoint.y

    if (modifiers.shift) {
      // Constrain to a square / circle: both axes get the larger magnitude.
      const span = Math.max(Math.abs(dx), Math.abs(dy))
      dx = Math.sign(dx || 1) * span
      dy = Math.sign(dy || 1) * span
    }

    if (modifiers.alt) {
      // Draw from the center: the start point is the rect's center.
      const left = this.startPoint.x - dx
      const top = this.startPoint.y - dy
      return new scope.Rectangle(
        Math.min(left, this.startPoint.x + dx),
        Math.min(top, this.startPoint.y + dy),
        Math.abs(dx) * 2,
        Math.abs(dy) * 2
      )
    }

    return new scope.Rectangle(
      Math.min(this.startPoint.x, this.startPoint.x + dx),
      Math.min(this.startPoint.y, this.startPoint.y + dy),
      Math.abs(dx),
      Math.abs(dy)
    )
  }

  /** Snap the line end vector to the nearest 45° increment (Shift held). */
  private snapLineEnd(point: paper.Point): paper.Point {
    const scope = this.engine!.scope
    const rel = point.subtract(new scope.Point(this.startPoint.x, this.startPoint.y))
    const length = rel.length
    if (length < 1e-6) return point
    const oct = Math.round(Math.atan2(rel.y, rel.x) / (Math.PI / 4))
    const angle = oct * (Math.PI / 4)
    return new scope.Point(
      this.startPoint.x + Math.cos(angle) * length,
      this.startPoint.y + Math.sin(angle) * length
    )
  }

  private updatePreview(point: paper.Point, modifiers: any) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    this.removePreview()
    let shape: paper.Path | null = null
    if (this.shapeKind === 'line') {
      const end = modifiers.shift ? this.snapLineEnd(point) : point
      shape = this.createShape(
        this.shapeKind,
        this.startPoint.x, this.startPoint.y,
        end.x, end.y
      )
    } else {
      const rect = this.resolveDragRect(point, modifiers)
      shape = this.createShape(
        this.shapeKind,
        rect.left, rect.top,
        rect.right, rect.bottom
      )
    }

    if (shape) {
      shape.opacity = 0.7
      shape.data.isPreview = true
      const overlay = engine.getOverlayLayer()
      overlay.addChild(shape)
      this.previewShape = shape
    }
    scope.view.update()
  }

  private createShape(
    kind: LiveShapeParams['kind'],
    x1: number, y1: number, x2: number, y2: number
  ): paper.Path | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope

    const left = Math.min(x1, x2)
    const top = Math.min(y1, y2)
    const width = Math.abs(x2 - x1)
    const height = Math.abs(y2 - y1)

    let path: paper.Path | null = null

    switch (kind) {
      case 'rect': {
        path = new scope.Path.Rectangle(new scope.Rectangle(left, top, width, height)) as paper.Path
        break
      }
      case 'rounded-rect': {
        const radius = Math.min(width, height) * 0.2
        path = new scope.Path.Rectangle(
          new scope.Rectangle(left, top, width, height),
          new scope.Size(radius, radius)
        ) as paper.Path
        break
      }
      case 'ellipse': {
        path = new scope.Path.Ellipse(new scope.Rectangle(left, top, width, height)) as paper.Path
        break
      }
      case 'line': {
        path = new scope.Path.Line(new scope.Point(x1, y1), new scope.Point(x2, y2)) as paper.Path
        break
      }
      case 'polygon': {
        const sides = 5
        const cx = left + width / 2
        const cy = top + height / 2
        const radius = Math.max(width, height) / 2
        path = new scope.Path.RegularPolygon(new scope.Point(cx, cy), sides, radius) as paper.Path
        break
      }
      default: {
        path = new scope.Path.Rectangle(new scope.Rectangle(left, top, width, height)) as paper.Path
        break
      }
    }

    if (path) {
      const style = engine.store.style
      engine.applyStyleToItem(path, style)
    }
    return path
  }

  private removePreview() {
    if (this.previewShape) {
      this.previewShape.remove()
      this.previewShape = null
    }
  }

  private finishShape() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    // Commit the live preview itself so any modifier-derived geometry
    // (constrained proportions, from-center, 45° line snapping) is kept.
    const shape = this.previewShape
    if (shape && this.isValidShape(shape)) {
      const layer = engine.getActiveLayer()
      layer.addChild(shape)
      shape.data.id = engine.genId()
      shape.data.isUserItem = true
      delete shape.data.isPreview
      shape.opacity = 1
      engine.applyStyleToItem(shape, engine.store.style)
      engine.selectItem(shape)
      engine.pushHistory('Draw Shape')
      this.previewShape = null
    }

    this.removePreview()
    this.isDrawing = false
    scope.view.update()
  }

  /** Minimum size gate: lines only need length, area shapes need both axes. */
  private isValidShape(shape: paper.Path): boolean {
    if (this.shapeKind === 'line') {
      return shape.length > 0.5
    }
    const bounds = shape.bounds
    return bounds.width > 0.5 && bounds.height > 0.5
  }

  private cancelShape() {
    this.removePreview()
    this.isDrawing = false
    if (this.engine) {
      this.engine.scope.view.update()
    }
  }
}
