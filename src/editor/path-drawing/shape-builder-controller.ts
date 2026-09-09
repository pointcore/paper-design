/**
 * Shape Builder tool controller (Shift+M).
 *
 * Drag across overlapping shapes to unite them into one path; Alt-drag
 * subtracts everything else touched from the first shape the stroke hit.
 * A click without a drag is a no-op with a status hint. Live text, pattern
 * fills, clip groups and locked art are never operands. One history entry
 * covers the whole gesture (via the engine boolean pipeline).
 */
import { PaperOffset } from 'paperjs-offset'
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'

/** Stroke diameter in screen pixels (forgiving touch area, constant zoom). */
const STROKE_SCREEN_SIZE = 12

export class ShapeBuilderController {
  engine: EditorEngine | null = null
  private isDrawing = false
  private stroke: paper.Path | null = null
  private subtractMode = false

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.cancelStroke()
    this.setupTool()
    applyToolCursor(this.engine.canvas, 'shape-builder')
  }

  private diameter(): number {
    return STROKE_SCREEN_SIZE / (this.engine?.scope.view.zoom || 1)
  }

  private setupTool() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    if (scope.tool) {
      scope.tool.remove()
    }
    new scope.Tool()

    scope.tool.onMouseDown = (event: paper.ToolEvent) => {
      const native = (event as any).event as MouseEvent
      if (native && native.button !== 0) return
      if (this.isDrawing) return
      this.subtractMode = !!native?.altKey
      const stroke = new scope.Path() as paper.Path
      stroke.add(new scope.Segment(event.point.clone()))
      stroke.strokeColor = new scope.Color(this.subtractMode ? '#e5484d' : '#4a90d9')
      stroke.strokeWidth = this.diameter()
      stroke.strokeCap = 'round'
      stroke.strokeJoin = 'round'
      stroke.opacity = 0.85
      stroke.data.isPreview = true
      engine.getOverlayLayer().addChild(stroke)
      this.stroke = stroke
      this.isDrawing = true
      engine.store.setDragging(true)
      scope.view.update()
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isDrawing || !this.stroke) return
      const segments = this.stroke.segments
      const last = segments[segments.length - 1].point
      if (last.getDistance(event.point) < 1.5 / scope.view.zoom) return
      this.stroke.add(new scope.Segment(event.point.clone()))
      engine.store.setCursorPos(event.point.x, event.point.y)
      scope.view.update()
    }

    scope.tool.onMouseUp = () => {
      if (!this.isDrawing) return
      this.applyGesture()
      engine.store.setDragging(false)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'escape' && this.isDrawing) {
        this.cancelStroke()
        engine.store.setDragging(false)
      }
    }

    scope.view.update()
  }

  /** Unite or subtract the shapes touched by the finished stroke. */
  private applyGesture() {
    const engine = this.engine
    const stroke = this.stroke
    this.isDrawing = false
    this.stroke = null
    if (!engine || !stroke) return
    const subtract = this.subtractMode
    stroke.remove()

    let touch: paper.Path | paper.CompoundPath | null = null
    try {
      const radius = this.diameter() / 2
      if (stroke.segments.length < 2 || stroke.length < 1e-6) {
        engine.showStatus('Drag across shapes to merge (Alt-drag to subtract)')
        engine.scope.view.update()
        return
      }
      touch = PaperOffset.offsetStroke(stroke, radius, {
        join: 'round',
        cap: 'round',
        insert: false,
      }) as paper.Path | paper.CompoundPath
    } catch {
      touch = null
    }
    if (!touch) {
      engine.scope.view.update()
      return
    }

    const targets = this.collectTargets(touch)
    touch.remove()
    if (targets.length < 2) {
      engine.showStatus(
        targets.length === 0
          ? 'Shape Builder found no paths under the stroke'
          : 'Drag across at least two overlapping paths'
      )
      engine.scope.view.update()
      return
    }

    // Route through the tested boolean pipeline: select the touched shapes,
    // then unite (or subtract upper shapes from the bottom one, matching
    // the panel Subtract order).
    engine.clearSelection()
    targets.forEach((item) => {
      item.selected = true
    })
    engine.syncSelectionToStore()
    const ok = engine.booleanOperation(subtract ? 'subtract' : 'unite')
    if (!ok) {
      engine.clearSelection()
      engine.syncSelectionToStore()
      engine.showStatus('Shapes do not overlap — nothing to build')
      engine.scope.view.update()
    }
  }

  /**
   * Unlocked plain paths under user layers touched by the gesture shape.
   * Pattern fills, clip groups, path text and live text are skipped (their
   * structure would not survive a boolean rebuild).
   */
  private collectTargets(touch: paper.Item): Array<paper.Path | paper.CompoundPath> {
    const engine = this.engine
    if (!engine) return []
    const scope = engine.scope
    const out: Array<paper.Path | paper.CompoundPath> = []
    const seen = new Set<string>()
    const walk = (item: paper.Item) => {
      if ((item as any).locked) return
      const data = (item.data as any) ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.annotation) return
      if (data.isPatternTile || data.isPatternFill) return
      if (data.textMode) return
      if (item instanceof scope.Group) {
        const kids = (item as any).children as Array<any> | undefined
        if (kids && kids.some((k) => k && k.clipMask)) return
      }
      if (
        (item instanceof scope.Path || item instanceof scope.CompoundPath) &&
        data.id &&
        !seen.has(data.id as string)
      ) {
        try {
          const path = item as paper.PathItem
          if ((touch as paper.PathItem).intersects(path) || (path as any).intersects?.(touch)) {
            seen.add(data.id as string)
            out.push(item as paper.Path | paper.CompoundPath)
            return
          }
        } catch {
          // A stubborn pair never blocks the rest of the stroke.
        }
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

  /** Drop the in-progress stroke without touching the artwork. */
  private cancelStroke() {
    if (this.stroke) {
      this.stroke.remove()
      this.stroke = null
    }
    this.isDrawing = false
    if (this.engine) {
      this.engine.store.setDragging(false)
      this.engine.scope.view.update()
    }
  }
}
