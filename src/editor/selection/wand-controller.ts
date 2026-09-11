/**
 * Magic wand tool (AI Magic Wand parity).
 *
 * Click artwork to select every unlocked leaf sharing its fill color.
 * Tolerance (RGB distance, 0 = exact) comes from the store ControlBar
 * slider. Shift-click adds to the selection instead of replacing it.
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'

export class WandController {
  engine: EditorEngine | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.setupTool()
    applyToolCursor(this.engine.canvas, 'wand')
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
      const additive = !!native?.shiftKey
      const top = this.pickTop(event.point)
      if (!top) {
        if (!additive) {
          engine.clearSelection()
          engine.store.setStatusMessage('Wand found nothing')
        }
        return
      }
      // Additive (Shift) must not clear first: selectItem() defaults to a
      // replacing selection, which left selectSame() nothing to add to.
      engine.selectItem(top, additive)
      const tol = Number((engine.store as any).wandTolerance) || 0
      const n = engine.selectSame('fill', additive, tol)
      engine.store.setStatusMessage(
        `Wand selected ${n} item${n === 1 ? '' : 's'} with the same fill${tol > 0 ? ` (±${Math.round(tol)})` : ''}`
      )
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      // No in-progress state to cancel; Escape is owned by tool-level flows.
    }
    scope.view.update()
  }

  /**
   * Topmost unlocked user item under the point (user layers top-first,
   * children front-first), or null. Chrome, guides, artboard sheets and
   * previews never match.
   */
  private pickTop(point: paper.Point): paper.Item | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const layers = engine.project.layers.filter((l) => (l.data as any)?.isUserLayer && l.visible)
    for (let li = layers.length - 1; li >= 0; li--) {
      const kids = layers[li].children
      for (let ci = kids.length - 1; ci >= 0; ci--) {
        const hit = this.hitTree(kids[ci] as paper.Item, point, scope)
        if (hit) return hit
      }
    }
    return null
  }

  private hitTree(item: paper.Item, point: paper.Point, scope: paper.PaperScope): paper.Item | null {
    const data = (item as any).data ?? {}
    if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard || data.annotation) return null
    if ((item as any).visible === false || (item as any).locked) return null
    if (item instanceof scope.Group) {
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (let i = children.length - 1; i >= 0; i--) {
          const hit = this.hitTree(children[i], point, scope)
          if (hit) return item
        }
      }
      return null
    }
    try {
      const r = (item as paper.Item).hitTest(point, {
        fill: true,
        stroke: true,
        segments: false,
        tolerance: 4 / scope.view.zoom,
      } as any)
      return r ? item : null
    } catch {
      return null
    }
  }
}
