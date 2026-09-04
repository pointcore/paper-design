/**
 * Anchor point tools controller.
 *
 * Groups the three anchor editing tools modelled after Adobe Illustrator:
 *  - 'add-anchor'     : hovering a segment previews a marker; clicking inserts
 *                       an anchor on the curve without altering its shape.
 *  - 'delete-anchor'  : clicking an anchor removes it while trying to preserve
 *                       the surrounding shape (neighbouring handles are
 *                       adjusted to approximate the original curve).
 *  - 'convert-anchor' : hover shows the anchor and its handles; dragging from
 *                       an anchor pulls out symmetric control handles; dragging
 *                       a handle endpoint adjusts that handle individually;
 *                       clicking a handle endpoint deletes that handle.
 *
 * Which tool is running is read from the current Pinia store tool name.
 */
import { EditorEngine } from '../engine'
import { AnchorChrome } from './anchor-chrome'

export type AnchorToolMode = 'add-anchor' | 'delete-anchor' | 'convert-anchor'

interface SegmentTarget {
  path: paper.Path
  point: paper.Point
  curveIndex: number
}

interface AnchorTarget {
  path: paper.Path
  segment: paper.Segment
  index: number
}

export class AnchorController {
  engine: EditorEngine | null = null
  chrome: AnchorChrome = new AnchorChrome()

  private mode: AnchorToolMode = 'add-anchor'
  private hoverPath: paper.Path | null = null
  private hoverTarget: SegmentTarget | AnchorTarget | null = null

  // Convert-anchor drag state.
  private isDragging = false
  private dragAnchorPath: paper.Path | null = null
  private dragAnchorIndex = -1
  private pressPoint: paper.Point | null = null
  private lastDragPoint: paper.Point | null = null
  // Whether the mouse-down was on a handle endpoint rather than the anchor
  // point itself. When true, dragging adjusts only the grabbed handle
  // instead of the symmetric pair (mirror of pen-tool handle editing).
  private pressOnHandle = false
  // When pressOnHandle is true, whether the grabbed handle is the "in" side.
  private pressHandleIsIn = false

  // After a convert-anchor drag drafts a handle, keep the handle chrome on
  // screen until the next mouse-down, even if the cursor moves away, so the
  // user can still inspect the just-pulled handle without clicking elsewhere.
  private keepHandleVisible = false

  // Tolerance for anchor / segment hit-testing (document units).
  private static readonly HIT_TOL = 6
  private static readonly ADD_NEAR_ANCHOR_TOL = 4

  attachEngine(engine: EditorEngine) {
    this.engine = engine
    this.chrome.attachEngine(engine)
  }

  activate() {
    if (!this.engine) return
    const tool = this.engine.store.tool
    if (tool === 'add-anchor' || tool === 'delete-anchor' || tool === 'convert-anchor') {
      this.mode = tool
    }
    this.setupTool()
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

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
      if (!this.isDragging && !this.keepHandleVisible) {
        this.updateHover(event.point)
      }
    }

