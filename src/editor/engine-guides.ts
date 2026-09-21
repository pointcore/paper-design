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
  return (item.data as any)?.guideOrientation as GuideOrientation
}

/** Document coordinate along the guide's free axis. */
export function getGuidePosition(e: EditorEngine, item: paper.Item): number {
  const orientation = getGuideOrientation(e, item)
  if (!orientation) return 0
  const segs = (item as paper.Path).segments
  if (!segs || segs.length === 0) return 0
  if (orientation === 'vertical') {
    return segs[0].point.x
  }
  return segs[0].point.y
}

/** Move a guide to a new document position along its free axis. */
export function moveGuide(e: EditorEngine, item: paper.Item, position: number) {
  if (!isGuide(e, item) || !(item instanceof e.scope.Path)) return
  const path = item as paper.Path
  const orientation = getGuideOrientation(e, item)
  const s0 = path.segments[0]
  const s1 = path.segments[path.segments.length - 1]
  if (!s0 || !s1) return

  const layer = e.getGuideLayer()
  const wasLocked = layer ? layer.locked : false
  if (layer) layer.locked = false
  try {
    if (orientation === 'horizontal') {
      // Horizontal guide: line is (a, y) - (b, y); update y.
      ;(s0 as any).point.y = position
      ;(s1 as any).point.y = position
    } else if (orientation === 'vertical') {
      // Vertical guide: line is (x, a) - (x, b); update x.
      ;(s0 as any).point.x = position
      ;(s1 as any).point.x = position
    }
  } finally {
    if (layer) layer.locked = wasLocked
    e.scope.view.update()
  }
}

/**
 * Create a guide line on the guide layer.
 * Vertical guides sit at a document X and run vertically;
 * horizontal guides sit at a document Y and run horizontally.
 * Guides span a huge document range so they stay visible through
 * pan/zoom operations.
 */
export function createGuide(
  e: EditorEngine,
  position: number,
  orientation: GuideOrientation
): paper.Path | null {
  const scope = e.scope
  const layer = e.getGuideLayer()
  if (!layer) return null

  const span = 1e6 // document units on each side
  const p1 = new scope.Point(-span, position)
  const p2 = new scope.Point(span, position)
  if (orientation === 'vertical') {
    p1.x = position
    p1.y = -span
    p2.x = position
    p2.y = span
  }

  const line = new scope.Path.Line(p1, p2) as paper.Path
  line.data.isGuide = true
  line.data.guideId = e.genId()
  line.data.guideOrientation = orientation
  line.strokeColor = new scope.Color('#00bcd4') // cyan
  line.strokeWidth = 1 / e.zoom
  line.strokeCap = 'butt'
  line.locked = false
  line.data.isUserLayer = false

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
export function listGuides(e: EditorEngine): Array<{ id: string; orientation: GuideOrientation; position: number }> {
  const layer = e.getGuideLayer()
  if (!layer) return []
  const out: Array<{ id: string; orientation: GuideOrientation; position: number }> = []
  for (const child of layer.children) {
    const data = (child as any).data ?? {}
    if (!data.isGuide) continue
    const orientation = (data.guideOrientation === 'vertical' ? 'vertical' : 'horizontal') as GuideOrientation
    const segs = (child as paper.Path).segments
    const p = segs.length > 0 ? (segs[0] as any).point : null
    if (!p) continue
    const position = orientation === 'vertical' ? Number(p.x) : Number(p.y)
    if (!Number.isFinite(position)) continue
    out.push({ id: String(data.guideId ?? ''), orientation, position: Math.round(position * 10) / 10 })
  }
  return out.reverse()
}

/** Move a guide by id; false when the id is unknown. Callers record history. */
export function moveGuideById(e: EditorEngine, id: string, position: number): boolean {
  if (!id || !Number.isFinite(position)) return false
  const layer = e.getGuideLayer()
  if (!layer) return false
  const guide = layer.children.find((c) => String((c as any).data?.guideId ?? '') === id)
  if (!guide) return false
  moveGuide(e, guide as paper.Item, position)
  return true
}

/** Delete a guide by id; false when the id is unknown. Callers record history. */
export function deleteGuideById(e: EditorEngine, id: string): boolean {
  if (!id) return false
  const layer = e.getGuideLayer()
  if (!layer) return false
  const guide = layer.children.find((c) => String((c as any).data?.guideId ?? '') === id)
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
