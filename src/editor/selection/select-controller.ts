/**
 * Selection controller
 */
import { EditorEngine } from '../engine'

export class SelectController {
  engine: EditorEngine | null = null
  private isDragging = false
  private isMarquee = false
  private dragStart: { x: number; y: number } = { x: 0, y: 0 }
  private dragItems: paper.Item[] = []
  private marqueeRect: paper.Path | null = null
  private marqueeLayer: paper.Layer | null = null

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
      if (native.button === 1 || native.button === 2) return

      const hitResult = this.hitTest(event.point)

      if (hitResult) {
        const item = hitResult.item
        engine.store.setDragging(true)

        if (!item.selected && !event.modifiers.shift) {
          engine.clearSelection()
          engine.selectItem(item, false)
        } else if (event.modifiers.shift && item.selected) {
          item.selected = false
          engine.syncSelectionToStore()
          this.isDragging = false
          return
        } else if (event.modifiers.shift) {
          engine.selectItem(item, true)
        }

        this.isDragging = true
        this.dragItems = engine.getSelection()
        this.dragStart = { x: event.point.x, y: event.point.y }
      } else {
        engine.clearSelection()
        this.isMarquee = true
        this.dragStart = { x: event.point.x, y: event.point.y }
        this.createMarquee(event.point.x, event.point.y)
        engine.store.setDragging(true)
      }
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      const store = engine.store
      if (this.isMarquee) {
        this.updateMarquee(event.point.x, event.point.y)
      } else if (this.isDragging && this.dragItems.length > 0) {
        const delta = new scope.Point(
          event.point.x - this.dragStart.x,
          event.point.y - this.dragStart.y
        )
        this.dragItems.forEach((item) => {
          if (!item.locked) {
            item.position = (item.position as paper.Point).add(delta)
          }
        })
        this.dragStart = { x: event.point.x, y: event.point.y }
        scope.view.update()
      }
      store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onMouseUp = () => {
      if (this.isMarquee) {
        this.finishMarquee()
        this.isMarquee = false
        this.removeMarquee()
      } else if (this.isDragging) {
        this.isDragging = false
        engine.pushHistory('Move')
      }
      engine.store.setDragging(false)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      switch (event.key) {
        case 'delete':
        case 'backspace':
          engine.deleteSelected()
          break
        case 'escape':
          engine.clearSelection()
          break
        case 'c':
          if (event.modifiers.command) engine.copySelected()
          break
        case 'd':
          if (event.modifiers.command) engine.duplicateSelected()
          break
      }
    }

    scope.view.update()
  }

  private hitTest(point: paper.Point): paper.HitResult | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const hitResult = engine.project.hitTest(point, {
      fill: true,
      stroke: true,
      segments: false,
      tolerance: 3 / scope.view.zoom,
    })
    return hitResult as paper.HitResult
  }

  private createMarquee(x: number, y: number) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    if (!this.marqueeLayer) {
      this.marqueeLayer = new scope.Layer()
      this.marqueeLayer.name = 'marquee-layer'
      this.marqueeLayer.locked = true
      this.marqueeLayer.data.isUserLayer = false
    }

    this.marqueeRect = new scope.Path.Rectangle({
      from: [x, y],
      to: [x, y],
      strokeColor: '#4a90d9',
      strokeWidth: 1 / scope.view.zoom,
      dashArray: [4 / scope.view.zoom, 2 / scope.view.zoom],
      fillColor: 'rgba(74, 144, 217, 0.1)',
    }) as paper.Path
    this.marqueeLayer.addChild(this.marqueeRect)
    this.marqueeLayer.bringToFront()
  }

  private updateMarquee(x: number, y: number) {
    if (!this.marqueeRect || !this.engine) return
    const scope = this.engine.scope
    const p1 = this.dragStart
    const rect = new scope.Rectangle(
      Math.min(p1.x, x), Math.min(p1.y, y),
      Math.abs(x - p1.x), Math.abs(y - p1.y)
    )
    this.marqueeRect.remove()
    this.marqueeRect = new scope.Path.Rectangle({
      from: [rect.x, rect.y],
      to: [rect.x + rect.width, rect.y + rect.height],
      strokeColor: '#4a90d9',
      strokeWidth: 1 / scope.view.zoom,
      dashArray: [4 / scope.view.zoom, 2 / scope.view.zoom],
      fillColor: 'rgba(74, 144, 217, 0.1)',
    }) as paper.Path
    this.marqueeLayer?.addChild(this.marqueeRect)
    scope.view.update()
  }

  private finishMarquee() {
    const engine = this.engine
    if (!engine || !this.marqueeRect) return
    const scope = engine.scope
    const bounds = this.marqueeRect.bounds

    const rectInProject = new scope.Rectangle(
      bounds.x - engine.center.x,
      bounds.y - engine.center.y,
      bounds.width,
      bounds.height
    )

    const userLayers = engine.project.layers.filter((l) => (l.data as any)?.isUserLayer)
    userLayers.forEach((layer) => {
      if (!layer.visible || layer.locked) return
      layer.children.forEach((child: any) => {
        if (!child.visible) return
        if (rectInProject.intersects(child.bounds)) {
          child.selected = true
        }
      })
    })
    engine.syncSelectionToStore()
  }

  private removeMarquee() {
    if (this.marqueeRect) {
      this.marqueeRect.remove()
      this.marqueeRect = null
    }
    if (this.marqueeLayer) {
      this.marqueeLayer.remove()
      this.marqueeLayer = null
    }
    this.engine?.scope.view.update()
  }
}
