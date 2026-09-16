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
 *
 * Performance: anchor points and target rectangles are cached with spatial
 * indexing (grid hash) and rebuilt only when the document geometry changes
 * (dirty flag). Callers must call invalidateCache() when items are
 * added/removed/moved/resized.
 */
import type { EditorEngine } from '../engine'

/** Bounds correction plus temporary guide segments for one drag step. */
export interface SmartCorrection {
  dx: number
  dy: number
  lines: Array<{ from: paper.Point; to: paper.Point }>
}

/** Cell in the spatial grid hash index. */
interface GridCell {
  /** Indices into the global anchors array. */
  anchors: number[]
}

/**
 * Spatial grid index for fast nearest-neighbor anchor lookups.
 * Divides the document space into cells; each anchor is assigned to one cell.
 * When searching, only the cell containing the query point and its 8 neighbors
 * are checked (constant-time per lookup regardless of total anchor count).
 */
class SpatialGrid {
  private cellSize: number
  private cells = new Map<string, GridCell>()

  constructor(cellSize = 200) {
    this.cellSize = cellSize
  }

  /** Clear all cells. */
  clear() {
    this.cells.clear()
  }

  /** Get the grid key for a document coordinate. */
  private key(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize)
    const cy = Math.floor(y / this.cellSize)
    return `${cx},${cy}`
  }

  /** Insert an anchor point index into the grid. */
  insert(index: number, x: number, y: number) {
    const k = this.key(x, y)
    let cell = this.cells.get(k)
    if (!cell) {
      cell = { anchors: [] }
      this.cells.set(k, cell)
    }
    cell.anchors.push(index)
  }

  /**
   * Query all anchor indices within the tolerance radius of (qx, qy).
   * Returns indices from the 3×3 neighborhood of cells.
   */
  queryRange(qx: number, qy: number, tol: number): number[] {
    const out: number[] = []
    const cx = Math.floor(qx / this.cellSize)
    const cy = Math.floor(qy / this.cellSize)
    // Expand search by 1 cell in each direction (covers points near cell edges).
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = this.cells.get(`${cx + dx},${cy + dy}`)
        if (cell) {
          for (const idx of cell.anchors) out.push(idx)
        }
      }
    }
    return out
  }
}

/**
 * Spatial grid index for fast alignment target lookups.
 * Stores target rectangle bounds; query returns targets that overlap
 * an expanded candidate rectangle (candidate + tolerance).
 */
class TargetSpatialGrid {
  private cellSize: number
  private cells = new Map<string, number[]>()

  constructor(cellSize = 400) {
    this.cellSize = cellSize
  }

  clear() {
    this.cells.clear()
  }

  private key(x: number, y: number): string {
    const cx = Math.floor(x / this.cellSize)
    const cy = Math.floor(y / this.cellSize)
    return `${cx},${cy}`
  }

  /** Insert a target index; the target's bounds span multiple cells. */
  insert(index: number, bounds: paper.Rectangle) {
    const x0 = Math.floor(bounds.x / this.cellSize)
    const y0 = Math.floor(bounds.y / this.cellSize)
    const x1 = Math.floor((bounds.x + bounds.width) / this.cellSize)
    const y1 = Math.floor((bounds.y + bounds.height) / this.cellSize)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = `${cx},${cy}`
        let cell = this.cells.get(k)
        if (!cell) {
          cell = []
          this.cells.set(k, cell)
        }
        cell.push(index)
      }
    }
  }

  /**
   * Query target indices whose bounds may overlap with (candidate + tolerance).
   * Returns a deduplicated set of candidate indices.
   */
  queryRange(candidate: paper.Rectangle, tol: number): number[] {
    const expanded = candidate.expand(tol)
    const x0 = Math.floor(expanded.x / this.cellSize)
    const y0 = Math.floor(expanded.y / this.cellSize)
    const x1 = Math.floor((expanded.x + expanded.width) / this.cellSize)
    const y1 = Math.floor((expanded.y + expanded.height) / this.cellSize)
    const seen = new Set<number>()
    const out: number[] = []
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.cells.get(`${cx},${cy}`)
        if (cell) {
          for (const idx of cell) {
            if (!seen.has(idx)) {
              seen.add(idx)
              out.push(idx)
            }
          }
        }
      }
    }
    return out
  }
}

