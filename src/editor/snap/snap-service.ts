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
 * (dirty flag). Per-query exclusions (dragged items) filter by recorded
 * owner identity instead of triggering a re-walk, so every frame after the
 * first is a grid lookup. Callers must call invalidateCache() when items
 * are added/removed/moved/resized.
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
   * The search ring widens with the tolerance so zoomed-out views (where
   * the snap radius can exceed one cell) never miss in-range anchors.
   */
  queryRange(qx: number, qy: number, tol: number): number[] {
    const out: number[] = []
    const cx = Math.floor(qx / this.cellSize)
    const cy = Math.floor(qy / this.cellSize)
    // Minimum 3x3 neighborhood; expand by one cell per cellSize of radius
    // so points near cell edges (or huge radii) stay covered.
    const ring = Math.max(1, Math.ceil(tol / this.cellSize))
    for (let dx = -ring; dx <= ring; dx++) {
      for (let dy = -ring; dy <= ring; dy++) {
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
 * Stores target rectangle bounds in per-column and per-row indexes.
 * X-alignment only needs column overlap (any row) and Y-alignment only
 * row overlap (any column) — the old full scan never constrained the
 * other axis, so a single-rectangle query would silently drop far-away
 * (but edge-aligned) targets. Strip queries keep that exact behavior.
 */
class TargetSpatialGrid {
  private cellSize: number
  private columns = new Map<number, number[]>()
  private rows = new Map<number, number[]>()

  constructor(cellSize = 400) {
    this.cellSize = cellSize
  }

  clear() {
    this.columns.clear()
    this.rows.clear()
  }

  /** Insert a target index; the target's bounds span multiple cells. */
  insert(index: number, bounds: paper.Rectangle) {
    const x0 = Math.floor(bounds.x / this.cellSize)
    const x1 = Math.floor((bounds.x + bounds.width) / this.cellSize)
    for (let cx = x0; cx <= x1; cx++) {
      let col = this.columns.get(cx)
      if (!col) {
        col = []
        this.columns.set(cx, col)
      }
      col.push(index)
    }
    const y0 = Math.floor(bounds.y / this.cellSize)
    const y1 = Math.floor((bounds.y + bounds.height) / this.cellSize)
    for (let cy = y0; cy <= y1; cy++) {
      let row = this.rows.get(cy)
      if (!row) {
        row = []
        this.rows.set(cy, row)
      }
      row.push(index)
    }
  }

  /**
   * Target indices whose x-range overlaps [x0, x1] (any row).
   * May contain duplicates across columns; callers deduplicate.
   */
  queryColumns(x0: number, x1: number): number[] {
    const out: number[] = []
    for (let cx = Math.floor(x0 / this.cellSize); cx <= Math.floor(x1 / this.cellSize); cx++) {
      const col = this.columns.get(cx)
      if (col) for (const idx of col) out.push(idx)
    }
    return out
  }

  /**
   * Target indices whose y-range overlaps [y0, y1] (any column).
   * May contain duplicates across rows; callers deduplicate.
   */
  queryRows(y0: number, y1: number): number[] {
    const out: number[] = []
    for (let cy = Math.floor(y0 / this.cellSize); cy <= Math.floor(y1 / this.cellSize); cy++) {
      const row = this.rows.get(cy)
      if (row) for (const idx of row) out.push(idx)
    }
    return out
  }
}

/**
 * Cached snap data to avoid rebuilding every frame.
 * Cached until invalidateCache() is called (on document changes).
 * Owner lists run parallel to anchors/targets so per-query exclusions
 * (dragged items) filter by identity instead of triggering a re-walk.
 */
interface SnapCache {
  anchors: paper.Point[]
  anchorOwners: Array<paper.Item | null>
  targets: paper.Rectangle[]
  targetOwners: paper.Item[]
  anchorGrid: SpatialGrid
  targetGrid: TargetSpatialGrid
  /** Cache rebuilds since startup (diagnostic/test seam, see getSnapCacheStats). */
  builds: number
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
  anchorOwners: [],
  targets: [],
  targetOwners: [],
  anchorGrid: new SpatialGrid(200),
  targetGrid: new TargetSpatialGrid(400),
  builds: 0,
  version: -1,
  anchorVersion: -1,
  targetVersion: -1,
}

/**
 * Diagnostic snapshot of the shared snap cache. The editor never reads
 * this; unit tests and benchmarks use it to assert rebuild counts.
 */
export function getSnapCacheStats(): {
  version: number
  anchorVersion: number
  targetVersion: number
  anchorCount: number
  targetCount: number
  builds: number
} {
  return {
    version: snapCache.version,
    anchorVersion: snapCache.anchorVersion,
    targetVersion: snapCache.targetVersion,
    anchorCount: snapCache.anchors.length,
    targetCount: snapCache.targets.length,
    builds: snapCache.builds,
  }
}

export class SnapService {
  engine: EditorEngine | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  /**
   * Mark cached data as stale. Call after any document mutation that
   * changes item geometry, visibility, lock state, or layer structure.
   * Safe to call multiple times per frame (idempotent). Arrays are
   * dropped eagerly so removed items are never retained by the cache.
   */
  invalidateCache() {
    snapCache.version++
    snapCache.anchors = []
    snapCache.anchorOwners = []
    snapCache.targets = []
    snapCache.targetOwners = []
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
    // Served from the shared grid every frame now: exclusions are
    // owner-filtered per query instead of triggering a full re-walk.
    if (snap.point) {
      const excluded = new Set(exclude ?? [])
      this.collectAnchorPoints()
      const anchors = snapCache.anchors
      const owners = snapCache.anchorOwners
      for (const idx of snapCache.anchorGrid.queryRange(raw.x, raw.y, tol)) {
        if (excluded.size > 0 && owners[idx] && this.isExcluded(owners[idx] as paper.Item, excluded)) {
          continue
        }
        const anchor = anchors[idx]
        if (!anchor) continue
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
   * Whether the item or any of its ancestors is excluded. Anchor ownership
   * is recorded at the leaf, so a nested excluded path prunes exactly its
   * own anchors while siblings keep snapping (same as the old subtree walk).
   */
  private isExcluded(item: paper.Item | null, excluded: Set<paper.Item>): boolean {
    let at: paper.Item | null | undefined = item
    while (at) {
      if (excluded.has(at)) return true
      at = at.parent
    }
    return false
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
    const targets = this.collectTargetRects()
    if (targets.length === 0) return empty

    // Grid-filtered every frame now; the dragged (excluded) top-level items
    // drop out by owner below instead of triggering a full rebuild.

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

    // Iterate over strip-filtered targets, skipping the dragged items by
    // top-level owner (mirrors the old collection-time exclusion exactly).
    // X-alignment needs column overlap only, Y-alignment row overlap only.
    const seen = new Set<number>()
    const order: number[] = []
    for (const i of snapCache.targetGrid.queryColumns(candidate.x - tol, candidate.x + candidate.width + tol)) {
      if (!seen.has(i)) {
        seen.add(i)
        order.push(i)
      }
    }
    for (const i of snapCache.targetGrid.queryRows(candidate.y - tol, candidate.y + candidate.height + tol)) {
      if (!seen.has(i)) {
        seen.add(i)
        order.push(i)
      }
    }
    const targetOwners = snapCache.targetOwners
    for (const i of order) {
      if (excluded.size > 0 && excluded.has(targetOwners[i])) continue
      const target = targets[i]
      if (!target) continue
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

  /**
   * Segment points (and text anchors) of user artwork, cached by version.
   * The walk ignores per-query exclusions: every anchor records its leaf
   * owner so queries filter dragged items by identity (see isExcluded).
   */
  private collectAnchorPoints(): paper.Point[] {
    const engine = this.engine
    if (!engine) return []
    const scope = engine.scope

    // Use cache if valid (not invalidated since last build).
    if (snapCache.anchorVersion === snapCache.version) {
      return snapCache.anchors
    }

    const out: paper.Point[] = []
    const owners: Array<paper.Item | null> = []
    const walk = (item: paper.Item) => {
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
        for (const seg of item.segments) {
          out.push(seg.point.clone())
          owners.push(item)
        }
        return
      }
      if (item instanceof scope.CompoundPath || item instanceof scope.Group) {
        for (const child of item.children) walk(child as paper.Item)
        return
      }
      if (item instanceof scope.PointText && !data.annotation) {
        out.push((item as paper.PointText).point.clone())
        owners.push(item)
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
      owners.push(null, null, null, null, null)
    }

    // Always cache: queries filter exclusions by owner, so the full set is
    // valid for every caller until the next invalidation.
    snapCache.anchors = out
    snapCache.anchorOwners = owners
    // Build spatial grid for fast nearest-neighbor lookups.
    snapCache.anchorGrid.clear()
    for (let i = 0; i < out.length; i++) {
      snapCache.anchorGrid.insert(i, out[i].x, out[i].y)
    }
    snapCache.anchorVersion = snapCache.version
    snapCache.builds++
    return out
  }

  /**
   * Bounds of top-level user items (alignment targets), cached by version.
   * Ownership is the top-level item itself, matching the old behavior where
   * only top-level children were tested against the excluded set.
   */
  private collectTargetRects(): paper.Rectangle[] {
    const engine = this.engine
    if (!engine) return []
    const scope = engine.scope

    // Use cache if valid (not invalidated since last build).
    if (snapCache.targetVersion === snapCache.version) {
      return snapCache.targets
    }

    const out: paper.Rectangle[] = []
    const owners: paper.Item[] = []
    for (const layer of engine.project.layers) {
      if (!(layer.data as any)?.isUserLayer || !layer.visible || layer.locked) continue
      for (const child of layer.children) {
        const item = child as paper.Item
        if (!item.visible || (item as any).locked) continue
        if ((item.data as any)?.isPreview) continue
        const b = item.bounds
        if (!b) continue
        out.push(b.clone())
        owners.push(item)
      }
    }
    // Artboard edges participate in smart alignment like any bounds.
    for (const board of engine.store.artboards) {
      if (board.width <= 0 || board.height <= 0) continue
      out.push(new scope.Rectangle(board.x, board.y, board.width, board.height))
      owners.push(null as unknown as paper.Item)
    }

    // Always cache: queries filter exclusions by owner, so the full set is
    // valid for every caller until the next invalidation.
    snapCache.targets = out
    snapCache.targetOwners = owners
    // Build spatial grid for fast alignment target lookups.
    snapCache.targetGrid.clear()
    for (let i = 0; i < out.length; i++) {
      snapCache.targetGrid.insert(i, out[i])
    }
    snapCache.targetVersion = snapCache.version
    snapCache.builds++
    return out
  }
}
