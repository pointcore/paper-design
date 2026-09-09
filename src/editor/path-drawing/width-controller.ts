/**
 * Width tool controller (Shift+W).
 *
 * Paper.js strokes have uniform width, so variable width is a destructive
 * expand like Outline Stroke: grab a stroked path, drag up/down to set the
 * local width (a profile stop is added where grabbed), and on release the
 * path is replaced by a filled variable-width outline. Escape cancels.
 * Compound children, text, patterns and clip content are refused with a
 * status hint.
 */

/** One width profile stop (offset 0-1 along the path, scale multiplier). */
interface WidthStop {
  offset: number
  scale: number
}

import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'

/** Drag sensitivity: scale units per screen pixel. */
const DRAG_RATE = 0.01
/** Grab merges with a stop within this offset distance, else inserts. */
const STOP_SNAP = 0.06

export class WidthController {
  engine: EditorEngine | null = null
  private target: paper.Path | null = null
  private profile: WidthStop[] = []
  private baseWidth = 1
  private activeStop = 0
  private startClientY = 0
  private startScale = 1
  private preview: paper.Path | null = null
  private isActive = false

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.cancelGesture()
    this.setupTool()
    applyToolCursor(this.engine.canvas, 'width')
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
      if (this.isActive) return
      const hit = this.widthTargetAt(event.point)
      if (!hit) return
      this.target = hit
      this.baseWidth = Number((hit as any).strokeWidth) || 1
      this.profile = this.readProfile(hit)
      const length = hit.length || 1
      const grabOffset = Math.min(1, Math.max(0, (hit.getOffsetOf(event.point) ?? 0) / length))
      this.activeStop = this.nearestStop(this.profile, grabOffset)
      if (Math.abs(this.profile[this.activeStop].offset - grabOffset) > STOP_SNAP) {
        this.profile.push({ offset: grabOffset, scale: this.scaleAt(this.profile, grabOffset) })
        this.profile.sort((a, b) => a.offset - b.offset)
        this.activeStop = this.profile.findIndex((s) => s.offset === grabOffset)
      }
      this.startClientY = native?.clientY ?? 0
      this.startScale = this.profile[this.activeStop].scale
      hit.visible = false
      this.isActive = true
      engine.store.setDragging(true)
      this.rebuildPreview()
      scope.view.update()
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isActive || !this.target) return
      const native = (event as any).event as MouseEvent
      const dy = this.startClientY - (native?.clientY ?? this.startClientY)
      const next = Math.min(5, Math.max(0.05, this.startScale + dy * DRAG_RATE))
      this.profile[this.activeStop].scale = Math.round(next * 100) / 100
      this.rebuildPreview()
      engine.store.setCursorPos(event.point.x, event.point.y)
      const pt = Math.round(this.baseWidth * this.profile[this.activeStop].scale * 10) / 10
      engine.showStatus(`Width ${pt} pt (${Math.round(this.profile[this.activeStop].scale * 100)}%) — release to expand, Esc to cancel`)
      scope.view.update()
    }

    scope.tool.onMouseUp = () => {
      if (!this.isActive) return
      this.commit()
      engine.store.setDragging(false)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'escape' && this.isActive) {
        this.cancelGesture()
        engine.store.setDragging(false)
      }
    }

    scope.view.update()
  }

  /** Stroked plain path under a point, or null (with a status hint). */
  private widthTargetAt(point: paper.Point): paper.Path | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const hit = engine.project.hitTest(point, {
      fill: false,
      stroke: true,
      segments: false,
      tolerance: 6 / scope.view.zoom,
    })
    let node = hit?.item ?? null
    while (node && !(node instanceof scope.Path) && !(node instanceof scope.Layer)) {
      node = node.parent
    }
    if (!node || !(node instanceof scope.Path) || node instanceof scope.CompoundPath) {
      engine.showStatus('Click a stroked path to adjust its width')
      return null
    }
    const data = (node.data as any) ?? {}
    if (data.isChrome || data.isPreview || data.isGuide || data.annotation || data.isArtboard) {
      return null
    }
    if ((node as any).locked) return null
    if (data.textMode || data.isPatternTile || data.isPatternFill) {
      engine.showStatus('Width needs a plain stroked path')
      return null
    }
    if (node.parent instanceof scope.CompoundPath) {
      engine.showStatus('Release the compound path first')
      return null
    }
    if (!this.isUserArtwork(node)) {
      engine.showStatus('Click a stroked path to adjust its width')
      return null
    }
    if (!(node as any).strokeColor || !((node as any).strokeWidth > 0)) {
      engine.showStatus('Path has no stroke to widen')
      return null
    }
    return node as paper.Path
  }

  /** Whether an item lives under a user layer. */
  private isUserArtwork(item: paper.Item): boolean {
    const engine = this.engine
    if (!engine) return false
    let node: paper.Item | null = item
    while (node && !(node instanceof engine.scope.Layer)) node = node.parent
    return !!node && !!(node.data as any)?.isUserLayer
  }

  /** Stored profile or a flat default. */
  private readProfile(path: paper.Path): WidthStop[] {
    const raw = (path.data as any)?.widthProfile as unknown
    if (Array.isArray(raw)) {
      const stops = (raw as any[])
        .filter((s) => s && Number.isFinite(s.offset) && Number.isFinite(s.scale))
        .map((s) => ({
          offset: Math.min(1, Math.max(0, Number(s.offset))),
          scale: Math.min(5, Math.max(0.05, Number(s.scale))),
        }))
        .sort((a, b) => a.offset - b.offset)
      if (stops.length >= 2) return stops
    }
    return [{ offset: 0, scale: 1 }, { offset: 1, scale: 1 }]
  }

  private nearestStop(profile: WidthStop[], offset: number): number {
    let best = 0
    for (let i = 1; i < profile.length; i++) {
      if (Math.abs(profile[i].offset - offset) < Math.abs(profile[best].offset - offset)) {
        best = i
      }
    }
    return best
  }

  /** Piecewise-linear scale at a normalized offset. */
  private scaleAt(profile: WidthStop[], u: number): number {
    const stops = profile.slice().sort((a, b) => a.offset - b.offset)
    if (u <= stops[0].offset) return stops[0].scale
    for (let i = 1; i < stops.length; i++) {
      if (u <= stops[i].offset) {
        const a = stops[i - 1]
        const b = stops[i]
        const span = b.offset - a.offset || 1
        const t = (u - a.offset) / span
        return a.scale + (b.scale - a.scale) * t
      }
    }
    return stops[stops.length - 1].scale
  }

  /** Rebuild the overlay preview from the target + current profile. */
  private rebuildPreview() {
    const engine = this.engine
    if (!engine || !this.target) return
    if (this.preview) {
      this.preview.remove()
      this.preview = null
    }
    const built = this.buildExpanded(this.target, this.profile, this.baseWidth)
    if (!built) return
    built.opacity = 0.9
    built.data.isPreview = true
    engine.getOverlayLayer().addChild(built)
    this.preview = built
  }

  /**
   * Variable-width outline of a path: rails sampled along the centerline
   * with round caps (open paths). Returns an overlay-owned closed path.
   */
  private buildExpanded(path: paper.Path, profile: WidthStop[], baseWidth: number): paper.Path | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const length = path.length
    if (!(length > 0) || !(baseWidth > 0)) return null
    const samples = Math.min(160, Math.max(24, Math.ceil(length / 2)))
    const left: paper.Point[] = []
    const right: paper.Point[] = []
    const radii: number[] = []
    for (let i = 0; i <= samples; i++) {
      const offset = (i / samples) * length
      const pt = path.getPointAt(offset)
      const tangent = path.getTangentAt(offset)
      if (!pt || !tangent || tangent.length < 1e-9) return null
      const normal = new scope.Point(-tangent.y, tangent.x).normalize()
      const r = (baseWidth / 2) * this.scaleAt(profile, i / samples)
      radii.push(r)
      left.push(pt.add(normal.multiply(r)))
      right.push(pt.subtract(normal.multiply(r)))
    }
    const outline = new scope.Path({ insert: false }) as paper.Path
    const closed = !!path.closed
    if (closed) {
      left.forEach((pt) => outline.add(new scope.Segment(pt.clone())))
      for (let i = right.length - 1; i >= 0; i--) {
        outline.add(new scope.Segment(right[i].clone()))
      }
      outline.closed = true
    } else {
      this.addCap(outline, left[0], right[0], radii[0], false)
      left.forEach((pt) => outline.add(new scope.Segment(pt.clone())))
      this.addCap(outline, left[left.length - 1], right[right.length - 1], radii[radii.length - 1], true)
      for (let i = right.length - 1; i >= 0; i--) {
        outline.add(new scope.Segment(right[i].clone()))
      }
      outline.closed = true
    }
    const anyPath = path as any
    outline.fillColor = anyPath.strokeColor?.clone?.() ?? anyPath.strokeColor
    outline.strokeColor = null
    outline.opacity = anyPath.opacity ?? 1
    if (anyPath.blendMode !== undefined) outline.blendMode = anyPath.blendMode
    return outline
  }

  /** Semicircle fan between rail ends (round cap). */
  private addCap(outline: paper.Path, left: paper.Point, right: paper.Point, radius: number, atEnd: boolean) {
    const engine = this.engine
    if (!engine || radius <= 0) return
    const scope = engine.scope
    const center = left.add(right).divide(2)
    const startAngle = Math.atan2(left.y - center.y, left.x - center.x) * 180 / Math.PI
    const steps = 8
    // Fan from the left rail end around to the right rail end.
    for (let i = 1; i < steps; i++) {
      const sweep = atEnd ? -180 : 180
      const angle = startAngle + (sweep * i) / steps
      const rad = (angle * Math.PI) / 180
      outline.add(
        new scope.Segment(
          new scope.Point(center.x + Math.cos(rad) * radius, center.y + Math.sin(rad) * radius)
        )
      )
    }
  }

  /** Replace the target with the committed expanded fill. */
  private commit() {
    const engine = this.engine
    const target = this.target
    this.isActive = false
    if (!engine || !target) {
      this.cancelGesture()
      return
    }
    if (this.preview) {
      this.preview.remove()
      this.preview = null
    }
    const built = this.buildExpanded(target, this.profile, this.baseWidth)
    if (!built) {
      target.visible = true
      this.target = null
      engine.scope.view.update()
      return
    }
    const parent = target.parent ?? engine.getActiveLayer()
    const at = Math.max(0, parent.children.indexOf(target))
    const color = (target as any).strokeColor
    target.remove()
    ;(built as any).fillColor = color
    parent.insertChild(Math.min(at, parent.children.length), built)
    built.data.id = engine.genId()
    built.data.isUserItem = true
    engine.clearSelection()
    built.selected = true
    engine.syncSelectionToStore()
    engine.pushHistory('Width Tool')
    this.target = null
    engine.scope.view.update()
  }

  /** Drop the gesture and restore the untouched target. */
  private cancelGesture() {
    if (this.preview) {
      this.preview.remove()
      this.preview = null
    }
    if (this.target) {
      this.target.visible = true
      this.target = null
    }
    this.isActive = false
    this.profile = []
    if (this.engine) {
      this.engine.store.setDragging(false)
      this.engine.scope.view.update()
    }
  }
}
