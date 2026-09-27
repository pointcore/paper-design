/**
 * Object transform / repeat domain (C1: slice out of engine.ts).
 *
 * Per-item batch transforms and repeat/clone generators (Transform Each,
 * Rotate Copy, Duplicate in Place, Step & Repeat, Split Into Grid, Radial
 * Repeat, Skew, Reflect, Scale, Grid Repeat): each function takes the
 * engine as an explicit first argument and otherwise runs the historical
 * method body unchanged. The EditorEngine import is type-only, so the
 * runtime dependency flows one way (engine → engine-transforms).
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'

/**
 * Detached clone with fresh identity: new ids, no preview flags, thread
 * links stripped (copies stand alone), deselected. Callers insert it.
 */
function freshClone(e: EditorEngine, item: paper.Item): paper.Item {
  const clone = (item as any).clone({ insert: false }) as paper.Item
  const walk = (node: paper.Item) => {
    const data = (node as any).data ?? ((node as any).data = {})
    if (data.id || data.isUserItem) {
      data.id = e.genId()
      data.isUserItem = true
    }
    delete data.isPreview
    delete data.threadNext
    delete data.threadPrev
    ;(node as any).selected = false
    const children = (node as any).children as paper.Item[] | undefined
    if (children) for (const child of children) walk(child)
  }
  walk(clone)
  return clone
}

/**
 * Transform Each (beloved batch dialog): move/rotate/scale every
 * unlocked selected item about its own bounds center. With copies > 0
 * the originals stay and each copy accumulates the transform (copy c
 * gets c steps); random jitters per-item rotation/scale. One history.
 * Returns items transformed (copies included).
 */
export function transformEach(
  e: EditorEngine,
  opts: {
    dx?: number
    dy?: number
    rotate?: number
    scale?: number
    copies?: number
    random?: boolean
  },
): number {
  const dx = Number.isFinite(opts.dx) ? Number(opts.dx) : 0
  const dy = Number.isFinite(opts.dy) ? Number(opts.dy) : 0
  const rotate = Number.isFinite(opts.rotate) ? Number(opts.rotate) : 0
  const scalePct = Number.isFinite(opts.scale) ? Number(opts.scale) : 100
  const copies = Math.min(50, Math.max(0, Math.round(Number(opts.copies) || 0)))
  const random = !!opts.random
  if (dx === 0 && dy === 0 && rotate === 0 && scalePct === 100 && copies === 0) return 0
  const sources = e.getSelection().filter((item) => !item.locked && item.parent)
  if (sources.length === 0) return 0
  const jitter = () => (random ? 0.5 + Math.random() : 1)
  const applyStep = (item: paper.Item, step: number) => {
    const b = (item as any).bounds as paper.Rectangle | undefined
    if (!b || !(b.width > 0) || !(b.height > 0)) return false
    const center = b.center.clone()
    if (dx !== 0 || dy !== 0) {
      item.position = (item.position as paper.Point).add(
        new e.scope.Point(dx * step, dy * step)
      )
    }
    const r = rotate * step * jitter()
    if (Math.abs(r) > 1e-9) item.rotate(r, center)
    const f = Math.pow(scalePct / 100, step)
    const fj = random ? 1 + (f - 1) * jitter() : f
    if (Math.abs(fj - 1) > 1e-9) item.scale(fj, fj, center)
    e.refreshItemGradient(item)
    return true
  }
  let done = 0
  if (copies > 0) {
    const made: paper.Item[] = []
    for (const item of sources) {
      const parent = item.parent ?? e.getActiveLayer()
      const at = parent.children.indexOf(item as any)
      for (let c = 1; c <= copies; c++) {
        const clone = freshClone(e, item)
        parent.insertChild(Math.min(at + c, parent.children.length), clone as any)
        if (applyStep(clone, c)) made.push(clone)
        else clone.remove()
      }
    }
    if (made.length === 0) return 0
    e.clearSelection()
    made.forEach((item) => {
      item.selected = true
    })
    e.syncSelectionToStore()
    e.reflowTextsForItems(made)
    done = made.length
  } else {
    for (const item of sources) {
      if (applyStep(item, 1)) done++
    }
    if (done === 0) return 0
    e.reflowTextsForItems(sources)
  }
  e.pushHistory('Transform Each')
  e.scope.view.update()
  return done
}

