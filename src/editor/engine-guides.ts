/**
 * Guide-line domain (C1: second slice out of engine.ts).
 *
 * Delegation target for guide CRUD: each function takes the engine as an
 * explicit first argument and otherwise runs the historical method body
 * unchanged. The EditorEngine import is type-only, so the runtime
 * dependency flows one way (engine → engine-guides). `getGuideLayer`
 * stays on the engine (it owns the private layer field) as does
 * `refreshGuideWidths` (it reaches the private controller registry);
 * everything else lives here and calls back through public members.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import type { GuideOrientation } from './types'
import { endpoints as guideEndpoints, normalizeGuideAngle, type GuideGeometry } from './guides/guide-geometry'

export type { GuideGeometry }

/** Whether an item is a guide line. */
export function isGuide(e: EditorEngine, item: paper.Item): boolean {
  return !!(item && (item.data as any)?.isGuide)
}

/** All guide items currently on the guide layer. */
export function getGuides(e: EditorEngine): paper.Path[] {
  const layer = e.getGuideLayer()
  const out: paper.Path[] = []
  if (!layer) return out
  layer.children.forEach((child: any) => {
    if ((child as any).data?.isGuide) out.push(child as paper.Path)
  })
  return out
}

/** Guide orientation of a guide item, or null if it is not a guide. */
export function getGuideOrientation(e: EditorEngine, item: paper.Item): GuideOrientation | null {
  if (!isGuide(e, item)) return null
  const raw = (item.data as any)?.guideOrientation
  if (raw === 'vertical' || raw === 'horizontal' || raw === 'diagonal') return raw
  // Anything unrecognised (including a hand-edited project) is a horizontal
  // guide, which is what an absent orientation used to mean.
  return 'horizontal'
}

/**
 * Read a guide's placement off the paper item.
 *
 * The anchor lives in the item data rather than being read back from the
 * segments: a diagonal guide is rebuilt from (x, y, angle) on every move, and
 * rounding the anchor out of two endpoints loses the sub-pixel position the
 * drag was aiming at.
 *
 * Guides saved before the diagonal work stored their coordinate only in the
 * segment points, so a missing data field falls back to reading the segment.
 * Without that a project from the previous version would open with every
 * guide at the origin.
 */
export function getGuideGeometry(e: EditorEngine, item: paper.Item): GuideGeometry | null {
  if (!isGuide(e, item)) return null
  const data = (item.data as any) ?? {}
  const orientation = getGuideOrientation(e, item) ?? 'horizontal'
  let position = Number(data.guidePosition)
  let cross = Number(data.guideCross)
  if (!Number.isFinite(position)) {
    const seg = (item as paper.Path).segments?.[0] as paper.Segment | undefined
    const point = seg?.point
    position = orientation === 'horizontal' ? Number(point?.y) : Number(point?.x)
  }
  if (!Number.isFinite(cross)) cross = 0
  return {
    orientation,
    position: Number.isFinite(position) ? position : 0,
    cross,
    angle: Number.isFinite(Number(data.guideAngle)) ? Number(data.guideAngle) : 0,
  }
}

/** Write a guide's placement to the item data and redraw its endpoints. */
export function setGuideGeometry(
  e: EditorEngine,
  item: paper.Item,
  geometry: GuideGeometry
): void {
  if (!isGuide(e, item) || !(item instanceof e.scope.Path)) return
  const path = item as paper.Path
  const angle = geometry.orientation === 'diagonal' ? normalizeGuideAngle(geometry.angle) : 0
  const data = (item.data as any) ?? (item.data = {})
  data.guideOrientation = geometry.orientation
  data.guidePosition = geometry.position
  data.guideCross = geometry.orientation === 'diagonal' ? geometry.cross : 0
  data.guideAngle = angle

  const layer = e.getGuideLayer()
  const wasLocked = layer ? layer.locked : false
  if (layer) layer.locked = false
  try {
    const [a, b] = guideEndpoints({ ...geometry, angle })
    const s0 = path.segments[0]
    const s1 = path.segments[path.segments.length - 1]
    if (!s0 || !s1) return
    // The segment points are mutated in place: replacing them would rebuild
    // the path's geometry and lose the item's identity in the guide layer.
    ;(s0 as any).point.x = a.x
    ;(s0 as any).point.y = a.y
    ;(s1 as any).point.x = b.x
    ;(s1 as any).point.y = b.y
  } finally {
    if (layer) layer.locked = wasLocked
  }
}