/**
 * Cached snap data to avoid rebuilding every frame.
 * Cached until invalidateCache() is called (on document changes).
 */
interface SnapCache {
  anchors: paper.Point[]
  targets: paper.Rectangle[]
  anchorGrid: SpatialGrid
  targetGrid: TargetSpatialGrid
  version: number
  anchorVersion: number
  targetVersion: number
}

/**
 * Document-wide snap cache shared across all SnapService instances.
 * Invalidated on every document mutation (pushHistory, layer toggle, etc.).
 */
const snapCache: SnapCache = {
  anchors: [],
  targets: [],
  anchorGrid: new SpatialGrid(200),
  targetGrid: new TargetSpatialGrid(400),
  version: -1,
  anchorVersion: -1,
  targetVersion: -1,
}

export class SnapService {
  engine: EditorEngine | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  /**
   * Mark cached data as stale. Call after any document mutation that
   * changes item geometry, visibility, lock state, or layer structure.
   * Safe to call multiple times per frame (idempotent).
   */
  invalidateCache() {
    snapCache.version++
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
      const anchors = this.collectAnchorPoints(excluded)
      // Use spatial grid when available and no exclusions (common case).
      if (excluded.size === 0 && snapCache.anchorVersion === snapCache.version) {
        const candidateIndices = snapCache.anchorGrid.queryRange(raw.x, raw.y, tol)
        for (const idx of candidateIndices) {
          const anchor = anchors[idx]
          if (!anchor) continue
          const dist = anchor.getDistance(raw)
          if (dist < bestDist) {
            best = anchor.clone()
            bestDist = dist
          }
        }
      } else {
        // Fallback: linear scan (excluded set means we can't use cached grid).
        for (const anchor of anchors) {
          const dist = anchor.getDistance(raw)
          if (dist < bestDist) {
            best = anchor.clone()
            bestDist = dist
          }
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

    // Use spatial grid to filter candidates when no exclusions (common case).
    let targetIndices: number[] | null = null
    if (excluded.size === 0 && snapCache.targetVersion === snapCache.version) {
      targetIndices = snapCache.targetGrid.queryRange(candidate, tol)
    }

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

    // Iterate over filtered targets (spatial grid) or all targets (fallback).
    const iterTargets = targetIndices !== null
      ? targetIndices.map((i) => targets[i]).filter(Boolean)
      : targets
    for (const target of iterTargets) {
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

    // Use cache if valid (not invalidated since last build) and no exclusions.
    if (snapCache.anchorVersion === snapCache.version && excluded.size === 0) {
      return snapCache.anchors
    }

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

    // Cache when no exclusions (common case: snapPoint without dragged items).
    if (excluded.size === 0) {
      snapCache.anchors = out
      // Build spatial grid for fast nearest-neighbor lookups.
      snapCache.anchorGrid.clear()
      for (let i = 0; i < out.length; i++) {
        snapCache.anchorGrid.insert(i, out[i].x, out[i].y)
      }
      snapCache.anchorVersion = snapCache.version
    }
    return out
  }

  /** Bounds of top-level user items outside `excluded` (alignment targets). */
  private collectTargetRects(excluded: Set<paper.Item>): paper.Rectangle[] {
    const engine = this.engine
    if (!engine) return []
    const scope = engine.scope

    // Use cache if valid (not invalidated since last build) and no exclusions.
    if (snapCache.targetVersion === snapCache.version && excluded.size === 0) {
      return snapCache.targets
    }

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

    // Cache when no exclusions (common case: alignDraggedBounds without excluded items).
    if (excluded.size === 0) {
      snapCache.targets = out
      // Build spatial grid for fast alignment target lookups.
      snapCache.targetGrid.clear()
      for (let i = 0; i < out.length; i++) {
        snapCache.targetGrid.insert(i, out[i])
      }
      snapCache.targetVersion = snapCache.version
    }
    return out
  }
}
