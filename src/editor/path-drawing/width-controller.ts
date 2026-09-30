/**
 * Width tool controller (Shift+W).
 *
 * Paper.js strokes have uniform width, so a variable width has to be drawn by
 * expanding the stroke into a filled outline: grab a stroked path, drag
 * up/down to set the local width (a profile stop is added where grabbed), and
 * on release the path is replaced by a filled variable-width outline. Escape
 * cancels.
 *
 * The commit goes through engine-width, not through local geometry, so the
 * profile it produces is the same object the panel can re-edit, save and
 * release — the expansion is a rendering of the profile, not the only copy of
 * it. The geometry and the stop math live in ./width-profile.
 * Compound children, text, patterns and clip content are refused with a
 * status hint.
 */

import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'
import { isPrimaryButton } from '../gestures'
import { expandWithProfile } from '../engine-width'
import { expandVariableWidth, makeProfile, scaleAt, type WidthStop } from './width-profile'

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
      if (!isPrimaryButton(native)) return
      if (this.isActive) return
      const hit = this.widthTargetAt(event.point)
      if (!hit) return
      this.target = hit
      this.baseWidth = Number((hit as any).strokeWidth) || 1
      // Fresh flat profile per gesture: the tool expands destructively on
      // commit, so there is no profile to resume from a previous run.
      this.profile = [{ offset: 0, scale: 1 }, { offset: 1, scale: 1 }]
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
    return scaleAt(makeProfile('', '', 1, profile), u)
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

  /** Variable-width outline of a path, for the transient preview. */
  private buildExpanded(path: paper.Path, profile: WidthStop[], baseWidth: number): paper.Path | null {
    const engine = this.engine
    if (!engine) return null
    return expandVariableWidth(
      engine.scope,
      path,
      makeProfile('', '', baseWidth, profile),
    )
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
    // Through the engine, so the committed item keeps the profile and the
    // source path: the width stays adjustable instead of being a one-way trip
    // into a filled outline.
    const built = expandWithProfile(
      engine,
      target,
      makeProfile('', 'Width', this.baseWidth, this.profile),
      'Width Tool',
    )
    if (!built) {
      target.visible = true
      this.target = null
      engine.scope.view.update()
      return
    }
    this.target = null
    engine.scope.view.update()
  }

  /**
   * Tool switch: the gesture's mouse-up never arrives, so drop it and put
   * the hidden target back instead of leaving an invisible, uncommitted path.
   */
  deactivate() {
    this.cancelGesture()
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
