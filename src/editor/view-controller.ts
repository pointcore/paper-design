/**
 * View controller - zoom and pan
 */
import { EditorEngine } from './engine'

export class ViewController {
  engine: EditorEngine | null = null
  private mode: 'none' | 'pan' | 'zoom' = 'none'
  private lastPoint: { x: number; y: number } = { x: 0, y: 0 }
  private isZoomTool = false

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    const store = this.engine.store
    // Determine the current tool mode
    this.isZoomTool = store.tool === 'zoom'
    this.setupTool()
  }

  private setupTool() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    scope.tool.remove()

    scope.tool.onMouseDown = (event: paper.ToolEvent) => {
      const native = (event as any).event as MouseEvent
      
      if (this.isZoomTool) {
        // Zoom tool
        const point = engine.screenToCanvas(event.point)
        const zoomFactor = native.button === 2 || event.modifiers.alt ? 0.8 : 1.2
        engine.zoomAt(zoomFactor, event.point.x, event.point.y)
      } else {
        // Hand / pan
        this.mode = 'pan'
        this.lastPoint = { x: event.point.x, y: event.point.y }
      }
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (this.mode === 'pan') {
        const dx = event.point.x - this.lastPoint.x
        const dy = event.point.y - this.lastPoint.y
        engine.panBy(dx, dy)
        this.lastPoint = { x: event.point.x, y: event.point.y }
      }
    }

    scope.tool.onMouseUp = () => {
      this.mode = 'none'
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (event.key === 'space') {
        this.mode = 'pan'
      }
    }

    scope.tool.onKeyUp = (event: paper.KeyEvent) => {
      if (event.key === 'space') {
        this.mode = 'none'
      }
    }

    scope.view.update()
  }
}
