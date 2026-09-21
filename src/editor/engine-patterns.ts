/**
 * Pattern-fill domain (C1: slice out of engine.ts).
 *
 * Paper.js has no native pattern paint, so a pattern fill is a plain
 * Group: [mask path (clipMask, paint stashed in data.maskPaint),
 * background clone (optional), motif tiles (no data.id so the layer tree
 * skips them)]. The group carries data.isPatternFill + data.pattern, so
 * it survives JSON snapshots, Save/Open and SVG export as clipped art.
 *
 * Delegation target: each function takes the engine as an explicit first
 * argument and otherwise runs the historical method body unchanged. The
 * EditorEngine import is type-only, so the runtime dependency flows one
 * way (engine → engine-patterns). The private group builders move along
 * as module functions since all of their callers live here.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import type { PatternFillState } from './types'

/** Plain CSS color string, or null for empty / gradient paints. */
export function cssOrNull(color: any): string | null {
  if (!color || color.gradient) return null
  return color.toCSS(true) as string
}

/** Pattern params when the item is (or is inside) a pattern group. */
export function getPatternFromItem(e: EditorEngine, item: paper.Item): PatternFillState | null {
  let node: paper.Item | null = item
  while (node && !(node instanceof e.scope.Layer)) {
    const data = (node.data as any) ?? {}
    if (data.isPatternFill && data.pattern) {
      const p = data.pattern as PatternFillState
      return {
        kind: p.kind,
        color: p.color,
        background: p.background ?? null,
        scale: Number.isFinite(p.scale) ? p.scale : 1,
        angle: Number.isFinite(p.angle) ? p.angle : 0,
      }
    }
    node = node.parent
  }
  return null
}

/** Whether an item is a pattern-fill group. */
export function isPatternGroup(e: EditorEngine, item: paper.Item): boolean {
  return (
    item instanceof e.scope.Group &&
    !!((item.data as any)?.isPatternFill)
  )
}

/**
 * Apply a pattern fill to every selected unlocked Path/CompoundPath.
 * Already-patterned selections are re-tiled in place (params update).
 * Returns how many shapes now carry the pattern.
 */
export function applyPatternFill(e: EditorEngine, pattern: PatternFillState): number {
  const scope = e.scope
  const targets = e.getSelection().filter((i) => !i.locked && i.parent)
  if (targets.length === 0) return 0
  let applied = 0
  const next: paper.Item[] = []
  for (const target of targets) {
    if (isPatternGroup(e, target)) {
      ;(target.data as any).pattern = { ...pattern }
      retilePatternGroup(e, target as paper.Group)
      applied++
      next.push(target)
    } else if (
      target instanceof scope.Path ||
      target instanceof scope.CompoundPath
    ) {
      const group = buildPatternGroup(
        e,
        target as paper.PathItem,
        { ...pattern }
      )
      if (group) {
        applied++
        next.push(group)
      } else {
        next.push(target)
      }
    } else {
      next.push(target)
    }
  }
  if (applied > 0) {
    e.clearSelection()
    next.forEach((item) => { item.selected = true })
    e.syncSelectionToStore()
    e.store.updateStyle({ pattern: { ...pattern }, fillColor: null, gradient: null })
    e.pushHistory('Pattern Fill')
    e.scope.view.update()
  }
  return applied
}

/**
 * Remove pattern fills from the selection, restoring each mask path with
 * its stashed background/solid paint. Returns how many groups removed.
 */
export function removePatternFill(e: EditorEngine): number {
  const groups = e.getSelection().filter(
    (i) => !i.locked && i.parent && isPatternGroup(e, i)
  ) as paper.Group[]
  if (groups.length === 0) return 0
  const restored: paper.Item[] = []
  for (const group of groups) {
    const base = releasePatternGroup(e, group)
    if (base) restored.push(base)
  }
  e.clearSelection()
  restored.forEach((item) => { item.selected = true })
  e.syncSelectionToStore()
  e.store.updateStyle({ pattern: null })
  e.pushHistory('Remove Pattern')
  e.scope.view.update()
  return restored.length
}

