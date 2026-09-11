/**
 * Smooth brush (AI Smooth-tool parity).
 *
 * Drag along a path to round the segments the pointer passes: a moving
 * window around the nearest segment is re-smoothed continuously, so
 * hand-drawn corners melt into curves. Locked/hidden art and generated
 * internals (pattern tiles, pattern fills, path-text glyphs) are off
 * limits, like every other edit tool. Release records one history entry;
 * Escape finishes the stroke the same way (use Undo to revert, the
 * geometry edits live).
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'

/** Number of segments smoothed on either side of the nearest one. */
const SMOOTH_WINDOW = 3

export class SmoothController {
  engine: EditorEngine | null = null
  private dragging = false
  /** Mouse-up closure, replayed by deactivate when a drag is orphaned. */
  private finishRef: (() => void) | null = null
  private moved = false

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.cancelStroke()
    this.setupTool()
    applyToolCursor(this.engine.canvas, 'smooth')
  }

  /**
   * Tool switch: the paper Tool is replaced so the drag's mouse-up never
   * arrives — finish the gesture instead of leaving a smoothed-but-
   * unrecorded path.
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
      engine.store.setDragging(true)
      this.smoothAt(event.point)
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.dragging) return
      this.smoothAt(event.point)
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    const finish = () => {
      if (!this.dragging) return
      this.dragging = false
      engine.store.setDragging(false)
      if (this.moved) {
        engine.pushHistory('Smooth')
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
      if (event.key === 'escape' && this.dragging) finish()
    }
    scope.view.update()
  }

  /** Smooth a moving window around the segment nearest the pointer. */
  private smoothAt(point: paper.Point) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const tol = 8 / (scope.view.zoom || 1)
    const hit = engine.project.hitTest(point, {
      stroke: true,
      fill: false,
      segments: false,
      tolerance: tol,
    })
    const path = this.smoothablePath(hit?.item as paper.Item | undefined)
    if (!path || path.segments.length < 3) return
    const location = path.getNearestLocation(point)
    if (!location) return
    // CurveLocation exposes the segment index via its segment (identity
    // lookup — paper's typings have no index accessor).
    const segment = location.segment
    const index = path.segments.indexOf(segment)
    const from = Math.max(0, index - SMOOTH_WINDOW)
    const to = Math.min(path.segments.length - 1, index + SMOOTH_WINDOW)
    if (to - from < 2) return
    path.smooth({ from, to, type: 'continuous' })
    engine.refreshItemGradient(path)
    this.moved = true
    scope.view.update()
  }

  /** Resolve the editable user path under a hit (same exclusions as reshape). */
  private smoothablePath(item: paper.Item | undefined): paper.Path | null {
    const engine = this.engine
    if (!engine || !item) return null
    const scope = engine.scope
    let node: paper.Item | null = item
    while (node && !(node instanceof scope.Path)) {
      const data = (node.data as any) ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard) return null
      node = node.parent
    }
    if (!node) return null
    const data = (node.data as any) ?? {}
    if ((node as any).locked || (node as any).visible === false) return null
    if (data.isPatternTile || data.isPatternFill || data.textMode || data.annotation) return null
    if ((node as any).clipMask) return null
    if (node instanceof scope.CompoundPath) return null
    return node as paper.Path
  }

  private cancelStroke() {
    this.dragging = false
    this.moved = false
    if (this.engine) {
      this.engine.store.setDragging(false)
      this.engine.scope.view.update()
    }
  }
}
