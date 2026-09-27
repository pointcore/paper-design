/**
 * Open-path join domain (C1: fifth slice out of engine.ts).
 *
 * Delegation target for end-to-end path joining: each function takes the
 * engine as an explicit first argument and otherwise runs the historical
 * method body unchanged. The EditorEngine import is type-only, so the
 * runtime dependency flows one way (engine → engine-join). The private
 * segment-copy helpers move along as module functions since all of their
 * callers live in this domain.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import { chooseJoinEnds } from './geometry'
import type { StyleState } from './types'

/**
 * Join exactly two unlocked open paths end to end. The closest endpoint
 * pair wins; a gap bridges with a straight span and coincident ends merge
 * cleanly. Curves keep their handles (reversed where the walk flips).
 */
export function joinPaths(e: EditorEngine): boolean {
  const scope = e.scope
  const paths = e.getSelection().filter(
    (item) =>
      !item.locked &&
      item.parent &&
      item instanceof scope.Path &&
      !(item instanceof scope.CompoundPath) &&
      !item.closed &&
      item.segments.length > 0
  ) as paper.Path[]
  if (paths.length !== 2) return false
  const ordered = paths
    .slice()
    .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))
  const [first, second] = ordered
  const aEnds = [first.segments[0].point, first.segments[first.segments.length - 1].point]
  const bEnds = [second.segments[0].point, second.segments[second.segments.length - 1].point]
  // Closest endpoint pair wins (ties keep the first); each path walks so
  // the joined ends meet. The decision core lives in geometry.ts under
  // unit-test lock; this stays a thin paper bridge.
  const ends = chooseJoinEnds(aEnds[0], aEnds[1], bEnds[0], bEnds[1])
  const style = e.getStyleFromItem(first)
  return mergePathsEndToEnd(e, first, second, ends.firstUsesFirst, ends.secondUsesFirst, style)
}

/**
 * Merge two open paths end to end with explicit orientations: each path
 * walks so the joined ends meet (useFirst reverses the walk). Shared by
 * auto nearest-pair join and sub-selection endpoint join.
 */
export function mergePathsEndToEnd(
  e: EditorEngine,
  first: paper.Path,
  second: paper.Path,
  firstUsesFirst: boolean,
  secondUsesFirst: boolean,
  style?: StyleState
): boolean {
  const scope = e.scope
  if (!first.parent || !second.parent) return false
  const paint = style ?? e.getStyleFromItem(first)
  const parent = first.parent ?? e.getActiveLayer()
  const rawAt = parent.children.indexOf(first)
  const at = rawAt < 0 ? parent.children.length : rawAt
  const merged = new scope.Path({ insert: false }) as paper.Path
  const walk: paper.Segment[] = []
  const pushOriented = (path: paper.Path, useFirst: boolean) => {
    const segs = path.segments
    if (!useFirst) {
      for (const seg of segs) walk.push(cloneSegment(e, seg))
    } else {
      for (let i = segs.length - 1; i >= 0; i--) walk.push(reversedSegment(e, segs[i]))
    }
  }
  pushOriented(first, firstUsesFirst)
  const junctionAt = walk.length
  pushOriented(second, secondUsesFirst)
  // Coincident ends merge into one anchor: the junction keeps the incoming
  // handle of the first walk and the outgoing handle of the second, so both
  // adjoining curves keep their shape and no degenerate zero-length span
  // is left behind (docstring: "coincident ends merge cleanly").
  if (
    junctionAt > 0 && junctionAt < walk.length &&
    walk[junctionAt - 1].point.getDistance(walk[junctionAt].point) < 1e-6
  ) {
    walk.splice(
      junctionAt - 1,
      2,
      new scope.Segment(
        walk[junctionAt - 1].point.clone(),
        walk[junctionAt - 1].handleIn ? walk[junctionAt - 1].handleIn.clone() : undefined,
        walk[junctionAt].handleOut ? walk[junctionAt].handleOut.clone() : undefined
      )
    )
  }
  for (const seg of walk) merged.add(seg)
  merged.closed = false
  first.remove()
  second.remove()
  parent.insertChild(Math.min(at, parent.children.length), merged)
  merged.data.id = e.genId()
  merged.data.isUserItem = true
  e.applyStyleToItem(merged, paint)
  e.clearSelection()
  merged.selected = true
  e.syncSelectionToStore()
  e.pushHistory('Join Paths')
  e.scope.view.update()
  return true
}

/** Copy a segment (points and handles cloned). */
function cloneSegment(e: EditorEngine, seg: paper.Segment): paper.Segment {
  const scope = e.scope
  return new scope.Segment(
    seg.point.clone(),
    seg.handleIn ? seg.handleIn.clone() : undefined,
    seg.handleOut ? seg.handleOut.clone() : undefined
  )
}

/**
 * Copy a segment for backwards traversal: the anchor stays, handles swap
 * sides (no negation — a reversed bezier reuses the same offsets).
 */
function reversedSegment(e: EditorEngine, seg: paper.Segment): paper.Segment {
  const scope = e.scope
  return new scope.Segment(
    seg.point.clone(),
    seg.handleOut ? seg.handleOut.clone() : undefined,
    seg.handleIn ? seg.handleIn.clone() : undefined
  )
}
