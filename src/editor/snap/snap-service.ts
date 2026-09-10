/**
 * SnapService - pointer snapping and smart alignment guides.
 *
 * Two services in one place, both driven by the store snap flags and gated
 * by the master snap.enable switch:
 *
 * - snapPoint() pulls a document point onto static sources: ruler guides,
 *   the grid and path anchor points. Used for object dragging and for
 *   placing shape / pen anchors.
 * - alignDraggedBounds() compares a dragged selection bounds against every
 *   other visible user item and returns the edge / center correction plus
 *   temporary guide segments (the "smart guides" behavior).
 */
import type { EditorEngine } from '../engine'

/** Bounds correction plus temporary guide segments for one drag step. */
export interface SmartCorrection {
  dx: number
  dy: number
  lines: Array<{ from: paper.Point; to: paper.Point }>
}

export class SnapService {
  engine: EditorEngine | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  /** Screen-space tolerance converted to document units. */
  private tolerance(): number {
    const engine = this.engine
    if (!engine) return 0
    return 6 / (engine.scope.view.zoom || 1)
  }

  /**
   * Snap a document point onto guides, grid and anchors. Sources compete by
   * distance (nearest wins); the original point is returned untouched when
   * snapping is disabled or nothing is within tolerance.
   */
  snapPoint(raw: paper.Point, exclude?: paper.Item[]): paper.Point {
    const engine = this.engine
    if (!engine) return raw
    const snap = engine.store.snap
    if (!snap.enable) return raw
    const scope = engine.scope
    const tol = this.tolerance()
    let best = raw.clone()
    let bestDist = tol

    // Ruler guide lines (single axis each).
    if (snap.guides && engine.store.view.showGuides) {
      for (const guide of engine.getGuides()) {
        const orientation = engine.getGuideOrientation(guide)
        if (orientation === 'vertical') {
          const gx = engine.getGuidePosition(guide)
          const dist = Math.abs(raw.x - gx)
          if (dist <= bestDist) {
            best = new scope.Point(gx, raw.y)
            bestDist = dist
          }
        } else if (orientation === 'horizontal') {
          const gy = engine.getGuidePosition(guide)
          const dist = Math.abs(raw.y - gy)
          if (dist <= bestDist) {
            best = new scope.Point(raw.x, gy)
            bestDist = dist
          }
        }
      }
    }

    // Grid crossings (radial distance).
    if (snap.grid) {
      const size = snap.gridSize > 0 ? snap.gridSize : 10
      const gx = Math.round(raw.x / size) * size
      const gy = Math.round(raw.y / size) * size
      const dist = Math.hypot(gx - raw.x, gy - raw.y)
      if (dist <= bestDist) {
        best = new scope.Point(gx, gy)
        bestDist = dist
      }
    }

    // Path anchor points (strictly nearer wins, so guides/grid win ties).
    if (snap.point) {
      const excluded = new Set(exclude ?? [])
      for (const anchor of this.collectAnchorPoints(excluded)) {
        const dist = anchor.getDistance(raw)
        if (dist < bestDist) {
          best = anchor.clone()
          bestDist = dist
        }
      }
    }

    return best
  }

