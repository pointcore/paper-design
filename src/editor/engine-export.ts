/**
 * Export domain (C1: slices out of engine.ts).
 *
 * Selection SVG serialization, raster export, board vector SVG, navigator
 * thumbnails and N-up imposition: each function takes the engine as an
 * explicit first argument and otherwise runs the historical method body
 * unchanged. The EditorEngine import is type-only, so the runtime
 * dependency flows one way (engine → engine-export).
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import type { RasterExportOptions } from './types'
import { unitedBoundsOf } from './engine-arrange'
import { encodeTiff } from './tiff'

/** Serialize unlocked selected user items into a standalone SVG string. */
export function exportSelectionSVG(e: EditorEngine): string | null {
  const items = e.getSelection().filter(
    (item) => (item.data as any)?.isUserItem && !item.locked
  )
  if (items.length === 0) return null
  const bodies = items.map((item) => {
    const exported = item.exportSVG()
    return typeof exported === 'string'
      ? exported
      : new XMLSerializer().serializeToString(exported)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg">${bodies.join('')}</svg>`
}

/** Export bounds for an area keyword (selection / page / artwork). */
function rasterBoundsFor(e: EditorEngine, area: RasterExportOptions['area']): paper.Rectangle | null {
  if (area === 'selection') {
    return e.getSelectionBounds()
  } else if (area === 'page') {
    // The active artboard is the page; older files fall back to pageSize.
    const board =
      e.store.artboards.find((b) => b.id === e.store.activeArtboardId) ??
      e.store.artboards[0]
    const page = e.store.pageSize
    const rect = board ?? { x: 0, y: 0, width: page.width, height: page.height }
    return Number.isFinite(rect.width) && Number.isFinite(rect.height) && rect.width > 0 && rect.height > 0
      ? new e.scope.Rectangle(rect.x, rect.y, rect.width, rect.height)
      : null
  }
  return unitedBoundsOf(e.getUserItems())
}

/**
 * Predicted pixel size for a raster export (null when there is nothing
 * to export). Lets callers explain size-guard failures precisely.
 */
export function estimateRasterSize(
  e: EditorEngine,
  area: RasterExportOptions['area'],
  scale: number,
): { width: number; height: number } | null {
  const bounds = rasterBoundsFor(e, area)
  if (!bounds || bounds.width < 1 || bounds.height < 1) return null
  const s = Number.isFinite(scale) ? Math.min(4, Math.max(0.5, scale)) : 1
  return { width: Math.ceil(bounds.width * s), height: Math.ceil(bounds.height * s) }
}

/**
 * Bake the unlocked selection into a 2x PNG placed at the same spot
 * (AI Object > Rasterize parity). Originals are removed only after the
 * raster loads; a load failure keeps them and reports false.
 */
export function rasterizeSelection(e: EditorEngine): boolean {
  const items = e.getSelection().filter((item) => !item.locked && item.parent)
  if (items.length === 0) return false
  const bounds = e.getSelectionBounds()
  if (!bounds || bounds.width < 1 || bounds.height < 1) return false
  const url = exportRaster(e, { format: 'png', scale: 2, area: 'selection' })
  if (!url) return false
  const parent = items[0].parent ?? e.getActiveLayer()
  const raster = new e.scope.Raster({ source: url }) as paper.Raster
  parent.addChild(raster)
  e.stampRasterIdentity(raster)
  raster.onLoad = () => {
    // exportRaster ran at 2x, so the bitmap lands at twice the selection
    // size (a data URL carries no DPI): scale it back into the original
    // bounds before placing it.
    const nb = (raster as any).bounds as paper.Rectangle | undefined
    if (nb && nb.width > 0 && nb.height > 0) {
      raster.scale(bounds.width / nb.width, bounds.height / nb.height)
    }
    raster.position = bounds.center.clone()
    e.stampRasterIdentity(raster)
    for (const item of items) {
      try {
        item.remove()
      } catch { /* already gone */ }
    }
    e.clearSelection()
    raster.selected = true
    e.syncSelectionToStore()
    e.pushHistory('Rasterize')
    e.scope.view.update()
    e.showStatus('Selection rasterized (2x PNG)')
  }
  raster.onError = () => {
    try {
      raster.remove()
    } catch { /* already gone */ }
    e.showStatus('Rasterize failed')
  }
  return true
}

/**
 * Rasterize artwork through the paper.js view into a data URL. The view
 * is pointed at the export bounds for exactly one synchronous render and
 * then restored, so no intermediate frame ever paints. Editor chrome
 * layers stay hidden like in SVG export. Returns null when there is
 * nothing to export or the output exceeds the size guard.
 *
 * `area: 'page'` keeps the artboard layer visible: the page *is* the sheet,
 * so hiding it exported a transparent page with the artwork floating on it
 * (which JPEG's white fill happened to hide and PNG did not).
 */
export function exportRaster(e: EditorEngine, options: RasterExportOptions): string | null {
  const bounds = rasterBoundsFor(e, options.area)
  if (!bounds || bounds.width < 1 || bounds.height < 1) return null
  const scale = Number.isFinite(options.scale) ? Math.min(4, Math.max(0.5, options.scale)) : 1
  const mime =
    options.format === 'jpeg' ? 'image/jpeg' :
    options.format === 'webp' ? 'image/webp' : 'image/png'
  const quality = Number.isFinite(options.quality)
    ? Math.min(1, Math.max(0.1, Number(options.quality)))
    : 0.92
  return withCapturedView(e, bounds, scale, options.area === 'page', (canvas, width, height) => {
    if (options.format === 'tiff') {
      // No canvas encoder writes TIFF, so the bytes are produced here. The
      // dpi falls back to the export scale: a 3x export of a 96dpi document
      // is a 288dpi page, which is what a print tool needs to place it.
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      const data = ctx.getImageData(0, 0, width, height)
      try {
        const bytes = encodeTiff({
          width,
          height,
          rgba: data.data,
          dpi: Number.isFinite(options.dpi) ? Number(options.dpi) : 96 * scale,
        })
        return bytesToDataUrl(bytes, 'image/tiff')
      } catch (err) {
        e.showStatus(err instanceof Error ? err.message : 'TIFF export failed')
        return null
      }
    }
    if (options.format === 'png') {
      return canvas.toDataURL('image/png')
    }
    const output = document.createElement('canvas')
    output.width = width
    output.height = height
    const ctx = output.getContext('2d')
    if (!ctx) return null
    if (options.format === 'jpeg') {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
    }
    ctx.drawImage(canvas, 0, 0)
    return output.toDataURL(mime, quality)
  })
}

/** Base64 data URL for raw bytes, chunked so a large page cannot blow the stack. */
function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return `data:${mime};base64,${btoa(binary)}`
}

/**
 * Render a whole-scene thumbnail (artwork plus artboard sheets) for the
 * navigator, capped at maxPixels on the long edge. Returns the image
 * with the document bounds it covers, or null when the scene is empty.
 */
export function renderThumbnail(
  e: EditorEngine,
  maxPixels: number,
): { url: string; x: number; y: number; width: number; height: number } | null {
  let bounds = unitedBoundsOf(e.getUserItems())
  for (const board of e.store.artboards) {
    if (board.width > 0 && board.height > 0) {
      const rect = new e.scope.Rectangle(board.x, board.y, board.width, board.height)
      bounds = bounds ? bounds.unite(rect) : rect
    }
  }
  if (!bounds) return null
  const longest = Math.max(bounds.width, bounds.height)
  if (!(longest > 0)) return null
  const limit = maxPixels > 0 ? maxPixels : 320
  const scale = Math.min(2, limit / longest)
  const snapshot = { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height }
  const url = withCapturedView(e, bounds, scale, true, (canvas) => canvas.toDataURL('image/png'))
  if (!url) return null
  return { url, ...snapshot }
}

/**
 * Point the view at bounds for exactly one synchronous render of `fn`,
 * then restore everything. The callback must be synchronous: restoring
 * resizes the canvas, which clears whatever was just drawn.
 */
function withCapturedView<T>(
  e: EditorEngine,
  bounds: paper.Rectangle,
  scale: number,
  keepArtboards: boolean,
  fn: (canvas: HTMLCanvasElement, width: number, height: number) => T | null
): T | null {
  if (!bounds || bounds.width < 1 || bounds.height < 1) return null
  const width = Math.max(1, Math.ceil(bounds.width * scale))
  const height = Math.max(1, Math.ceil(bounds.height * scale))
  if (width > 16384 || height > 16384) return null

  const view = e.scope.view
  const prevSize = view.viewSize.clone()
  const prevCenter = view.center.clone()
  const prevZoom = view.zoom

  // Temporarily hide non-user layers so editing chrome never leaks in.
  const hiddenLayers: paper.Layer[] = []
  for (const layer of e.project.layers) {
    const data = (layer.data as any) ?? {}
    if (!data.isUserLayer && layer.visible && !(keepArtboards && data.isArtboardLayer)) {
      layer.visible = false
      hiddenLayers.push(layer)
    }
  }

  try {
    view.viewSize = new e.scope.Size(width, height)
    view.zoom = scale
    view.center = bounds.center
    view.update()
    return fn(e.canvas, width, height)
  } finally {
    hiddenLayers.forEach((layer) => {
      layer.visible = true
    })
    view.viewSize = prevSize
    view.zoom = prevZoom
    view.center = prevCenter
    view.update()
    e.syncViewBookkeeping()
    e.refreshGrid()
    e.emitViewChange()
  }
}

/**
 * Export one artboard's artwork as a vector SVG element clipped to the
 * board (editor chrome layers hidden like raster export). The root
 * carries width/height/viewBox of the page plus a white page rect, so
 * vector-PDF renderers (svg2pdf) paint exactly one full-bleed page.
 * With `bleed > 0` the page grows by the bleed on every side and
 * `marks` draws hairline crop marks at the trim corners. Returns null
 * when the board is invalid or exports nothing.
 */
export function exportBoardVectorSVG(
  e: EditorEngine,
  board: { x: number; y: number; width: number; height: number },
  opts?: { bleed?: number; marks?: boolean }
): SVGSVGElement | null {
  if (!board || !(board.width > 0) || !(board.height > 0)) return null
  if (!Number.isFinite(board.x) || !Number.isFinite(board.y)) return null
  const bleed = Math.min(100, Math.max(0, Number(opts?.bleed) || 0))
  const page = {
    x: board.x - bleed,
    y: board.y - bleed,
    width: board.width + bleed * 2,
    height: board.height + bleed * 2,
  }
  const hiddenLayers: paper.Layer[] = []
  for (const layer of e.project.layers) {
    const data = (layer.data as any) ?? {}
    if (!data.isUserLayer && layer.visible) {
      layer.visible = false
      hiddenLayers.push(layer)
    }
  }
  try {
    e.scope.view.update()
    const exported = (e.project as any).exportSVG({ asString: false }) as unknown
    const root = exported as SVGSVGElement | null
    if (!root || typeof (root as any).setAttribute !== 'function') return null
    const fmt = (n: number): string => String(Math.round(n * 100) / 100)
    const ns = 'http://www.w3.org/2000/svg'
    root.setAttribute('xmlns', ns)
    root.setAttribute('width', fmt(page.width))
    root.setAttribute('height', fmt(page.height))
    root.setAttribute('viewBox', `${fmt(page.x)} ${fmt(page.y)} ${fmt(page.width)} ${fmt(page.height)}`)
    // White page sheet behind the artwork (raster PDF shows the sheet too).
    const sheet = document.createElementNS(ns, 'rect')
    sheet.setAttribute('x', fmt(page.x))
    sheet.setAttribute('y', fmt(page.y))
    sheet.setAttribute('width', fmt(page.width))
    sheet.setAttribute('height', fmt(page.height))
    sheet.setAttribute('fill', '#ffffff')
    root.insertBefore(sheet, root.firstChild)
    if (opts?.marks && bleed > 0) {
      appendCropMarks(root, ns, board, bleed)
    }
    // No mask post-processing: an opacity mask is a paper clip mask, and paper
    // exports it as an SVG <clipPath> that the artwork points at — the same
    // silhouette the canvas composites. (The old rewrite looked for
    // `data-isOpacityMaskGroup` attributes that paper never writes, so it had
    // never run.)
    return root
  } catch {
    return null
  } finally {
    hiddenLayers.forEach((layer) => {
      layer.visible = true
    })
    e.scope.view.update()
  }
}

/**
 * Hairline crop marks at the trim corners (drawn inside the bleed box,
 * flush to the page edges). Imposition stays one-up: every board is its
 * own PDF page.
 */
function appendCropMarks(
  root: SVGSVGElement,
  ns: string,
  trim: { x: number; y: number; width: number; height: number },
  bleed: number
): void {
  const fmt = (n: number): string => String(Math.round(n * 100) / 100)
  const len = Math.min(12, Math.max(3, bleed * 0.8))
  const x0 = trim.x
  const x1 = trim.x + trim.width
  const y0 = trim.y
  const y1 = trim.y + trim.height
  const segs: Array<[number, number, number, number]> = [
    // Top-left corner.
    [x0 - bleed, y0, x0 - bleed + len, y0],
    [x0, y0 - bleed, x0, y0 - bleed + len],
    // Top-right corner.
    [x1 + bleed - len, y0, x1 + bleed, y0],
    [x1, y0 - bleed, x1, y0 - bleed + len],
    // Bottom-left corner.
    [x0 - bleed, y1, x0 - bleed + len, y1],
    [x0, y1 + bleed - len, x0, y1 + bleed],
    // Bottom-right corner.
    [x1 + bleed - len, y1, x1 + bleed, y1],
    [x1, y1 + bleed - len, x1, y1 + bleed],
  ]
  const group = document.createElementNS(ns, 'g')
  group.setAttribute('fill', 'none')
  group.setAttribute('stroke', '#000000')
  group.setAttribute('stroke-width', '0.5')
  for (const [ax, ay, bx, by] of segs) {
    const line = document.createElementNS(ns, 'line')
    line.setAttribute('x1', fmt(ax))
    line.setAttribute('y1', fmt(ay))
    line.setAttribute('x2', fmt(bx))
    line.setAttribute('y2', fmt(by))
    group.appendChild(line)
  }
  root.appendChild(group)
}


/**
 * Compute an N-up imposition layout. Returns a list of { page, x, y }
 * describing where each board goes on the imposition sheet.
 * @param boards - array of artboard dimensions
 * @param upCount - number of pages per sheet (e.g. 2, 4, 6, 9, 16)
 * @param spacing - gap between imposed pages (pt)
 * @param margin - sheet margin (pt)
 * @param landscape - force sheet orientation
 */
export function computeNUpLayout(
  boards: Array<{ width: number; height: number }>,
  upCount: number = 4,
  spacing: number = 12,
  margin: number = 36,
  landscape?: boolean,
): Array<{ pageIndex: number; x: number; y: number; scale: number }> {
  if (boards.length === 0 || upCount < 1) return []

  // Find max board dimensions to determine sheet size
  const maxW = Math.max(...boards.map((b) => b.width))
  const maxH = Math.max(...boards.map((b) => b.height))

  // Compute grid dimensions (rows × cols) to fit upCount
  const cols = Math.ceil(Math.sqrt(upCount))
  const rows = Math.ceil(upCount / cols)

  const useLandscape = landscape ?? (maxW >= maxH)
  const sheetW = useLandscape ? Math.max(maxW, maxH) : Math.min(maxW, maxH)
  const sheetH = useLandscape ? Math.min(maxW, maxH) : Math.max(maxW, maxH)

  // Available area per cell
  const cellW = (sheetW * 2 - margin * 2 - spacing * (cols - 1)) / cols
  const cellH = (sheetH * 2 - margin * 2 - spacing * (rows - 1)) / rows

  const result: Array<{ pageIndex: number; x: number; y: number; scale: number }> = []

  for (let i = 0; i < Math.min(boards.length, upCount); i++) {
    const row = Math.floor(i / cols)
    const col = i % cols
    const board = boards[i]

    // Scale board to fit within cell while maintaining aspect ratio
    const scaleX = cellW / board.width
    const scaleY = cellH / board.height
    const scale = Math.min(scaleX, scaleY, 1) // Never upscale

    // Center board within cell
    const drawW = board.width * scale
    const drawH = board.height * scale
    const cellX = margin + col * (cellW + spacing)
    const cellY = margin + row * (cellH + spacing)
    const x = cellX + (cellW - drawW) / 2
    const y = cellY + (cellH - drawH) / 2

    result.push({ pageIndex: i, x, y, scale })
  }

  return result
}

/**
 * Create an N-up imposition SVG. Each board's artwork is placed on
 * the sheet according to the computed layout, scaled to fit.
 */
export function exportNUpSVG(
  e: EditorEngine,
  boards: Array<{ x: number; y: number; width: number; height: number; name?: string }>,
  opts?: { upCount?: number; spacing?: number; margin?: number; landscape?: boolean; bleed?: number }
): SVGSVGElement | null {
  const upCount = opts?.upCount ?? 4
  const spacing = opts?.spacing ?? 12
  const margin = opts?.margin ?? 36
  const bleed = opts?.bleed ?? 0

  const layout = computeNUpLayout(boards, upCount, spacing, margin, opts?.landscape)
  if (layout.length === 0) return null

  // Compute sheet size from layout
  const maxCellX = Math.max(...layout.map((l) => l.x))
  const maxCellY = Math.max(...layout.map((l) => l.y))
  const lastBoard = boards[layout[layout.length - 1].pageIndex]
  const sheetW = maxCellX + lastBoard.width * layout[layout.length - 1].scale + margin
  const sheetH = maxCellY + lastBoard.height * layout[layout.length - 1].scale + margin

  const ns = 'http://www.w3.org/2000/svg'
  const root = document.createElementNS(ns, 'svg') as SVGSVGElement
  root.setAttribute('xmlns', ns)
  root.setAttribute('width', String(Math.round(sheetW * 100) / 100))
  root.setAttribute('height', String(Math.round(sheetH * 100) / 100))
  root.setAttribute('viewBox', `0 0 ${Math.round(sheetW * 100) / 100} ${Math.round(sheetH * 100) / 100}`)

  // White sheet background
  const sheet = document.createElementNS(ns, 'rect')
  sheet.setAttribute('width', '100%')
  sheet.setAttribute('height', '100%')
  sheet.setAttribute('fill', '#ffffff')
  root.appendChild(sheet)

  // Place each board's artwork
  for (const item of layout) {
    const board = boards[item.pageIndex]
    const svg = exportBoardVectorSVG(e, board, { bleed, marks: false })
    if (!svg) continue

    // Create a group for this positioned board
    const g = document.createElementNS(ns, 'g')
    g.setAttribute('transform', `translate(${item.x},${item.y}) scale(${item.scale})`)

    // Copy all children from the board SVG
    while (svg.firstChild) {
      g.appendChild(svg.firstChild)
    }
    root.appendChild(g)
  }

  return root
}
