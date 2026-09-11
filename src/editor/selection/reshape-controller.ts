/**
 * Reshape brush (AI Reshape-tool parity).
 *
 * Drag across artwork to push nearby anchors along with the pointer; pull
 * falls off smoothly to zero at the brush radius (120 document units, ring
 * preview while dragging) so strokes blend into the artwork. Locked and
 * hidden art never moves. Release records one history entry; Escape ends
 * the stroke the same way (use Undo to revert, the geometry edits live).
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'
import { reshapeFalloff } from '../geometry'

/** Brush radius in document units. */
const RESHAPE_RADIUS = 120

export class ReshapeController {
  engine: EditorEngine | null = null
  private dragging = false
  /** Mouse-up closure, replayed by deactivate when a drag is orphaned. */
  private finishRef: (() => void) | null = null
  private last: { x: number; y: number } | null = null
  private ring: paper.Path | null = null
  private moved = false

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.cancelStroke()
    this.setupTool()
    applyToolCursor(this.engine.canvas, 'reshape')
  }

  /**
   * Tool switch: the paper Tool is replaced so the drag's mouse-up never
   * arrives — finish the gesture instead of leaving a moved-but-unrecorded
   * selection (Escape-time finishing uses the same closure).
   */
  deactivate() {
    if (this.dragging) this.finishRef?.()
  }

  private setupTool() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    if (scope.tool) scope.tool.remove()
    new scope.Tool()

    scope.tool.onMouseDown = (event: paper.ToolEvent) => {
      const native = (event as any).event as MouseEvent
      if (native && native.button !== 0) return
      this.dragging = true
      this.moved = false
      this.last = { x: event.point.x, y: event.point.y }
      this.drawRing(event.point)
      engine.store.setDragging(true)
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.dragging || !this.last) return
      const dx = event.point.x - this.last.x
      const dy = event.point.y - this.last.y
      this.last = { x: event.point.x, y: event.point.y }
      if (Math.hypot(dx, dy) < 1e-9) return
      this.pushAnchors(event.point, dx, dy)
      this.drawRing(event.point)
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    const finish = () => {
      if (!this.dragging) return
      this.dragging = false
      this.last = null
      this.clearRing()
      engine.store.setDragging(false)
      if (this.moved) {
        engine.pushHistory('Reshape')
        this.moved = false
      }
    }
    scope.tool.onMouseUp = finish
    this.finishRef = finish

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      // Live geometry edits cannot roll back like a preview stroke, so
      // Escape finishes the stroke (Undo reverts) instead of cancelling.
      if (event.key === 'escape' && this.dragging) finish()
    }
    scope.view.update()
  }

  /** Push anchors near the cursor along by the pointer delta, with falloff. */
  private pushAnchors(center: paper.Point, dx: number, dy: number) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const area = new scope.Rectangle(
      center.x - RESHAPE_RADIUS, center.y - RESHAPE_RADIUS,
      RESHAPE_RADIUS * 2, RESHAPE_RADIUS * 2
    )
    const touched = new Set<paper.Path>()
    const walk = (node: paper.Item) => {
      if ((node as any).locked || (node as any).visible === false) return
      const data = (node as any).data ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard || data.annotation) return
      // Generated appearance/typography internals are off limits: reshaping
      // them would deform pattern tiles, pattern clip masks and the glyph
      // outlines of path text. Same exclusion list the other tools use
      // (select-controller.hitTest, eyedropper, snap-service, anchor tool).
      if (data.isPatternTile || data.isPatternFill || data.textMode) return
      if ((node as any).clipMask) return
      if (node instanceof scope.Path) {
        const bounds = (node as any).bounds as paper.Rectangle | undefined
        if (bounds && !bounds.intersects(area)) return
        for (const seg of node.segments) {
          const dist = Math.hypot(seg.point.x - center.x, seg.point.y - center.y)
          const f = reshapeFalloff(dist, RESHAPE_RADIUS)
          if (f <= 0) continue
          seg.point = seg.point.add(new scope.Point(dx * f, dy * f))
          touched.add(node)
          this.moved = true
        }
        return
      }
      const children = (node as any).children as paper.Item[] | undefined
      if (children) for (const child of children) walk(child)
    }
    for (const layer of scope.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      for (const child of layer.children) walk(child as paper.Item)
    }
    touched.forEach((path) => engine.refreshItemGradient(path))
    if (touched.size > 0) {
      engine.reflowTextsForItems([...touched])
      scope.view.update()
    }
  }

  private drawRing(center: paper.Point) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    this.clearRing()
    const ring = new scope.Path.Circle(center.clone(), RESHAPE_RADIUS) as paper.Path
    ring.strokeColor = new scope.Color('#4a90d9')
    ring.strokeWidth = 1 / scope.view.zoom
    ring.dashArray = [5 / scope.view.zoom, 4 / scope.view.zoom]
    ring.data.isPreview = true
    engine.getOverlayLayer().addChild(ring)
    this.ring = ring
    scope.view.update()
  }

  private clearRing() {
    if (this.ring) {
      this.ring.remove()
      this.ring = null
    }
    this.engine?.scope.view.update()
  }

  private cancelStroke() {
    this.dragging = false
    this.moved = false
    this.last = null
    this.clearRing()
    if (this.engine) {
      this.engine.store.setDragging(false)
      this.engine.scope.view.update()
    }
  }
}