    scope.tool.onMouseDown = (event: paper.ToolEvent) => {
      const native = this.getNativeEvent(event)
      if (native && native.button !== 0) return
      this.isDragging = true
      this.keepHandleVisible = false
      this.pressPoint = event.point
      this.lastDragPoint = event.point
      this.applyAt(event.point, event.modifiers)
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isDragging || !this.lastDragPoint) return
      // For convert-anchor, dragging creates interactive handles.
      if (this.mode === 'convert-anchor' && this.dragAnchorPath && this.dragAnchorIndex >= 0) {
        this.dragConvertHandle(event.point, event.modifiers)
        this.lastDragPoint = event.point
        this.refreshHoverChrome(event.point)
      }
      scope.view.update()
    }

    scope.tool.onMouseUp = () => {
      // Whether the segment's chrome should be redrawn / kept visible.
      let showSegmentChrome = false
      let chromePath: paper.Path | null = null
      let chromeIdx = -1
      if (this.mode === 'convert-anchor' &&
          this.dragAnchorPath && this.dragAnchorIndex >= 0 &&
          this.pressPoint && this.lastDragPoint) {
        const moved = this.pressPoint.getDistance(this.lastDragPoint) > 1e-4
        const path = this.dragAnchorPath
        const idx = this.dragAnchorIndex
        const seg = (path && idx >= 0 && idx < path.segments.length)
          ? path.segments[idx]
          : null
        if (!moved && seg) {
          // A simple click (no drag).
          if (this.pressOnHandle) {
            // Clicking directly on a handle endpoint deletes that single
            // handle. Dragging from a handle endpoint adjusts it instead.
            if (this.pressHandleIsIn) {
              ;(seg.handleIn as any) = null
            } else {
              ;(seg.handleOut as any) = null
            }
            engine.pushHistory('Delete Handle')
          }
          // Note: clicking on the anchor body itself does NOT toggle between
          // corner and smooth. A corner stays corner; a smooth point stays
          // smooth. Handles are created by dragging from the anchor and are
          // removed by clicking their endpoints — no implicit conversion.
        } else if (moved) {
          // A drag already set symmetric handles via dragConvertHandle.
          engine.pushHistory('Convert Anchor')
        }
        // Always redraw the segment's chrome after the interaction so the
        // anchor marker and any remaining handles stay visible and stable.
        if (seg) {
          showSegmentChrome = true
          chromePath = path
          chromeIdx = idx
        }
      }
      this.endDrag()
      // Keep the segment's chrome on screen until the next mouse interaction,
      // so the anchor / handle state stays visually consistent.
      if (showSegmentChrome && chromePath && chromeIdx >= 0) {
        this.drawSegmentChrome(chromePath, chromeIdx)
        this.keepHandleVisible = true
      }
      scope.view.update()
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (event.key === 'escape') {
        if (this.isDragging) this.endDrag()
        engine.clearSelection()
        this.clearHover()
      }
    }

    scope.view.update()
  }

  private endDrag() {
    this.isDragging = false
    this.keepHandleVisible = false
    this.dragAnchorPath = null
    this.dragAnchorIndex = -1
    this.pressPoint = null
    this.lastDragPoint = null
    this.pressOnHandle = false
    this.pressHandleIsIn = false
    this.clearHover()
  }

  /** Reset and redraw the hover feedback for the given cursor position. */
  private updateHover(point: paper.Point) {
    this.clearHover()
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    if (this.mode === 'add-anchor') {
      const target = this.findSegmentTarget(point)
      if (target && target.path) {
        // Show the curve highlight plus a crosshair at the insertion point.
        this.chrome.clear()
        const seg = target.path.segments[target.curveIndex]
        const next = target.path.segments[target.curveIndex + 1] || target.path.segments[0]
        if (seg && next) {
          this.chrome.drawCurveHighlight(target.path, target.curveIndex)
        }
        this.chrome.drawCrosshair(target.point)
        this.hoverPath = target.path
        this.hoverTarget = target
      }
    } else if (this.mode === 'delete-anchor') {
      const target = this.findAnchorTarget(point)
      if (target && target.path && target.segment) {
        // Draw a red ring on the anchor to signal deletion.
        this.chrome.clear()
        this.chrome.drawRingMarker(target.segment.point, '#e5484d')
        this.hoverPath = target.path
        this.hoverTarget = target
      }
    } else {
      // convert-anchor: hover shows the anchor and its handles.
      const target = this.findAnchorTarget(point)
      if (target && target.path && target.segment) {
        this.chrome.clear()
        this.chrome.drawAnchor(target.segment.point, true)
        // Show handle lines and markers for smooth anchors.
        const seg = target.segment
        const anchor = seg.point
        const hi = seg.handleIn as paper.Point | null
        const ho = seg.handleOut as paper.Point | null
        if (hi && !(Math.abs(hi.x) < 1e-6 && Math.abs(hi.y) < 1e-6)) {
          this.chrome.drawHandle(anchor, anchor.add(hi))
        }
        if (ho && !(Math.abs(ho.x) < 1e-6 && Math.abs(ho.y) < 1e-6)) {
          this.chrome.drawHandle(anchor, anchor.add(ho))
        }
        this.hoverPath = target.path
        this.hoverTarget = target
      }
    }
    scope.view.update()
  }

  /** Redraw the chrome for the given path segment (anchor + its handles). */
  private drawSegmentChrome(path: paper.Path, idx: number) {
    const engine = this.engine
    if (!engine || !path) return
    if (idx < 0 || idx >= path.segments.length) return
    const seg = path.segments[idx]
    if (!seg) return
    this.chrome.clear()
    this.chrome.drawAnchor(seg.point, true)
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

  /** Redraw the dragged segment's chrome after a convert-drag geometry update. */
  private refreshHoverChrome(point: paper.Point) {
    if (this.mode !== 'convert-anchor') return
    const path = this.dragAnchorPath
    if (!path) return
    this.drawSegmentChrome(path, this.dragAnchorIndex)
  }

  private applyAt(point: paper.Point, modifiers: any) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    if (this.mode === 'add-anchor') {
      const target = this.findSegmentTarget(point)
      if (target && target.path) {
        // Do not add an anchor if the click is too close to an existing anchor.
        if (!this.isNearExistingAnchor(target.path, point)) {
          this.addAnchorOnCurve(target.path, point)
          engine.pushHistory('Add Anchor')
          // Keep the path selected so further edits are obvious.
          this.ensurePathSelected(target.path)
        }
      }
    } else if (this.mode === 'delete-anchor') {
      const target = this.findAnchorTarget(point)
      if (target && target.path && target.segment) {
        this.deleteAnchor(target.path, target.index)
        engine.pushHistory('Delete Anchor')
        this.ensurePathSelected(target.path)
      }
    } else if (this.mode === 'convert-anchor') {
      // First, check for handle endpoints. This takes priority so users can
      // grab and drag an individual handle to fine-tune it without the
      // smooth→corner toggle erasing the handle on mouse-down.
      const handleHit = this.findHandleTarget(point)
      if (handleHit) {
        this.dragAnchorPath = handleHit.path
        this.dragAnchorIndex = handleHit.index
        // A handle endpoint exists ⇒ the segment is smooth.
        this.pressOnHandle = true
        this.pressHandleIsIn = handleHit.isIn
        this.ensurePathSelected(handleHit.path)
      } else {
        const target = this.findAnchorTarget(point)
        if (target && target.path && target.segment) {
          this.dragAnchorPath = target.path
          this.dragAnchorIndex = target.index
          this.pressOnHandle = false
          this.pressHandleIsIn = false
          this.ensurePathSelected(target.path)
        }
      }
    }
    // In convert-anchor mode the hover chrome (anchor + handles) should stay
    // visible through mouse-down when an anchor or handle is hit, so clicking
    // does not cause a visible flicker. Chrome is redrawn on mouse-up /
    // drag as needed. For add / delete modes (and when the click missed any
    // anchor / handle in convert mode) clear the stale hover preview.
    if (this.mode !== 'convert-anchor' ||
        (!this.dragAnchorPath && !this.pressOnHandle)) {
      this.clearHover()
    } else {
      // Just reset hover bookkeeping without clearing the drawn visuals.
      this.hoverPath = null
      this.hoverTarget = null
    }
    scope.view.update()
  }

  /** Select the edited path so it's obvious which item is being modified. */
  private ensurePathSelected(path: paper.Path) {
    const engine = this.engine
    if (!engine) return
    if (!path.selected) {
      engine.clearSelection()
      engine.selectItem(path)
    }
  }

  // ------------------------------------------------------------------
  // Path enumeration (supports both simple Path and CompoundPath children)
  // ------------------------------------------------------------------

  /** Return all editable Path objects (including CompoundPath children). */
  private editablePaths(): paper.Path[] {
    const engine = this.engine
    if (!engine) return []
    const result: paper.Path[] = []
    for (const layer of engine.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      this.collectPaths(layer, result)
    }
    return result
  }

  private collectPaths(item: paper.Item, out: paper.Path[]) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    // Direct path: leaf item.
    if (item instanceof scope.Path && !(item instanceof scope.CompoundPath)) {
      out.push(item as paper.Path)
      return
    }
    // CompoundPath: each child is a Path.
    if (item instanceof scope.CompoundPath) {
      for (const child of item.children) {
        if (child instanceof scope.Path) {
          out.push(child as paper.Path)
        }
      }
      return
    }
    // Recurse into groups and other containers.
    if (item.children) {
      for (const child of item.children) {
        this.collectPaths(child as paper.Item, out)
      }
    }
  }

  // ------------------------------------------------------------------
  // Add Anchor helpers
  // ------------------------------------------------------------------

  /** Find the path + curve nearest the given point (for add-anchor). */
  private findSegmentTarget(point: paper.Point): SegmentTarget | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    let best: SegmentTarget | null = null
    let bestDist = Infinity
    for (const path of this.editablePaths()) {
      if (path.segments.length < 2) continue
      const loc = path.getNearestLocation(point) as paper.CurveLocation | null
      if (!loc || !loc.curve) continue
      const d = loc.point.getDistance(point)
      if (d < bestDist) {
        bestDist = d
        best = {
          path,
          point: loc.point,
          curveIndex: loc.curve.index,
        }
      }
    }
    const tol = AnchorController.HIT_TOL / scope.view.zoom
    if (best && bestDist <= tol) return best
    return null
  }

  /** True when the nearest curve point is at an existing anchor (duplicate add). */
  private isNearExistingAnchor(path: paper.Path, point: paper.Point): boolean {
    const engine = this.engine
    if (!engine) return false
    const scope = engine.scope
    const loc = path.getNearestLocation(point) as any
    if (!loc || !loc.curve || !loc.point) return false

    // Check if the nearest curve point is within a few screen pixels of any
    // existing anchor (in document space).
    const tol = AnchorController.ADD_NEAR_ANCHOR_TOL / scope.view.zoom
    for (const seg of path.segments) {
      if (seg.point.getDistance(loc.point) <= tol) return true
    }
    return false
  }

  /**
   * Insert a new anchor on the curve at the given screen point while keeping
   * the overall shape unchanged, using de Casteljau subdivision.
   */
  private addAnchorOnCurve(path: paper.Path, point: paper.Point) {
    const engine = this.engine
    if (!engine || path.segments.length < 2) return
    const scope = engine.scope

    const loc = path.getNearestLocation(point) as any
    if (!loc || !loc.curve) return
    const curve = loc.curve
    const t = loc.time

    // The index of the curve tells us which segment pair the point lies on.
    // Curve i spans from segment[i] → segment[i+1] (mod segments.length).
    const curveIndex = loc.curve.index
    if (curveIndex < 0) return

    // Control points of the cubic Bezier segment (absolute coordinates).
    // Paper.js Curve exposes handle1 (outgoing from point1) and handle2
    // (incoming to point2) — NOT handleOut / handleIn.
    const p0 = curve.point1
    const p1 = curve.point1.add(curve.handle1)
    const p2 = curve.point2.add(curve.handle2)
    const p3 = curve.point2

    // Subdivide at parameter t using de Casteljau.
    const p01 = p0.add(p1.subtract(p0).multiply(t))
    const p12 = p1.add(p2.subtract(p1).multiply(t))
    const p23 = p2.add(p3.subtract(p2).multiply(t))
    const p012 = p01.add(p12.subtract(p01).multiply(t))
    const p123 = p12.add(p23.subtract(p12).multiply(t))
    const split = p012.add(p123.subtract(p012).multiply(t))

    // Insert the new segment right after curve.startSeg.
    // path.insert(i, seg) puts the new segment at index i.
    const insertAt = curveIndex + 1
    const newSeg = new scope.Segment(split)
    path.insert(insertAt, newSeg)

    // Adjust handles: the "leading" segment (start of original curve)
    // now ends at split with a first-half outgoing handle.
    const leading = path.segments[curveIndex]
    if (leading) {
      leading.handleOut = p01.subtract(p0)
    }
    // The new segment's incoming handle comes from the first half.
    newSeg.handleIn = p012.subtract(split)
    // Its outgoing handle comes from the second half.
    newSeg.handleOut = p123.subtract(split)
    // The "trailing" segment (end of original curve) now has a new
    // incoming handle from the second half.
    const trailing = path.segments[insertAt + 1]
    if (trailing) {
      trailing.handleIn = p23.subtract(p3)
    }

    scope.view.update()
  }

  // ------------------------------------------------------------------
  // Delete Anchor helpers
  // ------------------------------------------------------------------

  /** Find the anchor (for delete / convert) nearest the given point. */
  private findAnchorTarget(point: paper.Point): AnchorTarget | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const tol = AnchorController.HIT_TOL / scope.view.zoom

    // For overlapping paths, prefer selected ones (most recently selected is
    // at the front of the selection stack).
    const allPaths = this.editablePaths()
    const selectedPaths = allPaths.filter((p) => p.selected)

    // Search selected paths first, then all paths.
    const searchOrder = selectedPaths.length > 0
      ? [...selectedPaths, ...allPaths.filter((p) => !p.selected)]
      : allPaths

    let best: AnchorTarget | null = null
    let bestDist = Infinity
    for (const path of searchOrder) {
      for (let i = 0; i < path.segments.length; i++) {
        const seg = path.segments[i]
        const d = seg.point.getDistance(point)
        if (d <= tol && d < bestDist) {
          bestDist = d
          best = { path, segment: seg, index: i }
        }
      }
    }
    return best
  }

  /**
   * Find a handle endpoint (the round marker at the free end of a control
   * handle) near the given point. Used by the convert-anchor tool so the
   * user can grab an individual handle to adjust it.
   */
  private findHandleTarget(point: paper.Point): { path: paper.Path; index: number; isIn: boolean } | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const tol = AnchorController.HIT_TOL / scope.view.zoom

    const allPaths = this.editablePaths()
    const selectedPaths = allPaths.filter((p) => p.selected)
    const searchOrder = selectedPaths.length > 0
      ? [...selectedPaths, ...allPaths.filter((p) => !p.selected)]
      : allPaths

    let best: { path: paper.Path; index: number; isIn: boolean } | null = null
    let bestDist = Infinity
    for (const path of searchOrder) {
      for (let i = 0; i < path.segments.length; i++) {
        const seg = path.segments[i]
        const hi = seg.handleIn as paper.Point | null
        const ho = seg.handleOut as paper.Point | null
        // Check handle-in endpoint.
        if (hi && !(Math.abs(hi.x) < 1e-6 && Math.abs(hi.y) < 1e-6)) {
          const hp = seg.point.add(hi)
          const d = hp.getDistance(point)
          if (d <= tol && d < bestDist) {
            bestDist = d
            best = { path, index: i, isIn: true }
          }
        }
        // Check handle-out endpoint.
        if (ho && !(Math.abs(ho.x) < 1e-6 && Math.abs(ho.y) < 1e-6)) {
          const hp = seg.point.add(ho)
          const d = hp.getDistance(point)
          if (d <= tol && d < bestDist) {
            bestDist = d
            best = { path, index: i, isIn: false }
          }
        }
      }
    }
    return best
  }

  /**
   * Delete an anchor while trying to preserve the path's visual shape.
   * When the deleted anchor is smooth and both neighbours also have handles,
   * the neighbouring handle lengths / directions are adjusted to approximate
   * the original path geometry through the three original points.
   */
  private deleteAnchor(path: paper.Path, index: number) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const n = path.segments.length

    // Minimum viable segments: 2 for open, 3 for closed.
    const minSegs = path.closed ? 3 : 2
    if (n <= minSegs) {
      path.remove()
      if (path.selected) engine.clearSelection()
      scope.view.update()
      return
    }

    const seg = path.segments[index]
    if (!seg) return

    // Only interior anchors (or any anchor on a closed path) qualify for
    // shape-preserving handle adjustment.
    const isInterior = path.closed || (index > 0 && index < n - 1)
    const wasSmooth = this.hasHandles(seg)

    // Capture geometry before deletion.
    const segHandleIn = seg.handleIn ? (seg.handleIn as paper.Point).clone() : null
    const segHandleOut = seg.handleOut ? (seg.handleOut as paper.Point).clone() : null

    let prevHandleOut: paper.Point | null = null
    let nextHandleIn: paper.Point | null = null
    let prevPt: paper.Point | null = null
    let nextPt: paper.Point | null = null

    if (isInterior && wasSmooth) {
      const pi = path.closed ? (index - 1 + n) % n : index - 1
      const ni = path.closed ? (index + 1) % n : index + 1
      const pSeg = path.segments[pi]
      const nSeg = path.segments[ni]
      if (pSeg && nSeg) {
        prevHandleOut = pSeg.handleOut ? (pSeg.handleOut as paper.Point).clone() : null
        nextHandleIn = nSeg.handleIn ? (nSeg.handleIn as paper.Point).clone() : null
        prevPt = pSeg.point.clone()
        nextPt = nSeg.point.clone()
      }
    }

    path.removeSegment(index)
    const newN = path.segments.length

    // Reconnect neighbours with adjusted handles to approximate curvature.
    if (isInterior && wasSmooth && prevHandleOut && nextHandleIn && prevPt && nextPt) {
      let newPrevIdx: number
      let newNextIdx: number
      if (path.closed) {
        if (index === 0) {
          newPrevIdx = newN - 1
          newNextIdx = 0
        } else {
          newPrevIdx = index - 1
          newNextIdx = index >= newN ? 0 : index
        }
      } else {
        newPrevIdx = index - 1
        newNextIdx = index
      }

      const p = path.segments[newPrevIdx]
      const nx = path.segments[newNextIdx]
      if (p && nx) {
        const dist = prevPt.getDistance(nextPt)
        const dir = nextPt.subtract(prevPt)
        if (dist > 1e-6) {
          const tangent = dir.normalize(1)
          const inLen = prevHandleOut.length + (segHandleIn ? segHandleIn.length : 0)
          const outLen = (segHandleOut ? segHandleOut.length : 0) + nextHandleIn.length
          const origCurve = Math.min(inLen, outLen)
          const handleLen = Math.min(
            Math.max(origCurve * 0.5, dist * 0.1),
            dist * 0.4
          )
          p.handleOut = tangent.multiply(handleLen)
          nx.handleIn = tangent.multiply(-handleLen)
        }
      }
    }

    scope.view.update()
  }

  // ------------------------------------------------------------------
  // Convert Anchor helpers
  // ------------------------------------------------------------------

  private hasHandles(seg: paper.Segment): boolean {
    const hi = seg.handleIn as paper.Point | null
    const ho = seg.handleOut as paper.Point | null
    const nearZero = (p: paper.Point | null) => !p || (Math.abs(p.x) < 1e-6 && Math.abs(p.y) < 1e-6)
    return !nearZero(hi) || !nearZero(ho)
  }

  /**
   * Called while dragging with convert-anchor: moves the control handle so
   * the user can interactively set the handle direction and length.
   * Holding Alt makes it a single-sided corner handle.
   */
  private dragConvertHandle(point: paper.Point, modifiers: any) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const path = this.dragAnchorPath
    if (!path) return
    const idx = this.dragAnchorIndex
    if (idx < 0 || idx >= path.segments.length) return
    const seg = path.segments[idx]
    if (!seg) return

    const anchor = seg.point
    let rel = point.subtract(anchor)
    if (modifiers && modifiers.shift) {
      rel = snap45(rel, scope)
    }

    // When the mouse-down landed on a handle endpoint, adjust only that
    // handle. This lets the user fine-tune one side of a smooth anchor
    // without erasing the opposite handle (mirror of pen-tool behaviour).
    if (this.pressOnHandle) {
      if (this.pressHandleIsIn) {
        seg.handleIn = rel.clone()
        // Alt breaks the smooth link and converts to a corner keeping
        // only the dragged side.
        if (modifiers && modifiers.alt) {
          seg.handleOut = null as any
        }
      } else {
        seg.handleOut = rel.clone()
        if (modifiers && modifiers.alt) {
          seg.handleIn = null as any
        }
      }
    } else {
      // Dragging from the anchor point itself always pulls out a
      // mirror-symmetric pair of handles: the outgoing handle points at
      // the cursor while the incoming handle mirrors it exactly. This keeps
      // both curves leaving the anchor tangent-smooth, matching Illustrator.
      seg.handleOut = rel.clone()
      seg.handleIn = rel.multiply(-1)

      // Holding Alt makes it a single-sided corner handle.
      if (modifiers && modifiers.alt) {
        seg.handleIn = null as any
      }
    }
    scope.view.update()
  }

  private clearHover() {
    this.chrome.clear()
    this.hoverPath = null
    this.hoverTarget = null
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
