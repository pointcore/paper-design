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
import { AnchorChrome } from '../path-drawing/anchor-chrome'
import { GuideController } from '../guides/guide-controller'

type EditMode = 'select' | 'direct-select'

export class SelectController {
  engine: EditorEngine | null = null
  chrome: AnchorChrome = new AnchorChrome()
  guides: GuideController = new GuideController()

  private isDragging = false
  private isMarquee = false
  private dragStart: { x: number; y: number } = { x: 0, y: 0 }
  private dragItems: paper.Item[] = []
  private marqueeRect: paper.Path | null = null
  private marqueeLayer: paper.Layer | null = null

  // Direct-select anchor editing state.
  private mode: EditMode = 'select'
  private grab: 'none' | 'anchor' | 'anchor-group' | 'handle' | 'object' | 'guide' = 'none'
  private grabSegmentIndex = -1
  private grabIsIn = false
  private lastSegmentCount = -1
  private grabGuide: paper.Path | null = null
  private guideOriginalPos = 0
  // Path currently grabbed for anchor / handle editing (identity-safe, the
  // front-most selected path may differ from the grabbed one).
  private grabPath: paper.Path | null = null
  // Anchor sub-selection built by direct-select marquee / shift-click.
  private selectedSegments: { path: paper.Path; index: number }[] = []
  // Whether the active marquee selects anchors (direct-select) or objects.
  private anchorMarquee = false
  // Whether the active marquee is additive (shift held on mouse-down).
  private marqueeShift = false
  // Reference point for group anchor translation.
  private dragStartPoint: { x: number; y: number } | null = null

  // Paths whose native paper.js selected-item decoration (the blue bounding
  // box + solid corner/segment squares) we suppress while they are shown via
  // the direct-select AnchorChrome. The app draws its own hollow / filled
  // anchor markers, so paper's native squares would otherwise render on top of
  // (or through) them and look like stray solid-blue boxes.
  private chromeSuppressed = new Set<paper.Path>()

  /** Disable paper.js's native selected decoration on one path. */
  private suppressNativeSelection(path: paper.Path) {
    if (!path.selected || (path as any)._drawSelected === false) return
    ;(path as any)._drawSelected = false
    this.chromeSuppressed.add(path)
  }

  /** Re-enable paper.js's native selected decoration on one path. */
  private restoreNativeSelection(path: paper.Path) {
    if (!this.chromeSuppressed.has(path)) return
    delete (path as any)._drawSelected
    this.chromeSuppressed.delete(path)
  }

  /** Re-enable native selection decoration for every suppressed path. */
  private restoreAllNativeSelections() {
    for (const path of Array.from(this.chromeSuppressed)) {
      this.restoreNativeSelection(path)
    }
  }

  attachEngine(engine: EditorEngine) {
    this.engine = engine
    this.chrome.attachEngine(engine)
    this.guides.attachEngine(engine)
  }

  activate() {
    if (!this.engine) return
    const store = this.engine.store
    // Whenever this controller is (re)activated, give paper.js back control of
    // the native selected-item decoration. The direct-select refreshChrome()
    // re-suppresses it for the paths it is actually rendering as we edit.
    this.restoreAllNativeSelections()
    this.mode = store.tool === 'direct-select' ? 'direct-select' : 'select'
    this.clearAnchorState()
    this.grabGuide = null
    this.guideOriginalPos = 0
    this.grabPath = null
    this.dragStartPoint = null
    this.anchorMarquee = false
    this.clearAnchorSelection()
    this.guides.clearSelection()
    this.chrome.clear()
    this.setupTool()
  }

