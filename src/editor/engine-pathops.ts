/**
 * Path construction domain (C1: slice out of engine.ts).
 *
 * Destructive path edits (Offset Path / Contour, Roughen / Zig Zag, Add
 * Anchor Points, Reverse, Clean Up, Arrowheads): each function takes the
 * engine as an explicit first argument and otherwise runs the historical
 * method body unchanged. The EditorEngine import is type-only, so the
 * runtime dependency flows one way (engine → engine-pathops).
 */
import type paper from 'paper'
import { PaperOffset } from 'paperjs-offset'
import { isClipMask } from './paper-types'
import type { EditorEngine } from './engine'

/**
 * Offset every selected unlocked path by a distance (AI Offset Path
 * parity, powered by paperjs-offset like Outline Stroke). Positive
 * expands, negative insets. `steps` repeats at multiples (CDR contour
 * parity); `cap` shapes open-path ends (omitted = library default).
 * Results keep the source appearance, sit beside their sources
 * and become the new selection. Returns offsets made; one history entry.
 */
export function offsetPaths(
  e: EditorEngine,
  distance: number,
  join: 'miter' | 'round' | 'bevel' = 'miter',
  steps = 1,
  cap?: 'round' | 'butt'
): number {
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-9) return 0
  const dist = Math.min(2000, Math.max(-2000, distance))
  const reps = Math.min(20, Math.max(1, Math.round(Number(steps) || 1)))
  const scope = e.scope
  const targets = e.getSelection().filter(
    (item) =>
      !item.locked &&
      item.parent &&
      (item instanceof scope.Path || item instanceof scope.CompoundPath)
  ) as Array<paper.Path | paper.CompoundPath>
  if (targets.length === 0) return 0
  const made: paper.Item[] = []
  for (const target of targets) {
    const parent = target.parent ?? e.getActiveLayer()
    const at = parent.children.indexOf(target as any)
    for (let i = 1; i <= reps; i++) {
      let result: paper.Path | paper.CompoundPath | null = null
      try {
        result = PaperOffset.offset(target as any, dist * i, {
          join,
          limit: 10,
          insert: false,
          ...(cap ? { cap } : {}),
        }) as any
      } catch {
        result = null
      }
      if (!result) continue
      parent.insertChild(Math.min(at + i, parent.children.length), result as any)
      result.data.id = e.genId()
      result.data.isUserItem = true
      e.applyStyleToItem(result as paper.Item, e.getStyleFromItem(target as paper.Item))
      made.push(result as paper.Item)
    }
  }
  if (made.length === 0) return 0
  e.clearSelection()
  made.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.pushHistory(reps > 1 ? 'Contour Offset' : 'Offset Path')
  e.scope.view.update()
  return made.length
}

/**
 * Roughen / zigzag selected paths (AI Roughen parity, destructive).
 * Curves subdivide `detail` times, then anchors jitter by `size`
 * (roughen, endpoints of open paths stay put) or ridge perpendicular
 * alternating ±size with cornered handles (zigzag). Returns anchors
 * touched; one history entry.
 */
