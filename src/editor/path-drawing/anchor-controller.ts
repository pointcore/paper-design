/**
 * Anchor point tools controller.
 *
 * Groups the three anchor editing tools modelled after Adobe Illustrator:
 *  - 'add-anchor'     : hovering a segment previews a marker; clicking inserts
 *                       an anchor on the curve without altering its shape.
 *  - 'delete-anchor'  : clicking an anchor removes it.
 *  - 'convert-anchor' : clicking an anchor toggles it between a smooth curve
 *                       point and a corner point.
 *
 * Which tool is running is read from the current Pinia store tool name.
 */
import { EditorEngine } from '../engine'
import { AnchorChrome } from './anchor-chrome'

export type AnchorToolMode = 'add-anchor' | 'delete-anchor' | 'convert-anchor'

export class AnchorController {
  engine: EditorEngine | null = null
  chrome: AnchorChrome = new AnchorChrome()

  private mode: AnchorToolMode = 'add-anchor'
  private hoverAnchor: paper.Segment | null = null
  private hoverPath: paper.Path | null = null
  private hoverSegIndex = -1

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
      this.updateHover(event.point)
    }

    scope.tool.onMouseDown = (event: paper.ToolEvent) => {
      const native = (event as any).event as MouseEvent
      if (native && native.button !== 0) return
      this.applyAt(event.point)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      if (event.key === 'escape') {
        engine.clearSelection()
      }
    }

    scope.view.update()
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
        // Show the anchor marker at the nearest point on the curve.
        this.chrome.clear()
        this.chrome.drawCrosshair(target.point)
        this.hoverPath = target.path
        this.hoverSegIndex = target.segmentIndex
      }
    } else {
      const target = this.findAnchorTarget(point)
      if (target && target.path && target.segment) {
        const isConvert = this.mode === 'convert-anchor'
        this.chrome.clear()
        // Highlight the candidate anchor.
        this.chrome.drawAnchor(target.segment.point, isConvert)
        if (isConvert && this.hasHandles(target.segment)) {
          this.drawHandlesOf(target.path, target.index)
        }
        this.hoverAnchor = target.segment
        this.hoverPath = target.path
        this.hoverSegIndex = target.index
      }
    }
    scope.view.update()
  }

  private applyAt(point: paper.Point) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    if (this.mode === 'add-anchor') {
      const target = this.findSegmentTarget(point)
      if (target && target.path) {
        this.addAnchorOnCurve(target.path, point)
        engine.pushHistory('Add Anchor')
      }
    } else if (this.mode === 'delete-anchor') {
      const target = this.findAnchorTarget(point)
      if (target && target.path && target.segment) {
        this.deleteAnchor(target.path, target.index)
        engine.pushHistory('Delete Anchor')
      }
    } else if (this.mode === 'convert-anchor') {
      const target = this.findAnchorTarget(point)
      if (target && target.path && target.segment) {
        this.convertAnchor(target.path, target.index)
        engine.pushHistory('Convert Anchor')
      }
    }
    this.clearHover()
    scope.view.update()
  }

  /** Enumerate every visible, unlocked user path that can be edited. */
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
    if (item instanceof engine.scope.Path) {
      out.push(item as paper.Path)
      return
    }
    if (item.children) {
      for (const child of item.children) {
        this.collectPaths(child, out)
      }
    }
  }

  /** Find the path + segment (for add-anchor) nearest the given point. */
  private findSegmentTarget(point: paper.Point): {
    path: paper.Path; point: paper.Point; segmentIndex: number
  } | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    let best: { path: paper.Path; point: paper.Point; segmentIndex: number } | null = null
    let bestDist = Infinity
    for (const path of this.editablePaths()) {
      if (path.segments.length < 2) continue
      const loc = path.getNearestLocation(point) as paper.CurveLocation | null
      if (!loc) continue
      const d = loc.point.getDistance(point)
      if (d < bestDist) {
        bestDist = d
        const segIndex = loc.segment ? loc.segment.index : loc.path.segments.length - 1
        best = { path, point: loc.point, segmentIndex: segIndex }
      }
    }
    const tol = 12 / scope.view.zoom
    if (best && bestDist <= tol) return best
    return null
  }

  /** Find the anchor (for delete / convert) nearest the given point. */
  private findAnchorTarget(point: paper.Point): {
    path: paper.Path; segment: paper.Segment; index: number
  } | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const tol = 8 / scope.view.zoom
    for (const path of this.editablePaths()) {
      for (let i = 0; i < path.segments.length; i++) {
        const seg = path.segments[i]
        if (seg.point.getDistance(point) <= tol) {
          return { path, segment: seg, index: i }
        }
      }
    }
    return null
  }

  private hasHandles(seg: paper.Segment): boolean {
    const hi = seg.handleIn as paper.Point | null
    const ho = seg.handleOut as paper.Point | null
    const nearZero = (p: paper.Point | null) => !p || (Math.abs(p.x) < 1e-6 && Math.abs(p.y) < 1e-6)
    return !nearZero(hi) || !nearZero(ho)
  }

  private drawHandlesOf(path: paper.Path, index: number) {
    const engine = this.engine
    if (!engine) return
    const seg = path.segments[index]
    if (seg) {
      this.chrome.clear()
      this.chrome.drawAnchor(seg.point, true)
    }
  }

  /**
   * Insert a new anchor on the curve at the given screen point while keeping
   * the overall shape unchanged, using de Casteljau subdivision.
   */
  private addAnchorOnCurve(path: paper.Path, point: paper.Point) {
    const engine = this.engine
    if (!engine || path.segments.length < 2) return
    const scope = engine.scope

    // Find the curve location nearest to the click.
    const loc = path.getNearestLocation(point) as any
    if (!loc || !loc.curve) return
    const curve = loc.curve
    const t = loc.time

    // Control points of the cubic Bezier segment (absolute coordinates).
    const p0 = curve.point1
    const p1 = curve.point1.add(curve.handleOut)
    const p2 = curve.point2.add(curve.handleIn)
    const p3 = curve.point2

    // Subdivide at parameter t.
    const p01 = p0.add(p1.subtract(p0).multiply(t))
    const p12 = p1.add(p2.subtract(p1).multiply(t))
    const p23 = p2.add(p3.subtract(p2).multiply(t))
    const p012 = p01.add(p12.subtract(p01).multiply(t))
    const p123 = p12.add(p23.subtract(p12).multiply(t))
    const split = p012.add(p123.subtract(p012).multiply(t))

    const segIndex = loc.segment ? loc.segment.index : 0

    // Insert the new segment right after segIndex.
    const newSeg = new scope.Segment(split)
    path.insert(segIndex + 1, newSeg)

    // Keep the first half handles on the leading segment.
    const a = path.segments[segIndex]
    if (a) {
      a.handleOut = p01.subtract(p0)
      newSeg.handleIn = p012.subtract(split)
    }
    // Keep the second half handles on the trailing segment.
    const b = path.segments[segIndex + 2]
    if (b) {
      newSeg.handleOut = p123.subtract(split)
      b.handleIn = p23.subtract(p3)
    }
    scope.view.update()
  }

  private deleteAnchor(path: paper.Path, index: number) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    // Keep at least two anchors for an open path (or three for a closed one).
    const minSegs = path.closed ? 4 : 3
    if (path.segments.length < minSegs) {
      // Too few anchors to keep a meaningful path.
      path.remove()
      return
    }
    path.removeSegment(index)
    scope.view.update()
  }

  /** Toggle an anchor between a smooth curve point and a sharp corner. */
  private convertAnchor(path: paper.Path, index: number) {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const seg = path.segments[index]
    if (!seg) return

    if (this.hasHandles(seg)) {
      // Remove the handles -> make it a corner point.
      ;(seg.handleIn as any) = null
      ;(seg.handleOut as any) = null
    } else {
      // Add symmetric handles derived from the neighbouring anchors.
      const n = path.segments.length
      const closed = path.closed
      const prev = closed
        ? path.segments[(index - 1 + n) % n]
        : (index > 0 ? path.segments[index - 1] : null)
      const next = closed
        ? path.segments[(index + 1) % n]
        : (index < n - 1 ? path.segments[index + 1] : null)

      let dir: paper.Point
      if (prev && next) {
        dir = next.point.subtract(prev.point)
      } else if (next) {
        dir = next.point.subtract(seg.point)
      } else if (prev) {
        dir = seg.point.subtract(prev.point)
      } else {
        dir = new scope.Point(10, 0)
      }
      let len = dir.length / 4
      if (len < 1) len = 10
      const tangent = dir.normalize(len)
      seg.handleIn = tangent.multiply(-1)
      seg.handleOut = tangent
    }
    scope.view.update()
  }

  private clearHover() {
    this.chrome.clear()
    this.hoverAnchor = null
    this.hoverPath = null
    this.hoverSegIndex = -1
  }
}
