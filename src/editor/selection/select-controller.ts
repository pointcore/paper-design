/**
 * Selection controller.
 *
 * Select tool: click / marquee select and move whole objects.
 *
 * Direct-select tool: refines the selection at the sub-object level. When a
 * path is selected its anchors and handles are drawn and can be dragged to
 * reshape the path (handle > anchor > segment > object hit priority).
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { AnchorChrome } from '../path-drawing/anchor-chrome'
import { remainingRuns, roundCornerHandle } from '../geometry'
import type { AlignMode, DistributeAxis } from '../types'
import { selectionColorForItem, selectionColorForItems } from './selection-style'
import { GuideController } from '../guides/guide-controller'
import { SnapService } from '../snap/snap-service'
import { applyToolCursor, cursorForTool, CURSOR_ROTATE, arrowResizeCursor } from '../cursors'
import type { TextController } from '../text/text-controller'

type EditMode = 'select' | 'direct-select'

/** Bounding-box transform handle in select mode (corners double as rotate zones). */
type TransformHandle =
  | 'none'
  | 'topLeft' | 'topCenter' | 'topRight'
  | 'middleLeft' | 'middleRight'
  | 'bottomLeft' | 'bottomCenter' | 'bottomRight'
  | 'rotate'

/** Scale-handle names (everything except none / rotate). */
type FrameHandle = Exclude<TransformHandle, 'none' | 'rotate'>

/**
 * Persistent oriented selection frame: center + size + clockwise degrees.
 * Unlike the axis-aligned bounds, it survives rotation — the box never
 * snaps back upright while the selection is intact.
 */
interface SelectionFrame {
  cx: number
  cy: number
  w: number
  h: number
  angle: number
  selKey: string
  version: number
}

/** Normalize degrees into (-180, 180]. */
function normAngle180(deg: number): number {
  return ((deg + 540) % 360) - 180
}

/**
 * Outward heading of each scale handle in frame-local space, clockwise
 * degrees from east (screen coords, y down): E=0, SE=45, S=90, SW=135,
 * W=180, NW=225, N=270, NE=315.
 */
const HANDLE_HEADINGS: Record<FrameHandle, number> = {
  middleRight: 0,
  bottomRight: 45,
  bottomCenter: 90,
  bottomLeft: 135,
  middleLeft: 180,
  topLeft: 225,
  topCenter: 270,
  topRight: 315,
}

/**
 * Resize cursor for a bidirectional axis heading (CSS resize cursors point
 * both ways, so the heading folds modulo 180° into the nearest of the
 * four axes). At angle 0 this reproduces the classic mapping exactly.
 */
function resizeCursorForHeading(headingDeg: number): string {
  const h = ((headingDeg % 180) + 180) % 180
  if (h < 22.5 || h >= 157.5) return 'ew-resize'
  if (h < 67.5) return 'nwse-resize'
  if (h < 112.5) return 'ns-resize'
  return 'nesw-resize'
}

/**
 * Diagonal-only cursor for corner handles: a corner resizes along its
 * right-angle bisector (45°), so it always shows a diagonal arrow — the
 * nearer of the two diagonals — never an axis arrow.
 */
function diagonalCursorForHeading(headingDeg: number): string {
  const h = ((headingDeg % 180) + 180) % 180
  return Math.abs(h - 45) <= Math.abs(h - 135) ? 'nwse-resize' : 'nesw-resize'
}

export class SelectController {
  engine: EditorEngine | null = null
  chrome: AnchorChrome = new AnchorChrome()
  guides: GuideController = new GuideController()
  snapService: SnapService = new SnapService()

  private isDragging = false
  private isMarquee = false
  private dragStart: { x: number; y: number } = { x: 0, y: 0 }
  private dragItems: paper.Item[] = []
  // Absolute drag bookkeeping: item positions and the snapped pointer at
  // grab time, so each move step recomputes from scratch (snap corrections
  // never accumulate and releasing a snap does not jump).
  private dragItemStartPositions: paper.Point[] = []
  private dragPointerStart: paper.Point | null = null
  private dragStartBounds: paper.Rectangle | null = null
  private marqueeRect: paper.Path | null = null
  private marqueeLayer: paper.Layer | null = null

  // Direct-select anchor editing state.
  private mode: EditMode = 'select'
  private grab: 'none' | 'anchor' | 'anchor-group' | 'handle' | 'segment' | 'object' | 'guide' | 'transform' = 'none'
  private grabSegmentIndex = -1
  private grabIsIn = false
  private grabGuide: paper.Path | null = null
  private guideOriginalPos = 0
  // Path currently grabbed for anchor / handle editing (identity-safe, the
  // front-most selected path may differ from the grabbed one).
  private grabPath: paper.Path | null = null
  // Anchor sub-selection built by direct-select marquee / shift-click.
  private selectedSegments: { path: paper.Path; index: number }[] = []
  // Curve (segment) sub-selection: clicking a path stroke in direct-select
  // selects the whole curve plus its two end anchors (AI behavior). Dragging
  // moves the end anchors rigidly so adjacent curves reshape with it.
  private selectedCurves: { path: paper.Path; curve: number }[] = []
  // Curve index grabbed for a segment drag (kept apart from
  // grabSegmentIndex so the anchor delete-key quirk never fires for curves).
  private grabCurveIndex = -1
  // Whether the active marquee selects anchors (direct-select) or objects.
  private anchorMarquee = false
  // Whether the active marquee is additive (shift held on mouse-down).
  private marqueeShift = false
  // Reference point for group anchor translation.
  private dragStartPoint: { x: number; y: number } | null = null
  // Grab-time pointer for Shift axis-locking (never updated mid-drag,
  // unlike dragStartPoint which advances with the pointer).
  private dragConstrainOrigin: { x: number; y: number } | null = null

  // Bounding-box transform drag state (select mode). Scaling is AI-aligned
  // absolute: totals are always measured from the grab-time snapshot
  // (start point / frame base / fixed pivots) and applied as
  // total/lastTotal steps, so edge drags never leak into the locked axis,
  // Shift-uniform never drifts, and crossing the pivot flips cleanly.
  // Scaling runs in the frame's local space (grab-time orientation), so
  // handles on a tilted box scale along the box axes, not the screen axes.
  private transformHandle: TransformHandle = 'none'
  private transformKind: 'scale' | 'rotate' | 'none' = 'none'
  private transformItems: paper.Item[] = []
  private transformPivot: paper.Point | null = null
  private transformCenter: paper.Point | null = null
  private transformOpposite: paper.Point | null = null
  private transformScaleBase: { cx: number; cy: number; w: number; h: number; angle: number } | null = null
  private transformStartPoint: { x: number; y: number } | null = null
  private transformLastTotalFx = 1
  private transformLastTotalFy = 1
  private transformUseCenter = false
  private transformLastPoint: { x: number; y: number } | null = null
  // AI-aligned rotate bookkeeping: the pivot follows the 9-point reference
  // proxy (frozen at grab), while the angle accumulates unsnapped so Shift
  // snaps the true total to 45-degree increments (snapping the per-step
  // delta instead would drop fractions and lag behind the pointer).
  private transformRotatePivot: paper.Point | null = null
  private transformRotateLastRaw = 0
  private transformRotateAccum = 0
  private transformRotateApplied = 0
  private transformMoved = false

  // Persistent oriented selection frame (center + size + clockwise angle).
  // Rebuilt from the axis-aligned bounds only when the selection identity
  // or the engine geometry version drifts — every other mutation (move /
  // scale / rotate / nudge / flip) advances it incrementally in place.
  private frame: SelectionFrame | null = null
  // Frame center at object-drag grab time (move replays from here).
  private dragStartFrame: { x: number; y: number } | null = null

  // Items whose native paper.js selected-item decoration we suppress while
  // they are shown via our own AI-aligned AnchorChrome (layer-color outlines
  // + white / solid anchors). Paper's native blue squares would otherwise
  // render on top of (or through) our markers and look like stray boxes, and
  // its native bounds would double-draw our own bbox outline in select mode.
  private chromeSuppressed = new Set<paper.Item>()

  /** Disable paper.js's native selected decoration on one item. */
  private suppressNativeSelection(item: paper.Item) {
    if (!item.selected || (item as any)._drawSelected === false) return
    ;(item as any)._drawSelected = false
    this.chromeSuppressed.add(item)
  }

  /** Re-enable paper.js's native selected decoration on one item. */
  private restoreNativeSelection(item: paper.Item) {
    if (!this.chromeSuppressed.has(item)) return
    delete (item as any)._drawSelected
    this.chromeSuppressed.delete(item)
  }

  /** Re-enable native selection decoration for every suppressed item. */
  private restoreAllNativeSelections() {
    for (const item of Array.from(this.chromeSuppressed)) {
      this.restoreNativeSelection(item)
    }
  }

  /** Public entry so panel / undo / engine selection changes repaint chrome. */
  refreshSelectionChrome() {
    this.refreshChrome()
  }

  /** Give paper.js back its native decoration (called when leaving select tools). */
  releaseNativeSuppressions() {
    this.restoreAllNativeSelections()
  }

  /** Sorted selection-identity key (frame rebuilds when this changes). */
  private selectionKey(): string {
    const engine = this.engine
    if (!engine) return ''
    return engine
      .getSelection()
      .map((i) => ((i.data as any)?.id as string | undefined) ?? '')
      .sort()
      .join('|')
  }