export function stylizeRoughen(
  e: EditorEngine,
  kind: 'roughen' | 'zigzag',
  size: number,
  detail: number,
): number {
  if (!Number.isFinite(size) || size <= 0) return 0
  const rounds = Math.min(10, Math.max(1, Math.round(Number(detail) || 3)))
  const scope = e.scope
  const paths: paper.Path[] = []
  for (const item of e.getSelection()) {
    if ((item as any).locked || !item.parent) continue
    if (item instanceof scope.CompoundPath) {
      for (const child of ((item as any).children ?? []) as paper.Item[]) {
        if (child instanceof scope.Path) paths.push(child)
      }
    } else if (item instanceof scope.Path) {
      paths.push(item)
    }
  }
  if (paths.length === 0) return 0
  const s = Math.min(500, size)
  let touched = 0
  for (const path of paths) {
    for (let r = 0; r < rounds; r++) {
      const curves = path.curves.slice()
      let split = false
      for (const curve of curves) {
        try {
          if (typeof (curve as any).divideAtTime === 'function' && (curve as any).divideAtTime(0.5)) split = true
        } catch { /* keep going */ }
      }
      if (!split) break
    }
    const n = path.segments.length
    for (let i = 0; i < n; i++) {
      const seg = path.segments[i]
      const isEnd = !path.closed && (i === 0 || i === n - 1)
      if (isEnd) continue
      if (kind === 'roughen') {
        seg.point = seg.point.add(new scope.Point((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s))
      } else {
        const prev = path.segments[(i - 1 + n) % n].point
        const next = path.segments[(i + 1) % n].point
        const tangent = next.subtract(prev)
        if (tangent.length < 1e-9) continue
        const normal = new scope.Point(-tangent.y, tangent.x).normalize()
        seg.point = seg.point.add(normal.multiply((i % 2 === 0 ? 1 : -1) * s))
        ;(seg as any).handleIn = new scope.Point(0, 0)
        ;(seg as any).handleOut = new scope.Point(0, 0)
      }
      touched++
    }
    e.refreshItemGradient(path as paper.Item)
  }
  if (touched > 0) {
    e.pushHistory(kind === 'roughen' ? 'Roughen' : 'Zig Zag')
    e.scope.view.update()
  }
  return touched
}

/**
 * Add a midpoint anchor to every curve of the selected unlocked paths
 * (AI Add Anchor Points parity). Returns anchors added; one history.
 */
export function addAnchorPoints(e: EditorEngine): number {
  const scope = e.scope
  const paths: paper.Path[] = []
  for (const item of e.getSelection()) {
    if ((item as any).locked || !item.parent) continue
    if (item instanceof scope.CompoundPath) {
      for (const child of ((item as any).children ?? []) as paper.Item[]) {
        if (child instanceof scope.Path) paths.push(child)
      }
    } else if (item instanceof scope.Path) {
      paths.push(item)
    }
  }
  if (paths.length === 0) return 0
  let added = 0
  for (const path of paths) {
    const curves = path.curves.slice()
    for (const curve of curves) {
      try {
        const c = curve as any
        const seg = typeof c.divideAtTime === 'function'
          ? c.divideAtTime(0.5)
          : typeof c.divide === 'function'
            ? c.divide(0.5)
            : null
        if (seg) added++
      } catch {
        continue
      }
    }
    e.refreshItemGradient(path as paper.Item)
  }
  if (added > 0) {
    e.pushHistory('Add Anchor Points')
    e.scope.view.update()
  }
  return added
}

/**
 * Reverse selected unlocked paths (winding/draw direction, matters for
 * compound and subtract operand order). Returns paths reversed.
 */
export function reversePaths(e: EditorEngine): number {
  const scope = e.scope
  const targets = e.getSelection().filter(
    (item) =>
      !(item as any).locked &&
      item.parent &&
      (item instanceof scope.Path || item instanceof scope.CompoundPath)
  )
  if (targets.length === 0) return 0
  for (const item of targets) {
    try {
      if (typeof (item as any).reverse === 'function') (item as any).reverse()
      else {
        const kids = (item as any).children as paper.Item[] | undefined
        if (kids) for (const k of kids) (k as any).reverse?.()
      }
    } catch {
      continue
    }
    e.refreshItemGradient(item)
  }
  e.reflowTextsForItems(targets)
  e.pushHistory('Reverse Path')
  e.scope.view.update()
  return targets.length
}

/**
 * Remove stray geometry: empty paths/compounds, blank point text and
 * groups emptied by the sweep (pattern tiles, clip scaffolding and
 * annotations are never touched). Returns items removed.
 */
export function cleanUp(e: EditorEngine): number {
  const scope = e.scope
  let removed = 0
  const isEmptyText = (item: paper.Item): boolean =>
    item instanceof scope.PointText &&
    !(item as any).data?.annotation &&
    String((item as any).content ?? '') === ''
  const isEmptyPath = (item: paper.Item): boolean =>
    (item instanceof scope.Path && !(item instanceof scope.CompoundPath) && item.segments.length === 0) ||
    (item instanceof scope.CompoundPath && ((item as any).children?.length ?? 0) === 0)
  const sweep = (node: paper.Item): boolean => {
    const data = (node as any).data ?? {}
    if (data.isPatternTile || data.annotation || isClipMask(node)) return false
    if ((node as any).locked) return false
    const children = (node as any).children as paper.Item[] | undefined
    if (children) {
      for (const child of children.slice()) {
        if (sweep(child)) removed++
      }
      const left = (node as any).children as paper.Item[] | undefined
      // Prune emptied plain groups (never user layers or text runs).
      if (
        node instanceof scope.Group &&
        !(data as any).isUserItem &&
        !(data as any).textMode &&
        (left?.length ?? 1) === 0
      ) {
        node.remove()
        return true
      }
      return false
    }
    if (isEmptyPath(node) || isEmptyText(node)) {
      node.remove()
      return true
    }
    return false
  }
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer) continue
    for (const child of (layer.children as unknown as paper.Item[]).slice()) {
      // Top-level user items keep their slot (AI never deletes layers
      // here); only their contents sweep.
      if ((child as any).data?.isUserItem && ((child as any).children as paper.Item[] | undefined)) {
        for (const grand of (((child as any).children as paper.Item[]) ?? []).slice()) {
          if (sweep(grand)) removed++
        }
      } else if (sweep(child)) {
        removed++
      }
    }
  }
  if (removed > 0) {
    e.clearSelection()
    e.pushHistory('Clean Up')
    e.scope.view.update()
  }
  return removed
}

