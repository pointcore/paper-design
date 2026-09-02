/**
 * Pen tool controller
 */
import { EditorEngine } from '../engine'

export class PenController {
  engine: EditorEngine | null = null
  private isDrawing = false
  private currentPath: paper.Path | null = null
  private lastPoint: { x: number; y: number } = { x: 0, y: 0 }
  private previewPath: paper.Path | null = null
  private isCurvatureMode = false
  private dragStartPos: { x: number; y: number } = { x: 0, y: 0 }
  private hasDragged = false

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.isCurvatureMode = this.engine.store.tool === 'curvature'
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
      if (native.button === 2) {
        this.finishPath()
        return
      }
      if (native.button === 1) return

      const point = event.point

      if (!this.isDrawing) {
        this.startNewPath()
        this.hasDragged = false
        this.dragStartPos = { x: point.x, y: point.y }
      }
      
      // Add anchor point
      this.addSegment(point, event)
      engine.store.setDragging(true)
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isDrawing || !this.currentPath) return
      
      this.hasDragged = true
      const point = event.point

      // Update the handle of the last segment
      const segments = this.currentPath.segments
      if (segments.length >= 2) {
        const lastSeg = segments[segments.length - 1]
        const prevSeg = segments[segments.length - 2]
        
        if (this.isCurvatureMode) {
          // Curvature mode: auto-compute smooth handles
          const dir = new scope.Point(
            point.x - lastSeg.point.x,
            point.y - lastSeg.point.y
          )
          const len = dir.length
          if (len > 0) {
            const handleLen = len * 0.33
            const angle = dir.angle * Math.PI / 180
            lastSeg.handleOut = new scope.Point(
              Math.cos(angle) * handleLen,
              Math.sin(angle) * handleLen
            )
            prevSeg.handleIn = new scope.Point(
              -Math.cos(angle) * handleLen,
              -Math.sin(angle) * handleLen
            )
          }
        } else {
          // Pen mode: drag to create curve handles
          const handle = new scope.Point(
            point.x - lastSeg.point.x,
            point.y - lastSeg.point.y
          )
          if (segments.length >= 2) {
            lastSeg.handleOut = handle
            // Mirror handleIn
            const scaleHandle = new scope.Point(-handle.x, -handle.y)
            prevSeg.handleIn = scaleHandle
          }
        }
      }
      scope.view.update()
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
      if (this.isDrawing && this.currentPath) {
        this.updatePreview(event.point)
      }
    }

    scope.tool.onMouseUp = () => {
      const native = this.getNativeEventFromLast()
      if (native && native.detail === 2) {
        // Double-click to finish
        this.finishPath()
      }
      engine.store.setDragging(false)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      switch (event.key) {
        case 'escape':
          if (this.isDrawing) {
            this.finishPath()
          } else {
            engine.clearSelection()
          }
          break
        case 'enter':
          this.finishPath()
          break
      }
    }

    scope.view.update()
  }

  private getNativeEventFromLast(): MouseEvent | null {
    return null
  }

  private startNewPath() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    const layer = engine.getActiveLayer()
    this.isDrawing = true
    this.currentPath = new scope.Path() as paper.Path
    layer.addChild(this.currentPath)

    const style = engine.store.style
    engine.applyStyleToItem(this.currentPath, style)
  }

  private addSegment(point: paper.Point, event: paper.ToolEvent) {
    if (!this.currentPath) return
    const scope = this.engine!.scope

    // Constrain to 45 degrees while holding Shift
    if (event.modifiers.shift) {
      const segments = this.currentPath.segments
      if (segments.length > 0) {
        const prev = segments[segments.length - 1].point
        const dx = point.x - prev.x
        const dy = point.y - prev.y
        const angle = Math.atan2(dy, dx)
        const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4)
        const len = Math.sqrt(dx * dx + dy * dy)
        point = new scope.Point(
          prev.x + Math.cos(snapped) * len,
          prev.y + Math.sin(snapped) * len
        )
      }
    }

    this.clearPreview()
    this.currentPath.add(new scope.Segment(point))
    this.lastPoint = { x: point.x, y: point.y }
    scope.view.update()
  }

  private updatePreview(point: paper.Point) {
    if (!this.currentPath) return
    const engine = this.engine!
    const scope = engine.scope

    this.clearPreview()

    const segments = this.currentPath.segments
    if (segments.length === 0) return

    // Draw from the last anchor to the mouse position
    const last = segments[segments.length - 1].point
    this.previewPath = new scope.Path()
    this.previewPath.strokeColor = new scope.Color('#4a90d9')
    this.previewPath.strokeWidth = 1 / scope.view.zoom
    this.previewPath.dashArray = [4 / scope.view.zoom, 2 / scope.view.zoom]
    this.previewPath.strokeCap = 'round' as any
    this.previewPath.data.isPreview = true
    this.previewPath.add(new scope.Segment(last))
    this.previewPath.add(new scope.Segment(point))

    const overlayLayer = engine.getOverlayLayer()
    overlayLayer.addChild(this.previewPath)
    scope.view.update()
  }

  private clearPreview() {
    if (this.previewPath) {
      this.previewPath.remove()
      this.previewPath = null
    }
  }

  private finishPath() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    this.clearPreview()

    if (this.currentPath) {
      const path = this.currentPath
      if (path.segments.length >= 2) {
        // Check whether the path should be closed
        const first = path.segments[0]
        const last = path.segments[path.segments.length - 1]
        const dist = first.point.getDistance(last.point)
        if (dist < 8 / scope.view.zoom) {
          path.closed = true
        }
        path.data.id = engine.genId()
        path.data.isUserItem = true
        engine.pushHistory('Pen Path')
      } else if (path.segments.length <= 1) {
        path.remove()
      }
      this.currentPath = null
    }

    this.isDrawing = false
    scope.view.update()
  }
}
