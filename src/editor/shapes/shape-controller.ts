/**
 * Live shape tool controller
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
      this.updatePreview(event.point)
      engine.store.setCursorPos(event.point.x, event.point.y)
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

  private updatePreview(point: paper.Point) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    this.removePreview()
    this.previewShape = this.createShape(
      this.shapeKind,
      this.startPoint.x, this.startPoint.y,
      point.x, point.y
    )

    if (this.previewShape) {
      this.previewShape.opacity = 0.7
      this.previewShape.data.isPreview = true
      const overlay = engine.getOverlayLayer()
      overlay.addChild(this.previewShape)
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

    // Get the end point of the last update
    // Would need lastPoint stored; simplified by using previewShape bounds
    if (this.previewShape) {
      const bounds = this.previewShape.bounds
      const w = bounds.width
      const h = bounds.height
      if (w > 0.5 && h > 0.5) {
        // Create the final shape
        const shape = this.createShape(
          this.shapeKind,
          this.startPoint.x, this.startPoint.y,
          this.startPoint.x + w, this.startPoint.y + h
        )
        if (shape) {
          const layer = engine.getActiveLayer()
          layer.addChild(shape)
          shape.data.id = engine.genId()
          shape.data.isUserItem = true
          shape.opacity = 1
          // Apply the style
          const style = engine.store.style
          engine.applyStyleToItem(shape, style)
          // Select the shape
          engine.selectItem(shape)
          engine.pushHistory('Draw Shape')
        }
      }
    }

    this.removePreview()
    this.isDrawing = false
    scope.view.update()
  }

  private cancelShape() {
    this.removePreview()
    this.isDrawing = false
    if (this.engine) {
      this.engine.scope.view.update()
    }
  }
}
