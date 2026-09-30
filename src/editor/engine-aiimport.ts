/**
 * AI/PDF import domain: opening a .ai/.pdf as a new document and importing
 * one into the current document, plus the per-page SVG -> Paper.js glue.
 * Mirrors engine-cdrimport; each function takes the engine as an explicit
 * first argument so the runtime dependency flows one way
 * (engine → engine-aiimport). The EditorEngine import is type-only.
 */
import type paper from 'paper'
import type { CdrImportResult, EditorEngine } from './engine'
import type { ArtboardMeta } from './types'
import { parseAiBytes, AI_PT_TO_PX } from './ai/ai-to-svg'
import { scaleCdrImportedStrokes } from './cdr/cdr-to-svg'
import { yieldToUI, isCancelled, type ProgressReport } from './busy'
import { snapshotProject, restoreSnapshot, resetHistory } from './engine-history'

/**
 * Open a .ai/.pdf file as a new document (one artboard per PDF page).
 * Replaces the current document; throws with an English message on failure.
 */
export async function openAiBytes(
  e: EditorEngine,
  input: Uint8Array | ArrayBuffer,
  baseName = 'AI',
  onProgress?: ProgressReport,
  /** Aborting unwinds at the parser's next yield point (see ai-to-svg.ts). */
  signal?: AbortSignal
): Promise<CdrImportResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length > 150 * 1024 * 1024) throw new Error('AI/PDF file too large (150 MB max)')
  const report = onProgress ?? ((): void => {})
  let doc
  try {
    report(0.05, 'Parsing AI/PDF…')
    await yieldToUI(signal)
    doc = await parseAiBytes(bytes, (f) => report(0.05 + 0.55 * f, 'Parsing AI/PDF objects…'), signal)
  } catch (err) {
    // Keep the cancellation identity: the caller reports "Cancelled" and
    // expects the document to have been left alone.
    if (isCancelled(err)) throw err
    throw new Error(err instanceof Error ? err.message : 'AI parse failed')
  }
  if (!doc.pages.length) throw new Error('No convertible pages found')

  const stem = (baseName || 'AI').replace(/\.(ai|pdf)$/i, '').slice(0, 80) || 'AI'
  // Snapshot first: per-page canvas import can still fail after the parse
  // succeeded, and the old document must survive that path untouched.
  const backup = snapshotProject(e)
  const prevBoards = e.store.artboards.map((b) => ({ ...b }))
  const prevActiveBoard = e.store.activeArtboardId
  const prevPageSize = { ...e.store.pageSize }
  e.clearIsolationState()
  e.project.clear()
  e.setupProject()
  e.initLayers()
  e.pointActiveLayerAtRestoredStack()

  /**
   * Put the pre-import document back. The project was cleared above, so any
   * exit before the artboards are committed — no convertible pages, or a
   * cancellation partway through the page loop — has to undo that here.
   */
  const restorePreviousDocument = () => {
    try {
      restoreSnapshot(e, backup)
    } catch {
      // The backup came from our own exporter; keep the original error.
    }
    e.store.setArtboards(prevBoards)
    e.store.setActiveArtboard(prevActiveBoard)
    e.store.setPageSize(prevPageSize.width, prevPageSize.height)
    e.pointActiveLayerAtRestoredStack()
    e.syncLayersToStore()
    e.clearSelection()
    e.refreshArtboards()
    e.refreshGrid()
    e.refreshGuides()
    e.scope.view.update()
    e.emitViewChange()
  }

  const GAP = 100
  let cursorX = 0
  const boards: ArtboardMeta[] = []
  const allItems: paper.Item[] = []
  let skippedPages = 0
  for (let k = 0; k < doc.pages.length; k++) {
    const page = doc.pages[k]
    const wPx = Math.min(16384, Math.max(1, Math.round(page.width)))
    const hPx = Math.min(16384, Math.max(1, Math.round(page.height)))
    const board = {
      id: e.genId(),
      name: doc.pages.length > 1 ? `${stem} p${k + 1}` : stem,
      x: Math.round(cursorX * 10) / 10,
      y: 0,
      width: wPx,
      height: hPx,
    }
    try {
      report(0.6 + (0.3 * k) / Math.max(1, doc.pages.length), `Importing page ${k + 1}…`)
      await yieldToUI(signal)
      const items = importAiPageSvg(e, page.svg, board.x, board.y)
      // Only successful pages take a board and advance the row: failed
      // pages leave neither a blank sheet nor a gap behind.
      boards.push(board)
      cursorX += wPx + GAP
      allItems.push(...items)
    } catch (err) {
      // A cancelled yield is not a page that failed to convert; counting it
      // as skipped would quietly finish the whole file and report success.
      if (isCancelled(err)) {
        restorePreviousDocument()
        throw err
      }
      skippedPages++
    }
  }
  if (allItems.length === 0) {
    // Nothing convertible: restore the previous document instead of
    // leaving an empty one behind (and never mark it as saved).
    restorePreviousDocument()
    throw new Error('No convertible pages found')
  }
  report(0.92, 'Arranging artboards…')
  await yieldToUI(signal)
  const first = boards[0]
  e.store.setPageSize(first.width, first.height)
  e.store.setBleed(0)
  e.store.setKeyObject('')
  e.store.setArtboards(boards)
  e.store.setActiveArtboard(first.id)
  e.pointActiveLayerAtRestoredStack()
  e.syncLayersToStore()
  e.clearSelection()
  allItems.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.clipboardItems = []
  e.pasteCount = 0
  resetHistory(e, 'Open AI')
  e.store.setDocumentName(stem)
  e.refreshArtboards()
  e.refreshGrid()
  e.refreshGuides()
  e.scope.view.update()
  e.zoomToArtboard()
  e.emitViewChange()
  const warnings = [...(doc.warnings ?? [])]
  return { pages: boards.length, warnings, skippedPages }
}

