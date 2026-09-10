/**
 * Live shape tool controller.
 *
 * Drag draws a live preview on the overlay layer. Modifier keys match the
 * Illustrator / CorelDRAW conventions:
 * - Shift constrains rectangles / rounded rectangles / ellipses to square /
 *   circle proportions and snaps line segments to 45° increments.
 * - Alt (Option) draws from the center: the start point stays the shape's
 *   center instead of its corner.
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { SnapService } from '../snap/snap-service'
import { applyToolCursor } from '../cursors'
import type { LiveShapeParams } from '../types'

export class ShapeController {
  engine: EditorEngine | null = null
  snapService: SnapService = new SnapService()
  private isDrawing = false
  private startPoint: { x: number; y: number } = { x: 0, y: 0 }
  private previewShape: paper.Item | null = null
  private shapeKind: LiveShapeParams['kind'] = 'rect'

  attachEngine(engine: EditorEngine) {
    this.engine = engine
    this.snapService.attachEngine(engine)
  }

  activate() {
    if (!this.engine) return
    this.shapeKind = this.getShapeKind()
    // A mid-drag tool switch must not orphan the overlay preview.
    this.cancelShape()
    applyToolCursor(this.engine.canvas, this.engine.store.tool)
    this.setupTool()
  }

  private getNativeEvent(event: paper.ToolEvent): MouseEvent {
    return (event as any).event as MouseEvent
  }

  private getShapeKind(): LiveShapeParams['kind'] {
    const tool = this.engine!.store.tool
    switch (tool) {
      case 'rect': return 'rect'
      case 'rounded-rect': return 'rounded-rect'
      case 'ellipse': return 'ellipse'
      case 'polygon': return 'polygon'
      case 'arc': return 'arc'
      case 'line': return 'line'
      case 'spiral': return 'spiral'
      case 'rect-grid': return 'rect-grid'
      case 'polar-grid': return 'polar-grid'
      default: return 'rect'
    }
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
      if (native.button !== 0) return
      const snapped = this.snapService.snapPoint(event.point)
      this.startPoint = { x: snapped.x, y: snapped.y }
      this.isDrawing = true
      engine.store.setDragging(true)
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isDrawing) return
      const snapped = this.snapService.snapPoint(event.point)
      this.updatePreview(snapped, event.modifiers)
      engine.store.setCursorPos(snapped.x, snapped.y)
    }

    scope.tool.onMouseUp = () => {
      if (!this.isDrawing) return
      this.finishShape()
      engine.store.setDragging(false)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      // Never steal keystrokes typed into panel inputs or dialogs.
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'escape' && this.isDrawing) {
        this.cancelShape()
        engine.store.setDragging(false)
      }
    }

    scope.view.update()
  }

  /**
   * Resolve the drag rectangle from the start / current points, honoring the
   * Shift (constrain proportions) and Alt (draw from center) modifiers.
   */
  private resolveDragRect(
    point: paper.Point, modifiers: any
  ): paper.Rectangle {
    const scope = this.engine!.scope
    let dx = point.x - this.startPoint.x
    let dy = point.y - this.startPoint.y

    if (modifiers.shift) {
      // Constrain to a square / circle: both axes get the larger magnitude.
      const span = Math.max(Math.abs(dx), Math.abs(dy))
      dx = Math.sign(dx || 1) * span
      dy = Math.sign(dy || 1) * span
    }

    if (modifiers.alt) {
      // Draw from the center: the start point is the rect's center.
      const left = this.startPoint.x - dx
      const top = this.startPoint.y - dy
      return new scope.Rectangle(
        Math.min(left, this.startPoint.x + dx),
        Math.min(top, this.startPoint.y + dy),
        Math.abs(dx) * 2,
        Math.abs(dy) * 2
      )
    }

    return new scope.Rectangle(
      Math.min(this.startPoint.x, this.startPoint.x + dx),
      Math.min(this.startPoint.y, this.startPoint.y + dy),
      Math.abs(dx),
      Math.abs(dy)
    )
  }

  /** Snap the line end vector to the nearest 45° increment (Shift held). */
  private snapLineEnd(point: paper.Point): paper.Point {
    const scope = this.engine!.scope
    const rel = point.subtract(new scope.Point(this.startPoint.x, this.startPoint.y))
    const length = rel.length
    if (length < 1e-6) return point
    const oct = Math.round(Math.atan2(rel.y, rel.x) / (Math.PI / 4))
    const angle = oct * (Math.PI / 4)
    return new scope.Point(
      this.startPoint.x + Math.cos(angle) * length,
      this.startPoint.y + Math.sin(angle) * length
    )
  }

  private updatePreview(point: paper.Point, modifiers: any) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    this.removePreview()
    let shape: paper.Item | null = null
    if (this.shapeKind === 'line') {
      const end = modifiers.shift ? this.snapLineEnd(point) : point
      shape = this.createShape(
        this.shapeKind,
        this.startPoint.x, this.startPoint.y,
        end.x, end.y
      )
    } else {
      const rect = this.resolveDragRect(point, modifiers)
      shape = this.createShape(
        this.shapeKind,
        rect.left, rect.top,
        rect.right, rect.bottom
      )
    }

    if (shape) {
      (shape as any).opacity = 0.7
      shape.data.isPreview = true
      const overlay = engine.getOverlayLayer()
      overlay.addChild(shape)
      this.previewShape = shape
    }
    scope.view.update()
  }

  private createShape(
    kind: LiveShapeParams['kind'],
    x1: number, y1: number, x2: number, y2: number
  ): paper.Item | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope

    const left = Math.min(x1, x2)
    const top = Math.min(y1, y2)
    const width = Math.abs(x2 - x1)
    const height = Math.abs(y2 - y1)

    let path: paper.Item | null = null

    switch (kind) {
      case 'rect': {
        path = new scope.Path.Rectangle(new scope.Rectangle(left, top, width, height)) as paper.Path
        break
      }
      case 'rounded-rect': {
        const want = Number((engine.store as any).roundedRadius)
        const fallback = Math.min(width, height) * 0.2
        const radius = Number.isFinite(want) ? Math.min(want, Math.min(width, height) / 2) : fallback
        path = new scope.Path.Rectangle(
          new scope.Rectangle(left, top, width, height),
          new scope.Size(radius, radius)
        ) as paper.Path
        break
      }
      case 'ellipse': {
        path = new scope.Path.Ellipse(new scope.Rectangle(left, top, width, height)) as paper.Path
        break
      }
      case 'line': {
        path = new scope.Path.Line(new scope.Point(x1, y1), new scope.Point(x2, y2)) as paper.Path
        break
      }
      case 'arc': {
        // Quarter arc across the drag box (AI Arc tool default).
        const arc = new scope.Path() as paper.Path
        const cx = left
        const cy = top + height
        arc.add(new scope.Point(left + width, top + height))
        arc.arcTo(new scope.Point(left + width, top), new scope.Point(left, top))
        void cx
        void cy
        path = arc
        break
      }
      case 'rect-grid': {
        const rows = Math.min(20, Math.max(1, Math.round(Number((engine.store as any).gridRows) || 4)))
        const cols = Math.min(20, Math.max(1, Math.round(Number((engine.store as any).gridCols) || 4)))
        const group = new scope.Group({ insert: false }) as paper.Group
        const frame = new scope.Path.Rectangle(new scope.Rectangle(left, top, width, height)) as paper.Path
        group.addChild(frame)
        for (let r = 1; r < rows; r++) {
          const y = top + (height * r) / rows
          group.addChild(new scope.Path.Line(new scope.Point(left, y), new scope.Point(left + width, y)) as paper.Path)
        }
        for (let c = 1; c < cols; c++) {
          const x = left + (width * c) / cols
          group.addChild(new scope.Path.Line(new scope.Point(x, top), new scope.Point(x, top + height)) as paper.Path)
        }
        path = group
        break
      }
      case 'polar-grid': {
        const rings = Math.min(12, Math.max(1, Math.round(Number((engine.store as any).gridRows) || 4)))
        const spokes = Math.min(32, Math.max(3, Math.round(Number((engine.store as any).gridCols) || 8)))
        const cx = left + width / 2
        const cy = top + height / 2
        const maxR = Math.min(width, height) / 2
        const group = new scope.Group({ insert: false }) as paper.Group
        for (let r = 1; r <= rings; r++) {
          group.addChild(new scope.Path.Ellipse(
            new scope.Rectangle(cx - (maxR * r) / rings, cy - (maxR * r) / rings, (maxR * r * 2) / rings, (maxR * r * 2) / rings)
          ) as paper.Path)
        }
        for (let s = 0; s < spokes; s++) {
          const a = (s / spokes) * Math.PI * 2
          group.addChild(new scope.Path.Line(
            new scope.Point(cx, cy),
            new scope.Point(cx + Math.cos(a) * maxR, cy + Math.sin(a) * maxR)
          ) as paper.Path)
        }
        path = group
        break
      }
      case 'polygon': {
        const sides = Math.min(64, Math.max(3, Math.round(Number((engine.store as any).polygonSides) || 5)))
        const cx = left + width / 2
        const cy = top + height / 2
        const radius = Math.max(width, height) / 2
        path = new scope.Path.RegularPolygon(new scope.Point(cx, cy), sides, radius) as paper.Path
        break
      }
      case 'spiral': {
        // Archimedean spiral: drag diagonal sets the extent, turns from store.
        const cx = left + width / 2
        const cy = top + height / 2
        const maxRadius = Math.min(width, height) / 2
        const turns = Math.min(12, Math.max(1, Math.round(Number((engine.store as any).spiralTurns) || 3)))
        const steps = 120
        const spiral = new scope.Path() as paper.Path
        for (let i = 0; i <= steps; i++) {
          const t = i / steps
          const angle = t * turns * Math.PI * 2
          const radius = maxRadius * t
          spiral.add(new scope.Point(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius))
        }
        path = spiral
        break
      }
      default: {
        path = new scope.Path.Rectangle(new scope.Rectangle(left, top, width, height)) as paper.Path
        break
      }
    }

    if (path) {
      const style = engine.store.style
      if (path instanceof scope.Group) {
        for (const child of path.children) engine.applyStyleToItem(child, style)
      } else {
        engine.applyStyleToItem(path, style)
      }
    }
    return path
  }

  private removePreview() {
    if (this.previewShape) {
      this.previewShape.remove()
      this.previewShape = null
    }
  }

  private finishShape() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    // Commit the live preview itself so any modifier-derived geometry
    // (constrained proportions, from-center, 45° line snapping) is kept.
    const shape = this.previewShape
    if (shape && this.isValidShape(shape)) {
      const layer = engine.getActiveLayer()
      layer.addChild(shape)
      shape.data.id = engine.genId()
      shape.data.isUserItem = true
      delete shape.data.isPreview
      ;(shape as any).opacity = 1
      if (shape instanceof scope.Group) {
        for (const child of shape.children) engine.applyStyleToItem(child, engine.store.style)
      } else {
        engine.applyStyleToItem(shape, engine.store.style)
      }
      engine.selectItem(shape)
      engine.pushHistory('Draw Shape')
      this.previewShape = null
    }

    this.removePreview()
    this.isDrawing = false
    scope.view.update()
  }

  /** Minimum size gate: lines only need length, area shapes need both axes. */
  private isValidShape(shape: paper.Item): boolean {
    if (this.shapeKind === 'line' || this.shapeKind === 'arc' || this.shapeKind === 'spiral') {
      return (shape as paper.Path).length > 0.5
    }
    const bounds = shape.bounds
    return bounds.width > 0.5 && bounds.height > 0.5
  }

  private cancelShape() {
    this.removePreview()
    this.isDrawing = false
    if (this.engine) {
      this.engine.scope.view.update()
    }
  }
}