/**
 * Document coordinate along the guide's free axis: the anchor x for a
 * vertical guide, the anchor y for a horizontal one. A diagonal guide has
 * no single free axis, so this reports its anchor x — callers that care
 * about diagonals use getGuideGeometry.
 */
export function getGuidePosition(e: EditorEngine, item: paper.Item): number {
  return getGuideGeometry(e, item)?.position ?? 0
}

/** Move a guide to a new document position along its free axis. */
export function moveGuide(e: EditorEngine, item: paper.Item, position: number) {
  const geometry = getGuideGeometry(e, item)
  if (!geometry) return
  setGuideGeometry(e, item, { ...geometry, position })
  e.scope.view.update()
}

/**
 * Create a guide line on the guide layer.
 * Vertical guides sit at a document X and run vertically;
 * horizontal guides sit at a document Y and run horizontally;
 * a diagonal guide runs at `options.angle` degrees through (position, y).
 * Guides span a huge document range so they stay visible through
 * pan/zoom operations.
 */
export function createGuide(
  e: EditorEngine,
  position: number,
  orientation: GuideOrientation,
  options?: { angle?: number; y?: number }
): paper.Path | null {
  const scope = e.scope
  const layer = e.getGuideLayer()
  if (!layer) return null

  const geometry: GuideGeometry = {
    orientation,
    position,
    cross: orientation === 'diagonal' ? (options?.y ?? position) : 0,
    angle: orientation === 'diagonal' ? normalizeGuideAngle(options?.angle ?? 0) : 0,
  }
  const [p1, p2] = guideEndpoints(geometry)

  const line = new scope.Path.Line(
    new scope.Point(p1.x, p1.y),
    new scope.Point(p2.x, p2.y)
  ) as paper.Path
  line.data.isGuide = true
  line.data.guideId = e.genId()
  line.strokeColor = new scope.Color('#00bcd4') // cyan
  line.strokeWidth = 1 / e.zoom
  line.strokeCap = 'butt'
  line.locked = false
  line.data.isUserLayer = false
  setGuideGeometry(e, line, geometry)

  // Unlock temporarily so we can add to the locked guide layer
  layer.locked = false
  try {
    layer.addChild(line)
  } finally {
    layer.locked = true
  }

  e.scope.view.update()
  return line
}

/** Delete a guide item from the guide layer. */
export function deleteGuide(e: EditorEngine, guide: paper.Path) {
  const layer = e.getGuideLayer()
  if (!layer) return
  layer.locked = false
  try {
    guide.remove()
  } finally {
    layer.locked = true
    e.scope.view.update()
  }
}

/** Every guide as plain data (id / orientation / position), top-first. */
export function listGuides(e: EditorEngine): Array<{
  id: string
  orientation: GuideOrientation
  position: number
  cross: number
  angle: number
}> {
  const layer = e.getGuideLayer()
  if (!layer) return []
  const out: Array<{
    id: string
    orientation: GuideOrientation
    position: number
    cross: number
    angle: number
  }> = []
  for (const child of layer.children) {
    const data = (child as any).data ?? {}
    if (!data.isGuide) continue
    const geometry = getGuideGeometry(e, child as paper.Item)
    if (!geometry) continue
    if (!Number.isFinite(geometry.position)) continue
    out.push({
      id: String(data.guideId ?? ''),
      orientation: geometry.orientation,
      position: Math.round(geometry.position * 10) / 10,
      cross: Math.round(geometry.cross * 10) / 10,
      angle: Math.round(geometry.angle * 100) / 100,
    })
  }
  return out.reverse()
}