  /**
   * Ensure the oriented frame matches the live selection: rebuild upright
   * from the axis-aligned bounds only when the selection identity or the
   * engine geometry version drifted. Everything else advances the frame
   * incrementally, so rotation never snaps back.
   */
  private ensureFrame(): void {
    const engine = this.engine
    if (!engine) {
      this.frame = null
      return
    }
    const items = engine.getSelection()
    if (items.length === 0) {
      this.frame = null
      return
    }
    const key = items
      .map((i) => ((i.data as any)?.id as string | undefined) ?? '')
      .sort()
      .join('|')
    if (this.frame && this.frame.selKey === key && this.frame.version === engine.geometryVersion) return
    const bounds = engine.getSelectionBounds()
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      this.frame = null
      return
    }
    this.frame = {
      cx: bounds.center.x,
      cy: bounds.center.y,
      w: bounds.width,
      h: bounds.height,
      angle: 0,
      selKey: key,
      version: engine.geometryVersion,
    }
  }

  /** Whether the frame currently tracks the live selection. */
  private frameTracking(): boolean {
    const engine = this.engine
    if (!engine || !this.frame) return false
    return this.frame.selKey === this.selectionKey()
  }

  /**
   * Rigidly rotate the tracked frame (called by engine.rotateSelection, so
   * canvas drags and the Properties panel stay in sync).
   */
  frameRotated(deltaDeg: number, pivot: paper.Point) {
    if (!this.frameTracking() || !this.frame) return
    const f = this.frame
    const c = new (this.engine!.scope.Point)(f.cx, f.cy).rotate(deltaDeg, pivot)
    f.cx = c.x
    f.cy = c.y
    f.angle = normAngle180(f.angle + deltaDeg)
  }

  /** Slide the tracked frame (called by engine.nudgeSelection). */
  frameTranslated(dx: number, dy: number) {
    if (!this.frameTracking() || !this.frame) return
    this.frame.cx += dx
    this.frame.cy += dy
  }

  /**
   * Mirror the tracked frame (called by engine.flipSelection: both flip
   * axes map θ → −θ, and the center mirrors about the pivot).
   */
  frameMirrored(pivot: paper.Point) {
    if (!this.frameTracking() || !this.frame) return
    const f = this.frame
    f.cx = 2 * pivot.x - f.cx
    f.cy = 2 * pivot.y - f.cy
    f.angle = normAngle180(-f.angle)
  }

  /** Revalidate the tracked frame after its drag records history. */
  frameStamped() {
    const engine = this.engine
    if (!engine || !this.frameTracking() || !this.frame) return
    this.frame.version = engine.geometryVersion
  }

  /**
   * Drop the tracked frame (partial-lock mutations the frame cannot
   * follow). The next paint rebuilds it upright from live bounds.
   */
  dropFrame() {
    this.frame = null
  }

  /** World-space corner / edge positions of an oriented frame. */
  private frameCorners(f: SelectionFrame): Record<FrameHandle, paper.Point> {
    const scope = this.engine!.scope
    const c = new scope.Point(f.cx, f.cy)
    const at = (ox: number, oy: number) =>
      new scope.Point(f.cx + ox, f.cy + oy).rotate(f.angle, c)
    const hw = f.w / 2
    const hh = f.h / 2
    const TL = at(-hw, -hh)
    const TR = at(hw, -hh)
    const BR = at(hw, hh)
    const BL = at(-hw, hh)
    const mid = (a: paper.Point, b: paper.Point) =>
      new scope.Point((a.x + b.x) / 2, (a.y + b.y) / 2)
    return {
      topLeft: TL,
      topCenter: mid(TL, TR),
      topRight: TR,
      middleLeft: mid(TL, BL),
      middleRight: mid(TR, BR),
      bottomLeft: BL,
      bottomCenter: mid(BL, BR),
      bottomRight: BR,
    }
  }

  /** Map a world point into the frame's local (unrotated) space. */
  private frameToLocal(p: paper.Point, f: SelectionFrame): paper.Point {
    const scope = this.engine!.scope
    return p.clone().rotate(-f.angle, new scope.Point(f.cx, f.cy))
  }

  /** Local (axis-aligned) position of a named handle at grab time. */
  private localHandlePoint(
    base: { cx: number; cy: number; w: number; h: number },
    name: FrameHandle
  ): { x: number; y: number } {
    const hw = base.w / 2
    const hh = base.h / 2
    switch (name) {
      case 'topLeft': return { x: base.cx - hw, y: base.cy - hh }
      case 'topCenter': return { x: base.cx, y: base.cy - hh }
      case 'topRight': return { x: base.cx + hw, y: base.cy - hh }
      case 'middleLeft': return { x: base.cx - hw, y: base.cy }
      case 'middleRight': return { x: base.cx + hw, y: base.cy }
      case 'bottomLeft': return { x: base.cx - hw, y: base.cy + hh }
      case 'bottomCenter': return { x: base.cx, y: base.cy + hh }
      case 'bottomRight': return { x: base.cx + hw, y: base.cy + hh }
    }
  }

  attachEngine(engine: EditorEngine) {
    this.engine = engine
    this.chrome.attachEngine(engine)
    this.guides.attachEngine(engine)
    this.snapService.attachEngine(engine)
  }

  activate() {
    if (!this.engine) return
    const store = this.engine.store
    // Whenever this controller is (re)activated, give paper.js back control of
    // the native selected-item decoration. The direct-select refreshChrome()
    // re-suppresses it for the paths it is actually rendering as we edit.
    this.restoreAllNativeSelections()
    this.mode = store.tool === 'direct-select' ? 'direct-select' : 'select'
    // AI-aligned defaults: black arrow for select, white arrow for direct.
    applyToolCursor(this.engine.canvas, this.mode)
    this.clearAnchorState()
    this.resetTransformDrag()
    // Drop any in-progress marquee / object drag orphaned by a mid-gesture
    // tool swap (e.g. Space parking the hand tool mid-marquee), otherwise a
    // stale rubber band reappears and flickers on the next mouse event.
    this.isDragging = false
    this.isMarquee = false
    this.dragItems = []
    this.dragStartFrame = null
    this.removeMarquee()
    this.grabGuide = null
    this.guideOriginalPos = 0
    this.grabPath = null
    this.dragStartPoint = null
    this.anchorMarquee = false
    this.clearAnchorSelection()
    this.clearCurveSelection()
    this.guides.clearSelection()
    this.chrome.clear()
    this.setupTool()
    // Repaint AI chrome for any pre-existing selection (panel select, undo
    // restore, or tool switch-back) so the canvas never falls back to
    // paper.js native blue until the next mouse event.
    this.refreshChrome()
  }

  private clearAnchorState() {
    this.grab = 'none'
    this.grabSegmentIndex = -1
    this.grabCurveIndex = -1
    this.grabIsIn = false
    this.grabPath = null
    this.dragStartPoint = null
    this.dragConstrainOrigin = null
  }

  /** Drop any in-progress bounding-box transform drag state. */
  private resetTransformDrag() {
    this.transformHandle = 'none'
    this.transformKind = 'none'
    this.transformItems = []
    this.transformPivot = null
    this.transformCenter = null
    this.transformOpposite = null
    this.transformScaleBase = null
    this.transformStartPoint = null
    this.transformLastTotalFx = 1
    this.transformLastTotalFy = 1
    this.transformUseCenter = false
    this.transformLastPoint = null
    this.transformRotatePivot = null
    this.transformRotateLastRaw = 0
    this.transformRotateAccum = 0
    this.transformRotateApplied = 0
    this.transformMoved = false
  }

  private getNativeEvent(event: paper.ToolEvent): MouseEvent {
    return (event as any).event as MouseEvent
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
      if (native.button === 1 || native.button === 2) return

      // Double-clicking a text item hands it over to the text tool for
      // in-place editing; double-clicking a group isolates it instead.
      if (native.detail === 2) {
        const textItem = this.userTextAt(event.point)
        if (textItem) {
          const textCtrl = engine.getController('type') as TextController | null
          if (textCtrl) {
            engine.store.setTool('type')
            engine.setTool('type')
            textCtrl.editItem(textItem)
            return
          }
        }
        // Double-clicking a callout label re-enters label editing.
        const annotationText = this.annotationTextAt(event.point)
        if (annotationText) {
          const calloutCtrl = engine.getController('callout') as {
            editLabel?: (item: paper.PointText) => void
          } | null
          if (calloutCtrl?.editLabel) {
            calloutCtrl.editLabel(annotationText)
            return
          }
        }
        if (this.mode === 'select') {
          const group = this.groupAt(event.point)
          if (group && engine.enterIsolation(group)) return
        }
      }

      // In direct-select mode, anchor/handle grabbing takes priority over
      // guide interaction so users can fine-tune anchors near guides.
      if (this.mode === 'direct-select' && this.tryGrabAnchor(event)) {
        this.guides.clearSelection()
        engine.store.setDragging(true)
        // AI direct-select keeps the white arrow, but a move cue confirms
        // the anchor drag started.
        engine.canvas.style.cursor = 'move'
        this.refreshChrome()
        return
      }

      // Direct-select curve (segment) grab: clicking a path stroke selects
      // the whole curve plus its two end anchors; dragging moves them.
      // Priority sits below anchors/handles, above guides and objects.
      if (this.mode === 'direct-select') {
        const curveHit = this.curveHitAt(event.point, 5 / scope.view.zoom)
        if (curveHit) {
          this.guides.clearSelection()
          this.ensureEditedPath(curveHit.path)
          let targetPath = curveHit.path
          if (event.modifiers.alt) {
            targetPath = this.altDuplicatePaths([curveHit.path]).get(curveHit.path) ?? curveHit.path
          }
          if (event.modifiers.shift) {
            this.toggleCurveSelection(targetPath, curveHit.curve)
          } else if (!this.isCurveSelected(targetPath, curveHit.curve)) {
            this.clearCurveSelection()
            this.clearAnchorSelection()
            this.addCurveToSelection(targetPath, curveHit.curve)
          }
          this.grab = 'segment'
          this.grabPath = targetPath
          this.grabCurveIndex = curveHit.curve
          this.dragStartPoint = { x: event.point.x, y: event.point.y }
          this.dragConstrainOrigin = { x: event.point.x, y: event.point.y }
          engine.store.setDragging(true)
          engine.canvas.style.cursor = 'move'
          this.refreshChrome()
          return
        }
      }

      // ---- Guide interaction (skipped while guides are locked) ----
      if (engine.store.view.showGuides && !engine.store.view.guidesLocked) {
        const guideHit = this.guides.hitTest(event.point)
        if (guideHit) {
          this.clearAnchorSelection()
          this.clearCurveSelection()
          engine.store.setDragging(true)
          const wasSelected = this.guides.getSelectedGuides().includes(guideHit)

          if (!wasSelected && !event.modifiers.shift) {
            // Select only this guide
            this.guides.selectGuide(guideHit, false)
          } else if (event.modifiers.shift && wasSelected) {
            // Toggle guide off
            this.guides.deselectGuide(guideHit)
            this.grab = 'none'
            this.grabGuide = null
            this.isDragging = false
            engine.store.setDragging(false)
            engine.clearSelection()
            engine.syncSelectionToStore()
            return
          } else if (event.modifiers.shift) {
            // Add to existing guide selection
            this.guides.selectGuide(guideHit, true)
          } else {
            // was already selected, keep the group
            this.guides.selectGuide(guideHit, false)
          }

          // Clear regular artwork selection.
          engine.clearSelection()
          engine.syncSelectionToStore()

          this.grabGuide = guideHit
          this.grab = 'guide'
          this.isDragging = true
          this.dragStart = { x: event.point.x, y: event.point.y }
          this.guideOriginalPos = engine.getGuidePosition(guideHit)
          // Axis cue: vertical guides slide horizontally and vice versa.
          const orientation = engine.getGuideOrientation(guideHit)
          engine.canvas.style.cursor = orientation === 'vertical' ? 'ew-resize' : orientation === 'horizontal' ? 'ns-resize' : 'move'
          this.refreshChrome()
          engine.scope.view.update()
          return
        }
      }
      // Not clicking a guide -> clear guide selection.
      this.guides.clearSelection()

      // Ctrl+click cycles the selection through the objects stacked under
      // the cursor (AI select-behind parity; Alt stays duplicate, Shift
      // stays add-to-selection).
      if (
        (event.modifiers.control || event.modifiers.command) &&
        !event.modifiers.shift &&
        !event.modifiers.alt
      ) {
        this.cycleSelectBehind(event.point)
        return
      }

      // In select mode, bounding-box transform handles take priority over
      // object hit testing so scale / rotate drags start reliably.
      if (this.mode === 'select' && this.tryGrabTransformHandle(event)) {
        engine.store.setDragging(true)
        // Keep the hovered resize cursor throughout the transform drag.
        const held = this.cursorForHandleAt(event.point)
        if (held) engine.canvas.style.cursor = held
        this.refreshChrome()
        return
      }

      const hitResult = this.hitTest(event.point)

      if (hitResult) {
        const item = hitResult.item
        this.clearAnchorSelection()
        this.clearCurveSelection()
        engine.store.setDragging(true)

        if (!item.selected && !event.modifiers.shift) {
          engine.clearSelection()
          engine.selectItem(item, false)
        } else if (event.modifiers.shift && item.selected) {
          item.selected = false
          engine.syncSelectionToStore()
          this.isDragging = false
          this.refreshChrome()
          return
        } else if (event.modifiers.shift) {
          engine.selectItem(item, true)
        }

        if (event.modifiers.alt && engine.getSelection().length > 0) {
          // Alt-drag duplicates first; the copies become the drag set.
          // Records Duplicate up front so the copies stay undoable even
          // without a drag (release adds the usual Move entry).
          const clones = engine.copySelected()
          engine.clearSelection()
          clones.forEach((clone) => {
            clone.selected = true
          })
          engine.syncSelectionToStore()
          engine.pushHistory('Duplicate')
        }

        this.isDragging = true
        this.dragItems = engine.getSelection()
        this.dragItemStartPositions = this.dragItems.map(
          (item) => (item.position as paper.Point).clone()
        )
        this.dragPointerStart = this.snapService.snapPoint(event.point, this.dragItems).clone()
        this.dragStartBounds = engine.getSelectionBounds()?.clone() ?? null
        this.dragStartFrame = this.frame ? { x: this.frame.cx, y: this.frame.cy } : null
        this.dragStart = { x: event.point.x, y: event.point.y }
        this.grab = 'object'
        // Move cue while the object follows the pointer (AI keeps the arrow,
        // but the move affordance reads better on the web canvas).
        engine.canvas.style.cursor = 'move'
      } else {
        // Shift starts an additive marquee. The old early return made
        // Shift-drag a complete no-op and left marqueeShift permanently
        // false, so the additive branches below were dead code.
        this.marqueeShift = !!event.modifiers.shift
        if (!this.marqueeShift) {
          engine.clearSelection()
          this.clearAnchorSelection()
          this.clearCurveSelection()
          this.refreshChrome()
        }
        this.isMarquee = true
        // Direct-select marquee sub-selects anchors; the select tool marquee
        // selects whole objects.
        this.anchorMarquee = this.mode === 'direct-select'
        this.dragStart = { x: event.point.x, y: event.point.y }
        this.createMarquee(event.point.x, event.point.y)
        engine.store.setDragging(true)
      }
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      const store = engine.store
      if (this.grab === 'transform') {
        this.dragTransform(event.point, event.modifiers)
      } else if (this.grab === 'guide' && this.grabGuide) {
        this.dragGuide(event.point)
      } else if (this.mode === 'direct-select' && (this.grab === 'anchor' || this.grab === 'anchor-group')) {
        this.dragAnchor(event.point, event.modifiers)
      } else if (this.mode === 'direct-select' && this.grab === 'handle') {
        this.dragHandle(event.point)
      } else if (this.mode === 'direct-select' && this.grab === 'segment') {
        this.dragSegment(event.point, event.modifiers)
      } else if (this.isMarquee) {
        this.updateMarquee(event.point.x, event.point.y)
      } else if (this.isDragging && this.dragItems.length > 0) {
        this.dragObjects(event.point, event.modifiers)
      }
      store.setCursorPos(event.point.x, event.point.y)
      this.refreshChrome()
      scope.view.update()
    }

    scope.tool.onMouseUp = (event: paper.ToolEvent) => {
      if (this.grab === 'transform') {
        if (this.transformMoved) {
          engine.pushHistory(this.transformKind === 'rotate' ? 'Rotate' : 'Scale')
        }
        // The frame already matches the final artwork — revalidate it
        // against the (possibly bumped) version instead of rebuilding it
        // upright.
        engine.stampSelectionFrame()
        this.resetTransformDrag()
      } else if (this.grab === 'guide' && this.grabGuide) {
        this.finishGuideDrag(event)
      } else if (this.isMarquee) {
        if (this.anchorMarquee) this.finishAnchorMarquee()
        else this.finishMarquee()
        this.isMarquee = false
        this.anchorMarquee = false
        this.removeMarquee()
      } else if (this.isDragging && this.grab === 'object') {
        this.isDragging = false
        this.reflowEditedPaths()
        // Total drag delta from the tracked start positions feeds
        // Transform Again (AI repeats drag moves too).
        const startPos = this.dragItemStartPositions[0]
        const endPos = this.dragItems[0]?.position as paper.Point | undefined
        if (startPos && endPos) {
          engine.recordTransformMove(endPos.x - startPos.x, endPos.y - startPos.y)
        }
        engine.pushHistory('Move')
        engine.stampSelectionFrame()
      } else if (this.grab === 'anchor' || this.grab === 'anchor-group' || this.grab === 'handle' || this.grab === 'segment') {
        this.reflowEditedPaths()
        engine.pushHistory('Edit Path')
      }
      this.grab = 'none'
      this.isDragging = false
      this.grabGuide = null
      this.grabPath = null
      this.grabCurveIndex = -1
      this.dragStartPoint = null
      this.dragConstrainOrigin = null
      engine.store.setDragging(false)
      // Back to the AI-aligned tool default (arrow / white arrow).
      engine.canvas.style.cursor = cursorForTool(this.mode)
      // Geometry changed without the id set changing, so the store would
      // otherwise keep pre-drag bounds: the Properties panel would recompute
      // X/Y from a stale anchor and snap the object back on the next edit.
      engine.syncSelectionToStore()
      this.refreshChrome()
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
      // Hover priority (select mode): transform handle > guide > tool default.
      // Direct-select adds anchor / handle hover on top of the white arrow.
      if (this.grab !== 'none' || this.isMarquee || this.isDragging) {
        this.refreshChrome()
        return
      }
      const handleCursor =
        this.mode === 'select'
          ? this.cursorForHandleAt(event.point)
          : null
      if (handleCursor) {
        engine.canvas.style.cursor = handleCursor
      } else {
        const guide =
          engine.store.view.showGuides && !engine.store.view.guidesLocked
            ? this.guides.hitTest(event.point)
            : null
        if (guide) {
          const orientation = engine.getGuideOrientation(guide)
          engine.canvas.style.cursor =
            orientation === 'vertical' ? 'ew-resize' : orientation === 'horizontal' ? 'ns-resize' : 'move'
        } else if (this.mode === 'direct-select') {
          engine.canvas.style.cursor = this.directHoverCursor(event.point) ?? cursorForTool(this.mode)
        } else {
          engine.canvas.style.cursor = cursorForTool(this.mode)
        }
      }
      this.refreshChrome()
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      // Never steal keystrokes typed into panel inputs or dialogs.
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      switch (event.key) {
        case 'delete':
        case 'backspace':
          if (!engine.store.view.guidesLocked && this.guides.hasSelection()) {
            this.guides.deleteSelectedGuides()
          } else if (this.mode === 'direct-select' && this.hasCurveSelection()) {
            // AI deletes the curve itself (path splits open); the anchor
            // branch below would remove both end anchors instead.
            this.deleteSelectedCurves()
          } else if (this.mode === 'direct-select' && this.hasAnchorSelection()) {
            this.deleteSelectedAnchors()
          } else if (this.mode === 'direct-select' && this.grabSegmentIndex >= 0) {
            this.deleteGrabbedAnchor()
          } else {
            engine.deleteSelected()
          }
          // Keyboard deletes change geometry with no mouse movement: repaint
          // the AI chrome now, or the old outlines linger until the next
          // mousemove.
          this.refreshChrome()
          break
        case 'escape':
          if (engine.store.isolationActive) {
            engine.exitIsolation()
            break
          }
          this.guides.clearSelection()
          this.clearAnchorSelection()
          this.clearCurveSelection()
          engine.clearSelection()
          this.refreshChrome()
          break
        case 'd':
          if (event.modifiers.command) engine.duplicateSelected()
          break
      }
    }

    scope.view.update()
  }

  // ------------------------------------------------------------------
  // Direct-select anchor / handle editing
  // ------------------------------------------------------------------

  /** In direct-select, the top selected path's anchors are grabbed first. */
  private getEditPath(): paper.Path | null {
    const engine = this.engine
    if (!engine) return null
    if (!this.mode) return null
    // Pick the first selected path (front-most) that is editable.
    for (let i = engine.getSelection().length - 1; i >= 0; i--) {
      const item = engine.getSelection()[i]
      if (item instanceof engine.scope.Path) {
        return item as paper.Path
      }
    }
    return null
  }

  private tryGrabAnchor(event: paper.ToolEvent): boolean {
    const engine = this.engine
    if (!engine) return false
    const scope = engine.scope
    const tol = 6 / scope.view.zoom
    const modifiers = event.modifiers

    // 1) An anchor that already belongs to the sub-selection wins: the whole
    //    selection is then dragged as one group.
    const hit = this.anchorHitAt(event.point, tol)
    if (hit && this.hasAnchorSelection()) {
      const member = this.selectedSegments.some(
        (s) => s.path === hit.path && s.index === hit.index
      )
      if (member) {
        // Alt-drag duplicates the involved paths first (AI); indices carry
        // over to the clones untouched.
        let targetPath = hit.path
        if (modifiers.alt) {
          targetPath = this.altDuplicatePaths(this.anchorSelectionPaths()).get(hit.path) ?? hit.path
        }
        // Anchor business now: an explicit anchor grab always drops curve
        // entries, otherwise a later Delete would remove curves (or whole
        // small paths) instead of the dragged anchors.
        this.clearCurveSelection()
        this.grab = 'anchor-group'
        this.grabPath = targetPath
        this.grabSegmentIndex = hit.index
        this.grabIsIn = false
        this.dragStartPoint = { x: event.point.x, y: event.point.y }
        this.dragConstrainOrigin = { x: event.point.x, y: event.point.y }
        return true
      }
    }

    // 2) Handle endpoints keep the highest priority for reshaping curves.
    let candidates: paper.Path[] = []
    const selected = this.getEditPath()
    if (selected) candidates.push(selected)
    for (const extra of this.userPathsAt(event.point)) {
      if (!candidates.includes(extra)) candidates.push(extra)
    }

    for (const path of candidates) {
      // Priority: handle > anchor.
      for (let i = 0; i < path.segments.length; i++) {
        const seg = path.segments[i]
        const anchor = seg.point
        const hi = seg.handleIn as paper.Point | null
        const ho = seg.handleOut as paper.Point | null
        if (hi) {
          const hp = anchor.add(hi)
          if (hp.getDistance(event.point) <= tol) {
            this.ensureEditedPath(path)
            this.clearAnchorSelection()
            this.grab = 'handle'
            this.grabPath = path
            this.grabSegmentIndex = i
            this.grabIsIn = true
            return true
          }
        }
        if (ho) {
          const hp = anchor.add(ho)
          if (hp.getDistance(event.point) <= tol) {
            this.ensureEditedPath(path)
            this.clearAnchorSelection()
            this.grab = 'handle'
            this.grabPath = path
            this.grabSegmentIndex = i
            this.grabIsIn = false
            return true
          }
        }
      }
    }

    // 3) Plain anchor grab. Shift-click toggles the anchor's membership in
    //    the sub-selection; a plain click replaces it with just this anchor.
    if (hit) {
      this.ensureEditedPath(hit.path)
      let targetPath = hit.path
      if (modifiers.alt) {
        targetPath = this.altDuplicatePaths([hit.path]).get(hit.path) ?? hit.path
      }
      if (modifiers.shift) {
        this.toggleAnchorSelection(targetPath, hit.index)
      } else {
        if (!this.isAnchorSelected(targetPath, hit.index)) {
          this.clearAnchorSelection()
          this.addAnchorToSelection(targetPath, hit.index)
        }
        // Plain anchor click (even on an already-selected anchor) means
        // anchor intent: drop curve entries so Delete removes anchors.
        this.clearCurveSelection()
      }
      this.grab = this.hasAnchorSelection() ? 'anchor-group' : 'anchor'
      this.grabPath = targetPath
      this.grabSegmentIndex = hit.index
      this.grabIsIn = false
      this.dragStartPoint = { x: event.point.x, y: event.point.y }
      this.dragConstrainOrigin = { x: event.point.x, y: event.point.y }
      return true
    }
    return false
  }

  /**
   * Find the anchor nearest the given point within tolerance. Anchors that
   * already belong to the sub-selection are preferred so grabbing a selected
   * anchor wins over picking an unselected one from an overlapping path.
   */
  private anchorHitAt(point: paper.Point, tol: number): { path: paper.Path; index: number } | null {
    let best: { path: paper.Path; index: number; dist: number; sel: boolean } | null = null
    for (const path of this.userPathsAt(point)) {
      for (let i = 0; i < path.segments.length; i++) {
        const d = path.segments[i].point.getDistance(point)
        if (d > tol) continue
        const sel = this.isAnchorSelected(path, i)
        if (!best || (sel && !best.sel) || (sel === best.sel && d < best.dist)) {
          best = { path, index: i, dist: d, sel }
        }
      }
    }
    return best ? { path: best.path, index: best.index } : null
  }

  /** Select a path so direct-select anchors operate on it. */
  private ensureEditedPath(path: paper.Path) {
    const engine = this.engine
    if (!engine) return
    if (!path.selected) {
      engine.clearSelection()
      engine.selectItem(path)
    }
  }

  /** Collect user paths near a point (used to choose an anchor target). */
  private userPathsAt(point: paper.Point): paper.Path[] {
    const engine = this.engine
    if (!engine) return []
    const scope = engine.scope
    const out: paper.Path[] = []
    const tol = 6 / scope.view.zoom
    const collect = (item: paper.Item) => {
      if (item instanceof scope.Path) {
        const p = item as paper.Path
        const segs = p.segments
        for (let i = 0; i < segs.length; i++) {
          const a = segs[i].point
          const hi = segs[i].handleIn as paper.Point | null
          const ho = segs[i].handleOut as paper.Point | null
          if (a.getDistance(point) <= tol) { out.push(p); return }
          if (hi && a.add(hi).getDistance(point) <= tol) { out.push(p); return }
          if (ho && a.add(ho).getDistance(point) <= tol) { out.push(p); return }
        }
      }
      if (item.children) item.children.forEach(collect)
    }
    for (const layer of engine.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      layer.children.forEach(collect)
    }
    return out
  }

  /**
   * Shift axis-lock for sub-object drags (AI): the free axis stays pinned
   * to the grab-time pointer, measured as totals from the grab origin.
   */
  private constrainPoint(raw: paper.Point, modifiers?: any): paper.Point {
    const engine = this.engine
    if (!engine || !modifiers?.shift || !this.dragConstrainOrigin) return raw
    const ox = this.dragConstrainOrigin.x
    const oy = this.dragConstrainOrigin.y
    const tx = raw.x - ox
    const ty = raw.y - oy
    if (Math.abs(tx) >= Math.abs(ty)) return new engine.scope.Point(raw.x, oy)
    return new engine.scope.Point(ox, raw.y)
  }

  private dragAnchor(point: paper.Point, modifiers?: any) {
    const engine = this.engine
    if (!engine) return
    if (this.grab === 'anchor-group' && this.hasAnchorSelection()) {
      // Translate every sub-selected anchor as one rigid group.
      if (!this.dragStartPoint) return
      // Static snap first (own paths excluded so the grab never sticks to
      // its start), then the Shift axis lock — same order as object drags.
      const snapped = this.snapService.snapPoint(point, this.anchorSelectionPaths())
      const eff = this.constrainPoint(snapped, modifiers)
      const dx = eff.x - this.dragStartPoint.x
      const dy = eff.y - this.dragStartPoint.y
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return
      for (const entry of this.selectedSegments) {
        const seg = entry.path.segments[entry.index]
        if (!seg) continue
        seg.point = seg.point.add(new engine.scope.Point(dx, dy))
      }
      for (const path of this.anchorSelectionPaths()) engine.refreshItemGradient(path)
      this.dragStartPoint = { x: eff.x, y: eff.y }
      engine.scope.view.update()
      return
    }
    const path = this.grabPath ?? this.getEditPath()
    if (!path) return
    const seg = path.segments[this.grabSegmentIndex]
    if (!seg) return
    const snapped = this.snapService.snapPoint(point, [path])
    seg.point = this.constrainPoint(snapped, modifiers)
    engine.refreshItemGradient(path)
    engine.scope.view.update()
  }

  private dragHandle(point: paper.Point) {
    const path = this.getEditPath()
    const engine = this.engine
    if (!path || !engine) return
    const seg = path.segments[this.grabSegmentIndex]
    if (!seg) return
    const rel = point.subtract(seg.point)
    if (this.grabIsIn) seg.handleIn = rel
    else seg.handleOut = rel
    engine.scope.view.update()
  }

  /**
   * Alt-drag duplicate for sub-object grabs (AI duplicates the whole
   * path): clone every involved path in place, reselect the clones and
   * remap anchor/curve entries (indices carry over untouched). One
   * Duplicate entry up front mirrors the object Alt-drag flow.
   */
  private altDuplicatePaths(paths: paper.Path[]): Map<paper.Path, paper.Path> {
    const engine = this.engine!
    const remap = new Map<paper.Path, paper.Path>()
    const seen = new Set(paths)
    for (const path of seen) {
      if (!path.parent) continue
      const parent = path.parent
      const at = parent.children.indexOf(path)
      const clone = path.clone({ insert: false }) as paper.Path
      engine.restampCloneTree(clone)
      const data = (clone.data as any) ?? {}
      data.id = engine.genId()
      data.isUserItem = true
      parent.insertChild(at < 0 ? parent.children.length : at + 1, clone)
      path.selected = false
      clone.selected = true
      remap.set(path, clone)
    }
    if (remap.size === 0) return remap
    this.selectedSegments = this.selectedSegments.map((s) => {
      const clone = remap.get(s.path)
      return clone ? { path: clone, index: s.index } : s
    })
    this.selectedCurves = this.selectedCurves.map((s) => {
      const clone = remap.get(s.path)
      return clone ? { path: clone, curve: s.curve } : s
    })
    engine.syncSelectionToStore()
    engine.pushHistory('Duplicate')
    engine.scope.view.update()
    return remap
  }

  private deleteGrabbedAnchor() {
    const path = this.getEditPath()
    const engine = this.engine
    if (!path || !engine) return
    const scope = engine.scope
    const idx = this.grabSegmentIndex
    if (idx < 0 || idx >= path.segments.length) return
    const remaining = path.segments.length - 1
    const survives = path.closed ? remaining >= 2 : remaining >= 2
    if (!survives) {
      path.remove()
      engine.clearSelection()
      this.clearAnchorState()
      this.clearCurveSelection()
      this.chrome.clear()
      engine.pushHistory('Delete Anchor')
      scope.view.update()
      return
    }
    path.removeSegment(idx)
    if (path.closed && path.segments.length === 2) path.closed = false
    this.grabSegmentIndex = -1
    engine.pushHistory('Delete Anchor')
    scope.view.update()
  }

  // ------------------------------------------------------------------
  // Curve (segment) sub-selection (direct-select)
  // ------------------------------------------------------------------

  /**
   * Nearest curve (segment between two anchors) within tolerance. Only
   * plain editable paths qualify: compound children would break their
   * compound, pattern tiles and text modes are never direct-edited.
   * Later (top-most) hits win ties, matching paint order.
   */
  private curveHitAt(point: paper.Point, tol: number): { path: paper.Path; curve: number } | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    // Holder object (not a bare `let`): assignments inside the `walk`
    // closure below are invisible to control-flow narrowing at the return.
    const found: { hit: { path: paper.Path; curve: number; dist: number } | null } = { hit: null }
    const walk = (item: paper.Item) => {
      if ((item as any).locked) return
      const data = (item.data as any) ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard || data.annotation) return
      if (data.isPatternTile || data.isPatternFill || data.textMode) return
      // Clipping masks reshape their whole group; never direct-edit one.
      if ((item as any).clipMask) return
      if (item instanceof scope.Path && !(item instanceof scope.CompoundPath)) {
        const path = item as paper.Path
        if (!path.parent || path.segments.length < 2) return
        if (path.parent instanceof scope.CompoundPath) return
        if (path.parent instanceof scope.Layer && !(path.parent.data as any)?.isUserLayer) return
        const bounds = path.bounds
        if (!bounds || !bounds.expand(tol).contains(point)) return
        let loc: any = null
        try {
          loc = path.getNearestLocation(point)
        } catch {
          return
        }
        if (!loc || !loc.curve || !loc.point) return
        const d = (loc.point as paper.Point).getDistance(point)
        if (d > tol) return
        const index = (loc.curve as paper.Curve).index
        if (index < 0 || index >= path.curves.length) return
        if (!found.hit || d <= found.hit.dist) found.hit = { path, curve: index, dist: d }
        return
      }
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) walk(child as paper.Item)
      }
    }
    for (const layer of engine.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      for (const child of layer.children) walk(child as paper.Item)
    }
    return found.hit ? { path: found.hit.path, curve: found.hit.curve } : null
  }

  /** End anchor indices of a curve (curve i spans segments[i] → next). */
  private curveEndAnchors(path: paper.Path, curve: number): [number, number] | null {
    const n = path.segments.length
    if (n < 2 || curve < 0 || curve >= path.curves.length) return null
    return [curve, (curve + 1) % n]
  }

  private isCurveSelected(path: paper.Path, curve: number): boolean {
    return this.selectedCurves.some((s) => s.path === path && s.curve === curve)
  }

  /** Select a curve plus its two end anchors (AI shows both ends solid). */
  private addCurveToSelection(path: paper.Path, curve: number) {
    if (!this.isCurveSelected(path, curve)) {
      this.selectedCurves.push({ path, curve })
    }
    const ends = this.curveEndAnchors(path, curve)
    if (ends) {
      this.addAnchorToSelection(path, ends[0])
      this.addAnchorToSelection(path, ends[1])
    }
  }

  /** Drop a curve; end anchors shared with other curves stay selected. */
  private removeCurveFromSelection(path: paper.Path, curve: number) {
    const at = this.selectedCurves.findIndex((s) => s.path === path && s.curve === curve)
    if (at < 0) return
    this.selectedCurves.splice(at, 1)
    const ends = this.curveEndAnchors(path, curve)
    if (!ends) return
    for (const anchor of ends) {
      const shared = this.selectedCurves.some((s) => {
        const other = this.curveEndAnchors(s.path, s.curve)
        return !!other && s.path === path && (other[0] === anchor || other[1] === anchor)
      })
      if (!shared) {
        const si = this.selectedSegments.findIndex((s) => s.path === path && s.index === anchor)
        if (si >= 0) this.selectedSegments.splice(si, 1)
      }
    }
  }

  private toggleCurveSelection(path: paper.Path, curve: number) {
    if (this.isCurveSelected(path, curve)) this.removeCurveFromSelection(path, curve)
    else this.addCurveToSelection(path, curve)
  }

  private clearCurveSelection() {
    this.selectedCurves = []
  }

  private hasCurveSelection(): boolean {
    return this.selectedCurves.length > 0
  }

  /** Drop curve entries whose path or curve no longer exists. */
  private pruneCurveSelection() {
    this.selectedCurves = this.selectedCurves.filter(
      (s) => s.path.parent && s.curve >= 0 && s.curve < s.path.curves.length
    )
  }

  /**
   * Drag the selected curves by translating every distinct end anchor
   * rigidly. Handles are anchor-relative in Paper.js, so they travel along
   * and adjacent curves reshape — the AI segment-move feel.
   */
  private dragSegment(point: paper.Point, modifiers?: any) {
    const engine = this.engine
    if (!engine || !this.dragStartPoint) return
    const curvePaths: paper.Path[] = []
    for (const entry of this.selectedCurves) {
      if (!curvePaths.includes(entry.path)) curvePaths.push(entry.path)
    }
    const snapped = this.snapService.snapPoint(point, curvePaths)
    const eff = this.constrainPoint(snapped, modifiers)
    const dx = eff.x - this.dragStartPoint.x
    const dy = eff.y - this.dragStartPoint.y
    if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return
    this.pruneCurveSelection()
    const seen = new Set<paper.Segment>()
    for (const entry of this.selectedCurves) {
      const ends = this.curveEndAnchors(entry.path, entry.curve)
      if (!ends) continue
      for (const index of ends) {
        const seg = entry.path.segments[index]
        if (!seg || seen.has(seg)) continue
        seen.add(seg)
        seg.point = seg.point.add(new engine.scope.Point(dx, dy))
      }
      engine.refreshItemGradient(entry.path)
    }
    this.dragStartPoint = { x: eff.x, y: eff.y }
    engine.scope.view.update()
  }

  /**
   * Join from the anchor sub-selection (AI Ctrl+J): exactly two selected
   * endpoints. Same path + both ends closes it; two paths merge end to
   * end with the chosen ends meeting. Returns null when there is no
   * sub-selection (caller falls through to object join), false when the
   * selection cannot join.
   */
  joinEndpointsFromSubselection(): boolean | null {
    const engine = this.engine
    if (!engine || this.mode !== 'direct-select') return null
    this.pruneAnchorSelection()
    this.pruneCurveSelection()
    if (this.selectedSegments.length === 0 && this.selectedCurves.length === 0) return null
    // Curves resolve to their end anchors, like everywhere else.
    const ends: Array<{ path: paper.Path; index: number }> = []
    const seen = new Set<string>()
    const take = (path: paper.Path, index: number) => {
      const key = `${(path.data as any)?.id ?? ''}:${index}`
      if (seen.has(key)) return
      seen.add(key)
      ends.push({ path, index })
    }
    for (const s of this.selectedSegments) take(s.path, s.index)
    for (const c of this.selectedCurves) {
      const pair = this.curveEndAnchors(c.path, c.curve)
      if (pair) {
        take(c.path, pair[0])
        take(c.path, pair[1])
      }
    }
    if (ends.length !== 2) return false
    const scope = engine.scope
    const valid = (entry: { path: paper.Path; index: number }): boolean => {
      const { path, index } = entry
      if (!path.parent || (path as any).locked) return false
      if (!(path instanceof scope.Path) || path instanceof scope.CompoundPath) return false
      if (path.closed || path.segments.length === 0) return false
      const last = path.segments.length - 1
      return index === 0 || index === last
    }
    if (!valid(ends[0]) || !valid(ends[1])) return false
    const [a, b] = ends
    if (a.path === b.path) {
      if (a.index === b.index) return false
      a.path.closed = true
      engine.refreshItemGradient(a.path)
      this.clearCurveSelection()
      this.clearAnchorSelection()
      this.clearAnchorState()
      engine.pushHistory('Join Paths')
      engine.scope.view.update()
      this.refreshChrome()
      return true
    }
    // Orient each walk so the chosen ends meet: the first path ends with
    // its anchor, the second starts with its anchor.
    const ordered = [a.path, b.path]
      .slice()
      .sort((p, q) => (p.isBelow(q) ? -1 : p.isAbove(q) ? 1 : 0))
    const first = ordered[0]
    const second = ordered[1]
    const firstIdx = first === a.path ? a.index : b.index
    const secondIdx = second === a.path ? a.index : b.index
    const ok = engine.mergePathsEndToEnd(first, second, firstIdx === 0, secondIdx !== 0)
    if (!ok) return false
    this.clearCurveSelection()
    this.clearAnchorSelection()
    this.clearAnchorState()
    this.refreshChrome()
    return true
  }

  /**
   * Re-layout path-text runs attached to the paths touched by the current
   * gesture (anchor/curve drags reshape them, object drags move them).
   * Runs before the gesture's history push so snapshots include the text.
   */
  private reflowEditedPaths() {
    const engine = this.engine
    if (!engine) return
    const touched: paper.Item[] = []
    for (const p of this.anchorSelectionPaths()) touched.push(p)
    if (this.grabPath && !touched.includes(this.grabPath)) touched.push(this.grabPath)
    for (const s of this.selectedCurves) {
      if (!touched.includes(s.path)) touched.push(s.path)
    }
    for (const item of this.dragItems) touched.push(item)
    engine.reflowTextsForItems(touched)
  }

  // ------------------------------------------------------------------
  // Anchor sub-selection (direct-select)
  // ------------------------------------------------------------------

  private isAnchorSelected(path: paper.Path, index: number): boolean {
    return this.selectedSegments.some((s) => s.path === path && s.index === index)
  }

  private addAnchorToSelection(path: paper.Path, index: number) {
    if (!this.isAnchorSelected(path, index)) {
      this.selectedSegments.push({ path, index })
    }
  }

  private toggleAnchorSelection(path: paper.Path, index: number) {
    const at = this.selectedSegments.findIndex((s) => s.path === path && s.index === index)
    if (at >= 0) this.selectedSegments.splice(at, 1)
    else this.selectedSegments.push({ path, index })
  }

  private clearAnchorSelection() {
    this.selectedSegments = []
  }

  private hasAnchorSelection(): boolean {
    return this.selectedSegments.length > 0
  }

  /** Drop sub-selection entries whose path or segment no longer exists. */
  private pruneAnchorSelection() {
    this.selectedSegments = this.selectedSegments.filter(
      (s) => s.path.parent && s.index >= 0 && s.index < s.path.segments.length
    )
  }

  /**
   * Collect the paths involved in the anchor sub-selection so their handles
   * can be drawn together with the selected anchors.
   */
  private anchorSelectionPaths(): paper.Path[] {
    const out: paper.Path[] = []
    for (const s of this.selectedSegments) {
      if (!out.includes(s.path)) out.push(s.path)
    }
    return out
  }

  /**
   * Direct-select Ctrl+A (AI): select every anchor of the selected paths.
   * Returns false when there is nothing to sub-select so the caller falls
   * back to whole-object selection. Curves highlight themselves through
   * their (now fully selected) end anchors.
   */
  selectAllSubselection(): boolean {
    const engine = this.engine
    if (!engine || this.mode !== 'direct-select') return false
    const scope = engine.scope
    const paths: paper.Path[] = []
    const walk = (item: paper.Item) => {
      if ((item as any).locked) return
      if (item instanceof scope.Path && !(item instanceof scope.CompoundPath)) {
        if (item.parent && (item as paper.Path).segments.length > 0 && !paths.includes(item as paper.Path)) {
          paths.push(item as paper.Path)
        }
        return
      }
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) walk(child as paper.Item)
      }
    }
    for (const item of engine.getSelection()) walk(item)
    if (paths.length === 0) return false
    this.clearCurveSelection()
    this.selectedSegments = []
    for (const path of paths) {
      for (let i = 0; i < path.segments.length; i++) {
        this.addAnchorToSelection(path, i)
      }
    }
    engine.scope.view.update()
    this.refreshChrome()
    return true
  }

  /**
   * Arrow-key nudge for the sub-selection (AI moves selected anchors, not
   * whole objects). Shares the engine's coalesced Nudge history so holding
   * a key still records one undo step.
   */
  nudgeSubselection(dx: number, dy: number): boolean {
    const engine = this.engine
    if (!engine || this.mode !== 'direct-select') return false
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return false
    this.pruneAnchorSelection()
    this.pruneCurveSelection()
    const owned: Array<{ seg: paper.Segment; path: paper.Path }> = []
    const seen = new Set<paper.Segment>()
    const take = (path: paper.Path, index: number) => {
      if ((path as any).locked) return
      const seg = path.segments[index]
      if (!seg || seen.has(seg)) return
      seen.add(seg)
      owned.push({ seg, path })
    }
    for (const s of this.selectedSegments) take(s.path, s.index)
    for (const c of this.selectedCurves) {
      const ends = this.curveEndAnchors(c.path, c.curve)
      if (ends) {
        take(c.path, ends[0])
        take(c.path, ends[1])
      }
    }
    if (owned.length === 0) return false
    const delta = new engine.scope.Point(dx, dy)
    const paths = new Set<paper.Path>()
    for (const { seg, path } of owned) {
      seg.point = seg.point.add(delta)
      paths.add(path)
    }
    paths.forEach((path) => engine.refreshItemGradient(path))
    engine.reflowTextsForItems([...paths])
    engine.scope.view.update()
    engine.pushCoalescedHistory('Nudge')
    this.refreshChrome()
    return true
  }

  /** Distinct sub-selected anchors (curves resolve to their end anchors). */
  private subselectionAnchors(): Array<{ seg: paper.Segment; path: paper.Path }> {
    const engine = this.engine
    if (!engine) return []
    this.pruneAnchorSelection()
    this.pruneCurveSelection()
    const out: Array<{ seg: paper.Segment; path: paper.Path }> = []
    const seen = new Set<paper.Segment>()
    const take = (path: paper.Path, index: number) => {
      if ((path as any).locked) return
      const seg = path.segments[index]
      if (!seg || seen.has(seg)) return
      seen.add(seg)
      out.push({ seg, path })
    }
    for (const s of this.selectedSegments) take(s.path, s.index)
    for (const c of this.selectedCurves) {
      const ends = this.curveEndAnchors(c.path, c.curve)
      if (ends) {
        take(c.path, ends[0])
        take(c.path, ends[1])
      }
    }
    return out
  }

  /**
   * Align sub-selected anchors (AI): to an explicit target rect (artboard)
   * or within their own united bounds (needs 2+ anchors then). Returns
   * null with no sub-selection (caller falls through to object align).
   */
  alignSubselection(mode: AlignMode, target?: paper.Rectangle | null): boolean | null {
    const engine = this.engine
    if (!engine || this.mode !== 'direct-select') return null
    const anchors = this.subselectionAnchors()
    if (anchors.length === 0) return null
    const scope = engine.scope
    let bounds = target ?? null
    if (!bounds) {
      if (anchors.length < 2) return false
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (const { seg } of anchors) {
        minX = Math.min(minX, seg.point.x)
        minY = Math.min(minY, seg.point.y)
        maxX = Math.max(maxX, seg.point.x)
        maxY = Math.max(maxY, seg.point.y)
      }
      bounds = new scope.Rectangle(minX, minY, Math.max(0, maxX - minX), Math.max(0, maxY - minY))
    }
    const left = bounds.x
    const centerX = bounds.x + bounds.width / 2
    const right = bounds.x + bounds.width
    const top = bounds.y
    const centerY = bounds.y + bounds.height / 2
    const bottom = bounds.y + bounds.height
    let moved = false
    const paths = new Set<paper.Path>()
    for (const { seg, path } of anchors) {
      let x = seg.point.x
      let y = seg.point.y
      if (mode === 'left') x = left
      else if (mode === 'centerX') x = centerX
      else if (mode === 'right') x = right
      else if (mode === 'top') y = top
      else if (mode === 'centerY') y = centerY
      else y = bottom
      if (Math.abs(x - seg.point.x) < 1e-9 && Math.abs(y - seg.point.y) < 1e-9) continue
      seg.point = new scope.Point(x, y)
      paths.add(path)
      moved = true
    }
    if (!moved) return false
    paths.forEach((path) => engine.refreshItemGradient(path))
    engine.scope.view.update()
    engine.pushHistory('Align Anchors')
    this.refreshChrome()
    return true
  }

  /**
   * Distribute sub-selected anchors evenly along an axis (AI). Point
   * spacing and center spacing coincide for anchors, so one routine
   * serves both panel buttons. Needs 3+ anchors with distinct extremes.
   */
  distributeSubselection(axis: DistributeAxis): boolean | null {
    const engine = this.engine
    if (!engine || this.mode !== 'direct-select') return null
    const anchors = this.subselectionAnchors()
    if (anchors.length === 0) return null
    if (anchors.length < 3) return false
    const horizontal = axis === 'horizontal'
    const at = anchors.map((a) => (horizontal ? a.seg.point.x : a.seg.point.y))
    const order = anchors.map((_, i) => i).sort((a, b) => at[a] - at[b])
    const first = at[order[0]]
    const last = at[order[order.length - 1]]
    if (!Number.isFinite(first) || !Number.isFinite(last)) return false
    if (Math.abs(last - first) < 1e-9) return false
    const step = (last - first) / (anchors.length - 1)
    let moved = false
    const paths = new Set<paper.Path>()
    order.forEach((anchorIndex, rank) => {
      const { seg, path } = anchors[anchorIndex]
      const goal = first + step * rank
      const current = horizontal ? seg.point.x : seg.point.y
      if (Math.abs(goal - current) < 1e-9) return
      seg.point = horizontal
        ? new engine.scope.Point(goal, seg.point.y)
        : new engine.scope.Point(seg.point.x, goal)
      paths.add(path)
      moved = true
    })
    if (!moved) return false
    paths.forEach((path) => engine.refreshItemGradient(path))
    engine.scope.view.update()
    engine.pushHistory('Distribute Anchors')
    this.refreshChrome()
    return true
  }

  /**
   * Average sub-selected anchors (AI Object > Path > Average): collapse to
   * the mean X, mean Y, or both. Handles follow their anchors. Needs 2+
   * anchors; null with no sub-selection (caller reports, no fallthrough).
   */
  averageSubselection(axis: 'horizontal' | 'vertical' | 'both'): boolean | null {
    const engine = this.engine
    if (!engine || this.mode !== 'direct-select') return null
    const anchors = this.subselectionAnchors()
    if (anchors.length === 0) return null
    if (anchors.length < 2) return false
    let mx = 0
    let my = 0
    for (const { seg } of anchors) {
      mx += seg.point.x
      my += seg.point.y
    }
    mx /= anchors.length
    my /= anchors.length
    let moved = false
    const paths = new Set<paper.Path>()
    for (const { seg, path } of anchors) {
      const x = axis === 'vertical' ? seg.point.x : mx
      const y = axis === 'horizontal' ? seg.point.y : my
      if (Math.abs(x - seg.point.x) < 1e-9 && Math.abs(y - seg.point.y) < 1e-9) continue
      seg.point = new engine.scope.Point(x, y)
      paths.add(path)
      moved = true
    }
    if (!moved) return false
    paths.forEach((path) => engine.refreshItemGradient(path))
    engine.reflowTextsForItems([...paths])
    engine.scope.view.update()
    engine.pushHistory('Average Anchors')
    this.refreshChrome()
    return true
  }

  /**
   * Split paths at sub-selected anchors (AI scissors-on-anchor parity):
   * open paths break into runs between the cut anchors, closed paths open
   * (one anchor) or split into arcs (several). Text-run paths are skipped.
   * Null with no sub-selection; false when nothing could split.
   */
  splitAtSelectedAnchors(): boolean | null {
    const engine = this.engine
    if (!engine || this.mode !== 'direct-select') return null
    const anchors = this.subselectionAnchors()
    if (anchors.length === 0) return null
    const scope = engine.scope
    const byPath = new Map<paper.Path, number[]>()
    for (const { seg, path } of anchors) {
      if ((path as any).data?.textMode) continue
      const index = path.segments.indexOf(seg as any)
      if (index < 0) continue
      const list = byPath.get(path) ?? []
      if (!list.includes(index)) list.push(index)
      byPath.set(path, list)
    }
    // Plan first (mutation invalidates segment identity).
    const ops: Array<{ path: paper.Path; ranges: Array<[number, number]>; closed: boolean }> = []
    for (const [path, indices] of byPath) {
      const n = path.segments.length
      if (n < 2 || !path.parent) continue
      const sorted = indices.slice().sort((a, b) => a - b)
      if (path.closed) {
        if (sorted.length === 1) {
          ops.push({ path, ranges: [[sorted[0], sorted[0] + n]], closed: true })
        } else {
          const ranges: Array<[number, number]> = []
          for (let k = 0; k < sorted.length; k++) {
            ranges.push([sorted[k], sorted[(k + 1) % sorted.length] + (k === sorted.length - 1 ? n : 0)])
          }
          ops.push({ path, ranges, closed: true })
        }
      } else {
        const cuts = sorted.filter((i) => i > 0 && i < n - 1)
        if (cuts.length === 0) continue
        const bounds = [0, ...cuts, n - 1]
        const ranges: Array<[number, number]> = []
        for (let k = 0; k + 1 < bounds.length; k++) ranges.push([bounds[k], bounds[k + 1]])
        ops.push({ path, ranges, closed: false })
      }
    }
    if (ops.length === 0) return false
    const pieces: paper.Path[] = []
    for (const { path, ranges, closed } of ops) {
      const style = engine.getStyleFromItem(path)
      const parent = path.parent ?? engine.getActiveLayer()
      const at = parent.children.indexOf(path as any)
      const made: paper.Path[] = []
      ranges.forEach(([from, to], ri) => {
        const segs: paper.Segment[] = []
        for (let i = from; i <= to; i++) {
          const src = path.segments[closed ? i % path.segments.length : i]
          segs.push(
            new scope.Segment(
              src.point.clone(),
              (src.handleIn as paper.Point).clone(),
              (src.handleOut as paper.Point).clone()
            )
          )
        }
        if (segs.length === 0) return
        const piece = new scope.Path(segs) as paper.Path
        piece.closed = false
        parent.insertChild(Math.min(Math.max(at + 1 + ri, 0), parent.children.length), piece as any)
        piece.data.id = engine.genId()
        piece.data.isUserItem = true
        engine.applyStyleToItem(piece, style)
        made.push(piece)
      })
      if (made.length === 0) continue
      path.remove()
      pieces.push(...made)
    }
    if (pieces.length === 0) return false
    // Drop the now-stale sub-selection (its segments are gone).
    this.selectedSegments = []
    this.clearCurveSelection()
    engine.clearSelection()
    pieces.forEach((item) => {
      item.selected = true
    })
    engine.syncSelectionToStore()
    engine.pushHistory('Split at Anchors')
    engine.scope.view.update()
    this.refreshChrome()
    return true
  }

  /**
   * Round sharp corners (AI Round Corners / CDR fillet lite): sub-selected
   * anchors when present, else every sharp non-endpoint anchor of the
   * selected paths. Handles extend along both edges by the clamped kappa
   * run; smooth anchors and text runs are left alone. One history entry.
   */
  roundSelectedCorners(radius: number): number {
    const engine = this.engine
    if (!engine || !Number.isFinite(radius) || radius <= 0) return 0
    const scope = engine.scope
    const r = Math.min(500, radius)
    const targets = new Map<paper.Path, number[] | null>()
    // Sub-selected anchors only count in direct-select (other tools leave
    // stale segment sets behind); everywhere else every sharp corner goes.
    if (this.mode === 'direct-select') {
      for (const { seg, path } of this.subselectionAnchors()) {
        if ((path as any).data?.textMode) continue
        const index = path.segments.indexOf(seg as any)
        if (index < 0) continue
        const list = targets.get(path) ?? []
        if (!list.includes(index)) list.push(index)
        targets.set(path, list)
      }
    }
    if (targets.size === 0) {
      for (const item of engine.getSelection()) {
        if ((item as any).locked || !item.parent) continue
        const paths: paper.Path[] =
          item instanceof scope.CompoundPath
            ? (((item as any).children ?? []) as paper.Item[]).filter(
                (c): c is paper.Path => c instanceof scope.Path
              )
            : item instanceof scope.Path
              ? [item]
              : []
        for (const path of paths) {
          if ((path as any).data?.textMode) continue
          targets.set(path, null)
        }
      }
    }
    if (targets.size === 0) return 0
    let rounded = 0
    const touched = new Set<paper.Path>()
    for (const [path, only] of targets) {
      const n = path.segments.length
      if (n < 2) continue
      const indices = only ?? path.segments.map((_, i) => i)
      for (const i of indices) {
        if (!path.closed && (i === 0 || i === n - 1)) continue
        const seg = path.segments[i]
        if (!seg) continue
        const hi = (seg.handleIn as paper.Point).length
        const ho = (seg.handleOut as paper.Point).length
        if (hi > 1e-9 || ho > 1e-9) continue
        const prev = path.segments[(i - 1 + n) % n].point
        const next = path.segments[(i + 1) % n].point
        const la = seg.point.getDistance(prev)
        const lb = seg.point.getDistance(next)
        const k = roundCornerHandle(la, lb, r)
        if (k <= 1e-9) continue
        const u = seg.point.subtract(prev).normalize()
        const v = next.subtract(seg.point).normalize()
        seg.handleIn = u.multiply(-k)
        seg.handleOut = v.multiply(k)
        touched.add(path)
        rounded++
      }
    }
    if (rounded > 0) {
      touched.forEach((path) => engine.refreshItemGradient(path))
      engine.reflowTextsForItems([...touched])
      engine.pushHistory('Round Corners')
      engine.scope.view.update()
      this.refreshChrome()
    }
    return rounded
  }

  /**
   * Finish an anchor marquee: every anchor inside the rubber band joins the
   * sub-selection. Shift extends the existing sub-selection, otherwise the
   * rubber band defines the whole sub-selection.
   */
  private finishAnchorMarquee() {
    const engine = this.engine
    if (!engine || !this.marqueeRect) return
    const scope = engine.scope
    // The rubber band is built from tool event points, which live in project
    // space — the same space as segment points — so it can be used as-is.
    const rectInProject = this.marqueeRect.bounds

    const additive = this.marqueeShift
    if (!additive) this.selectedSegments = []
    if (!additive) this.clearCurveSelection()

    const touchedPaths: paper.Path[] = []
    for (const layer of engine.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      this.collectAnchorsInRect(layer as unknown as paper.Item, rectInProject, touchedPaths)
    }
    for (const path of touchedPaths) {
      for (let i = 0; i < path.segments.length; i++) {
        const pt = path.segments[i].point
        if (rectInProject.contains(pt)) this.addAnchorToSelection(path, i)
      }
    }
    if (this.selectedSegments.length > 0) {
      // Keep the owning paths highlighted (AI shows the path outline too).
      for (const path of this.anchorSelectionPaths()) path.selected = true
      engine.syncSelectionToStore()
    } else {
      engine.clearSelection()
    }
    this.refreshChrome()
  }

  /** Collect editable leaf paths under the item (paths themselves included). */
  private collectAnchorsInRect(item: paper.Item, rect: paper.Rectangle, out: paper.Path[]) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    if (item instanceof scope.Path && !(item instanceof scope.CompoundPath)) {
      // CompoundPath children are collected via the parent branch below.
      if (rect.intersects(item.bounds)) out.push(item as paper.Path)
      return
    }
    if (item.children) {
      for (const child of item.children) {
        this.collectAnchorsInRect(child as paper.Item, rect, out)
      }
    }
  }

  /**
   * Delete entry for menu callers (mirrors the controller keydown branch):
   * sub-selections delete anchors/curves, otherwise false so the caller
   * falls through to whole-object deletion.
   */
  deleteSubselection(): boolean {
    const engine = this.engine
    if (!engine || this.mode !== 'direct-select') return false
    if (this.hasCurveSelection()) {
      this.deleteSelectedCurves()
    } else if (this.hasAnchorSelection()) {
      this.deleteSelectedAnchors()
    } else {
      return false
    }
    this.refreshChrome()
    return true
  }

  /** Delete every sub-selected anchor and clear the sub-selection. */
  private deleteSelectedAnchors() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    this.pruneAnchorSelection()
    if (this.selectedSegments.length === 0) return

    // Delete from the back so indices stay valid while removing. AI keeps
    // deleting while a drawable path survives: open paths need 2 anchors,
    // closed paths stay closed down to a triangle, become a line at 2 and
    // vanish below that.
    const byPath = new Map<paper.Path, number[]>()
    for (const s of this.selectedSegments) {
      const list = byPath.get(s.path) ?? []
      list.push(s.index)
      byPath.set(s.path, list)
    }
    const removedAll: paper.Path[] = []
    for (const [path, indices] of byPath) {
      indices.sort((a, b) => b - a)
      for (const idx of indices) {
        if (idx < 0 || idx >= path.segments.length) continue
        const remaining = path.segments.length - 1
        if (path.closed) {
          if (remaining >= 3) {
            path.removeSegment(idx)
          } else if (remaining === 2) {
            path.removeSegment(idx)
            path.closed = false
          } else {
            removedAll.push(path)
            break
          }
        } else {
          if (remaining >= 2) {
            path.removeSegment(idx)
          } else {
            removedAll.push(path)
            break
          }
        }
      }
    }
    for (const path of removedAll) {
      if (path.selected) path.selected = false
      path.remove()
    }
    this.clearAnchorSelection()
    this.clearCurveSelection()
    this.clearAnchorState()
    engine.pushHistory('Delete Anchors')
    scope.view.update()
  }

  /**
   * AI segment delete: remove the selected curves and split the path open
   * (middle curves split one path into runs; a fully consumed path is
   * removed). End anchors survive — only the curve between them goes.
   */
  private deleteSelectedCurves() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    this.pruneAnchorSelection()
    this.pruneCurveSelection()
    if (this.selectedCurves.length === 0) return
    const byPath = new Map<paper.Path, number[]>()
    for (const s of this.selectedCurves) {
      if (!s.path.parent) continue
      const list = byPath.get(s.path) ?? []
      list.push(s.curve)
      byPath.set(s.path, list)
    }
    const selectAfter: paper.Item[] = []
    for (const [path, curves] of byPath) {
      const removed = new Set(curves)
      const n = path.segments.length
      if (path.curves.length <= removed.size) {
        if (path.selected) path.selected = false
        path.remove()
        continue
      }
      const runs = remainingRuns(path.closed, n, removed)
      const style = engine.getStyleFromItem(path)
      const name = (path as any).name as string | undefined
      const parent = path.parent ?? engine.getActiveLayer()
      let at = parent.children.indexOf(path)
      if (at < 0) at = parent.children.length
      for (const run of runs) {
        if (run.length === 0) continue
        const np = new scope.Path({ insert: false }) as paper.Path
        for (const i of run) {
          const seg = path.segments[i]
          np.add(new scope.Segment(
            seg.point.clone(),
            (seg.handleIn as paper.Point | null)?.clone() as any,
            (seg.handleOut as paper.Point | null)?.clone() as any
          ))
        }
        np.closed = false
        parent.insertChild(Math.min(at++, parent.children.length), np)
        np.data.id = engine.genId()
        np.data.isUserItem = true
        if (name) (np as any).name = name
        engine.applyStyleToItem(np, style)
        selectAfter.push(np)
      }
      path.remove()
    }
    this.clearCurveSelection()
    // Anchor entries on rebuilt/removed paths are stale — prune them, but
    // keep entries on untouched paths so a mixed curve+anchor selection
    // deletes the curves first and the remaining anchors right after.
    this.pruneAnchorSelection()
    this.clearAnchorState()
    engine.clearSelection()
    selectAfter.forEach((item) => { item.selected = true })
    engine.syncSelectionToStore()
    engine.pushHistory('Delete Segment')
    if (this.hasAnchorSelection()) {
      this.deleteSelectedAnchors()
    } else {
      engine.scope.view.update()
      this.refreshChrome()
    }
  }

  /** Redraw editing chrome: bbox handles in select mode, anchors in direct-select. */
  private refreshChrome() {
    if (this.mode !== 'direct-select') {
      this.drawSelectionBounds()
      return
    }
    const engine = this.engine
    if (!engine) {
      this.restoreAllNativeSelections()
      this.chrome.clear()
      return
    }
    this.pruneAnchorSelection()
    this.pruneCurveSelection()
    // When anchors are sub-selected, draw chrome for every involved path so
    // multi-path anchor selections stay visible. Curve selections always
    // bring their own paths along.
    const paths = this.hasAnchorSelection() ? this.anchorSelectionPaths() : []
    for (const s of this.selectedCurves) {
      if (s.path.parent && !paths.includes(s.path)) paths.push(s.path)
    }
    if (paths.length === 0) {
      const path = this.getEditPath()
      if (path) paths.push(path)
    }
    if (paths.length === 0) {
      // No direct-edit target: fall back to select-style chrome so a plain
      // object selection still shows AI outlines instead of native blue.
      this.drawSelectionBounds()
      return
    }
    // Only our AnchorChrome should paint the anchor markers of the paths we
    // are editing: restore native decoration for items no longer part of the
    // chrome and suppress it for the ones we are about to draw.
    for (const item of Array.from(this.chromeSuppressed)) {
      if (!paths.includes(item as paper.Path)) this.restoreNativeSelection(item)
    }
    for (const path of paths) {
      if (path.selected) this.suppressNativeSelection(path)
      else this.restoreNativeSelection(path)
    }
    const scope = engine.scope
    this.chrome.clear()
    for (const path of paths) {
      const color = selectionColorForItem(engine, path)
      // AI order: path outline beneath, then handle lines/dots, anchors on top.
      this.chrome.drawItemOutline(path, color)
      const segs = path.segments
      // AI shows handles only for selected anchors (plus the anchor under
      // an active anchor/handle grab); unselected anchors stay hollow with
      // no handle chrome even when they carry handles.
      const editPath = this.grabPath ?? this.getEditPath()
      const selFlags = segs.map(
        (_, i) =>
          this.isAnchorSelected(path, i) ||
          (this.grabSegmentIndex === i &&
            path === editPath &&
            (this.grab === 'anchor' || this.grab === 'handle'))
      )
      for (let i = 0; i < segs.length; i++) {
        if (!selFlags[i]) continue
        const seg = segs[i]
        const hi = seg.handleIn as paper.Point | null
        const ho = seg.handleOut as paper.Point | null
        if (hi && !(Math.abs(hi.x) < 1e-6 && Math.abs(hi.y) < 1e-6)) {
          this.chrome.drawHandle(seg.point, seg.point.add(hi), color)
        }
        if (ho && !(Math.abs(ho.x) < 1e-6 && Math.abs(ho.y) < 1e-6)) {
          this.chrome.drawHandle(seg.point, seg.point.add(ho), color)
        }
      }
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i]
        // AI: unselected = hollow white, selected = solid layer color.
        this.chrome.drawAnchor(seg.point, selFlags[i], color)
      }
      // AI segment selection: the curve paints in the layer color (thicker
      // than the path outline) and both end anchors read solid. Curves
      // enclosed by a marquee (both ends selected) highlight the same way.
      const curves = path.curves
      for (let ci = 0; ci < curves.length; ci++) {
        const ends = this.curveEndAnchors(path, ci)
        if (!ends) continue
        if (
          this.isCurveSelected(path, ci) ||
          (this.isAnchorSelected(path, ends[0]) && this.isAnchorSelected(path, ends[1]))
        ) {
          this.chrome.drawCurveHighlight(path, ci, color)
        }
      }
    }
    scope.view.update()
  }

  // ------------------------------------------------------------------
  // Bounding-box transform (select mode): hit-testing and pivots run off
  // the persistent oriented frame, never the axis-aligned bounds, so a
  // tilted selection keeps tilted handles.
  // ------------------------------------------------------------------

  /** Opposite pivot name for a scale handle (the corner that stays fixed). */
  private oppositeHandle(handle: FrameHandle): FrameHandle {
    switch (handle) {
      case 'topLeft': return 'bottomRight'
      case 'topRight': return 'bottomLeft'
      case 'bottomLeft': return 'topRight'
      case 'bottomRight': return 'topLeft'
      case 'topCenter': return 'bottomCenter'
      case 'bottomCenter': return 'topCenter'
      case 'middleLeft': return 'middleRight'
      case 'middleRight': return 'middleLeft'
    }
  }

  private isCornerHandle(handle: TransformHandle): boolean {
    return (
      handle === 'topLeft' ||
      handle === 'topRight' ||
      handle === 'bottomLeft' ||
      handle === 'bottomRight'
    )
  }

  /**
   * Handle under a point within tolerance, measured on the oriented frame.
   * AI-aligned: exactly on a handle scales; just outside a corner (wider
   * band, outside the quad) rotates — the corner itself always wins so
   * scaling stays easy to grab.
   */
  private transformHandleAt(point: paper.Point, tol: number): TransformHandle {
    const engine = this.engine
    if (!engine) return 'none'
    this.ensureFrame()
    const f = this.frame
    if (!f) return 'none'
    const positions = this.frameCorners(f)
    const order: FrameHandle[] = [
      'topLeft', 'topCenter', 'topRight',
      'middleLeft', 'middleRight',
      'bottomLeft', 'bottomCenter', 'bottomRight',
    ]
    for (const handle of order) {
      if (point.getDistance(positions[handle]) <= tol) return handle
    }
    // Rotate band around the four corners (outside the quad only, so clicks
    // on artwork / marquee starts inside never misfire into a rotation).
    const local = this.frameToLocal(point, f)
    const hw = f.w / 2
    const hh = f.h / 2
    const outside =
      local.x < f.cx - hw || local.x > f.cx + hw ||
      local.y < f.cy - hh || local.y > f.cy + hh
    if (outside) {
      const rotateTol = tol * 2
      const corners: FrameHandle[] = [
        'topLeft', 'topRight', 'bottomLeft', 'bottomRight',
      ]
      for (const corner of corners) {
        if (point.getDistance(positions[corner]) <= rotateTol) return 'rotate'
      }
    }
    return 'none'
  }

  /** Nearest frame corner to a point (labels a corner-started rotate drag). */
  private nearestCorner(
    point: paper.Point,
    positions: Record<FrameHandle, paper.Point>
  ): FrameHandle {
    const corners: FrameHandle[] = [
      'topLeft', 'topRight', 'bottomLeft', 'bottomRight',
    ]
    let best = corners[0]
    let bestDist = point.getDistance(positions[best])
    for (const corner of corners) {
      const d = point.getDistance(positions[corner])
      if (d < bestDist) {
        best = corner
        bestDist = d
      }
    }
    return best
  }

  /** Clockwise pointer angle in degrees around a center point. */
  private pointerAngle(point: paper.Point, center: paper.Point): number {
    return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI
  }

  /** Begin a bbox transform drag when a handle is grabbed. */
  private tryGrabTransformHandle(event: paper.ToolEvent): boolean {
    const engine = this.engine
    if (!engine || this.mode !== 'select') return false
    if (engine.getSelection().length === 0) return false
    const tol = 7 / engine.scope.view.zoom
    const handle = this.transformHandleAt(event.point, tol)
    if (handle === 'none' || !this.frame) return false
    const f = this.frame
    const positions = this.frameCorners(f)
    this.transformKind = handle === 'rotate' ? 'rotate' : 'scale'
    this.transformItems = engine.getSelection()
    if (handle === 'rotate') {
      // AI corner rotation: the grab started just outside this corner; the
      // corner handle itself is highlighted while the reference pivot stays
      // the rotation origin. The live frame follows via engine.rotateSelection.
      this.transformHandle = this.nearestCorner(event.point, positions)
      this.transformScaleBase = null
      this.transformStartPoint = null
      this.transformLastTotalFx = 1
      this.transformLastTotalFy = 1
      this.transformUseCenter = false
      this.transformOpposite = null
      this.transformPivot = null
      // AI Transform proxy governs the origin: canvas rotation honors the
      // same 9-point reference pivot the Properties panel uses (frozen for
      // the whole drag so the origin never wanders).
      const pivot = engine.selectionReferencePivot() ?? new engine.scope.Point(f.cx, f.cy)
      this.transformRotatePivot = pivot.clone()
      this.transformCenter = pivot.clone()
      const startRaw = this.pointerAngle(event.point, pivot)
      this.transformRotateLastRaw = startRaw
      this.transformRotateAccum = 0
      this.transformRotateApplied = 0
    } else {
      this.transformHandle = handle
      // AI: Alt scales about the center, otherwise the opposite handle stays
      // fixed. Base frame + pivots freeze at grab time; Alt toggles mid-drag
      // re-baseline onto the live frame so the switch never jumps.
      this.transformScaleBase = { cx: f.cx, cy: f.cy, w: f.w, h: f.h, angle: f.angle }
      this.transformOpposite = positions[this.oppositeHandle(handle)].clone()
      this.transformCenter = new engine.scope.Point(f.cx, f.cy)
      this.transformUseCenter = !!(event.modifiers as any)?.alt
      this.transformPivot = (this.transformUseCenter ? this.transformCenter : this.transformOpposite).clone()
      this.transformStartPoint = { x: event.point.x, y: event.point.y }
      this.transformLastTotalFx = 1
      this.transformLastTotalFy = 1
    }
    this.transformLastPoint = { x: event.point.x, y: event.point.y }
    this.transformMoved = false
    this.grab = 'transform'
    this.isDragging = true
    this.dragStart = { x: event.point.x, y: event.point.y }
    return true
  }

  /** Apply one step of an in-progress bbox scale / rotate drag. */
  private dragTransform(point: paper.Point, modifiers: any) {
    const engine = this.engine
    if (!engine) return
    if (this.transformKind === 'rotate' && this.transformRotatePivot) {
      this.dragRotateAbsolute(point, modifiers)
    } else if (this.transformKind === 'scale') {
      this.dragScaleAbsolute(point, modifiers)
    }
    engine.store.setCursorPos(point.x, point.y)
    this.refreshChrome()
    engine.scope.view.update()
  }

  /**
   * AI-aligned canvas rotation: sweeps the pointer angle around the frozen
   * reference pivot. The unsnapped total accumulates every step (branch-cut
   * normalized, so multi-turn drags keep counting); Shift constrains the
   * total to 45-degree increments, snapping on the very next move when
   * pressed mid-drag — like Illustrator's constraint.
   */
  private dragRotateAbsolute(point: paper.Point, modifiers: any) {
    const engine = this.engine
    const pivot = this.transformRotatePivot
    if (!engine || !pivot) return
    const raw = this.pointerAngle(point, pivot)
    const stepRaw = ((raw - this.transformRotateLastRaw + 540) % 360) - 180
    this.transformRotateAccum += stepRaw
    this.transformRotateLastRaw = raw
    const target = (modifiers as any)?.shift
      ? snapAngle45(this.transformRotateAccum)
      : this.transformRotateAccum
    const delta = target - this.transformRotateApplied
    if (Math.abs(delta) > 1e-9) {
      engine.rotateSelection(delta, pivot)
      this.transformRotateApplied = target
      this.transformMoved = true
    }
    // Live readout (status bar), matching the measure tool's convention.
    const shown = ((this.transformRotateApplied % 360) + 540) % 360 - 180
    engine.showStatus(`Rotate ${Math.round(shown * 10) / 10}° (Shift: 45°)`)
  }

  /**
   * AI-aligned absolute bbox scaling, measured in the frame's local space
   * (grab-time orientation): the math is identical to axis-aligned scaling
   * there, so handles on a tilted box scale along the box axes. Totals
   * apply as total/lastTotal steps composed as unrotate → scale → re-rotate
   * about the frozen world pivot (exact for fixed pivot + angle). Edge
   * handles lock the orthogonal axis, Shift on corners equalizes magnitude
   * while preserving each axis sign, and totals clamp off zero so pivot
   * crossing flips in one bounded step.
   */
  private dragScaleAbsolute(point: paper.Point, modifiers: any) {
    const engine = this.engine
    if (!engine) return
    const base = this.transformScaleBase
    if (!base || !this.transformStartPoint) return
    if (this.transformHandle === 'none' || this.transformHandle === 'rotate') return

    // Alt toggles the pivot mid-drag. Re-baseline onto the live frame so
    // the switch keeps the current size instead of jumping (Shift snaps, so
    // it intentionally does not re-baseline).
    const wantCenter = !!(modifiers as any)?.alt
    if (wantCenter !== this.transformUseCenter && this.frame) {
      const f = this.frame
      this.transformScaleBase = { cx: f.cx, cy: f.cy, w: f.w, h: f.h, angle: f.angle }
      const corners = this.frameCorners(f)
      this.transformOpposite = corners[this.oppositeHandle(this.transformHandle)].clone()
      this.transformCenter = new engine.scope.Point(f.cx, f.cy)
      this.transformUseCenter = wantCenter
      this.transformPivot = (wantCenter ? this.transformCenter : this.transformOpposite).clone()
      this.transformStartPoint = { x: point.x, y: point.y }
      this.transformLastTotalFx = 1
      this.transformLastTotalFy = 1
      return
    }
    if (!this.transformOpposite || !this.transformCenter) return

    const scope = engine.scope
    const centerW = new scope.Point(base.cx, base.cy)
    const toLocal = (p: paper.Point) => p.rotate(-base.angle, centerW)
    const pivotW = wantCenter ? this.transformCenter : this.transformOpposite
    const pL = wantCenter
      ? { x: base.cx, y: base.cy }
      : this.localHandlePoint(base, this.oppositeHandle(this.transformHandle))
    const sL = toLocal(new scope.Point(this.transformStartPoint.x, this.transformStartPoint.y))
    const qL = toLocal(point.clone())
    const dxs = sL.x - pL.x
    const dys = sL.y - pL.y
    const corner = this.isCornerHandle(this.transformHandle)
    const horizontalEdge = this.transformHandle === 'middleLeft' || this.transformHandle === 'middleRight'
    const verticalEdge = this.transformHandle === 'topCenter' || this.transformHandle === 'bottomCenter'

    let fx = 1
    let fy = 1
    if (corner || horizontalEdge) {
      fx = Math.abs(dxs) > 1e-9 ? (qL.x - pL.x) / dxs : 1
    }
    if (corner || verticalEdge) {
      fy = Math.abs(dys) > 1e-9 ? (qL.y - pL.y) / dys : 1
    }
    if (!Number.isFinite(fx)) fx = 1
    if (!Number.isFinite(fy)) fy = 1

    if (modifiers && modifiers.shift && corner) {
      // Uniform proportions: dominant magnitude wins, each axis keeps its
      // own flip sign so Shift never invents a new mirror.
      const mag = Math.max(Math.abs(fx), Math.abs(fy))
      fx = (fx < 0 ? -1 : 1) * mag
      fy = (fy < 0 ? -1 : 1) * mag
    }

    // Clamp totals: cap runaway zoom, floor off zero so pivot crossing flips
    // in one bounded step instead of dividing by ~0.
    const startW = Math.max(base.w, 1e-9)
    const startH = Math.max(base.h, 1e-9)
    const MIN_SIZE = 0.5
    const MAX_SCALE = 100
    const minFx = MIN_SIZE / startW
    const minFy = MIN_SIZE / startH
    if (corner || horizontalEdge) {
      const s = fx < 0 ? -1 : 1
      const a = Math.abs(fx)
      fx = s * Math.max(minFx, Math.min(MAX_SCALE, a))
    }
    if (corner || verticalEdge) {
      const s = fy < 0 ? -1 : 1
      const a = Math.abs(fy)
      fy = s * Math.max(minFy, Math.min(MAX_SCALE, a))
    }

    const lastFx = Math.abs(this.transformLastTotalFx) < 1e-12 ? 1 : this.transformLastTotalFx
    const lastFy = Math.abs(this.transformLastTotalFy) < 1e-12 ? 1 : this.transformLastTotalFy
    let stepFx = fx / lastFx
    let stepFy = fy / lastFy
    if (!Number.isFinite(stepFx)) stepFx = 1
    if (!Number.isFinite(stepFy)) stepFy = 1
    if (Math.abs(stepFx - 1) < 1e-9 && Math.abs(stepFy - 1) < 1e-9) return

    const P = new scope.Point(pivotW.x, pivotW.y)
    const th = base.angle
    const skipSpin = Math.abs(th) < 1e-9
    let applied = false
    let skippedLocked = false
    for (const item of this.transformItems) {
      if (!item.parent || item.locked) {
        if (item.locked) skippedLocked = true
        continue
      }
      if (!skipSpin) item.rotate(-th, P)
      item.scale(stepFx, stepFy, P)
      if (!skipSpin) item.rotate(th, P)
      engine.refreshItemGradient(item)
      applied = true
    }
    if (!applied) return
    this.transformLastTotalFx = fx
    this.transformLastTotalFy = fy
    this.transformMoved = true
    // Locked members staying behind break rigid tracking — drop the frame
    // so the next paint rebuilds it from live bounds.
    if (skippedLocked) {
      this.frame = null
      return
    }
    // Advance the tracked frame from the totals (signed factors keep flips
    // honest); the angle never changes under scaling.
    if (this.frame) {
      const f = this.frame
      f.w = base.w * Math.abs(fx)
      f.h = base.h * Math.abs(fy)
      const clx = pL.x + (base.cx - pL.x) * fx
      const cly = pL.y + (base.cy - pL.y) * fy
      const cw = new scope.Point(clx, cly).rotate(base.angle, centerW)
      f.cx = cw.x
      f.cy = cw.y
    }
  }

  /**
   * Hover cursor for the bbox handle under a point, or null. Cursors follow
   * the frame's live tilt: corners resize along the corner's 45° bisector —
   * a native diagonal only when the bisector lands exactly on one,
   * otherwise an exact-angle double arrow in native white-core style —
   * while edges show the arrow perpendicular to the edge.
   */
  private cursorForHandleAt(point: paper.Point): string | null {
    const engine = this.engine
    if (!engine || engine.getSelection().length === 0) return null
    const tol = 7 / engine.scope.view.zoom
    const handle = this.transformHandleAt(point, tol)
    if (handle === 'none') return null
    if (handle === 'rotate') return CURSOR_ROTATE
    const tilt = this.frame ? this.frame.angle : 0
    const heading = HANDLE_HEADINGS[handle] + tilt
    if (this.isCornerHandle(handle)) {
      const native = diagonalCursorForHeading(heading)
      const folded = ((heading % 180) + 180) % 180
      const nearDiag = Math.min(Math.abs(folded - 45), Math.abs(folded - 135))
      if (nearDiag < 0.5) return native
      return arrowResizeCursor(heading, native)
    }
    return resizeCursorForHeading(heading)
  }

  /**
   * Hover cursor for direct-select anchor / handle / curve targets. Returns
   * `pointer` on a draggable anchor or handle, `move` on a draggable curve
   * segment, otherwise null (keep white arrow).
   */
  private directHoverCursor(point: paper.Point): string | null {
    const engine = this.engine
    if (!engine) return null
    const tol = 6 / engine.scope.view.zoom
    // Handles first (they are the smaller targets).
    const editPath = this.getEditPath()
    const candidates: paper.Path[] = []
    if (editPath) candidates.push(editPath)
    for (const extra of this.userPathsAt(point)) {
      if (!candidates.includes(extra)) candidates.push(extra)
      if (candidates.length > 4) break
    }
    for (const path of candidates) {
      for (const seg of path.segments) {
        const anchor = seg.point
        const hi = seg.handleIn as paper.Point | null
        const ho = seg.handleOut as paper.Point | null
        if (hi && anchor.add(hi).getDistance(point) <= tol) return 'pointer'
        if (ho && anchor.add(ho).getDistance(point) <= tol) return 'pointer'
      }
    }
    if (this.anchorHitAt(point, tol)) return 'pointer'
    // A hovered curve reads draggable (AI shows the segment highlight on
    // selection; the move cue previews the drag here).
    if (this.curveHitAt(point, tol)) return 'move'
    return null
  }

  /** Draw the AI-style selection: outlines + oriented frame + 8 handles. */
  private drawSelectionBounds() {
    const engine = this.engine
    this.chrome.clear()
    if (!engine || this.isMarquee) return
    const items = engine.getSelection()
    if (items.length === 0) {
      this.restoreAllNativeSelections()
      return
    }
    // Our chrome owns the visuals: silence paper.js native blue everywhere.
    for (const stale of Array.from(this.chromeSuppressed)) {
      if (!items.includes(stale)) this.restoreNativeSelection(stale)
    }
    for (const item of items) this.suppressNativeSelection(item)
    // The oriented frame persists across rotation (never snaps back); it
    // rebuilds upright only when the selection or untracked geometry drifts.
    this.ensureFrame()
    const f = this.frame
    if (!f) return
    // Per-object outlines keep their own layer color (AI); the frame uses
    // the first item's layer color.
    for (const item of items) {
      this.chrome.drawItemOutline(item, selectionColorForItem(engine, item))
    }
    const bboxColor = selectionColorForItems(engine, items)
    const order: FrameHandle[] = [
      'topLeft', 'topCenter', 'topRight',
      'middleLeft', 'middleRight',
      'bottomLeft', 'bottomCenter', 'bottomRight',
    ]
    const positions = this.frameCorners(f)
    this.chrome.drawPolygonOutline(
      [positions.topLeft, positions.topRight, positions.bottomRight, positions.bottomLeft],
      bboxColor
    )
    for (const handle of order) {
      // Active drag handle fills solid so the grab reads clearly (a
      // corner-started rotation highlights its corner the same way).
      this.chrome.drawAnchor(positions[handle], handle === this.transformHandle, bboxColor)
    }
    // While rotating, mark the frozen reference pivot (AI's transform
    // origin) so the rotation center is explicit.
    if (this.grab === 'transform' && this.transformKind === 'rotate' && this.transformRotatePivot) {
      this.chrome.drawPivotMarker(this.transformRotatePivot, bboxColor)
    }
    engine.scope.view.update()
  }

  /**
   * Move grabbed objects with pointer snapping plus smart alignment.
   * Positions recompute from the grab-time snapshot every step: the pointer
   * follows the snapped cursor, then the smart correction nudges the united
   * bounds onto nearby edges / centers and draws its guide lines. Holding
   * Shift constrains the total shift to the dominant axis.
   */
  private dragObjects(point: paper.Point, modifiers: any) {
    const engine = this.engine
    if (!engine || this.dragItems.length === 0) return
    if (!this.dragPointerStart || !this.dragStartBounds) return
    const snapped = this.snapService.snapPoint(point, this.dragItems)
    const dx = snapped.x - this.dragPointerStart.x
    const dy = snapped.y - this.dragPointerStart.y
    const candidate = new engine.scope.Rectangle(
      this.dragStartBounds.x + dx,
      this.dragStartBounds.y + dy,
      this.dragStartBounds.width,
      this.dragStartBounds.height
    )
    const correction = this.snapService.alignDraggedBounds(candidate, this.dragItems)
    let totalX = dx + correction.dx
    let totalY = dy + correction.dy
    if (modifiers && modifiers.shift && (totalX !== 0 || totalY !== 0)) {
      if (Math.abs(totalX) > Math.abs(totalY)) totalY = 0
      else totalX = 0
    }
    const shift = new engine.scope.Point(totalX, totalY)
    let moved = false
    let skippedLocked = false
    this.dragItems.forEach((item, index) => {
      if (item.locked) {
        skippedLocked = true
        return
      }
      const start = this.dragItemStartPositions[index]
      if (!start) return
      item.position = start.add(shift)
      engine.refreshItemGradient(item)
      moved = true
    })
    // Pure translation: the oriented frame slides along untouched — unless
    // locked members stay behind, in which case the frame is dropped.
    if (skippedLocked) {
      if (moved) this.frame = null
    } else if (moved && this.frame && this.dragStartFrame) {
      this.frame.cx = this.dragStartFrame.x + totalX
      this.frame.cy = this.dragStartFrame.y + totalY
    }
    engine.store.setCursorPos(point.x, point.y)
    this.refreshChrome()
    // Smart alignment guides draw above the bbox chrome.
    for (const line of correction.lines) {
      this.chrome.drawLine(line.from, line.to)
    }
    engine.scope.view.update()
  }

  // ------------------------------------------------------------------
  // Plain hit testing / marquee helpers (shared)
  // ------------------------------------------------------------------

  /** Find a user point text at the given point (annotation labels excluded). */
  private userTextAt(point: paper.Point): paper.PointText | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const hit = engine.project.hitTest(point, {
      fill: true,
      stroke: true,
      segments: false,
      tolerance: 3 / scope.view.zoom,
    })
    const item = hit?.item
    if ((item as any)?.locked) return null
    if ((item as any)?.data?.isArtboard) return null
    if (item instanceof scope.PointText && !(item as any).data?.annotation) {
      return item as paper.PointText
    }
    return null
  }

  /** Callout label under a point (double-click re-enters label editing). */
  private annotationTextAt(point: paper.Point): paper.PointText | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const hit = engine.project.hitTest(point, {
      fill: true,
      stroke: true,
      segments: false,
      tolerance: 3 / scope.view.zoom,
    })
    const item = hit?.item
    if (!item || (item as any).locked || (item as any).visible === false) return null
    if ((item as any)?.data?.isArtboard) return null
    if (item instanceof scope.PointText && (item as any).data?.annotation) {
      return item as paper.PointText
    }
    return null
  }

  /**
   * Topmost selectable artwork under a point. Editing chrome, guide lines
   * and locked items never block: the search continues underneath them.
   */
  /**
   * Ctrl+click (AI select-behind parity): walk the unlocked user items
   * stacked under the point, top first, and select the entry after the
   * currently selected one — clicking again cycles deeper, wrapping to the
   * top. No-op when nothing is stacked here.
   */
  private cycleSelectBehind(point: paper.Point): void {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const hits = engine.project.hitTestAll(point, {
      fill: true,
      stroke: true,
      segments: false,
      tolerance: 3 / scope.view.zoom,
    })
    const stack: paper.Item[] = []
    for (const hit of hits) {
      const item = hit.item
      const data = (item.data as any) ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard) continue
      if ((item as any).locked) continue
      stack.push(item)
    }
    if (stack.length === 0) return
    const selectedIdx = stack.findIndex((item) => (item as any).selected)
    const next = stack[(selectedIdx + 1) % stack.length]
    this.clearAnchorSelection()
    this.clearCurveSelection()
    engine.clearSelection()
    engine.selectItem(next, false)
    engine.syncSelectionToStore()
    this.refreshChrome()
    engine.scope.view.update()
  }

  private hitTest(point: paper.Point): paper.HitResult | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const hits = engine.project.hitTestAll(point, {
      fill: true,
      stroke: true,
      segments: false,
      tolerance: 3 / scope.view.zoom,
    })
    for (const hit of hits) {
      const item = hit.item
      const data = (item.data as any) ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard) continue
      if ((item as any).locked) continue
      return hit as paper.HitResult
    }
    return null
  }

  /**
   * Innermost unlocked user group under a point (isolation target on
   * double-click). Path-text runs never isolate; plain art returns null.
   */
  private groupAt(point: paper.Point): paper.Group | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const hit = engine.project.hitTest(point, {
      fill: true,
      stroke: true,
      segments: false,
      tolerance: 3 / scope.view.zoom,
    })
    let node: paper.Item | null = hit?.item ?? null
    let group: paper.Group | null = null
    while (node && !(node instanceof scope.Layer)) {
      const data = (node.data as any) ?? {}
      if (
        !group &&
        node instanceof scope.Group &&
        !data.textMode &&
        !(node as any).locked
      ) {
        group = node as paper.Group
      }
      node = node.parent
    }
    if (!(node instanceof scope.Layer) || !(node.data as any)?.isUserLayer) return null
    return group
  }

  private createMarquee(x: number, y: number) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    // Rebuild the container when a tool switch swept the previous one away
    // (clearTransientChrome removes it, leaving this reference detached).
    if (!this.marqueeLayer || !this.marqueeLayer.parent) {
      this.marqueeLayer = new scope.Layer()
      this.marqueeLayer.name = 'marquee-layer'
      this.marqueeLayer.locked = true
      this.marqueeLayer.data.isUserLayer = false
      // Transient feedback: keeps it out of history/project snapshots and
      // lets a tool switch mid-marquee sweep it away.
      this.marqueeLayer.data.isPreview = true
    }

    this.marqueeRect = new scope.Path.Rectangle({
      from: [x, y],
      to: [x, y],
      strokeColor: '#4a90d9',
      strokeWidth: 1 / scope.view.zoom,
      dashArray: [4 / scope.view.zoom, 2 / scope.view.zoom],
      fillColor: 'rgba(74, 144, 217, 0.1)',
    }) as paper.Path
    this.marqueeLayer.addChild(this.marqueeRect)
    this.marqueeLayer.bringToFront()
  }

  private updateMarquee(x: number, y: number) {
    if (!this.marqueeRect || !this.engine) return
    const scope = this.engine.scope
    const p1 = this.dragStart
    const rect = new scope.Rectangle(
      Math.min(p1.x, x), Math.min(p1.y, y),
      Math.abs(x - p1.x), Math.abs(y - p1.y)
    )
    this.marqueeRect.remove()
    this.marqueeRect = new scope.Path.Rectangle({
      from: [rect.x, rect.y],
      to: [rect.x + rect.width, rect.y + rect.height],
      strokeColor: '#4a90d9',
      strokeWidth: 1 / scope.view.zoom,
      dashArray: [4 / scope.view.zoom, 2 / scope.view.zoom],
      fillColor: 'rgba(74, 144, 217, 0.1)',
    }) as paper.Path
    this.marqueeLayer?.addChild(this.marqueeRect)
    scope.view.update()
  }

  private finishMarquee() {
    const engine = this.engine
    if (!engine || !this.marqueeRect) return
    const scope = engine.scope
    // The rubber band is built from tool event points (project space), the
    // same space as item bounds — use it directly so selection stays correct
    // after zooming / panning.
    const rectInProject = this.marqueeRect.bounds

    const userLayers = engine.project.layers.filter((l) => (l.data as any)?.isUserLayer)
    userLayers.forEach((layer) => {
      if (!layer.visible || layer.locked) return
      layer.children.forEach((child: any) => {
        // Locked items are skipped here because Paper only filters them in
        // hitTest; this marquee walks children by hand, so it used to select
        // locked artwork that clicks could never reach.
        if (!child.visible || child.locked) return
        if (rectInProject.intersects(child.bounds)) {
          child.selected = true
        }
      })
    })
    engine.syncSelectionToStore()
    this.refreshChrome()
  }

  /** Remove the rubber band rectangle and its temporary layer. */
  private removeMarquee() {
    if (this.marqueeRect) {
      this.marqueeRect.remove()
      this.marqueeRect = null
    }
    if (this.marqueeLayer) {
      this.marqueeLayer.remove()
      this.marqueeLayer = null
    }
    this.engine?.scope.view.update()
  }

  // ------------------------------------------------------------------
  // Guide dragging / deletion
  // ------------------------------------------------------------------

  /** Drag the grabbed guide to the given document point. */
  private dragGuide(point: paper.Point) {
    const engine = this.engine
    if (!engine || !this.grabGuide) return

    // If the cursor enters the ruler strip (top/left edge), delete the guide.
    const viewPoint = engine.scope.view.projectToView(point)
    if (viewPoint.x <= 0 || viewPoint.y <= 0) {
      const dragged = this.grabGuide
      engine.deleteGuide(dragged)
      this.guides.deselectGuide(dragged)
      engine.pushHistory('Delete Guide')
      this.grabGuide = null
      this.grab = 'none'
      this.isDragging = false
      engine.scope.view.update()
      return
    }

    const orientation = engine.getGuideOrientation(this.grabGuide)
    if (!orientation) return
    const position = orientation === 'horizontal' ? point.y : point.x
    engine.moveGuide(this.grabGuide, position)
    engine.scope.view.update()
  }

  /**
   * Finish dragging a guide. Pushes a history snapshot for the move if the
   * guide is still present (deletion already happens inside dragGuide when the
   * cursor reaches the ruler strip). Only pushes history if the guide was
   * actually moved from its original position.
   */
  private finishGuideDrag(event: paper.ToolEvent) {
    const engine = this.engine
    if (!engine || !this.grabGuide) return
    // Determine if the guide was moved from its original position.
    const orientation = engine.getGuideOrientation(this.grabGuide)
    const curPos = orientation ? engine.getGuidePosition(this.grabGuide) : 0

    this.isDragging = false
    this.grabGuide = null
    if (Math.abs(curPos - this.guideOriginalPos) > 1e-6) {
      engine.pushHistory('Move Guide')
    }
    engine.scope.view.update()
  }
}

/**
 * Snap a clockwise angle in degrees to the nearest 45-degree increment,
 * matching the Shift-constrain convention used by the pen and shape tools.
 */
function snapAngle45(deg: number): number {
  return Math.round(deg / 45) * 45
}
