/**
 * Blend domain (C1: slice out of engine.ts).
 *
 * Delegation target for AI/CDR Object > Blend: each function takes the
 * engine as an explicit first argument and otherwise runs the historical
 * method body unchanged. The EditorEngine import is type-only, so the
 * runtime dependency flows one way (engine → engine-blend). The private
 * resampling/paint helpers move along as module functions since all of
 * their callers live here.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import { alignSampledPoints, lerp, lerpRgba, rgbaToCss, sampleCountFor } from './blend/blend'
import { colorToCSS, parseCssColor, type Rgba } from './color'

/**
 * Sample `count` vertices evenly along a path's arc length (closed
 * outlines wrap without repeating the first vertex; open outlines include
 * both endpoints). Returns null for degenerate geometry.
 */
function resamplePathPoints(
  path: paper.Path,
  count: number,
  closed: boolean
): paper.Point[] | null {
  const len = path.length
  if (!Number.isFinite(len) || len <= 0) return null
  const pts: paper.Point[] = []
  if (closed) {
    for (let i = 0; i < count; i++) {
      const pt = path.getPointAt((len * i) / count)
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null
      pts.push(pt)
    }
  } else {
    for (let i = 0; i <= count; i++) {
      const pt = path.getPointAt(Math.min(len, (len * i) / count))
      if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return null
      pts.push(pt)
    }
  }
  return pts
}

/** Solid paint of an item as 8-bit channels, null for gradients/none. */
function solidPaintOf(item: paper.Item, key: 'fillColor' | 'strokeColor'): Rgba | null {
  const paint = (item as any)[key] as any
  if (!paint || paint.gradient) return null
  return parseCssColor(colorToCSS(paint))
}

/**
 * AI/CDR "Smooth Color" blend: auto-calculate the number of steps needed
 * for a smooth color transition between two selected paths. Returns up to
 * 256 steps (enough for 8-bit-per-channel gradients).
 */
export function autoBlendSteps(e: EditorEngine): number {
  const scope = e.scope
  const paths = e.getSelection().filter(
    (item) => !item.locked && item.parent && item instanceof scope.Path
  ) as paper.Path[]
  if (paths.length !== 2) return 8
  const [a, b] = paths
  const fa = solidPaintOf(a, 'fillColor')
  const fb = solidPaintOf(b, 'fillColor')
  const sa = solidPaintOf(a, 'strokeColor')
  const sb = solidPaintOf(b, 'strokeColor')
  let maxDist = 0
  if (fa && fb) {
    const d = Math.abs(fa.r - fb.r) + Math.abs(fa.g - fb.g) + Math.abs(fa.b - fb.b) + Math.abs(fa.a - fb.a)
    maxDist = Math.max(maxDist, d)
  }
  if (sa && sb) {
    const d = Math.abs(sa.r - sb.r) + Math.abs(sa.g - sb.g) + Math.abs(sa.b - sb.b) + Math.abs(sa.a - sb.a)
    maxDist = Math.max(maxDist, d)
  }
  // Also factor in opacity difference
  const opa = a.opacity ?? 1
  const opb = b.opacity ?? 1
  maxDist = Math.max(maxDist, Math.abs(opa - opb) * 4)
  // Map 0..4 color distance to 8..256 steps
  const steps = Math.min(256, Math.max(8, Math.round(maxDist * 64)))
  return steps
}

/**
 * AI/CDR Object > Blend: build `steps` shapes interpolated between two
 * unlocked selected paths (blending runs back-to-front). Both outlines
 * resample to a shared vertex budget, align start/winding, then every step
 * lerps the geometry plus solid fill/stroke colors, stroke widths and
 * opacity — gradient paints or a paint present on only one end leave the
 * matching step paint empty. Shared-parent operands group the whole run at
 * the back operand's z slot; otherwise the steps stack above the back
 * operand. One history entry. Returns the steps built, 0 when the
 * selection or geometry cannot blend.
 */
export function blendSelection(e: EditorEngine, steps: number): number {
  const scope = e.scope
  const count = Math.round(Number(steps))
  if (!Number.isFinite(count) || count < 1 || count > 200) return 0
  const paths = e.getSelection().filter(
    (item) => !item.locked && item.parent && item instanceof scope.Path
  ) as paper.Path[]
  if (paths.length !== 2) return 0
  const [back, front] = paths
    .slice()
    .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))

  // One closure convention for both operands so the vertex streams line up
  // (a mixed closed/open pair resamples as open).
  const closed = back.closed && front.closed
  const budget = sampleCountFor([back.segments.length, front.segments.length])
  const backPts = resamplePathPoints(back, budget, closed)
  const frontPts = resamplePathPoints(front, budget, closed)
  if (!backPts || !frontPts || backPts.length !== frontPts.length) return 0
  const alignedFront = alignSampledPoints(backPts, frontPts, closed)

  const fillBack = solidPaintOf(back, 'fillColor')
  const fillFront = solidPaintOf(front, 'fillColor')
  const strokeBack = solidPaintOf(back, 'strokeColor')
  const strokeFront = solidPaintOf(front, 'strokeColor')
  const widthBack = Number.isFinite(back.strokeWidth as number) ? (back.strokeWidth as number) : null
  const widthFront = Number.isFinite(front.strokeWidth as number) ? (front.strokeWidth as number) : null

  const steps_: paper.Path[] = []
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1)
    const segs: paper.Point[] = []
    for (let j = 0; j < backPts.length; j++) {
      segs.push(
        new scope.Point(
          lerp(backPts[j].x, alignedFront[j].x, t),
          lerp(backPts[j].y, alignedFront[j].y, t)
        )
      )
    }
    const step = new scope.Path({ segments: segs, closed, insert: false }) as paper.Path
    try {
      step.smooth({ type: 'catmull-rom', factor: 0.5 })
    } catch {
      // Straight-segment steps beat aborting the whole blend.
    }
    if (fillBack && fillFront) {
      step.fillColor = new scope.Color(rgbaToCss(lerpRgba(fillBack, fillFront, t)))
    }
    if (strokeBack && strokeFront) {
      step.strokeColor = new scope.Color(rgbaToCss(lerpRgba(strokeBack, strokeFront, t)))
    }
    if (widthBack !== null && widthFront !== null) step.strokeWidth = lerp(widthBack, widthFront, t)
    step.strokeCap = back.strokeCap
    step.strokeJoin = back.strokeJoin
    step.opacity = lerp(back.opacity, front.opacity, t)
    step.data.id = e.genId()
    step.data.isUserItem = true
    steps_.push(step)
  }

  const parent = back.parent as paper.Item
  if (front.parent === back.parent) {
    const at = parent.children.indexOf(back)
    const group = new scope.Group({ insert: false }) as paper.Group
    group.addChild(back)
    for (const step of steps_) group.addChild(step)
    group.addChild(front)
    parent.insertChild(Math.min(Math.max(0, at), parent.children.length), group)
    group.data.id = e.genId()
    group.data.isUserItem = true
    e.selectItem(group)
  } else {
    const at = parent.children.indexOf(back)
    let k = 1
    for (const step of steps_) {
      parent.insertChild(Math.min(at + k, parent.children.length), step)
      k++
    }
    e.clearSelection()
    for (const item of [back, ...steps_, front]) item.selected = true
    e.syncSelectionToStore()
  }
  e.pushHistory('Blend')
  e.scope.view.update()
  return count
}