/**
 * Import a .ai/.pdf file into the current document (one artboard appended
 * per PDF page). Unlike openAiBytes the current artwork/history is kept;
 * one history entry is pushed.
 */
export async function importAiBytes(
  e: EditorEngine,
  input: Uint8Array | ArrayBuffer,
  baseName = 'AI',
  onProgress?: ProgressReport,
  /** Aborting unwinds at the parser's next yield point. */
  signal?: AbortSignal
): Promise<CdrImportResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length > 150 * 1024 * 1024) throw new Error('AI/PDF file too large (150 MB max)')
  const report = onProgress ?? ((): void => {})
  let doc
  try {
    report(0.05, 'Parsing AI/PDF…')
    await yieldToUI(signal)
    doc = await parseAiBytes(bytes, (f) => report(0.05 + 0.55 * f, 'Parsing AI/PDF objects…'), signal)
  } catch (err) {
    if (isCancelled(err)) throw err
    throw new Error(err instanceof Error ? err.message : 'AI parse failed')
  }
  if (!doc.pages.length) throw new Error('No convertible pages found')

  const stem = (baseName || 'AI').replace(/\.(ai|pdf)$/i, '').slice(0, 80) || 'AI'
  const GAP = 100
  let cursorX = 0
  for (const b of e.store.artboards) {
    cursorX = Math.max(cursorX, b.x + b.width + GAP)
  }
  const boards = e.store.artboards.slice()
  const initialBoards = boards.length
  const allItems: paper.Item[] = []
  let skippedPages = 0
  for (let k = 0; k < doc.pages.length; k++) {
    const page = doc.pages[k]
    const wPx = Math.min(16384, Math.max(1, Math.round(page.width)))
    const hPx = Math.min(16384, Math.max(1, Math.round(page.height)))
    const board = {
      id: e.genId(),
      name: doc.pages.length > 1 ? `${stem} p${k + 1}` : stem,
      x: Math.round(cursorX * 10) / 10,
      y: 0,
      width: wPx,
      height: hPx,
    }
    try {
      report(0.6 + (0.3 * k) / Math.max(1, doc.pages.length), `Importing page ${k + 1}…`)
      await yieldToUI(signal)
      const items = importAiPageSvg(e, page.svg, board.x, board.y)
      boards.push(board)
      cursorX += wPx + GAP
      allItems.push(...items)
    } catch (err) {
      if (isCancelled(err)) throw err
      skippedPages++
    }
  }
  if (allItems.length === 0) throw new Error('No convertible pages found')
  e.store.setArtboards(boards)
  e.syncLayersToStore()
  e.clearSelection()
  allItems.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  report(0.92, 'Arranging artboards…')
  await yieldToUI(signal)
  e.pushHistory('Import AI')
  e.refreshArtboards()
  e.scope.view.update()
  e.emitViewChange()
  const warnings = [...(doc.warnings ?? [])]
  return { pages: boards.length - initialBoards, warnings, skippedPages }
}

/**
 * Convert one AI/PDF page SVG (viewBox in PDF points, px width/height) and
 * import onto the given board origin. Returns the placed top-level items.
 */
function importAiPageSvg(
  e: EditorEngine,
  pageSvg: string,
  boardX: number,
  boardY: number
): paper.Item[] {
  // Paper.js bakes the viewBox scale into coordinates but keeps raw
  // user-unit stroke widths: rescale so pt strokes land at their px size.
  const imported = e.project.importSVG(pageSvg)
  const layer = e.getActiveLayer()
  const items = (Array.isArray(imported) ? imported : [imported]).filter(
    Boolean
  ) as paper.Item[]
  if (items.length === 0) throw new Error('Empty AI page')
  const placed: paper.Item[] = []
  for (const item of items) {
    e.restampCloneTree(item)
    if (!(item as any).data) (item as any).data = {}
    ;((item as any).data as any).id = e.genId()
    ;((item as any).data as any).isUserItem = true
    layer.addChild(item)
    scaleCdrImportedStrokes(item, AI_PT_TO_PX)
    item.translate(new e.scope.Point(boardX, boardY))
    placed.push(item)
  }
  return placed
}