/**
 * Stamp triangular arrowheads on open selected paths (AI Stroke
 * arrowheads, destructive v1: markers are plain filled siblings, so
 * later stroke edits do not follow them). Length is absolute document
 * units; paint follows the stroke (else fill, else black). Returns
 * markers created; one history entry.
 */
export function addArrowheads(e: EditorEngine, start: boolean, end: boolean, length: number): number {
  if (!start && !end) return 0
  if (!Number.isFinite(length) || length <= 0) return 0
  const len = Math.min(200, length)
  const scope = e.scope
  const targets = e.getSelection().filter(
    (item) =>
      !(item as any).locked &&
      item.parent &&
      item instanceof scope.Path &&
      !(item instanceof scope.CompoundPath) &&
      item.segments.length >= 2 &&
      !item.closed
  ) as paper.Path[]
  if (targets.length === 0) return 0
  const made: paper.Item[] = []
  for (const path of targets) {
    const paint = (path as any).strokeColor ?? (path as any).fillColor
    const segs = path.segments
    const ends: Array<{ tip: paper.Point; dir: paper.Point }> = []
    if (start) {
      const tip = segs[0].point
      const prev = segs[1].point
      ends.push({ tip, dir: tip.subtract(prev) })
    }
    if (end) {
      const tip = segs[segs.length - 1].point
      const prev = segs[segs.length - 2].point
      ends.push({ tip, dir: tip.subtract(prev) })
    }
    for (const { tip, dir } of ends) {
      if (dir.length < 1e-9) continue
      const d = dir.normalize()
      const n = new scope.Point(-d.y, d.x)
      const base = tip.subtract(d.multiply(len))
      const half = len * 0.42
      const head = new scope.Path([
        tip.clone(),
        base.add(n.multiply(half)),
        base.subtract(n.multiply(half)),
      ]) as paper.Path
      head.closed = true
      try {
        head.fillColor = paint ? (paint.clone ? paint.clone() : new scope.Color(paint)) : new scope.Color('#000000')
      } catch {
        head.fillColor = new scope.Color('#000000')
      }
      head.strokeColor = null
      const parent = path.parent ?? e.getActiveLayer()
      parent.insertChild(parent.children.indexOf(path as any) + 1, head as any)
      head.data.id = e.genId()
      head.data.isUserItem = true
      made.push(head as paper.Item)
    }
  }
  if (made.length === 0) return 0
  e.clearSelection()
  made.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.pushHistory('Add Arrowheads')
  e.scope.view.update()
  return made.length
}