  /**
   * Edge / center alignment correction for dragged bounds against every
   * other visible user item. Returns the shift that lands the closest
   * alignment plus the guide segments to draw for it.
   */
  alignDraggedBounds(candidate: paper.Rectangle, exclude?: paper.Item[]): SmartCorrection {
    const engine = this.engine
    const empty: SmartCorrection = { dx: 0, dy: 0, lines: [] }
    if (!engine) return empty
    const snap = engine.store.snap
    if (!snap.enable || !snap.smartGuides) return empty
    const scope = engine.scope
    const tol = this.tolerance()
    const excluded = new Set(exclude ?? [])
    const targets = this.collectTargetRects(excluded)
    if (targets.length === 0) return empty

    const candX = [candidate.x, candidate.x + candidate.width / 2, candidate.x + candidate.width]
    const candY = [candidate.y, candidate.y + candidate.height / 2, candidate.y + candidate.height]

    let bestDx = 0
    let bestDxDist = tol + 1e-9
    let alignX = 0
    let spanTop = 0
    let spanBottom = 0
    let foundX = false

    let bestDy = 0
    let bestDyDist = tol + 1e-9
    let alignY = 0
    let spanLeft = 0
    let spanRight = 0
    let foundY = false

    for (const target of targets) {
      const tx = [target.x, target.x + target.width / 2, target.x + target.width]
      const ty = [target.y, target.y + target.height / 2, target.y + target.height]
      for (const cx of candX) {
        for (const gx of tx) {
          const dist = Math.abs(cx - gx)
          if (dist < bestDxDist) {
            bestDx = gx - cx
            bestDxDist = dist
            alignX = gx
            spanTop = Math.min(candidate.y, target.y)
            spanBottom = Math.max(candidate.y + candidate.height, target.y + target.height)
            foundX = true
          }
        }
      }
      for (const cy of candY) {
        for (const gy of ty) {
          const dist = Math.abs(cy - gy)
          if (dist < bestDyDist) {
            bestDy = gy - cy
            bestDyDist = dist
            alignY = gy
            spanLeft = Math.min(candidate.x, target.x)
            spanRight = Math.max(candidate.x + candidate.width, target.x + target.width)
            foundY = true
          }
        }
      }
    }

    const lines: Array<{ from: paper.Point; to: paper.Point }> = []
    let dx = 0
    let dy = 0
    if (foundX) {
      dx = bestDx
      lines.push({
        from: new scope.Point(alignX, spanTop),
        to: new scope.Point(alignX, spanBottom),
      })
    }
    if (foundY) {
      dy = bestDy
      lines.push({
        from: new scope.Point(spanLeft, alignY),
        to: new scope.Point(spanRight, alignY),
      })
    }
    return { dx, dy, lines }
  }

  /** Segment points (and text anchors) of user artwork outside `excluded`. */
  private collectAnchorPoints(excluded: Set<paper.Item>): paper.Point[] {
    const engine = this.engine
    if (!engine) return []
    const scope = engine.scope
    const out: paper.Point[] = []
    const walk = (item: paper.Item) => {
      if (excluded.has(item)) return
      // Locked / hidden art never pulls the pointer (AI); pattern tiles
      // and path-text glyph runs are layout exhaust, not snap targets.
      if ((item as any).locked || (item as any).visible === false) return
      const data = (item.data as any) ?? {}
      if (data.isPreview || data.isChrome) return
      // Pattern tiles are layout exhaust (the clip mask itself stays a
      // valid outline target); path-text glyph runs reflow constantly.
      if (data.isPatternTile) return
      if (data.textMode === 'path') return
      if (item instanceof scope.Path && !(item instanceof scope.CompoundPath)) {
        for (const seg of item.segments) out.push(seg.point.clone())
        return
      }
      if (item instanceof scope.CompoundPath || item instanceof scope.Group) {
        for (const child of item.children) walk(child as paper.Item)
        return
      }
      if (item instanceof scope.PointText && !data.annotation) {
        out.push((item as paper.PointText).point.clone())
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
    // Artboard corners and centers snap like anchors (placement aid).
    for (const board of engine.store.artboards) {
      if (board.width <= 0 || board.height <= 0) continue
      const cx = board.x + board.width / 2
      const cy = board.y + board.height / 2
      out.push(
        new scope.Point(board.x, board.y),
        new scope.Point(board.x + board.width, board.y),
        new scope.Point(board.x, board.y + board.height),
        new scope.Point(board.x + board.width, board.y + board.height),
        new scope.Point(cx, cy)
      )
    }
    return out
  }

  /** Bounds of top-level user items outside `excluded` (alignment targets). */
  private collectTargetRects(excluded: Set<paper.Item>): paper.Rectangle[] {
    const engine = this.engine
    if (!engine) return []
    const scope = engine.scope
    const out: paper.Rectangle[] = []
    for (const layer of engine.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      for (const child of layer.children) {
        const item = child as paper.Item
        if (excluded.has(item)) continue
        if (!item.visible || (item as any).locked) continue
        if ((item.data as any)?.isPreview) continue
        const b = item.bounds
        if (!b) continue
        out.push(b.clone())
      }
    }
    // Artboard edges participate in smart alignment like any bounds.
    for (const board of engine.store.artboards) {
      if (board.width <= 0 || board.height <= 0) continue
      out.push(new scope.Rectangle(board.x, board.y, board.width, board.height))
    }
    return out
  }
}
