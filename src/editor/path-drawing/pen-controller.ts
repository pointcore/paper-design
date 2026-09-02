/**
 * Pen tool controller.
 *
 * Faithful, Adobe-Illustrator-like pen behaviour built on Paper.js:
 *  - Click to place a corner anchor.
 *  - Press and drag from an anchor to pull out direction handles (creating a
 *    smooth curve point).
 *  - A rubber-band preview follows the cursor while a path is open.
 *  - Shift constrains segments / dragged handles to 45 degree increments.
 *  - Backspace removes the last placed anchor, clicking the start anchor /
 *    double-click / Enter finishes or closes, Escape / right-click cancels.
 *  - While a path is open the existing anchors and their control handles stay
 *    editable: drag a handle to reshape the previous curve, drag an anchor to
 *    move it in place, Alt + drag breaks a smooth point into a corner that
 *    keeps only the dragged handle.
 *  - Hovering an open path's end point shows a "continue" cursor and resumes
 *    drawing on that path.
 *
 * The path is drawn into the active user layer and committed to history once
 * it has enough segments.
 */
import { EditorEngine } from '../engine'
import { AnchorChrome } from './anchor-chrome'

/** What an active mouse press is doing while a pen stroke is open. */
type PressAction =
  | 'none'
  | 'place'          // placing a brand new anchor
  | 'move-anchor'    // dragging an already placed anchor in place
  | 'adjust-handle'  // dragging an already placed anchor's control handle

export class PenController {
  engine: EditorEngine | null = null
  chrome: AnchorChrome = new AnchorChrome()