/** Build a pattern group from a plain path (caller handles selection). */
function buildPatternGroup(
  e: EditorEngine,
  source: paper.PathItem,
  pattern: PatternFillState
): paper.Group | null {
  const scope = e.scope
  const bounds = (source as any).bounds as paper.Rectangle | undefined
  if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return null
  const parent = source.parent ?? e.getActiveLayer()
  const at = Math.max(0, parent.children.indexOf(source))
  const mask = source.clone({ insert: false }) as paper.PathItem
  const maskAny = mask as any
  maskAny.data = { ...(maskAny.data ?? {}), id: (source.data as any)?.id ?? e.genId() }
  maskAny.data.maskPaint = {
    fill: cssOrNull(maskAny.fillColor),
    stroke: cssOrNull(maskAny.strokeColor),
    width: Number(maskAny.strokeWidth) || 0,
  }
  source.remove()
  const group = new scope.Group({ insert: false }) as paper.Group
  group.addChild(mask)
  mask.clipMask = true
  if (maskAny.fillColor !== undefined) maskAny.fillColor = null
  if (maskAny.strokeColor !== undefined) maskAny.strokeColor = null
  if (pattern.background) {
    const bg = mask.clone({ insert: false }) as paper.PathItem
    const bgAny = bg as any
    bgAny.clipMask = false
    if (bgAny.data) delete bgAny.data.id
    bgAny.data = { ...(bgAny.data ?? {}), isPatternTile: true }
    bgAny.fillColor = pattern.background
    if (bgAny.strokeColor !== undefined) bgAny.strokeColor = null
    group.addChild(bg)
  }
  group.data.id = e.genId()
  group.data.isUserItem = true
  group.data.isPatternFill = true
  group.data.pattern = { ...pattern }
  parent.insertChild(Math.min(at, parent.children.length), group)
  tilePatternGroup(e, group)
  return group
}

/** Regenerate tiles for new params (keeps mask + background slot). */
function retilePatternGroup(e: EditorEngine, group: paper.Group): void {
  const pattern = (group.data as any)?.pattern as PatternFillState | undefined
  if (!pattern) return
  const children = group.children.slice()
  // Child 0 is the clip mask; child 1 may be the background clone.
  for (let i = children.length - 1; i >= 1; i--) {
    const child = children[i] as any
    if (child?.data?.isPatternTile) child.remove()
  }
  const mask = group.children[0] as paper.PathItem
  if (pattern.background && mask) {
    const bg = (mask.clone({ insert: false }) as any) as paper.PathItem
    bg.clipMask = false
    if (bg.data) delete (bg.data as any).id
    ;(bg.data as any).isPatternTile = true
    ;(bg as any).fillColor = pattern.background
    if ((bg as any).strokeColor !== undefined) (bg as any).strokeColor = null
    group.insertChild(1, bg)
  }
  tilePatternGroup(e, group)
}

