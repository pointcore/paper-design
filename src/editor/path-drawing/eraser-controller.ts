/**
 * Eraser tool controller.
 *
 * Drag paints a fat preview stroke; on release the stroke expands into an
 * outline (round caps and joins via paperjs-offset, circular punch for
 * clicks) and is subtracted from every unlocked path it touches. One
 * history entry covers the whole drag; Escape cancels the preview without
 * touching the artwork. Live text is left alone.
 */
import { PaperOffset } from 'paperjs-offset'
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { ringCursor, setCanvasCursor } from '../cursors'

/** Fallback eraser diameter in screen pixels (store.brushSize wins). */
const ERASER_SCREEN_SIZE = 20

export class EraserController {
  engine: EditorEngine | null = null
  private isErasing = false
  private stroke: paper.Path | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  /** Screen-px footprint (store-driven, [ ] resizable). */
  brushScreenSize(): number {
    const n = Number((this.engine?.store as any)?.brushSize)
    return Number.isFinite(n) && n > 0 ? Math.min(200, Math.max(1, Math.round(n))) : ERASER_SCREEN_SIZE
  }

  /** Repaint the precision ring after a size change. */
  refreshCursor() {
    if (!this.engine) return
    setCanvasCursor(this.engine.canvas, ringCursor(this.brushScreenSize(), 'cell'))
  }

  activate() {
    if (!this.engine) return
    this.cancelStroke()
    this.setupTool()
    this.refreshCursor()
  }

  private getNativeEvent(event: paper.ToolEvent): MouseEvent | null {
    return ((event as any).event as MouseEvent) ?? null
  }

  /** Eraser diameter in document units at the current zoom. */
  private diameter(): number {
    const engine = this.engine
    return this.brushScreenSize() / (engine?.scope.view.zoom || 1)
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
      if (native && native.button !== 0) return
      if (this.isErasing) return
      const stroke = new scope.Path() as paper.Path
      stroke.add(new scope.Segment(event.point.clone()))
      stroke.strokeColor = new scope.Color('#e5484d')
      stroke.strokeWidth = this.diameter()
      stroke.strokeCap = 'round'
      stroke.strokeJoin = 'round'
      stroke.opacity = 0.85
      stroke.data.isPreview = true
      engine.getOverlayLayer().addChild(stroke)
      this.stroke = stroke
      this.isErasing = true
      engine.store.setDragging(true)
      scope.view.update()
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isErasing || !this.stroke) return
      const segments = this.stroke.segments
      const last = segments[segments.length - 1].point
      if (last.getDistance(event.point) < 1.5 / scope.view.zoom) return
      this.stroke.add(new scope.Segment(event.point.clone()))
      engine.store.setCursorPos(event.point.x, event.point.y)
      scope.view.update()
    }

    scope.tool.onMouseUp = () => {
      if (!this.isErasing) return
      this.applyErase()
      engine.store.setDragging(false)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      // Never steal keystrokes typed into panel inputs or dialogs.
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'escape' && this.isErasing) {
        this.cancelStroke()
        engine.store.setDragging(false)
      }
    }

    scope.view.update()
  }

  /** Subtract the finished stroke from every path it touches. */
  private applyErase() {
    const engine = this.engine
    const stroke = this.stroke
    this.isErasing = false
    this.stroke = null
    if (!engine || !stroke) return
    stroke.remove()

    let shape: paper.Path | paper.CompoundPath | null = null
    try {
      const radius = this.diameter() / 2
      if (stroke.segments.length < 2 || stroke.length < 1e-6) {
        const at = stroke.segments[0]?.point ?? new engine.scope.Point(0, 0)
        shape = new engine.scope.Path.Circle(at, radius) as paper.Path
      } else {
        shape = PaperOffset.offsetStroke(stroke, radius, {
          join: 'round',
          cap: 'round',
          insert: false,
        }) as paper.Path | paper.CompoundPath
      }
    } catch {
      shape = null
    }
    if (!shape) {
      engine.scope.view.update()
      return
    }

    const targets = this.collectTargets(shape)
    if (targets.length === 0) {
      shape.remove()
      engine.scope.view.update()
      return
    }

    const carved: paper.Item[] = []
    for (const target of targets) {
      try {
        const result = (target as paper.PathItem).subtract(shape as paper.PathItem, {
          insert: false,
        }) as paper.PathItem
        const parent = target.parent ?? engine.getActiveLayer()
        const rawAt = parent.children.indexOf(target)
        target.remove()
        if (this.isEmptyResult(result)) {
          result.remove()
          continue
        }
        parent.insertChild(Math.min(Math.max(rawAt, 0), parent.children.length), result as paper.Item)
        engine.refreshItemGradient(result as paper.Item)
        result.data.id = engine.genId()
        result.data.isUserItem = true
        carved.push(result as paper.Item)
      } catch {
        // One stubborn path never blocks the rest of the stroke.
      }
    }
    shape.remove()

    engine.clearSelection()
    carved.forEach((item) => {
      item.selected = true
    })
    engine.syncSelectionToStore()
    engine.pushHistory('Erase')
    engine.scope.view.update()
  }

  /** Unlocked paths under user layers whose bounds meet the eraser. */
  private collectTargets(shape: paper.Item): Array<paper.Path | paper.CompoundPath> {
    const engine = this.engine
    if (!engine) return []
    const scope = engine.scope
    const bounds = shape.bounds
    if (!bounds) return []
    const out: Array<paper.Path | paper.CompoundPath> = []
    const walk = (item: paper.Item) => {
      if ((item as any).locked) return
      const data = (item.data as any) ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.annotation) return
      if (
        (item instanceof scope.Path || item instanceof scope.CompoundPath) &&
        item.bounds?.intersects(bounds)
      ) {
        out.push(item as paper.Path | paper.CompoundPath)
        return
      }
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) walk(child)
      }
    }
    for (const layer of engine.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      for (const child of layer.children) walk(child as paper.Item)
    }
    return out
  }

  /** Whether a subtraction left no visible geometry behind. */
  private isEmptyResult(result: paper.PathItem): boolean {
    const scope = this.engine!.scope
    if (result instanceof scope.Path) return result.segments.length === 0
    if (result instanceof scope.CompoundPath) return result.children.length === 0
    return false
  }

  /** Drop the in-progress stroke without touching the artwork. */
  /**
   * Tool switch: the paper Tool is replaced so the gesture's mouse-up
   * never arrives — cancel the in-flight gesture (same cleanup as
   * Escape) instead of leaving its preview behind.
   */
  deactivate() {
    if (this.isErasing) this.cancelStroke()
  }

  private cancelStroke() {
    if (this.stroke) {
      this.stroke.remove()
      this.stroke = null
    }
    this.isErasing = false
    if (this.engine) {
      this.engine.store.setDragging(false)
      this.engine.scope.view.update()
    }
  }
}