/**
 * Duplicate the unlocked selection in place, then rotate the copies
 * (AI Rotate-dialog Copy parity). Clones get fresh ids, thread links
 * are stripped so copies stand alone, and the copies become the new
 * selection. Returns false when there is nothing to copy.
 */
export function rotateCopy(e: EditorEngine, angleDeg: number, pivot?: paper.Point): boolean {
  if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) < 1e-9) return false
  const sources = e.getSelection().filter((item) => !item.locked && item.parent)
  if (sources.length === 0) return false
  const center = pivot ?? e.getSelectionBounds()?.center
  if (!center) return false
  const clones: paper.Item[] = []
  for (const item of sources) {
    const clone = freshClone(e, item)
    const parent = item.parent ?? e.getActiveLayer()
    parent.insertChild(parent.children.indexOf(item as any) + 1, clone as any)
    clones.push(clone)
  }
  for (const clone of clones) {
    clone.rotate(angleDeg, center)
    e.refreshItemGradient(clone)
  }
  e.clearSelection()
  clones.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.reflowTextsForItems(clones)
  e.pushHistory('Rotate Copy')
  e.scope.view.update()
  return true
}

/**
 * Duplicate the unlocked selection in place (CDR duplicate parity):
 * copies land exactly over their sources and become the selection.
 */
export function duplicateInPlace(e: EditorEngine): boolean {
  const sources = e.getSelection().filter((item) => !item.locked && item.parent)
  if (sources.length === 0) return false
  const clones: paper.Item[] = []
  for (const item of sources) {
    const clone = freshClone(e, item)
    const parent = item.parent ?? e.getActiveLayer()
    parent.insertChild(parent.children.indexOf(item as any) + 1, clone as any)
    e.refreshItemGradient(clone)
    clones.push(clone)
  }
  e.clearSelection()
  clones.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.reflowTextsForItems(clones)
  e.pushHistory('Duplicate in Place')
  e.scope.view.update()
  return true
}

/**
 * Step-and-repeat the unlocked selection (layout staple): `count`
 * translated copies at (dx, dy) increments. Copies become the new
 * selection; one history entry. Returns copies made.
 */
export function stepRepeat(e: EditorEngine, count: number, dx: number, dy: number): number {
  const n = Math.min(100, Math.max(1, Math.round(Number(count) || 0)))
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return 0
  const step = new e.scope.Point(
    Math.min(5000, Math.max(-5000, dx)),
    Math.min(5000, Math.max(-5000, dy))
  )
  const sources = e.getSelection().filter((item) => !item.locked && item.parent)
  if (sources.length === 0 || n < 1) return 0
  const made: paper.Item[] = []
  for (const item of sources) {
    const parent = item.parent ?? e.getActiveLayer()
    const at = parent.children.indexOf(item as any)
    for (let i = 1; i <= n; i++) {
      const clone = freshClone(e, item)
      clone.position = (clone.position as paper.Point).add(step.multiply(i))
      parent.insertChild(Math.min(at + i, parent.children.length), clone as any)
      e.refreshItemGradient(clone)
      made.push(clone)
    }
  }
  if (made.length === 0) return 0
  e.clearSelection()
  made.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.reflowTextsForItems(made)
  e.pushHistory('Step and Repeat')
  e.scope.view.update()
  return made.length
}

/**
 * AI Path > Split Into Grid: replace the single unlocked selected item
 * with rows x cols rectangular cells tiling its axis-aligned bounds
 * (optional gutters), styled like the source. Cells become the new
 * selection; one history entry. Returns the cell count, 0 when nothing
 * usable is selected or the bounds do not fit the gutters.
 */