  private clearAnchorState() {
    this.grab = 'none'
    this.grabSegmentIndex = -1
    this.grabIsIn = false
    this.lastSegmentCount = -1
    this.grabPath = null
    this.dragStartPoint = null
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

      // In direct-select mode, anchor/handle grabbing takes priority over
      // guide interaction so users can fine-tune anchors near guides.
      if (this.mode === 'direct-select' && this.tryGrabAnchor(event)) {
        this.guides.clearSelection()
        engine.store.setDragging(true)
        this.refreshChrome()
        return
      }

      // ---- Guide interaction ----
      if (engine.store.view.showGuides) {
        const guideHit = this.guides.hitTest(event.point)
        if (guideHit) {
          this.clearAnchorSelection()
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
          this.refreshChrome()
          engine.scope.view.update()
          return
        }
      }
      // Not clicking a guide -> clear guide selection.
      this.guides.clearSelection()

      const hitResult = this.hitTest(event.point)

      if (hitResult) {
        const item = hitResult.item
        this.clearAnchorSelection()
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

        this.isDragging = true
        this.dragItems = engine.getSelection()
        this.dragStart = { x: event.point.x, y: event.point.y }
        this.grab = 'object'
      } else {
        if (event.modifiers.shift) return
        engine.clearSelection()
        this.clearAnchorSelection()
        this.refreshChrome()
        this.isMarquee = true
        // Direct-select marquee sub-selects anchors; the select tool marquee
        // selects whole objects.
        this.anchorMarquee = this.mode === 'direct-select'
        this.marqueeShift = !!event.modifiers.shift
        this.dragStart = { x: event.point.x, y: event.point.y }
        this.createMarquee(event.point.x, event.point.y)
        engine.store.setDragging(true)
      }
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      const store = engine.store
      if (this.grab === 'guide' && this.grabGuide) {
        this.dragGuide(event.point)
      } else if (this.mode === 'direct-select' && (this.grab === 'anchor' || this.grab === 'anchor-group')) {
        this.dragAnchor(event.point)
      } else if (this.mode === 'direct-select' && this.grab === 'handle') {
        this.dragHandle(event.point)
      } else if (this.isMarquee) {
        this.updateMarquee(event.point.x, event.point.y)
      } else if (this.isDragging && this.dragItems.length > 0) {
        const delta = new scope.Point(
          event.point.x - this.dragStart.x,
          event.point.y - this.dragStart.y
        )
        this.dragItems.forEach((item) => {
          if (!item.locked) {
            item.position = (item.position as paper.Point).add(delta)
          }
        })
        this.dragStart = { x: event.point.x, y: event.point.y }
      }
      store.setCursorPos(event.point.x, event.point.y)
      this.refreshChrome()
      scope.view.update()
    }

