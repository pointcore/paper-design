/**
 * Data merge domain (C1: slice out of engine.ts).
 *
 * CSV record merge (one artboard per row with merged title/body text):
 * the function takes the engine as an explicit first argument and
 * otherwise runs the historical method body unchanged. The EditorEngine
 * import is type-only, so the runtime dependency flows one way
 * (engine → engine-datamerge).
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import { MAX_MERGE_ROWS, mergeTemplate } from './data-merge'

/**
 * Generate one artboard per record with merged title/body text.
 * Boards extend the row to the right (same size as the active board);
 * every text item is a regular user item (selectable, undoable).
 * Returns board/item counts; 0 boards when there is nothing to merge.
 */
export function dataMerge(
  e: EditorEngine,
  records: Array<Record<string, string>>,
  opts: { titleTemplate: string; bodyTemplate: string }
): { boards: number; items: number } {
  const rows = (Array.isArray(records) ? records : []).slice(0, MAX_MERGE_ROWS)
  if (rows.length === 0) return { boards: 0, items: 0 }
  const active = e.store.activeArtboard
  const GAP = 100
  let cursorX = active ? active.x + active.width + GAP : 0
  const cursorY = active ? active.y : 0
  const bw = active ? active.width : e.store.pageSize.width
  const bh = active ? active.height : e.store.pageSize.height
  const fontFamily = e.store.charStyle.fontFamily || 'Arial'
  const layer = e.getActiveLayer()
  const made: paper.Item[] = []
  let boards = 0
  rows.forEach((rec, i) => {
    const title = mergeTemplate(opts.titleTemplate || '{{name}}', rec).slice(0, 120) || `Row ${i + 1}`
    const body = mergeTemplate(opts.bodyTemplate || '', rec).slice(0, 2000)
    const board = {
      id: e.genId(),
      name: title.slice(0, 40),
      x: Math.round(cursorX * 10) / 10,
      y: cursorY,
      width: bw,
      height: bh,
    }
    e.store.addArtboard(board)
    const titleItem = new e.scope.PointText({
      point: new e.scope.Point(board.x + 48, board.y + 84),
      content: title,
      fontFamily,
      fontSize: 26,
      justification: 'left',
      fillColor: '#1a1a1a',
    }) as paper.PointText
    ;(titleItem as any).data = { id: e.genId(), isUserItem: true }
    layer.addChild(titleItem)
    made.push(titleItem)
    if (body) {
      const bodyItem = new e.scope.PointText({
        point: new e.scope.Point(board.x + 48, board.y + 128),
        content: body,
        fontFamily,
        fontSize: 13,
        justification: 'left',
        fillColor: '#333333',
      }) as paper.PointText
      ;(bodyItem as any).data = { id: e.genId(), isUserItem: true }
      layer.addChild(bodyItem)
      made.push(bodyItem)
    }
    cursorX += bw + GAP
    boards++
  })
  const last = e.store.artboards[e.store.artboards.length - 1]
  if (last) e.store.setActiveArtboard(last.id)
  e.refreshArtboards()
  e.clearSelection()
  for (const item of made) item.selected = true
  e.syncSelectionToStore()
  e.pushHistory('Data Merge')
  e.scope.view.update()
  return { boards, items: made.length }
}
