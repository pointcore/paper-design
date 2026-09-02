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
  private grab: 'none' | 'anchor' | 'handle' | 'object' | 'guide' = 'none'
  private grabSegmentIndex = -1
  private grabIsIn = false
  private lastSegmentCount = -1
  private grabGuide: paper.Path | null = null
  private guideOriginalPos = 0

  attachEngine(engine: EditorEngine) {
    this.engine = engine
    this.chrome.attachEngine(engine)
    this.guides.attachEngine(engine)
  }

  activate() {
    if (!this.engine) return
    const store = this.engine.store
    this.mode = store.tool === 'direct-select' ? 'direct-select' : 'select'
    this.clearAnchorState()
    this.grabGuide = null
    this.guideOriginalPos = 0
    this.guides.clearSelection()
    this.chrome.clear()
    this.setupTool()
  }

  private clearAnchorState() {
    this.grab = 'none'
    this.grabSegmentIndex = -1
    this.grabIsIn = false
    this.lastSegmentCount = -1
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
        return
      }

      // ---- Guide interaction ----
      if (engine.store.view.showGuides) {
        const guideHit = this.guides.hitTest(event.point)
        if (guideHit) {
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
        this.refreshChrome()
        this.isMarquee = true
        this.dragStart = { x: event.point.x, y: event.point.y }
        this.createMarquee(event.point.x, event.point.y)
        engine.store.setDragging(true)
      }
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      const store = engine.store
      if (this.grab === 'guide' && this.grabGuide) {
        this.dragGuide(event.point)
      } else if (this.mode === 'direct-select' && this.grab === 'anchor') {
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
        this.finishMarquee()
        this.isMarquee = false
        this.removeMarquee()
      } else if (this.isDragging && this.grab === 'object') {
        this.isDragging = false
        engine.pushHistory('Move')
      } else if (this.grab === 'anchor' || this.grab === 'handle') {
        engine.pushHistory('Edit Path')
      }
      this.grab = 'none'
      this.isDragging = false
      this.grabGuide = null
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
          } else if (this.mode === 'direct-select' && this.grabSegmentIndex >= 0) {
            this.deleteGrabbedAnchor()
          } else {
            engine.deleteSelected()
          }
          break
        case 'escape':
          this.guides.clearSelection()
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

    // Look at the edited path first, then at any other visible path in the
    // active layer when nothing of interest is selected yet.
    let candidates: paper.Path[] = []
    const selected = this.getEditPath()
    if (selected) candidates.push(selected)
    for (const extra of this.userPathsAt(event.point)) {
      if (!extra.selected && !candidates.includes(extra)) candidates.push(extra)
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
            this.grab = 'handle'
            this.grabSegmentIndex = i
            this.grabIsIn = true
            return true
          }
        }
        if (ho) {
          const hp = anchor.add(ho)
          if (hp.getDistance(event.point) <= tol) {
            this.ensureEditedPath(path)
            this.grab = 'handle'
            this.grabSegmentIndex = i
            this.grabIsIn = false
            return true
          }
        }
      }
      for (let i = 0; i < path.segments.length; i++) {
        const seg = path.segments[i]
        if (seg.point.getDistance(event.point) <= tol) {
          this.ensureEditedPath(path)
          this.grab = 'anchor'
          this.grabSegmentIndex = i
          return true
        }
      }
    }
    return false
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
        if (p.selected) return // handled by getEditPath already
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
    const path = this.getEditPath()
    const engine = this.engine
    if (!path || !engine) return
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

  /** Redraw anchor + handle chrome for the currently edited path. */
  private refreshChrome() {
    if (this.mode !== 'direct-select') {
      this.chrome.clear()
      return
    }
    const path = this.getEditPath()
    const engine = this.engine
    if (!path || !engine) {
      this.chrome.clear()
      return
    }
    const scope = engine.scope
    this.chrome.clear()
    const segs = path.segments
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]
      const selected = this.grabSegmentIndex === i && (this.grab === 'anchor' || this.grab === 'handle')
      this.chrome.drawAnchor(seg.point, selected)
    }
    // Draw handles (two passes so handle lines are beneath the handle markers).
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
    const bounds = this.marqueeRect.bounds

    const rectInProject = new scope.Rectangle(
      bounds.x - engine.center.x,
      bounds.y - engine.center.y,
      bounds.width,
      bounds.height
    )

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
