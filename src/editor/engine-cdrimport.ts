/**
 * CDR import domain (C1: slice out of engine.ts).
 *
 * Opening a .cdr as a new document and importing one into the current
 * document, plus the per-page SVG -> Paper.js glue: each function takes
 * the engine as an explicit first argument and otherwise runs the
 * historical method body unchanged. The EditorEngine import is type-only,
 * so the runtime dependency flows one way (engine → engine-cdrimport).
 */
import type paper from 'paper'
import type { CdrImportResult, EditorEngine } from './engine'
import type { ArtboardMeta } from './types'
import type { CdrPage } from './cdr/cdr-to-svg'
import { yieldToUI, type ProgressReport } from './busy'
import {
  parseCdrBytes,
  cdrMmToPx,
  cdrSvgToImportSvg,
  cdrViewBoxScale,
  countCdrUrlFills,
  scaleCdrImportedStrokes,
} from './cdr/cdr-to-svg'
import { snapshotProject, restoreSnapshot, resetHistory } from './engine-history'

/**
 * Open a .cdr file as a new document (multi-page -> multi-artboard row).
 * Parses locally via src/editor/cdr (ZIP CDR + 16-bit CDRX/CMX), converts
 * each page to SVG at 96dpi and imports onto its own artboard.
 * Replaces the current document; throws with an English message on failure.
 */
export async function openCdrBytes(
  e: EditorEngine,
  input: Uint8Array | ArrayBuffer,
  baseName = 'CDR',
  onProgress?: ProgressReport
): Promise<CdrImportResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length > 150 * 1024 * 1024) throw new Error('CDR file too large (150 MB max)')
  const report = onProgress ?? ((): void => {})
  let doc
  try {
    report(0.05, 'Extracting CDR…')
    await yieldToUI()
    // Parser takes 0-60%: unzip + object tree + per-page SVG conversion.
    doc = await parseCdrBytes(bytes, (f) => report(0.05 + 0.55 * f, 'Parsing CDR objects…'))
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'CDR parse failed')
  }
  if (!doc.pages.length) throw new Error('No convertible pages found')

  const stem = (baseName || 'CDR').replace(/\.cdr$/i, '').slice(0, 80) || 'CDR'
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

  const GAP = 100
  let cursorX = 0
  const boards: ArtboardMeta[] = []
  const allItems: paper.Item[] = []
  let skippedPages = 0
  let patternApprox = 0
  const layeredImport = doc.pages.some((p) => p.layers?.length)
  const seededLayer = layeredImport ? e.getActiveLayer() : null
  for (let k = 0; k < doc.pages.length; k++) {
    const page = doc.pages[k]
    const wPx = Math.min(16384, Math.max(1, Math.round(cdrMmToPx(page.width))))
    const hPx = Math.min(16384, Math.max(1, Math.round(cdrMmToPx(page.height))))
    const board = {
      id: e.genId(),
      name: doc.pages.length > 1 ? `${stem} p${k + 1}` : stem,
      x: Math.round(cursorX * 10) / 10,
      y: 0,
      width: wPx,
      height: hPx,
    }
    try {
      // Canvas import takes 60-90% (Paper.js importSVG is synchronous).
      report(0.6 + (0.3 * k) / Math.max(1, doc.pages.length), `Importing page ${k + 1}…`)
      await yieldToUI()
      const items = importPageItems(e, page, k, board, doc.pages.length > 1)
      // Only successful pages take a board and advance the row: failed
      // pages leave neither a blank sheet nor a gap behind.
      boards.push(board)
      cursorX += wPx + GAP
      allItems.push(...items)
      // Pattern fills import as solid approximations (Paper.js has no
      // <pattern> support and would render them opaque black instead).
      patternApprox += countCdrUrlFills(page.svg)
    } catch {
      skippedPages++
    }
  }
  if (allItems.length === 0) {
    // Nothing convertible: restore the previous document instead of
    // leaving an empty one behind (and never mark it as saved).
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
    throw new Error('No convertible pages found')
  }
  if (layeredImport && (seededLayer?.children?.length ?? 0) === 0) {
    // Layered files bring their own layer names; drop the seeded empty
    // default layer instead of leaving an unused "Layer 1" behind.
    seededLayer?.remove()
    const users = e.project.layers.filter((l) => (l.data as any)?.isUserLayer)
    const top = users[users.length - 1]
    top?.activate()
    if (top) e.store.setActiveLayer(top.data.layerId as string)
  }
  report(0.92, 'Arranging artboards…')
  await yieldToUI()
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
  resetHistory(e, 'Open CDR')
  e.store.setDocumentName(stem)
  e.refreshArtboards()
  e.refreshGrid()
  e.refreshGuides()
  e.scope.view.update()
  e.zoomToArtboard()
  e.emitViewChange()
  const warnings = [...(doc.warnings ?? [])]
  if (patternApprox > 0) warnings.push(`Pattern fills approximated as solid (${patternApprox})`)
  return { pages: boards.length, warnings, skippedPages }
}

/**
 * Import a .cdr file into the current document (multi-page appends one
 * artboard per page in a row after existing boards). Unlike openCdrBytes
 * the current artwork/history is kept; one history entry is pushed.
 */