  private isDrawing = false
  private currentPath: paper.Path | null = null
  private currentIsResumed = false // the path already existed before this stroke
  private resumeStartSegments = 0  // segment count when a resumed stroke began
  private pressSegment = -1
  private pressAction: PressAction = 'none'
  private grabIsIn = false         // which side of a handle is grabbed
  private draggedDuringPress = false
  private previewPath: paper.Path | null = null
  private closeRing: paper.Path | null = null
  private resumeHint: paper.Path | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
    this.chrome.attachEngine(engine)
  }

  activate() {
    if (!this.engine) return
    this.setupTool()
    this.restoreDefaultCursor()
  }

  private getNativeEvent(event: paper.ToolEvent): MouseEvent | null {
    return ((event as any).event as MouseEvent) ?? null
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
      if (native && native.button === 2) {
        this.finishPath()
        return
      }
      if (native && native.button === 1) return
      this.restoreDefaultCursor()

      const point = event.point

      if (!this.isDrawing) {
        // Try to resume an open path at its end point before starting fresh.
        const resume = this.findResumeTarget(point)
        if (resume) {
          this.resumePath(resume)
          // Capturing the existing end point does not create an anchor on its
          // own; subsequent clicks append new anchors. Keep the press segment
          // inactive so an accidental drag does not mutate the old path.
          this.pressAction = 'none'
          this.pressSegment = -1
          this.pressStart(point)
          engine.store.setDragging(true)
          return
        }
        this.beginPath(point)
        this.pressAction = 'place'
        this.pressSegment = this.currentPath ? this.currentPath.segments.length - 1 : 0
        this.pressStart(point)
        engine.store.setDragging(true)
        return
      }

      // While drawing: closing click on the start anchor.
      if (this.shouldClose(point)) {
        this.finishClosed()
        engine.store.setDragging(false)
        return
      }

      // While drawing: editing an existing anchor or handle takes priority.
      const hit = this.hitExistingControl(point)
      if (hit) {
        this.pressSegment = hit.index
        this.grabIsIn = hit.isIn
        this.pressAction = hit.kind === 'anchor' ? 'move-anchor' : 'adjust-handle'
        this.pressStart(point)
        return
      }

      // Otherwise place a fresh corner anchor (possibly turning smooth later).
      this.placeCorner(point)
      this.pressAction = 'place'
      this.pressSegment = this.currentPath ? this.currentPath.segments.length - 1 : 0
      this.pressStart(point)
      engine.store.setDragging(true)
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isDrawing || !this.currentPath) return
      const point = event.point
      const segments = this.currentPath.segments
      const seg = segments[this.pressSegment]
      if (!seg) return

      this.draggedDuringPress = true

      if (this.pressAction === 'move-anchor') {
        this.moveAnchorDrag(seg, point, event.modifiers)
      } else if (this.pressAction === 'adjust-handle') {
        this.adjustHandleDrag(seg, point, event.modifiers)
      } else {
        // Placing a new point with a drag pulls out direction handles.
        this.placeSmoothDrag(seg, point, event.modifiers)
      }

      this.clearPreview()
      this.refreshChrome()
      scope.view.update()
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
      if (this.isDrawing && this.currentPath) {
        this.updatePreview(event.point)
        this.refreshChrome()
      } else if (!this.isDrawing) {
        this.chrome.clear()
        this.updateResumeAffordance(event.point)
      }
      scope.view.update()
    }

    scope.tool.onMouseUp = () => {
      engine.store.setDragging(false)
      this.pressAction = 'none'
      this.pressSegment = -1
      this.grabIsIn = false
      this.draggedDuringPress = false
      this.refreshChrome()
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      switch (event.key) {
        case 'backspace':
        case 'delete':
          if (this.isDrawing) this.removeLastAnchor()
          else engine.clearSelection()
          break
        case 'escape':
          if (this.isDrawing) this.cancelPath()
          else engine.clearSelection()
          break
        case 'enter':
          if (this.isDrawing) this.finishPath()
          break
      }
    }

    scope.view.update()
  }

  // ------------------------------------------------------------------
  // Lifecycle: begin / place / resume
  // ------------------------------------------------------------------

  private pressStart(_point: paper.Point) {
    // Reserved hook for future gesture bookkeeping.
  }

  /** Begin a brand new path and place the very first anchor. */
  private beginPath(point: paper.Point) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const layer = engine.getActiveLayer()
    const path = new scope.Path() as paper.Path
    path.add(new scope.Segment(point))
    layer.addChild(path)
    const style = engine.store.style
    engine.applyStyleToItem(path, style)
    this.currentPath = path
    this.currentIsResumed = false
    this.isDrawing = true
    this.chrome.clear()
    scope.view.update()
  }

  /** Continue drawing on an already committed open path (feature #5). */
  private resumePath(target: { path: paper.Path; index: number }) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const path = target.path
    engine.clearSelection()
    engine.selectItem(path)
    this.currentPath = path
    this.currentIsResumed = true
    this.resumeStartSegments = path.segments.length
    this.isDrawing = true
    this.chrome.clear()
    scope.view.update()
  }

  /** Place a corner anchor (straight segment to the new point). */
  private placeCorner(point: paper.Point) {
    if (!this.currentPath) return
    const scope = this.engine!.scope
    this.clearPreview()
    this.currentPath.add(new scope.Segment(point))
    scope.view.update()
  }

  // ------------------------------------------------------------------
  // Drag handlers (modifiers: Shift -> 45deg, Alt -> break/corner)
  // ------------------------------------------------------------------

  /** Drag while placing a fresh point: pull out handles for a smooth point. */
  private placeSmoothDrag(seg: paper.Segment, point: paper.Point, mods: any) {
    const scope = this.engine!.scope
    let rel = new scope.Point(point.x - seg.point.x, point.y - seg.point.y)
    if (mods && mods.shift) rel = snap45(rel, scope)
    // Alt keeps only one (dragged) handle -> a corner anchor with a single
    // outgoing direction handle.
    if (mods && mods.alt) {
      seg.handleOut = rel
      seg.handleIn = null as any
      return
    }
    // Default: symmetric smooth point.
    seg.handleOut = rel
    seg.handleIn = new scope.Point(-rel.x, -rel.y)
  }

  /** Drag an existing anchor to move it in place (feature #4). */
  private moveAnchorDrag(seg: paper.Segment, point: paper.Point, mods: any) {
    const scope = this.engine!.scope
    if (mods && mods.shift) {
      const rel = new scope.Point(point.x - seg.point.x, point.y - seg.point.y)
      const snapped = snap45(rel, scope)
      seg.point = new scope.Point(seg.point.x + snapped.x, seg.point.y + snapped.y)
      return
    }
    seg.point = point.clone()
  }

  /**
   * Drag an existing anchor's control handle (features #1/#2/#3).
   *
   * Without Alt only the dragged handle is moved, letting the user fine tune
   * the shape of the previous curve. Holding Alt additionally removes the
   * opposite handle, converting the smooth point into a corner that keeps only
   * the dragged side.
   */
  private adjustHandleDrag(seg: paper.Segment, point: paper.Point, mods: any) {
    const scope = this.engine!.scope
    const anchor = seg.point
    let rel = new scope.Point(point.x - anchor.x, point.y - anchor.y)
    if (mods && mods.shift) rel = snap45(rel, scope)
    const isOut = !this.grabIsIn
    const alt = !!(mods && mods.alt)
    if (isOut) {
      seg.handleOut = rel
      if (alt) seg.handleIn = null as any
    } else {
      seg.handleIn = rel
      if (alt) seg.handleOut = null as any
    }
  }

  // ------------------------------------------------------------------
  // Hit testing of already-placed anchors / handles (features #1,#2,#4)
  // ------------------------------------------------------------------

  /** First editable segment index for the current stroke. */
  private firstEditableIndex(): number {
    if (!this.currentPath) return 0
    if (!this.currentIsResumed) return 0
    // For a resumed path let the connection point (the end anchor we continued
    // from) stay editable so its handles can be fine tuned.
    return Math.max(0, this.resumeStartSegments - 1)
  }

  private hitExistingControl(point: paper.Point): { kind: 'anchor' | 'handle'; index: number; isIn: boolean } | null {
    if (!this.currentPath || !this.engine) return null
    const scope = this.engine.scope
    const tol = 6 / scope.view.zoom
    const segs = this.currentPath.segments
    // Handles first (smallest grab targets), then anchors.
    for (let i = this.firstEditableIndex(); i < segs.length; i++) {
      const seg = segs[i]
      const ho = seg.handleOut as paper.Point | null
      const hi = seg.handleIn as paper.Point | null
      if (ho) {
        const hp = seg.point.add(ho)
        if (hp.getDistance(point) <= tol) return { kind: 'handle', index: i, isIn: false }
      }
      if (hi) {
        const hp = seg.point.add(hi)
        if (hp.getDistance(point) <= tol) return { kind: 'handle', index: i, isIn: true }
      }
    }
    for (let i = this.firstEditableIndex(); i < segs.length; i++) {
      if (segs[i].point.getDistance(point) <= tol) return { kind: 'anchor', index: i, isIn: false }
    }
    return null
  }

  // ------------------------------------------------------------------
  // Rubber-band preview & chrome
  // ------------------------------------------------------------------

  /** Whether the given click should close the path (hit near the first anchor). */
  private shouldClose(point: paper.Point): boolean {
    if (!this.currentPath || !this.engine) return false
    const scope = this.engine.scope
    if (this.currentPath.segments.length < 2) return false
    const first = this.currentPath.segments[0].point
    const tol = 8 / scope.view.zoom
    return first.getDistance(point) <= tol
  }

  /** Remove the last placed anchor while still drawing. */
  private removeLastAnchor() {
    if (!this.currentPath) return
    const scope = this.engine!.scope
    const segments = this.currentPath.segments
    const minSegments = this.currentIsResumed ? this.resumeStartSegments : 1
    if (segments.length <= minSegments) {
      this.cancelPath()
      return
    }
    this.currentPath.removeSegment(segments.length - 1)
    this.pressSegment = -1
    this.clearPreview()
    this.chrome.clear()
    scope.view.update()
  }

  /** Rubber-band preview from the last anchor to the cursor (or closing). */
  private updatePreview(point: paper.Point) {
    if (!this.currentPath || !this.engine) return
    const engine = this.engine
    const scope = engine.scope
    const segments = this.currentPath.segments
    if (segments.length === 0) return

    this.clearPreview()
    const last = segments[segments.length - 1].point

    if (this.shouldClose(point)) {
      const first = segments[0].point
      this.closeRing = this.makeDashedLine(last, first)
    } else {
      this.closeRing = null
    }
    this.previewPath = this.makeDashedLine(last, point)
    scope.view.update()
  }

  private makeDashedLine(from: paper.Point, to: paper.Point): paper.Path | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const line = new scope.Path.Line(from, to) as paper.Path
    line.strokeColor = new scope.Color('#4a90d9')
    line.strokeWidth = 1 / scope.view.zoom
    line.dashArray = [4 / scope.view.zoom, 3 / scope.view.zoom]
    line.strokeCap = 'round' as any
    line.data.isPreview = true
    const overlay = engine.getOverlayLayer()
    overlay.addChild(line)
    return line
  }

  private clearPreview() {
    if (this.previewPath) {
      this.previewPath.remove()
      this.previewPath = null
    }
    if (this.closeRing) {
      this.closeRing.remove()
      this.closeRing = null
    }
  }

  /** Draw anchors + control handles of the open path so they can be tweaked. */
  private refreshChrome() {
    if (!this.isDrawing || !this.currentPath) {
      this.chrome.clear()
      return
    }
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    this.chrome.clear()
    const segs = this.currentPath.segments
    // Only expose the anchors added by the current stroke.
    const firstEditable = this.firstEditableIndex()
    for (let i = firstEditable; i < segs.length; i++) {
      const isActive = i === this.pressSegment && this.pressAction !== 'none'
      this.chrome.drawAnchor(segs[i].point, isActive)
    }
    // Handle lines for smooth anchors.
    for (let i = firstEditable; i < segs.length; i++) {
      const seg = segs[i]
      const anchor = seg.point
      const hi = seg.handleIn as paper.Point | null
      const ho = seg.handleOut as paper.Point | null
      if (hi && !(Math.abs(hi.x) < 1e-6 && Math.abs(hi.y) < 1e-6)) {
        this.chrome.drawHandle(anchor, anchor.add(hi))
      }
      if (ho && !(Math.abs(ho.x) < 1e-6 && Math.abs(ho.y) < 1e-6)) {
        this.chrome.drawHandle(anchor, anchor.add(ho))
      }
    }
    scope.view.update()
  }

  // ------------------------------------------------------------------
  // Resume-on-open-path-endpoint (feature #5)
  // ------------------------------------------------------------------

  /**
   * Find an open user path whose end point is within tolerance of the cursor.
   */
  private findResumeTarget(point: paper.Point): { path: paper.Path; index: number } | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const tol = 6 / scope.view.zoom
    const candidates: paper.Path[] = []
    const walk = (item: paper.Item) => {
      if (item instanceof scope.Path) {
        const p = item as paper.Path
        if (!p.closed && p.visible && !p.data?.isPreview) candidates.push(p)
      }
      if (item.children) item.children.forEach(walk)
    }
    for (const layer of engine.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      layer.children.forEach(walk)
    }
    let best: { path: paper.Path; index: number } | null = null
    let bestDist = Infinity
    for (const p of candidates) {
      const n = p.segments.length
      if (n === 0) continue
      // Resume continues from the most recently drawn end point (n - 1).
      const i = n - 1
      const d = p.segments[i].point.getDistance(point)
      if (d <= tol && d < bestDist) {
        bestDist = d
        best = { path: p, index: i }
      }
    }
    return best
  }

  /**
   * When not drawing, show a ring marker + "continue" cursor on an open end
   * point that can be extended.
   */
  private updateResumeAffordance(point: paper.Point) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const target = this.findResumeTarget(point)

    if (this.resumeHint && this.resumeHint.parent) {
      this.resumeHint.remove()
      this.resumeHint = null
    }

    if (target) {
      const r = 6 / scope.view.zoom
      const circle = new scope.Path.Circle(target.path.segments[target.index].point, r) as paper.Path
      circle.strokeColor = new scope.Color('#4a90d9')
      circle.strokeWidth = 1.5 / scope.view.zoom
      circle.data.isPreview = true
      const overlay = engine.getOverlayLayer()
      overlay.addChild(circle)
      this.resumeHint = circle
      engine.canvas.style.cursor = 'copy'
    } else {
      this.restoreDefaultCursor()
    }
  }

  private restoreDefaultCursor() {
    if (this.engine?.canvas) {
      this.engine.canvas.style.cursor = 'crosshair'
    }
  }

  // ------------------------------------------------------------------
  // Finish / cancel / reset
  // ------------------------------------------------------------------

  /** Finish the current path as an open stroke. */
  private finishPath() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    this.clearPreview()
    this.chrome.clear()
    this.restoreDefaultCursor()
    if (this.currentPath) {
      const path = this.currentPath
      const added = this.currentIsResumed
        ? path.segments.length - this.resumeStartSegments
        : path.segments.length
      if (this.currentIsResumed) {
        if (added > 0) {
          engine.pushHistory('Extend Path')
          this.afterCommit(path)
        }
      } else if (added >= 2) {
        path.data.id = engine.genId()
        path.data.isUserItem = true
        engine.pushHistory('Pen Path')
        this.afterCommit(path)
      } else {
        path.remove()
      }
    }
    this.reset()
    scope.view.update()
  }

  /** Close the path by connecting the last anchor back to the first. */
  private finishClosed() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    this.clearPreview()
    this.chrome.clear()
    this.restoreDefaultCursor()
    if (this.currentPath) {
      const path = this.currentPath
      path.closed = true
      path.data.isUserItem = true
      if (!this.currentIsResumed) {
        path.data.id = engine.genId()
      }
      engine.pushHistory('Pen Path')
      this.afterCommit(path)
    }
    this.reset()
    scope.view.update()
  }

  /** Cancel the current in-progress stroke and remove its additions. */
  private cancelPath() {
    const engine = this.engine
    if (!engine) return
    this.clearPreview()
    this.chrome.clear()
    this.restoreDefaultCursor()
    if (this.currentPath) {
      if (this.currentIsResumed) {
        // Roll back every segment added during this resumed stroke.
        while (this.currentPath.segments.length > this.resumeStartSegments) {
          this.currentPath.removeSegment(this.currentPath.segments.length - 1)
        }
      } else {
        this.currentPath.remove()
      }
      engine.scope.view.update()
    }
    this.reset()
    engine.store.setDragging(false)
    engine.scope.view.update()
  }

  private afterCommit(path: paper.Path) {
    const engine = this.engine
    if (!engine) return
    engine.clearSelection()
    engine.selectItem(path)
  }

  private reset() {
    this.currentPath = null
    this.currentIsResumed = false
    this.resumeStartSegments = 0
    this.isDrawing = false
    this.pressSegment = -1
    this.pressAction = 'none'
    this.grabIsIn = false
    this.draggedDuringPress = false
    this.chrome.clear()
  }
}

/**
 * Snap a direction vector to the nearest 45-degree increment (including the
 * axes). Returns a new vector of the same length constrained to one of the
 * eight cardinal / diagonal directions.
 */
function snap45(v: paper.Point, scope: paper.PaperScope): paper.Point {
  const length = Math.hypot(v.x, v.y)
  if (length < 1e-6) return new scope.Point(0, 0)
  const angle = Math.atan2(v.y, v.x)
  const oct = Math.round(angle / (Math.PI / 4))
  const snappedAngle = oct * (Math.PI / 4)
  return new scope.Point(
    Math.cos(snappedAngle) * length,
    Math.sin(snappedAngle) * length
  )
}