/** Move a guide by id; false when the id is unknown. Callers record history. */
export function moveGuideById(e: EditorEngine, id: string, position: number): boolean {
  if (!id || !Number.isFinite(position)) return false
  const guide = findGuideById(e, id)
  if (!guide) return false
  moveGuide(e, guide, position)
  return true
}

/**
 * Patch a guide's placement by id: any subset of the anchor coordinates and
 * the angle. The Guides dialog edits all three independently, and a diagonal
 * guide needs its angle to survive a move.
 */
export function updateGuideById(
  e: EditorEngine,
  id: string,
  patch: { position?: number; cross?: number; angle?: number }
): boolean {
  if (!id) return false
  const guide = findGuideById(e, id)
  if (!guide) return false
  const geometry = getGuideGeometry(e, guide)
  if (!geometry) return false
  const next: GuideGeometry = {
    orientation: geometry.orientation,
    position: Number.isFinite(patch.position) ? (patch.position as number) : geometry.position,
    cross: Number.isFinite(patch.cross) ? (patch.cross as number) : geometry.cross,
    angle: Number.isFinite(patch.angle) ? (patch.angle as number) : geometry.angle,
  }
  setGuideGeometry(e, guide, next)
  e.scope.view.update()
  return true
}

/** The guide item with this id, or null. */
function findGuideById(e: EditorEngine, id: string): paper.Item | null {
  const layer = e.getGuideLayer()
  if (!layer) return null
  return layer.children.find((c) => String((c as any).data?.guideId ?? '') === id) ?? null
}

/** Delete a guide by id; false when the id is unknown. Callers record history. */
export function deleteGuideById(e: EditorEngine, id: string): boolean {
  if (!id) return false
  const guide = findGuideById(e, id)
  if (!guide || !(guide instanceof e.scope.Path)) return false
  deleteGuide(e, guide as paper.Path)
  return true
}

/** Remove all guides from the guide layer. */
export function clearGuides(e: EditorEngine) {
  const layer = e.getGuideLayer()
  if (!layer) return
  layer.locked = false
  try {
    layer.removeChildren()
  } finally {
    layer.locked = true
    e.scope.view.update()
  }
}

/** Set guide-layer visibility according to the current store setting. */
export function refreshGuides(e: EditorEngine) {
  const layer = e.getGuideLayer()
  if (!layer) return
  layer.visible = e.store.view.showGuides
  e.scope.view.update()
}

/**
 * Drop a guide through the selection center (vertical = X, horizontal =
 * Y). Respects the guides lock. Returns false with no selection.
 */
export function guideAtSelection(e: EditorEngine, orientation: GuideOrientation): boolean {
  if (e.store.view.guidesLocked) return false
  const bounds = e.getSelectionBounds()
  if (!bounds) return false
  const pos = orientation === 'vertical' ? bounds.x + bounds.width / 2 : bounds.y + bounds.height / 2
  if (!Number.isFinite(pos)) return false
  const guide = createGuide(e, pos, orientation)
  if (!guide) return false
  e.pushHistory('Add Guide')
  return true
}

/**
 * Inset margin guides on a board (print-layout staple): two vertical +
 * two horizontal guides at `margin` inside the sheet. Respects the
 * guides lock. Returns guides created.
 */
export function addMarginGuides(e: EditorEngine, boardId: string, margin: number): number {
  if (e.store.view.guidesLocked) return 0
  const board = e.store.artboards.find((b) => b.id === boardId)
  if (!board || !(board.width > 0) || !(board.height > 0)) return 0
  const m = Number.isFinite(margin) ? Math.min(Math.min(board.width, board.height) / 2 - 1, Math.max(0, margin)) : 0
  if (!(m > 0)) return 0
  let made = 0
  const specs: Array<[number, GuideOrientation]> = [
    [board.x + m, 'vertical'],
    [board.x + board.width - m, 'vertical'],
    [board.y + m, 'horizontal'],
    [board.y + board.height - m, 'horizontal'],
  ]
  for (const [pos, orientation] of specs) {
    if (createGuide(e, pos, orientation)) made++
  }
  if (made > 0) e.pushHistory('Add Margin Guides')
  return made
}
