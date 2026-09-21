/**
 * Envelope-distort domain (C1: slice out of engine.ts).
 *
 * Delegation target for destructive path warps: the entry takes the
 * engine as an explicit first argument and otherwise runs the
 * historical method body unchanged. The EditorEngine import is
 * type-only, so the runtime dependency flows one way
 * (engine → engine-envelope). The leaf collector and the preset point
 * mapper move along as module functions (paper math only).
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import type { EnvelopePreset } from './types'

/**
 * Destructively warp selected paths through an envelope preset (arc,
 * bulge, wave). Each path warps in its own bounds; anchors and handles
 * map through the same function so curves stay coherent. Text, patterns
 * and clip content are skipped. Returns how many paths warped.
 */
export function envelopeDistort(e: EditorEngine, preset: EnvelopePreset): number {
  const scope = e.scope
  const leaves = e.getSelection().flatMap((item) => envelopeLeaves(e, item))
  if (leaves.length === 0) return 0
  let changed = 0
  for (const leaf of leaves) {
    const bounds = (leaf as any).bounds as paper.Rectangle | undefined
    if (!bounds || !(bounds.width > 1e-6) || !(bounds.height > 1e-6)) continue
    const paths =
      leaf instanceof scope.CompoundPath
        ? ((leaf.children as unknown as paper.Path[]) ?? [])
        : [leaf as paper.Path]
    for (const path of paths) {
      if (!path.segments || path.segments.length === 0) continue
      for (const seg of path.segments) {
        const anchor = (seg.point as paper.Point).clone()
        const mapped = envelopePoint(e, anchor, bounds, preset)
        // Handles are relative to the anchor: map the absolute handle
        // position, then store the relative remainder.
        for (const key of ['handleIn', 'handleOut'] as const) {
          const handle = (seg as any)[key] as paper.Point | undefined
          if (handle && (handle as paper.Point).length > 1e-9) {
            const absolute = anchor.add(handle as paper.Point)
            const warped = envelopePoint(e, absolute, bounds, preset)
            ;(seg as any)[key] = warped.subtract(mapped)
          }
        }
        seg.point = mapped
      }
      changed++
    }
    e.refreshItemGradient(leaf)
  }
  if (changed > 0) {
    const label =
      preset === 'arc-upper' ? 'Envelope Arc Upper' :
      preset === 'arc-lower' ? 'Envelope Arc Lower' :
      preset === 'bulge' ? 'Envelope Bulge' :
      preset === 'wave' ? 'Envelope Wave' :
      preset === 'flag' ? 'Envelope Flag' :
      preset === 'fisheye' ? 'Envelope Fisheye' :
      preset === 'pinch' ? 'Envelope Pinch' :
      preset === 'rise' ? 'Envelope Rise' :
      preset === 'fish' ? 'Envelope Fish' : 'Envelope Squeeze'
    e.reflowTextsForItems(e.getSelection())
    e.pushHistory(label)
    e.scope.view.update()
  }
  return changed
}

/** Plain warpable path leaves under an item (groups descended into). */
function envelopeLeaves(e: EditorEngine, item: paper.Item): Array<paper.Path | paper.CompoundPath> {
  const scope = e.scope
  const out: Array<paper.Path | paper.CompoundPath> = []
  const walk = (node: paper.Item): void => {
    if ((node as any).locked) return
    const data = (node as any).data ?? {}
    if (data.isChrome || data.isPreview || data.isGuide || data.annotation) return
    if (data.isPatternTile || data.isPatternFill || data.textMode) return
    if (node instanceof scope.Group) {
      const kids = (node as any).children as Array<any> | undefined
      if (kids && kids.some((k) => k && k.clipMask)) return
      for (const child of node.children) walk(child as paper.Item)
      return
    }
    if (
      (node instanceof scope.Path || node instanceof scope.CompoundPath) &&
      (node.data as any)?.id &&
      node.parent
    ) {
      out.push(node as paper.Path | paper.CompoundPath)
    }
  }
  walk(item)
  return out
}

/** Map one absolute point through an envelope preset within bounds. */
function envelopePoint(e: EditorEngine, p: paper.Point, b: paper.Rectangle, preset: EnvelopePreset): paper.Point {
  const scope = e.scope
  const nx = (p.x - b.x) / b.width
  const ny = (p.y - b.y) / b.height
  switch (preset) {
    case 'arc-upper':
      return new scope.Point(p.x, p.y - Math.sin(Math.PI * nx) * 0.25 * b.height)
    case 'arc-lower':
      return new scope.Point(p.x, p.y + Math.sin(Math.PI * nx) * 0.25 * b.height)
    case 'bulge': {
      const cx = b.x + b.width / 2
      return new scope.Point(cx + (p.x - cx) * (1 + 0.3 * Math.sin(Math.PI * ny)), p.y)
    }
    case 'wave':
      return new scope.Point(p.x, p.y + Math.sin(2 * Math.PI * nx) * 0.08 * b.height)
    case 'flag':
      // One-sided wave growing toward the right edge.
      return new scope.Point(p.x, p.y + Math.sin(Math.PI * nx) * nx * 0.3 * b.height)
    case 'fisheye': {
      // Magnify toward the center, compress toward the corners.
      const cx = b.x + b.width / 2
      const cy = b.y + b.height / 2
      const rx = (nx - 0.5) * 2
      const ry = (ny - 0.5) * 2
      const f = 1 + 0.4 * Math.max(0, 1 - (rx * rx + ry * ry) / 2)
      return new scope.Point(cx + (p.x - cx) * f, cy + (p.y - cy) * f)
    }
    case 'squeeze':
      // Pinch the middle horizontally (inverse bulge).
      return new scope.Point(b.x + b.width / 2 + (p.x - (b.x + b.width / 2)) * (1 - 0.3 * Math.sin(Math.PI * ny)), p.y)
    case 'pinch': {
      // Contract toward the center (inverse fisheye).
      const pcx = b.x + b.width / 2
      const pcy = b.y + b.height / 2
      const prx = (nx - 0.5) * 2
      const pry = (ny - 0.5) * 2
      const pf = 1 - 0.35 * Math.max(0, 1 - (prx * prx + pry * pry) / 2)
      return new scope.Point(pcx + (p.x - pcx) * pf, pcy + (p.y - pcy) * pf)
    }
    case 'rise': {
      // Perspective rise: wider at the bottom, narrower at the top.
      const ry2 = 1 - 0.3 * ny  // ny=0 top → scale 1, ny=1 bottom → scale 0.7
      const rcx = b.x + b.width / 2
      return new scope.Point(rcx + (p.x - rcx) * ry2, p.y)
    }
    case 'fish': {
      // Asymmetric horizontal stretch: stronger on the right side.
      const fx = nx < 0.5
        ? 1 + 0.15 * Math.sin(Math.PI * nx * 2)
        : 1 + 0.35 * Math.sin(Math.PI * (nx - 0.5) * 2)
      return new scope.Point(b.x + b.width / 2 + (p.x - (b.x + b.width / 2)) * fx, p.y)
    }
  }
}