export async function importCdrBytes(
  e: EditorEngine,
  input: Uint8Array | ArrayBuffer,
  baseName = 'CDR',
  onProgress?: ProgressReport
): Promise<CdrImportResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length > 150 * 1024 * 1024) throw new Error('CDR file too large (150 MB max)')
  const report = onProgress ?? ((): void => {})
  let doc
  try {
    report(0.05, 'Extracting CDR…')
    await yieldToUI()
    doc = await parseCdrBytes(bytes, (f) => report(0.05 + 0.55 * f, 'Parsing CDR objects…'))
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'CDR parse failed')
  }
  if (!doc.pages.length) throw new Error('No convertible pages found')

  const stem = (baseName || 'CDR').replace(/\.cdr$/i, '').slice(0, 80) || 'CDR'
  const GAP = 100
  let cursorX = 0
  for (const b of e.store.artboards) {
    cursorX = Math.max(cursorX, b.x + b.width + GAP)
  }
  const boards = e.store.artboards.slice()
  const initialBoards = boards.length
  const allItems: paper.Item[] = []
  let skippedPages = 0
  let patternApprox = 0
  for (let k = 0; k < doc.pages.length; k++) {
    const page = doc.pages[k]
    const wPx = Math.min(16384, Math.max(1, Math.round(cdrMmToPx(page.width))))
    const hPx = Math.min(16384, Math.max(1, Math.round(cdrMmToPx(page.height))))
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
      await yieldToUI()
      const items = importPageItems(e, page, k, board, doc.pages.length > 1)
      boards.push(board)
      cursorX += wPx + GAP
      allItems.push(...items)
      patternApprox += countCdrUrlFills(page.svg)
    } catch {
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
  await yieldToUI()
  e.pushHistory('Import CDR')
  e.refreshArtboards()
  e.scope.view.update()
  e.emitViewChange()
  const warnings = [...(doc.warnings ?? [])]
  if (patternApprox > 0) warnings.push(`Pattern fills approximated as solid (${patternApprox})`)
  return { pages: boards.length - initialBoards, warnings, skippedPages }
}

/**
 * Import one parsed page. Layered pages put each CDR layer on its own new
 * editor layer (bottom-first paint order; layers that render to nothing are
 * dropped); layerless pages land on the active layer as before. Returns the
 * placed top-level items, or throws when nothing was convertible.
 */
function importPageItems(
  e: EditorEngine,
  page: CdrPage,
  pageIndex: number,
  board: ArtboardMeta,
  multiPage: boolean
): paper.Item[] {
  if (!page.layers?.length) {
    return importCdrPageSvg(e, page.svg, page.width, page.height, board.x, board.y)
  }
  const items: paper.Item[] = []
  for (let li = 0; li < page.layers.length; li++) {
    const pl = page.layers[li]
    const name = pageLayerName(pl.name, pl.kind, li)
    const target = createCdrLayer(e, multiPage ? `p${pageIndex + 1} ${name}` : name)
    const placed = importCdrPageSvg(e, pl.svg, page.width, page.height, board.x, board.y, target)
    if (placed.length === 0) target.remove()
    else items.push(...placed)
  }
  if (items.length === 0) throw new Error('Empty CDR page')
  return items
}

/** Fallback layer name when the file omits arg1000 for a layer. */
function pageLayerName(name: string, kind: number, layerIndex: number): string {
  if (name) return name
  if (kind === 17) return 'Desktop'
  if (kind === 11) return 'Grid'
  return `Layer ${layerIndex + 1}`
}

/**
 * Create a user layer for an imported CDR layer. No history entry and no
 * store sync (the caller batches both); placed on top of the user band per
 * createLayer's rule, so importing bottom-first yields the original stack.
 */
function createCdrLayer(e: EditorEngine, name: string): paper.Layer {
  const layer = new e.scope.Layer()
  layer.name = name
  layer.data.isUserLayer = true
  layer.data.layerId = e.genId()
  const users = e.project.layers.filter((l) => (l.data as any)?.isUserLayer && l !== layer)
  if (users.length > 0) layer.insertAbove(users[users.length - 1])
  else {
    const chrome = e.project.layers.find((l) => !(l.data as any)?.isUserLayer && l !== layer)
    if (chrome) layer.insertBelow(chrome)
  }
  return layer
}

/**
 * Convert one CDR page SVG (CDR units viewBox, 300dpi header) to 96dpi and
 * import onto the given board origin. Returns the placed top-level items.
 */
function importCdrPageSvg(
  e: EditorEngine,
  pageSvg: string,
  widthMm: number,
  heightMm: number,
  boardX: number,
  boardY: number,
  targetLayer?: paper.Layer
): paper.Item[] {
  const svgText = cdrSvgToImportSvg(pageSvg, widthMm, heightMm)
  // Paper.js bakes the viewBox scale into coordinates but keeps raw
  // user-unit stroke widths: rescale them so CDR strokes (thousands of
  // CDR units) do not render thousands of px wide and bury every fill.
  const strokeScale = cdrViewBoxScale(svgText)
  const imported = e.project.importSVG(svgText)
  const layer = targetLayer ?? e.getActiveLayer()
  const items = (Array.isArray(imported) ? imported : [imported]).filter(
    Boolean
  ) as paper.Item[]
  if (items.length === 0) throw new Error('Empty CDR page')
  const placed: paper.Item[] = []
  for (const item of items) {
    e.restampCloneTree(item)
    if (!(item as any).data) (item as any).data = {}
    ;((item as any).data as any).id = e.genId()
    ;((item as any).data as any).isUserItem = true
    layer.addChild(item)
    scaleCdrImportedStrokes(item, strokeScale)
    item.translate(new e.scope.Point(boardX, boardY))
    placed.push(item)
  }
  return placed
}
