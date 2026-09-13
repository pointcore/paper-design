/**
 * Knife tool controller (CDR parity).
 *
 * Drag a straight cut line through the artwork: every unlocked plain path
 * the line crosses is split at each intersection, so a closed shape opens
 * into two pieces and an open path divides into one more piece than there
 * are crossings. Pieces keep their styling and z-order and stay selected
 * under one history entry. Escape cancels the preview line; compound
 * paths, live text, rasters, pattern scaffolding and clip masks are left
 * alone (scissors handles single-path cuts).
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'

export class KnifeController {
  engine: EditorEngine | null = null
  private isCutting = false
  private line: paper.Path | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.cancelCut()
    this.setupTool()
    applyToolCursor(this.engine.canvas, 'knife')
  }

  /**
   * Tool switch: the paper Tool is replaced so the gesture's mouse-up
   * never arrives — drop the in-flight preview instead of leaving it on
   * the overlay layer.
   */
  deactivate() {
    if (this.isCutting) this.cancelCut()
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
      const native = ((event as any).event as MouseEvent) ?? null
      if (native && native.button !== 0) return
      if (this.isCutting) return
      const line = new scope.Path() as paper.Path
      line.add(new scope.Segment(event.point.clone()))
      line.strokeColor = new scope.Color('#e5484d')
      line.strokeWidth = 1 / scope.view.zoom
      line.dashArray = [4 / scope.view.zoom, 3 / scope.view.zoom]
      line.data.isPreview = true
      engine.getOverlayLayer().addChild(line)
      this.line = line
      this.isCutting = true
      engine.store.setDragging(true)
      scope.view.update()
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (!this.isCutting || !this.line) return
      const segments = this.line.segments
      const last = segments[segments.length - 1].point
      if (last.getDistance(event.point) < 1 / scope.view.zoom) return
      this.line.add(new scope.Segment(event.point.clone()))
      engine.store.setCursorPos(event.point.x, event.point.y)
      scope.view.update()
    }

    scope.tool.onMouseUp = () => {
      if (!this.isCutting) return
      this.applyCut()
      engine.store.setDragging(false)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      // Never steal keystrokes typed into panel inputs or dialogs.
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'escape' && this.isCutting) {
        this.cancelCut()
        engine.store.setDragging(false)
      }
    }

    scope.view.update()
  }

  /** Split every unlocked plain path the finished line crosses. */
  private applyCut() {
    const engine = this.engine
    const line = this.line
    this.isCutting = false
    this.line = null
    if (!engine || !line) return
    line.remove()
    if (line.segments.length < 2 || line.length < 1e-6) {
      // A click instead of a drag: nothing to slice, just hint at the gesture.
      engine.store.setStatusMessage('Drag across unlocked paths to cut')
      engine.scope.view.update()
      return
    }

    const targets = this.collectTargets(line)
    const selected: paper.Item[] = []
    let sliced = 0
    for (const target of targets) {
      const wasClosed = target.closed
      let pieces: paper.Path[]
      try {
        pieces = this.slicePath(target, line)
      } catch {
        pieces = [target]
      }
      // Bounds pre-filter admits uncut paths: only sliced results join the
      // selection. A closed ring opened by a single crossing mutates in
      // place to one piece, so closed->open counts as sliced too — or the
      // open would land with no history entry.
      const didSlice = pieces.length > 1 || (wasClosed && !target.closed)
      if (!didSlice) continue
      sliced++
      for (const piece of pieces) {
        if (piece !== target) {
          // Split-off parts carry the styling already; re-anchor their
          // gradients to the new bounds and give them fresh identities.
          engine.applyStyleToItem(piece, engine.getStyleFromItem(target))
          piece.data.id = engine.genId()
          piece.data.isUserItem = true
        }
        engine.refreshItemGradient(piece)
        selected.push(piece)
      }
    }

    if (sliced === 0) {
      engine.store.setStatusMessage(targets.length === 0 ? 'Drag across unlocked paths to cut' : 'The cut line crossed no cuttable path')
      engine.scope.view.update()
      return
    }

    engine.clearSelection()
    for (const item of selected) item.selected = true
    engine.syncSelectionToStore()
    engine.pushHistory('Knife')
    engine.scope.view.update()
  }

  /**
   * Cuttable unlocked plain paths whose bounds meet the line. Compound
   * paths and scaffolding (pattern tiles, clip masks) stay out — cutting
   * the host shape instead of its pieces would tear the artwork apart.
   */
  private collectTargets(line: paper.Path): paper.Path[] {
    const engine = this.engine
    if (!engine) return []
    const scope = engine.scope
    const lineBounds = line.bounds
    if (!lineBounds) return []
    // Pad by a unit so a re-cut running exactly along a previous seam still
    // admits the seam pieces: their shared edge only touches the line, and
    // strict bounds tests would reject the touch. interiorOf() then no-ops
    // them (every crossing sits on an anchor) instead of the pre-filter.
    const bounds = new scope.Rectangle(
      lineBounds.x - 1, lineBounds.y - 1, lineBounds.width + 2, lineBounds.height + 2
    )
    const out: paper.Path[] = []
    const walk = (item: paper.Item) => {
      if ((item as any).locked || (item as any).visible === false) return
      const data = (item.data as any) ?? {}
      if (data.isChrome || data.isPreview || data.isGuide || data.annotation) return
      if (data.isPatternTile || data.isPatternFill || data.textMode) return
      if ((item as any).clipMask) return
      // Compound children would tear the compound apart — leave the whole
      // compound to scissors/object ops instead.
      if (item instanceof scope.CompoundPath) return
      if (item instanceof scope.Group) {
        const kids = (item as any).children as Array<any> | undefined
        if (kids && kids.some((k) => k && k.clipMask)) return
      }
      if (item instanceof scope.Path) {
        if (item.segments.length >= 2 && item.bounds?.intersects(bounds)) out.push(item as paper.Path)
        return
      }
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) walk(child)
      }
    }
    for (const layer of engine.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      for (const child of layer.children) walk(child as paper.Item)
    }
    return out
  }

  /**
   * Cut one path at every crossing with the line. paper 0.12.x opens a
   * closed ring in place on splitAt and hands back the ring itself (there
   * is no duplicate "rest" — removing the return value would delete the
   * artwork), so the opened ring simply goes through the same open-path
   * loop below. Open-path splits are clean (head + complementary tail),
   * and crossings that sit on an existing anchor are ignored so a
   * just-created seam can never re-split.
   */
  private slicePath(target: paper.Path, line: paper.Path): paper.Path[] {
    const interiorOf = (piece: paper.Path): paper.CurveLocation | null => {
      let crossings: paper.CurveLocation[] = []
      try {
        crossings = piece.getIntersections(line)
      } catch {
        crossings = []
      }
      for (const loc of crossings) {
        if (!loc.point) continue
        // Crossings sitting on an existing anchor are seam/anchor hits.
        if (piece.segments.some((s) => s.point.getDistance(loc.point) < 1e-6)) continue
        // Re-derive the location ON the piece itself: with the cut line
        // already detached, paper answers with CurveLocations whose owner
        // path is unreliable (the geometry is right, the .path/.item
        // identity is not), and splitting with a foreign location corrupts
        // the split. getNearestLocation is guaranteed piece-owned.
        const own = piece.getNearestLocation(loc.point)
        if (own && own.point && own.point.getDistance(loc.point) < 1e-6) return own
      }
      return null
    }
    if (target.segments.length < 2 || target.length < 1e-6) return [target]
    // New children paper adds while splitting (plus the target itself) are
    // tracked so degenerate split leftovers can be swept at the end.
    const parent = target.parent as paper.Item | null
    const known = new Set<paper.Item>(parent ? ((parent.children as paper.Item[]) ?? []) : [])
    const first = interiorOf(target)
    if (!first) return [target]
    // paper 0.12 opens a closed ring in place on splitAt; when the split
    // point is not inserted as an anchor (observed for crossings on the
    // ring's first curve), the ring's start anchor turns into a phantom
    // seam that would shred one extra piece below. Remember it so the two
    // seam-touching pieces are joined back together after the loop.
    let seam: paper.Point | null = null
    if (target.closed) {
      try {
        target.splitAt(first)
      } catch {
        return [target]
      }
      if (target.closed) return [target]
      if (!target.segments.some((s) => s.point.getDistance(first.point) < 1e-6)) {
        seam = target.firstSegment.point.clone()
      }
    }
    const done: paper.Path[] = []
    const queue: paper.Path[] = [target]
    let guard = 0
    while (queue.length) {
      const piece = queue.pop() as paper.Path
      const interior = interiorOf(piece)
      if (!interior || piece.segments.length < 2 || piece.length < 1e-6) {
        done.push(piece)
        continue
      }
      if (++guard > 32) {
        done.push(piece)
        continue
      }
      let rest: paper.Path | null = null
      try {
        rest = piece.splitAt(interior) as paper.Path | null
      } catch {
        rest = null
      }
      if (rest && rest.segments.length >= 2 && rest.length > 1e-6) queue.push(rest)
      if (piece.segments.length >= 2 && piece.length > 1e-6) queue.push(piece)
      else done.push(piece)
    }
    if (seam && done.length > 1) {
      const tail = done.find((p) => p.lastSegment.point.getDistance(seam as paper.Point) < 1e-6)
      const head = done.find((p) => p !== tail && p.firstSegment.point.getDistance(seam as paper.Point) < 1e-6)
      if (tail && head) {
        try {
          tail.join(head)
          done.splice(done.indexOf(head), 1)
        } catch {
          /* leave the phantom seam split rather than corrupt the artwork */
        }
      }
    }
    const pieces = done.filter((piece) => piece.length > 1e-6)
    if (parent) {
      // paper's splitAt can leave degenerate husks behind (single-point
      // leftovers, or the target itself when a split collapses onto its
      // start anchor); anything new and degenerate is invisible garbage —
      // drop it.
      for (const child of [...((parent.children as paper.Item[]) ?? [])]) {
        if (pieces.includes(child as paper.Path)) continue
        const path = child as paper.Path
        if (!(path as any).segments) continue
        const degenerate = path.segments.length < 2 || path.length <= 1e-6
        if (degenerate && (!known.has(child) || child === target)) {
          path.remove()
        }
      }
    }
    return pieces
  }

  /** Drop the in-progress preview line without touching the artwork. */
  private cancelCut() {
    if (this.line) {
      this.line.remove()
      this.line = null
    }
    this.isCutting = false
    if (this.engine) {
      this.engine.store.setDragging(false)
      this.engine.scope.view.update()
    }
  }
}
