/**
 * Guide controller.
 *
 * Manages ruler-guide lines drawn on the dedicated guide layer.
 * Provides hit-testing, selection tracking, and visual styling for guides
 * so the Select tool can interact with them independently of artwork.
 *
 * Guide lines are long paper.Path items stored on the locked guide layer.
 * Because the layer is locked, all mutations temporarily unlock it.
 */
import { EditorEngine } from '../engine'

export class GuideController {
  engine: EditorEngine | null = null

  /** Set of selected guide ids. */
  private selectedIds: Set<string> = new Set()

  /** Colour used for a plain (unselected) guide. */
  private static readonly NORMAL_COLOR = '#00bcd4'
  /** Colour used for a selected guide. */
  private static readonly SELECTED_COLOR = '#ff6b6b'
  /** Hit tolerance in document units. */
  private static readonly HIT_TOLERANCE_PX = 5

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  /** Run a closure while the guide layer is temporarily unlocked. */
  private withGuideLayerUnlocked(fn: () => void) {
    const engine = this.engine
    if (!engine) return
    const layer = engine.getGuideLayer()
    if (!layer) return
    layer.locked = false
    fn()
    layer.locked = true
    engine.scope.view.update()
  }

  /** Check whether an item is a guide. */
  isGuide(item: any): boolean {
    return !!(item && item.data?.isGuide)
  }

  /**
   * Return the guide item near the given document point, or null.
   * Tolerance is converted from screen px to document units using current zoom.
   */
  hitTest(point: paper.Point): paper.Path | null {
    const engine = this.engine
    if (!engine || !engine.getGuideLayer()?.visible) return null
    const guides = engine.getGuides()
    if (guides.length === 0) return null
    const tol = GuideController.HIT_TOLERANCE_PX / engine.zoom

    for (const guide of guides) {
      if (!guide.visible) continue
      const orientation = engine.getGuideOrientation(guide)
      if (!orientation) continue
      const pos = engine.getGuidePosition(guide)
      const dist = orientation === 'horizontal'
        ? Math.abs(point.y - pos)
        : Math.abs(point.x - pos)
      if (dist <= tol) return guide
    }
    return null
  }

  /** True if any guide is currently selected. */
  hasSelection(): boolean {
    return this.selectedIds.size > 0
  }

  /** Return the selected guide items (in document order). */
  getSelectedGuides(): paper.Path[] {
    const engine = this.engine
    if (!engine) return []
    return engine.getGuides().filter((g) => this.selectedIds.has(g.data?.guideId as string))
  }

  /** Select a guide (optionally add to the current guide selection). */
  selectGuide(guide: paper.Path, additive = false) {
    if (!additive) {
      this.clearSelection()
    }
    const id = guide.data?.guideId as string
    this.selectedIds.add(id)
    this.updateVisuals()
  }

  /** Deselect every guide. */
  clearSelection() {
    if (this.selectedIds.size === 0) return
    this.selectedIds.clear()
    this.updateVisuals()
  }

  /** Style guide lines according to their selection state. */
  updateVisuals() {
    const engine = this.engine
    if (!engine) return
    const guides = engine.getGuides()
    this.withGuideLayerUnlocked(() => {
      guides.forEach((guide) => {
        const selected = this.selectedIds.has(guide.data?.guideId as string)
        guide.strokeColor = new engine.scope.Color(
          selected ? GuideController.SELECTED_COLOR : GuideController.NORMAL_COLOR
        )
        guide.strokeWidth = (selected ? 2 : 1) / engine.zoom
      })
    })
  }

  /** Delete all currently selected guides. Returns number deleted. */
  deleteSelectedGuides(): number {
    const engine = this.engine
    if (!engine) return 0
    const selected = this.getSelectedGuides()
    if (selected.length === 0) return 0

    this.withGuideLayerUnlocked(() => {
      selected.forEach((g) => g.remove())
    })
    this.selectedIds.clear()
    engine.pushHistory('Delete Guide')
    return selected.length
  }

  /** Deselect a single guide (e.g. when dragging it back to the ruler). */
  deselectGuide(guide: paper.Path) {
    const id = guide.data?.guideId as string
    if (this.selectedIds.delete(id)) {
      this.updateVisuals()
    }
  }
}