export function splitSelectionGrid(
  e: EditorEngine,
  rows: number,
  cols: number,
  gutterX: number,
  gutterY: number,
): number {
  const r = Math.round(Number(rows))
  const c = Math.round(Number(cols))
  const gx = Number(gutterX)
  const gy = Number(gutterY)
  if (!Number.isFinite(r) || !Number.isFinite(c) || r < 1 || c < 1) return 0
  if (!Number.isFinite(gx) || !Number.isFinite(gy) || gx < 0 || gy < 0) return 0
  if (r * c > 1000) return 0
  const selected = e.getSelection().filter((item) => !item.locked && item.parent)
  if (selected.length !== 1) return 0
  const source = selected[0]
  const b = source.bounds
  const cellW = (b.width - (c - 1) * gx) / c
  const cellH = (b.height - (r - 1) * gy) / r
  if (!(cellW > 0) || !(cellH > 0)) return 0

  const parent = source.parent ?? e.getActiveLayer()
  const at = parent.children.indexOf(source as any)
  const src = source as any
  const cells: paper.Item[] = []
  for (let row = 0; row < r; row++) {
    for (let col = 0; col < c; col++) {
      const x = b.x + col * (cellW + gx)
      const y = b.y + row * (cellH + gy)
      const cell = new e.scope.Path.Rectangle({
        from: [x, y, x + cellW, y + cellH],
        insert: false,
      }) as paper.Path
      cell.data.id = e.genId()
      cell.data.isUserItem = true
      // Cells inherit the source appearance (paint, dash, blend, opacity).
      ;(cell as any).fillColor = src.fillColor ?? null
      ;(cell as any).strokeColor = src.strokeColor ?? null
      if (src.strokeColor !== null && src.strokeColor !== undefined) {
        cell.strokeWidth = src.strokeWidth ?? 1
        cell.strokeCap = src.strokeCap
        cell.strokeJoin = src.strokeJoin
        cell.miterLimit = src.miterLimit
        cell.dashArray = src.dashArray
        cell.dashOffset = src.dashOffset
      }
      ;(cell as any).fillRule = src.fillRule
      ;(cell as any).blendMode = src.blendMode
      ;(cell as any).opacity = src.opacity
      e.refreshItemGradient(cell)
      parent.insertChild(Math.min(at + 1 + cells.length, parent.children.length), cell)
      cells.push(cell)
    }
  }
  source.remove()
  e.clearSelection()
  cells.forEach((cell) => {
    cell.selected = true
  })
  e.syncSelectionToStore()
  e.reflowTextsForItems(cells)
  e.pushHistory('Split Into Grid')
  e.scope.view.update()
  return cells.length
}

/**
 * Radial repeat (clock faces, badges, rosettes): `count` rotated copies
 * at `angleDeg` steps about the reference pivot. Copies become the new
 * selection; one history entry. Returns copies made.
 */
export function radialRepeat(e: EditorEngine, count: number, angleDeg: number): number {
  const n = Math.min(120, Math.max(1, Math.round(Number(count) || 0)))
  if (!Number.isFinite(angleDeg) || Math.abs(angleDeg) < 1e-9 || n < 1) return 0
  const angle = ((angleDeg % 360) + 360) % 360
  if (angle < 1e-9) return 0
  const sources = e.getSelection().filter((item) => !item.locked && item.parent)
  if (sources.length === 0) return 0
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) return 0
  const made: paper.Item[] = []
  for (const item of sources) {
    const parent = item.parent ?? e.getActiveLayer()
    const at = parent.children.indexOf(item as any)
    for (let i = 1; i <= n; i++) {
      const clone = freshClone(e, item)
      clone.rotate(angle * i, pivot)
      parent.insertChild(Math.min(at + i, parent.children.length), clone as any)
      e.refreshItemGradient(clone)
      made.push(clone)
    }
  }
  if (made.length === 0) return 0
  e.clearSelection()
  made.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.reflowTextsForItems(made)
  e.pushHistory('Radial Repeat')
  e.scope.view.update()
  return made.length
}

/**
 * Skew every unlocked selected item by degrees around a pivot (default:
 * united selection bounds center). Callers record history.
 */
export function skewSelection(
  e: EditorEngine,
  skewXDeg: number,
  skewYDeg: number,
  pivot?: paper.Point,
): void {
  if (!Number.isFinite(skewXDeg) || !Number.isFinite(skewYDeg)) return
  if (Math.abs(skewXDeg) < 1e-9 && Math.abs(skewYDeg) < 1e-9) return
  const items = e.getSelection().filter((item) => !item.locked)
  if (items.length === 0) return
  const center = pivot ?? e.getSelectionBounds()?.center
  if (!center) return
  const skew = new e.scope.Point(skewXDeg, skewYDeg)
  for (const item of items) {
    item.skew(skew, center)
    e.refreshItemGradient(item)
  }
  e.reflowTextsForItems(items)
  e.scope.view.update()
  // Skew is non-rigid: the oriented selection frame cannot track it, so
  // invalidate the frame like any other untracked geometry change.
  e.bumpGeometryVersion()
}

