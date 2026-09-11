/**
 * Measure tool controller.
 *
 * Drag to measure: a dashed preview line follows the cursor while the
 * status bar reads out length (in the current ruler unit) and angle.
 * Nothing is committed to the document and no history is recorded;
 * releasing or Escape clears the preview.
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'
import { SnapService } from '../snap/snap-service'
import { rulerUnitFactor, snap45 } from '../geometry'

export class MeasureController {
  engine: EditorEngine | null = null
  snapService: SnapService = new SnapService()
  private isMeasuring = false
  private startPoint: { x: number; y: number } | null = null
  private previewLine: paper.Path | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
    this.snapService.attachEngine(engine)
  }

  activate() {
    if (!this.engine) return
    this.cancelMeasure()
    this.setupTool()
    applyToolCursor(this.engine.canvas, 'measure')
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
      const native = (event as any).event as MouseEvent | undefined
      if (!native || native.button !== 0 || this.isMeasuring) return
      // Both ends snap like the pen tool so measurements land on geometry.
      const snapped = this.snapService.snapPoint(event.point)
      this.startPoint = { x: snapped.x, y: snapped.y }
      this.isMeasuring = true
      engine.store.setDragging(true)
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isMeasuring || !this.startPoint) return
      let snapped = this.snapService.snapPoint(event.point)
      if (event.modifiers.shift) {
        // Shift constrains the leg to 45° increments about the start.
        const rel = snapped.subtract(new scope.Point(this.startPoint.x, this.startPoint.y))
        const fixed = snap45(rel as paper.Point, scope)
        snapped = new scope.Point(this.startPoint.x, this.startPoint.y).add(fixed as paper.Point)
      }
      this.updatePreview(snapped)
      this.reportReading(snapped)
    }

    scope.tool.onMouseUp = () => {
      if (!this.isMeasuring) return
      this.isMeasuring = false
      this.startPoint = null
      this.removePreview()
      engine.store.setDragging(false)
      engine.scope.view.update()
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      // Never steal keystrokes typed into panel inputs or dialogs.
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'escape' && this.isMeasuring) {
        this.cancelMeasure()
        engine.store.setDragging(false)
      }
    }

    scope.view.update()
  }

  /** Length readout converted from document units to the ruler unit. */
  private formatLength(docUnits: number): string {
    const engine = this.engine
    const unit = engine?.store.rulerUnit ?? 'px'
    const factor = rulerUnitFactor(unit)
    return `${Math.round(docUnits * factor * 10) / 10} ${unit}`
  }

  /** Dashed preview between the drag start and the cursor. */
  private updatePreview(point: paper.Point) {
    const engine = this.engine
    if (!engine || !this.startPoint) return
    const scope = engine.scope
    this.removePreview()
    const line = new scope.Path.Line(
      new scope.Point(this.startPoint.x, this.startPoint.y),
      point.clone()
    ) as paper.Path
    line.strokeColor = new scope.Color('#4a90d9')
    line.strokeWidth = 1 / scope.view.zoom
    line.dashArray = [4 / scope.view.zoom, 2 / scope.view.zoom]
    line.data.isPreview = true
    engine.getOverlayLayer().addChild(line)
    this.previewLine = line
    scope.view.update()
  }

  /** Status-bar readout for the current drag vector. */
  private reportReading(point: paper.Point) {
    const engine = this.engine
    if (!engine || !this.startPoint) return
    const dx = point.x - this.startPoint.x
    const dy = point.y - this.startPoint.y
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI
    engine.store.setCursorPos(point.x, point.y)
    engine.showStatus(`${this.formatLength(Math.hypot(dx, dy))} (${Math.round(angle * 10) / 10} deg)`)
  }

  /** Drop the preview without reporting. */
  private removePreview() {
    if (this.previewLine) {
      this.previewLine.remove()
      this.previewLine = null
    }
  }

  /** Cancel the in-progress measurement entirely. */
  private cancelMeasure() {
    this.removePreview()
    this.isMeasuring = false
    this.startPoint = null
    if (this.engine) {
      this.engine.store.setDragging(false)
      this.engine.scope.view.update()
    }
  }
}
