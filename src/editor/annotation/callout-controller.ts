/**
 * Callout annotation controller
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'
import { SnapService } from '../snap/snap-service'

export class CalloutController {
  engine: EditorEngine | null = null
  snapService: SnapService = new SnapService()
  private isDrawing = false
  private currentPath: paper.Path | null = null
  private points: paper.Point[] = []

  attachEngine(engine: EditorEngine) {
    this.engine = engine
    this.snapService.attachEngine(engine)
  }

  activate() {
    if (!this.engine) return
    // Commit an in-progress draft on real tool switches (transient
    // space-pan / zoom returns keep drafting).
    const lastTool = this.engine.store.lastTool
    if (this.isDrawing && lastTool !== 'view-hand' && lastTool !== 'zoom') {
      this.finishCallout()
    }
    applyToolCursor(this.engine.canvas, 'callout')
    this.setupTool()
  }

  private getNativeEvent(event: paper.ToolEvent): MouseEvent {
    return (event as any).event as MouseEvent
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

      const point = this.snapService.snapPoint(event.point)

      if (!this.isDrawing) {
        this.isDrawing = true
        this.points = [point]

        const annotationLayer = engine.getAnnotationLayer()
        const style = engine.store.calloutStyle
        this.currentPath = new scope.Path() as paper.Path
        this.currentPath.strokeColor = new scope.Color(style.color)
        this.currentPath.strokeWidth = style.lineWidth
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
      // Never steal keystrokes typed into panel inputs or dialogs.
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'enter' || event.key === 'escape') {
        this.finishCallout()
      }
    }

    scope.tool.onMouseUp = () => {
      engine.store.setDragging(false)
    }

    scope.view.update()
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