    scope.tool.onMouseUp = (event: paper.ToolEvent) => {
      if (this.grab === 'guide' && this.grabGuide) {
        this.finishGuideDrag(event)
      } else if (this.isMarquee) {
        if (this.anchorMarquee) this.finishAnchorMarquee()
        else this.finishMarquee()
        this.isMarquee = false
        this.anchorMarquee = false
        this.removeMarquee()
      } else if (this.isDragging && this.grab === 'object') {
        this.isDragging = false
        engine.pushHistory('Move')
      } else if (this.grab === 'anchor' || this.grab === 'anchor-group' || this.grab === 'handle') {
        engine.pushHistory('Edit Path')
      }
      this.grab = 'none'
      this.isDragging = false
      this.grabGuide = null
      this.grabPath = null
      this.dragStartPoint = null
      engine.store.setDragging(false)
      this.refreshChrome()
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
      // Show a move cursor when hovering over a guide.
      const guide = engine.store.view.showGuides ? this.guides.hitTest(event.point) : null
      engine.canvas.style.cursor = guide ? 'move' : ''
      this.refreshChrome()
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      switch (event.key) {
        case 'delete':
        case 'backspace':
          if (this.guides.hasSelection()) {
            this.guides.deleteSelectedGuides()
          } else if (this.mode === 'direct-select' && this.hasAnchorSelection()) {
            this.deleteSelectedAnchors()
          } else if (this.mode === 'direct-select' && this.grabSegmentIndex >= 0) {
            this.deleteGrabbedAnchor()
          } else {
            engine.deleteSelected()
          }
          break
        case 'escape':
          this.guides.clearSelection()
          this.clearAnchorSelection()
          engine.clearSelection()
          this.refreshChrome()
          break
        case 'c':
          if (event.modifiers.command) engine.copySelected()
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
        this.grab = 'anchor-group'
        this.grabPath = hit.path
        this.grabSegmentIndex = hit.index
        this.grabIsIn = false
        this.dragStartPoint = { x: event.point.x, y: event.point.y }
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
      if (modifiers.shift) {
        this.toggleAnchorSelection(hit.path, hit.index)
      } else if (!this.isAnchorSelected(hit.path, hit.index)) {
        this.clearAnchorSelection()
        this.addAnchorToSelection(hit.path, hit.index)
      }
      this.grab = this.hasAnchorSelection() ? 'anchor-group' : 'anchor'
      this.grabPath = hit.path
      this.grabSegmentIndex = hit.index
      this.grabIsIn = false
      this.dragStartPoint = { x: event.point.x, y: event.point.y }
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

  private dragAnchor(point: paper.Point) {
    const engine = this.engine
    if (!engine) return
    if (this.grab === 'anchor-group' && this.hasAnchorSelection()) {
      // Translate every sub-selected anchor as one rigid group.
      if (!this.dragStartPoint) return
      const dx = point.x - this.dragStartPoint.x
      const dy = point.y - this.dragStartPoint.y
      if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return
      for (const entry of this.selectedSegments) {
        const seg = entry.path.segments[entry.index]
        if (!seg) continue
        seg.point = seg.point.add(new engine.scope.Point(dx, dy))
      }
      this.dragStartPoint = { x: point.x, y: point.y }
      engine.scope.view.update()
      return
    }
    const path = this.grabPath ?? this.getEditPath()
    if (!path) return
    const seg = path.segments[this.grabSegmentIndex]
    if (!seg) return
    seg.point = point
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

  private deleteGrabbedAnchor() {
    const path = this.getEditPath()
    const engine = this.engine
    if (!path || !engine) return
    const scope = engine.scope
    const idx = this.grabSegmentIndex
    if (idx < 0 || idx >= path.segments.length) return
    if (path.segments.length < (path.closed ? 4 : 3)) {
      path.remove()
      engine.clearSelection()
      this.clearAnchorState()
      this.chrome.clear()
      engine.pushHistory('Delete Anchor')
      scope.view.update()
      return
    }
    path.removeSegment(idx)
    this.grabSegmentIndex = -1
    engine.pushHistory('Delete Anchor')
    scope.view.update()
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

  /** Delete every sub-selected anchor and clear the sub-selection. */
  private deleteSelectedAnchors() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    this.pruneAnchorSelection()
    if (this.selectedSegments.length === 0) return

    // Delete from the back so indices stay valid while removing.
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
        const minSegs = path.closed ? 4 : 3
        if (path.segments.length <= minSegs) {
          removedAll.push(path)
          break
        }
        path.removeSegment(idx)
      }
    }
    for (const path of removedAll) {
      if (path.selected) path.selected = false
      path.remove()
    }
    this.clearAnchorSelection()
    this.clearAnchorState()
    engine.pushHistory('Delete Anchors')
    scope.view.update()
  }

  /** Redraw anchor + handle chrome for the currently edited path. */
  private refreshChrome() {
    if (this.mode !== 'direct-select') {
      this.restoreAllNativeSelections()
      this.chrome.clear()
      return
    }
    const engine = this.engine
    if (!engine) {
      this.restoreAllNativeSelections()
      this.chrome.clear()
      return
    }
    this.pruneAnchorSelection()
    // When anchors are sub-selected, draw chrome for every involved path so
    // multi-path anchor selections stay visible.
    const paths = this.hasAnchorSelection() ? this.anchorSelectionPaths() : []
    if (paths.length === 0) {
      const path = this.getEditPath()
      if (path) paths.push(path)
    }
    if (paths.length === 0) {
      this.restoreAllNativeSelections()
      this.chrome.clear()
      return
    }
    // Only our AnchorChrome should paint the anchor markers of the paths we
    // are editing: restore native decoration for paths no longer part of the
    // chrome and suppress it for the ones we are about to draw.
    for (const path of Array.from(this.chromeSuppressed)) {
      if (!paths.includes(path)) this.restoreNativeSelection(path)
    }
    for (const path of paths) {
      if (path.selected) this.suppressNativeSelection(path)
      else this.restoreNativeSelection(path)
    }
    const scope = engine.scope
    this.chrome.clear()
    for (const path of paths) {
      const segs = path.segments
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i]
        const isSelectedAnchor = this.isAnchorSelected(path, i) ||
          (this.grabSegmentIndex === i && path === (this.grabPath ?? this.getEditPath()) &&
            (this.grab === 'anchor' || this.grab === 'handle'))
        this.chrome.drawAnchor(seg.point, isSelectedAnchor)
      }
      // Draw handles (two passes so handle lines are beneath the markers).
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i]
        const hi = seg.handleIn as paper.Point | null
        const ho = seg.handleOut as paper.Point | null
        if (hi && !(Math.abs(hi.x) < 1e-6 && Math.abs(hi.y) < 1e-6)) {
          this.chrome.drawHandle(seg.point, seg.point.add(hi))
        }
        if (ho && !(Math.abs(ho.x) < 1e-6 && Math.abs(ho.y) < 1e-6)) {
          this.chrome.drawHandle(seg.point, seg.point.add(ho))
        }
      }
    }
    scope.view.update()
  }

  // ------------------------------------------------------------------
  // Plain hit testing / marquee helpers (shared)
  // ------------------------------------------------------------------

  private hitTest(point: paper.Point): paper.HitResult | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const hitResult = engine.project.hitTest(point, {
      fill: true,
      stroke: true,
      segments: false,
      tolerance: 3 / scope.view.zoom,
    })
    return hitResult as paper.HitResult
  }

  private createMarquee(x: number, y: number) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    if (!this.marqueeLayer) {
      this.marqueeLayer = new scope.Layer()
      this.marqueeLayer.name = 'marquee-layer'
      this.marqueeLayer.locked = true
      this.marqueeLayer.data.isUserLayer = false
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
        if (!child.visible) return
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