/** Generate motif tiles covering the mask bounds (capped at ~2000). */
function tilePatternGroup(e: EditorEngine, group: paper.Group): void {
  const scope = e.scope
  const pattern = (group.data as any)?.pattern as PatternFillState | undefined
  const mask = group.children[0] as paper.Item | undefined
  const bounds = (mask as any)?.bounds as paper.Rectangle | undefined
  if (!pattern || !bounds || !(bounds.width > 0) || !(bounds.height > 0)) return
  const scale = Math.min(4, Math.max(0.25, Number(pattern.scale) || 1))
  let step = 12 * scale
  const pad = step * 2
  const x0 = bounds.x - pad
  const y0 = bounds.y - pad
  const x1 = bounds.x + bounds.width + pad
  const y1 = bounds.y + bounds.height + pad
  let cols = Math.max(1, Math.ceil((x1 - x0) / step))
  let rows = Math.max(1, Math.ceil((y1 - y0) / step))
  // Cap total motifs so huge boards never freeze the tab.
  let guard = 0
  while (cols * rows > 2000 && guard < 8) {
    step *= 1.5
    cols = Math.max(1, Math.ceil((x1 - x0) / step))
    rows = Math.max(1, Math.ceil((y1 - y0) / step))
    guard++
  }
  const color = pattern.color || '#000000'
  const mk = (item: paper.Item): void => {
    const anyItem = item as any
    if (anyItem.data) delete anyItem.data.id
    anyItem.data = { ...(anyItem.data ?? {}), isPatternTile: true }
    if (anyItem.fillColor !== undefined) anyItem.fillColor = color
    if (anyItem.strokeColor !== undefined) anyItem.strokeColor = color
    anyItem.locked = false
    group.addChild(item)
  }
  const angle = ((Number(pattern.angle) || 0) % 360 + 360) % 360
  const rotateAbout = bounds.center
  const spin = (item: paper.Item): void => {
    if (angle !== 0) item.rotate(angle, rotateAbout)
  }
  if (pattern.kind === 'dots') {
    const r = Math.max(0.6, 1.6 * scale)
    for (let ix = 0; ix < cols; ix++) {
      for (let iy = 0; iy < rows; iy++) {
        const c = new scope.Point(x0 + (ix + 0.5) * step, y0 + (iy + 0.5) * step)
        const dot = new scope.Path.Circle({ center: c, radius: r, insert: false })
        const dAny = dot as any
        dAny.strokeColor = null
        dAny.strokeWidth = 0
        mk(dot)
      }
    }
  } else if (pattern.kind === 'stripes' || pattern.kind === 'grid' || pattern.kind === 'crosshatch') {
    const w = Math.max(0.6, 1.2 * scale)
    const diag = Math.hypot(x1 - x0, y1 - y0)
    const cx = (x0 + x1) / 2
    const cy = (y0 + y1) / 2
    const line = (xA: number, yA: number, xB: number, yB: number): void => {
      const p = new scope.Path({ insert: false })
      p.moveTo(new scope.Point(xA, yA))
      p.lineTo(new scope.Point(xB, yB))
      const pAny = p as any
      pAny.fillColor = null
      pAny.strokeColor = color
      pAny.strokeWidth = w
      spin(p)
      mk(p)
    }
    if (pattern.kind === 'stripes') {
      for (let iy = 0; iy <= rows; iy++) {
        const y = y0 + iy * step
        line(cx - diag, y, cx + diag, y)
      }
    } else {
      for (let iy = 0; iy <= rows; iy++) {
        const y = y0 + iy * step
        line(x0, y, x1, y)
      }
      for (let ix = 0; ix <= cols; ix++) {
        const x = x0 + ix * step
        line(x, y0, x, y1)
      }
      if (pattern.kind === 'crosshatch') {
        for (let k = -rows; k <= cols + rows; k++) {
          const xA = x0 + k * step
            line(xA, y0, xA + (y1 - y0), y1)
          }
          void cy
      }
    }
    // Stripes honour the angle via per-line rotation above; grid /
    // crosshatch keep axis alignment and use angle as 0 (documented).
    void cx
  }
}

/** Dissolve one pattern group back to its base path (tiles dropped). */
export function releasePatternGroup(e: EditorEngine, group: paper.Group): paper.Item | null {
  const parent = group.parent ?? e.getActiveLayer()
  const at = Math.max(0, parent.children.indexOf(group))
  const mask = group.children[0] as any
  if (!mask) {
    group.remove()
    return null
  }
  const pattern = (group.data as any)?.pattern as PatternFillState | undefined
  mask.clipMask = false
  const paint = mask.data?.maskPaint as
    | { fill: string | null; stroke: string | null; width: number }
    | undefined
  if (mask.fillColor !== undefined) {
    mask.fillColor = pattern?.background ?? paint?.fill ?? null
  }
  if (mask.strokeColor !== undefined) {
    mask.strokeColor = paint?.stroke ?? null
    if (Number.isFinite(paint?.width)) mask.strokeWidth = paint!.width
  }
  if (mask.data) delete mask.data.maskPaint
  if (!mask.data?.id) mask.data.id = e.genId()
  mask.data.isUserItem = true
  parent.insertChild(Math.min(at, parent.children.length), mask)
  group.remove()
  return mask as paper.Item
}
