/**
 * Calligraphic brush controller.
 *
 * Drag paints a centerline preview; on release a flat-nib ribbon is built
 * around it: the half-width follows the angle between the stroke tangent
 * and the fixed nib direction (full width across the nib, hairline along
 * it), modulated by pointer pressure when a pen reports it (plain mouse
 * input paints at full width). The ribbon commits as one filled shape in
 * the stroke color with a single history entry. Taps paint dots and
 * Escape cancels the preview.
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'

/** Nib width in screen pixels (stays constant across zoom). */
const NIB_SCREEN_SIZE = 20
/** Nib direction in degrees (flat nib resting angle). */
const NIB_ANGLE = 45
/** Hairline floor as a fraction of the full half-width. */
const HAIRLINE_FLOOR = 0.15

export class BrushController {
  engine: EditorEngine | null = null
  private isPainting = false
  private stroke: paper.Path | null = null
  private pressures: number[] = []

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.cancelStroke()
    this.setupTool()
    this.engine.canvas.style.cursor = 'crosshair'
  }

  private getNativeEvent(event: paper.ToolEvent): PointerEvent | null {
    return ((event as any).event as PointerEvent) ?? null
  }

  /** Nib width in document units at the current zoom. */
  private nibWidth(): number {
    const engine = this.engine
    return NIB_SCREEN_SIZE / (engine?.scope.view.zoom || 1)
  }

  /** Effective pressure: mice report 0 / 0.5 and paint at full width. */
  private readPressure(event: paper.ToolEvent): number {
    const raw = this.getNativeEvent(event)?.pressure ?? 0.5
    return raw === 0 || raw === 0.5 ? 1 : Math.min(1, Math.max(0, raw))
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
      if (this.isPainting) return
      const stroke = new scope.Path() as paper.Path
      stroke.add(new scope.Segment(event.point.clone()))
      this.pressures = [this.readPressure(event)]
      stroke.strokeColor = new scope.Color(engine.store.style.strokeColor || '#000000')
      stroke.strokeWidth = this.nibWidth()
      stroke.strokeCap = 'round'
      stroke.strokeJoin = 'round'
      stroke.opacity = 0.85
      stroke.data.isPreview = true
      engine.getOverlayLayer().addChild(stroke)
      this.stroke = stroke
      this.isPainting = true
      engine.store.setDragging(true)
      scope.view.update()
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isPainting || !this.stroke) return
      const segments = this.stroke.segments
      const last = segments[segments.length - 1].point
      if (last.getDistance(event.point) < 1.5 / scope.view.zoom) return
      this.stroke.add(new scope.Segment(event.point.clone()))
      this.pressures.push(this.readPressure(event))
      engine.store.setCursorPos(event.point.x, event.point.y)
      scope.view.update()
    }

    scope.tool.onMouseUp = () => {
      if (!this.isPainting) return
      this.commitStroke()
      engine.store.setDragging(false)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      // Never steal keystrokes typed into panel inputs or dialogs.
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'escape' && this.isPainting) {
        this.cancelStroke()
        engine.store.setDragging(false)
      }
    }

    scope.view.update()
  }

  /** Build the nib ribbon and commit it as one filled shape. */
  private commitStroke() {
    const engine = this.engine
    const stroke = this.stroke
    const pressures = this.pressures
    this.isPainting = false
    this.stroke = null
    this.pressures = []
    if (!engine || !stroke) return
    stroke.remove()

    const scope = engine.scope
    const nib = this.nibWidth()
    let ribbon: paper.Path | null = null
    if (stroke.segments.length >= 2 && stroke.length >= 1e-6) {
      ribbon = this.buildRibbon(
        stroke.segments.map((seg) => seg.point.clone()),
        pressures,
        nib
      )
    } else {
      // A tap paints a dot like the blob brush.
      const at = stroke.segments[0]?.point ?? new scope.Point(0, 0)
      ribbon = new scope.Path.Circle(at, nib / 2) as paper.Path
    }
    if (!ribbon) {
      engine.scope.view.update()
      return
    }

    ribbon.fillColor = new scope.Color(
      engine.store.style.strokeColor || engine.store.style.fillColor || '#000000'
    )
    ribbon.strokeColor = null
    ribbon.opacity = engine.store.style.opacity
    const layer = engine.getActiveLayer()
    layer.addChild(ribbon)
    ribbon.data.id = engine.genId()
    ribbon.data.isUserItem = true
    engine.selectItem(ribbon)
    engine.pushHistory('Brush')
    engine.scope.view.update()
  }

  /**
   * Flat-nib ribbon around centerline points: each edge pair sits on the
   * tangent normal, scaled by the nib projection (sine of the angle to
   * the nib direction, floored to a hairline) and the sample pressure.
   */
  private buildRibbon(
    points: paper.Point[],
    pressures: number[],
    nib: number
  ): paper.Path | null {
    const engine = this.engine
    if (!engine || points.length < 2) return null
    const scope = engine.scope
    const nibDir = new scope.Point(
      Math.cos((NIB_ANGLE * Math.PI) / 180),
      Math.sin((NIB_ANGLE * Math.PI) / 180)
    )
    const left: paper.Point[] = []
    const right: paper.Point[] = []
    for (let i = 0; i < points.length; i++) {
      const prev = points[Math.max(0, i - 1)]
      const next = points[Math.min(points.length - 1, i + 1)]
      const tangent = next.subtract(prev)
      if (tangent.length < 1e-9) continue
      const direction = tangent.normalize()
      // Sine of the angle between tangent and nib: 1 across, 0 along.
      const cross = Math.abs(direction.x * nibDir.y - direction.y * nibDir.x)
      const pressure = pressures[i] ?? 1
      const half = (nib / 2) * (HAIRLINE_FLOOR + (1 - HAIRLINE_FLOOR) * cross) * (0.3 + 0.7 * pressure)
      const normal = new scope.Point(-direction.y, direction.x)
      left.push(points[i].add(normal.multiply(half)))
      right.push(points[i].add(normal.multiply(-half)))
    }
    if (left.length < 2) return null
    const ribbon = new scope.Path() as paper.Path
    for (const point of left) ribbon.add(new scope.Segment(point))
    for (let i = right.length - 1; i >= 0; i--) ribbon.add(new scope.Segment(right[i]))
    ribbon.closed = true
    return ribbon
  }

  /** Drop the in-progress stroke without painting. */
  private cancelStroke() {
    if (this.stroke) {
      this.stroke.remove()
      this.stroke = null
    }
    this.pressures = []
    this.isPainting = false
    if (this.engine) {
      this.engine.store.setDragging(false)
      this.engine.scope.view.update()
    }
  }
}