/**
 * Reflect every unlocked selected item across an axis line through the
 * pivot (AI Object > Transform > Reflect). The axis angle is in degrees:
 * 0 mirrors top/bottom (horizontal axis), 90 mirrors left/right. With
 * `copy`, reflected duplicates are created and selected instead. Callers
 * record history. Returns false when nothing can be reflected.
 */
export function reflectSelection(
  e: EditorEngine,
  axisAngleDeg: number,
  copy = false,
  pivot?: paper.Point,
): boolean {
  if (!Number.isFinite(axisAngleDeg)) return false
  const full = e.getSelection()
  const items = full.filter((item) => !item.locked)
  if (items.length === 0) return false
  const center = pivot ?? e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!center) return false
  // Reflection about the angle-th axis = rotate(-angle) -> mirror Y ->
  // rotate(angle), the same proven rotate/scale primitives the flip and
  // mirror paths use.
  const reflect = (item: paper.Item) => {
    item.rotate(-axisAngleDeg, center)
    item.scale(1, -1, center)
    item.rotate(axisAngleDeg, center)
  }
  const targets: paper.Item[] = []
  if (copy) {
    for (const item of items) {
      const clone = freshClone(e, item)
      reflect(clone)
      const parent = item.parent ?? e.getActiveLayer()
      parent.insertChild(parent.children.indexOf(item as any) + 1, clone)
      e.refreshItemGradient(clone)
      targets.push(clone)
    }
  } else {
    for (const item of items) {
      reflect(item)
      e.refreshItemGradient(item)
      targets.push(item)
    }
  }
  e.clearSelection()
  targets.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.reflowTextsForItems(targets)
  // Reflection is non-rigid: the oriented frame cannot track it.
  e.bumpGeometryVersion()
  e.scope.view.update()
  return true
}

/**
 * Scale every unlocked selected item about a pivot (default: united
 * selection bounds center). Factors must be finite and non-zero.
 * Callers record history.
 */
export function scaleSelection(e: EditorEngine, sx: number, sy: number, pivot?: paper.Point): void {
  if (!Number.isFinite(sx) || !Number.isFinite(sy)) return
  if (Math.abs(sx) < 1e-9 || Math.abs(sy) < 1e-9) return
  const items = e.getSelection().filter((item) => !item.locked)
  if (items.length === 0) return
  const center = pivot ?? e.getSelectionBounds()?.center
  if (!center) return
  for (const item of items) {
    item.scale(sx, sy, center)
    e.refreshItemGradient(item)
  }
  e.reflowTextsForItems(items)
  e.scope.view.update()
  e.lastTransform = { kind: 'scale', sx, sy, pivot: center.clone() }
}

/**
 * AI Object > Repeat > Grid: duplicate every unlocked selected item into
 * a rows x cols grid offset by dx/dy document units per cell (the
 * original occupies the 0,0 cell). Copies become the new selection; one
 * history entry. Returns the copies made, 0 when nothing can repeat.
 */
export function gridRepeat(e: EditorEngine, rows: number, cols: number, dx: number, dy: number): number {
  const r = Math.round(Number(rows))
  const c = Math.round(Number(cols))
  const stepX = Number(dx)
  const stepY = Number(dy)
  if (!Number.isFinite(r) || !Number.isFinite(c) || r < 1 || c < 1 || r * c < 2) return 0
  if (!Number.isFinite(stepX) || !Number.isFinite(stepY) || stepX <= 0 || stepY <= 0) return 0
  const sources = e.getSelection().filter((item) => !item.locked && item.parent)
  if (sources.length === 0) return 0
  const made: paper.Item[] = []
  for (const item of sources) {
    const parent = item.parent ?? e.getActiveLayer()
    const at = parent.children.indexOf(item as any)
    let k = 0
    for (let row = 0; row < r; row++) {
      for (let col = 0; col < c; col++) {
        if (row === 0 && col === 0) continue
        const clone = freshClone(e, item)
        clone.position = (clone.position as paper.Point).add(
          new e.scope.Point(col * stepX, row * stepY)
        )
        parent.insertChild(Math.min(at + 1 + k, parent.children.length), clone)
        e.refreshItemGradient(clone)
        made.push(clone)
        k++
      }
    }
  }
  if (made.length === 0) return 0
  e.clearSelection()
  made.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.reflowTextsForItems(made)
  e.pushHistory('Grid Repeat')
  e.scope.view.update()
  return made.length
}
