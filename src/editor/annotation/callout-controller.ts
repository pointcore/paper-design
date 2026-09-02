/**
 * Callout annotation controller
 */
import { EditorEngine } from '../engine'

export class CalloutController {
  engine: EditorEngine | null = null
  private isDrawing = false
  private currentPath: paper.Path | null = null
  private points: paper.Point[] = []

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.setupTool()
  }

  private getNativeEvent(event: paper.ToolEvent): MouseEvent {
    return (event as any).event as MouseEvent
  }

  private setupTool() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    scope.tool.remove()

    scope.tool.onMouseDown = (event: paper.ToolEvent) => {
      const native = this.getNativeEvent(event)
      if (native.button !== 0) return

      const point = event.point

      if (!this.isDrawing) {
        this.isDrawing = true
        this.points = [point]

        const annotationLayer = engine.getAnnotationLayer()
        this.currentPath = new scope.Path() as paper.Path
        this.currentPath.strokeColor = new scope.Color('#333333')
        this.currentPath.strokeWidth = 1.5
        this.currentPath.strokeCap = 'round' as any
        annotationLayer.addChild(this.currentPath)
        this.currentPath.add(new scope.Segment(point))
      } else {
        this.points.push(point)
        this.currentPath?.add(new scope.Segment(point))
      }
      engine.store.setDragging(true)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (event.key === 'enter' || event.key === 'escape') {
        this.finishCallout()
      }
    }

    scope.tool.onMouseUp = () => {
      const native = this.getNativeEventFromUp()
      engine.store.setDragging(false)
    }

    scope.view.update()
  }

  private getNativeEventFromUp(): MouseEvent | null {
    return null
  }

  private finishCallout() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    if (!this.currentPath || this.points.length < 2) {
      if (this.currentPath) this.currentPath.remove()
      this.isDrawing = false
      this.points = []
      this.currentPath = null
      return
    }

    // Save
    const path = this.currentPath
    path.data.id = engine.genId()
    path.data.isUserItem = true
    path.data.annotation = true

    // Add the text label
    const lastPoint = this.points[this.points.length - 1]
    const style = engine.store.calloutStyle
    const text = new scope.PointText({
      point: new scope.Point(lastPoint.x + style.offset, lastPoint.y),
      content: 'Label',
      fontSize: style.fontSize,
      fillColor: style.textColor,
      fontFamily: style.fontFamily,
    }) as paper.PointText
    text.data.id = engine.genId()
    text.data.isUserItem = true
    text.data.annotation = true

    const annotationLayer = engine.getAnnotationLayer()
    annotationLayer.addChild(text)

    engine.pushHistory('Callout')
    this.isDrawing = false
    this.points = []
    this.currentPath = null
    scope.view.update()
  }
}
