/**
 * Placed-image domain (C1: slice out of engine.ts).
 *
 * Bitmap placement, asset extraction, destructive pixel edits (adjust /
 * downsample / replace) with their session-only pre-edit stash, raster
 * identity stamping and bitmap tracing: each function takes the engine as
 * an explicit first argument and otherwise runs the historical method
 * body unchanged. The EditorEngine import is type-only, so the runtime
 * dependency flows one way (engine → engine-images).
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import { yieldToUI } from './busy'
import {
  TRACE_MIN_DIM,
  cleanTraceOptions,
  countTracePaths,
  fitTraceSize,
  traceImageData,
  type TraceImage,
  type TraceOptions,
} from './trace'
import type { ImageTracerInstance } from 'imagetracerjs'
import { unitedBoundsOf } from './engine-arrange'

/**
 * Place a bitmap image into the active layer, centered on the current
 * view. The data URL source embeds the pixels so the image survives
 * history and save/reload round-trips. Selection and history land once
 * the pixels load.
 */
export function placeImage(e: EditorEngine, dataUrl: string, at?: paper.Point): void {
  const raster = new e.scope.Raster({ source: dataUrl }) as paper.Raster
  e.getActiveLayer().addChild(raster)
  e.stampRasterIdentity(raster)
  raster.onLoad = () => {
    raster.position = (at ?? e.scope.view.center).clone()
    e.stampRasterIdentity(raster)
    e.selectItem(raster)
    e.pushHistory('Place Image')
    e.showStatus('Image placed')
  }
  raster.onError = () => {
    raster.remove()
    e.showStatus('Image placement failed')
  }
}

/**
 * First selected raster as a downloadable PNG (AI asset extraction
 * parity). Reads back the raster canvas, so cross-origin-tainted
 * images resolve null instead of throwing. No history (read-only).
 */
export function extractSelectedImage(e: EditorEngine): { url: string; filename: string } | null {
  const scope = e.scope
  const find = (node: paper.Item): paper.Raster | null => {
    if ((node as any).locked) return null
    if (node instanceof scope.Raster) return node
    const children = (node as any).children as paper.Item[] | undefined
    if (children) {
      for (const child of children) {
        const hit = find(child)
        if (hit) return hit
      }
    }
    return null
  }
  for (const item of e.getSelection()) {
    const raster = find(item)
    if (!raster) continue
    try {
      const url = (raster as any).canvas?.toDataURL?.('image/png') as string | undefined
      if (!url || typeof url !== 'string' || !url.startsWith('data:')) continue
      const data = (raster as any).data ?? {}
      const raw = (raster as any).name ?? data.name
      const stem = typeof raw === 'string' && raw.trim() ? raw.trim().replace(/[\\/:*?"<>|]+/g, '-') : 'image'
      return { url, filename: `${stem}.png` }
    } catch {
      continue
    }
  }
  return null
}

/**
 * Repaint the first selected raster through a canvas 2D filter
 * (bitmap-effects lite): grayscale / sepia / invert plus brightness.
 * The filtered copy replaces the original at the same slot (a no-op
 * preset at 100% brightness resolves false). Tainted sources fail
 * gracefully with a status message and no history.
 */
export function adjustImage(
  e: EditorEngine,
  preset: 'none' | 'gray' | 'sepia' | 'invert',
  brightness: number,
): boolean {
  const scope = e.scope
  const b = Number.isFinite(brightness) ? Math.min(150, Math.max(50, brightness)) : 100
  if (preset === 'none' && b === 100) return false
  const find = (node: paper.Item): paper.Raster | null => {
    if ((node as any).locked || !node.parent) return null
    if (node instanceof scope.Raster) return node
    const children = (node as any).children as paper.Item[] | undefined
    if (children) {
      for (const child of children) {
        const hit = find(child)
        if (hit) return hit
      }
    }
    return null
  }
  let source: paper.Raster | null = null
  for (const item of e.getSelection()) {
    source = find(item)
    if (source) break
  }
  if (!source) return false
  const canvas = (source as any).canvas as HTMLCanvasElement | undefined
  if (!canvas || canvas.width < 1 || canvas.height < 1) return false
  const parts: string[] = []
  if (preset === 'gray') parts.push('grayscale(1)')
  else if (preset === 'sepia') parts.push('sepia(1)')
  else if (preset === 'invert') parts.push('invert(1)')
  if (b !== 100) parts.push(`brightness(${Math.round((b / 100) * 100) / 100})`)
  if (parts.length === 0) return false
  e.stashOriginalSource(source)
  let url: string | null = null
  try {
    const out = document.createElement('canvas')
    out.width = canvas.width
    out.height = canvas.height
    const ctx = out.getContext('2d')
    if (!ctx) return false
    ctx.filter = parts.join(' ')
    ctx.drawImage(canvas, 0, 0)
    url = out.toDataURL('image/png')
  } catch {
    e.showStatus('Image adjust failed (unreadable pixels)')
    return false
  }
  if (!url) return false
  const parent = source.parent ?? e.getActiveLayer()
  const at = parent.children.indexOf(source as any)
  const opacity = (source as any).opacity
  const next = new scope.Raster({ source: url }) as paper.Raster
  parent.insertChild(Math.min(Math.max(at, 0), parent.children.length), next as any)
  e.stampRasterIdentity(next)
  next.onLoad = () => {
    next.position = (source as paper.Raster).position.clone()
    next.opacity = opacity
    e.stampRasterIdentity(next)
    e.carryImageStash(source as paper.Raster, next)
    try {
      ;(source as paper.Raster).remove()
    } catch { /* already gone */ }
    e.clearSelection()
    next.selected = true
    e.syncSelectionToStore()
    e.pushHistory('Adjust Image')
    e.scope.view.update()
    e.showStatus('Image adjusted')
  }
  next.onError = () => {
    try {
      next.remove()
    } catch { /* already gone */ }
    e.showStatus('Image adjust failed')
  }
  return true
}

/**
 * Downsample every selected raster to a fraction of its pixels (file /
 * history diet for photo-heavy documents): each raster re-encodes at
 * `factor` and scales back into its old bounds at the same slot.
 * Tainted sources fail gracefully per item. Histories record once when
 * all loads settle. Returns rasters queued.
 */
export function downsampleImages(e: EditorEngine, factor: number): number {
  const scope = e.scope
  const f = Number.isFinite(factor) ? Math.min(0.75, Math.max(0.25, factor)) : 0.5
  const targets: paper.Raster[] = []
  const walk = (node: paper.Item) => {
    if ((node as any).locked || !node.parent) return
    if (node instanceof scope.Raster) {
      targets.push(node)
      return
    }
    const children = (node as any).children as paper.Item[] | undefined
    if (children) for (const child of children) walk(child)
  }
  for (const item of e.getSelection()) walk(item)
  if (targets.length === 0) return 0
  let pending = targets.length
  let done = 0
  const finished: paper.Item[] = []
  const settle = (ok: boolean) => {
    if (ok) done++
    pending--
    if (pending === 0) {
      if (done > 0) {
        e.pushHistory('Downsample Images')
        e.scope.view.update()
        e.showStatus(`Downsampled ${done} image${done === 1 ? '' : 's'}`)
      } else {
        e.showStatus('Downsample failed')
      }
    }
  }
  for (const source of targets) {
    const canvas = (source as any).canvas as HTMLCanvasElement | undefined
    const bounds = (source as any).bounds as paper.Rectangle | undefined
    if (!canvas || canvas.width < 2 || canvas.height < 2 || !bounds) {
      settle(false)
      continue
    }
    e.stashOriginalSource(source)
    let url: string | null = null
    try {
      const out = document.createElement('canvas')
      out.width = Math.max(1, Math.round(canvas.width * f))
      out.height = Math.max(1, Math.round(canvas.height * f))
      const ctx = out.getContext('2d')
      if (!ctx) {
        settle(false)
        continue
      }
      ctx.drawImage(canvas, 0, 0, out.width, out.height)
      url = out.toDataURL('image/png')
    } catch {
      settle(false)
      continue
    }
    const parent = source.parent ?? e.getActiveLayer()
    const at = parent.children.indexOf(source as any)
    const opacity = (source as any).opacity
    const next = new scope.Raster({ source: url }) as paper.Raster
    parent.insertChild(Math.min(Math.max(at, 0), parent.children.length), next as any)
    e.stampRasterIdentity(next)
    next.onLoad = () => {
      const nb = (next as any).bounds as paper.Rectangle | undefined
      if (nb && nb.width > 0 && nb.height > 0) {
        next.scale(bounds.width / nb.width, bounds.height / nb.height)
      }
      next.position = bounds.center.clone()
      next.opacity = opacity
      e.stampRasterIdentity(next)
      e.carryImageStash(source, next)
      try {
        source.remove()
      } catch { /* already gone */ }
      finished.push(next as paper.Item)
      e.clearSelection()
      finished.forEach((item) => {
        item.selected = true
      })
      e.syncSelectionToStore()
      settle(true)
    }
    next.onError = () => {
      try {
        next.remove()
      } catch { /* already gone */ }
      settle(false)
    }
  }
  return targets.length
}

/**
 * Restore the stashed pre-edit pixels of the first selected raster
 * (one level). Returns false with nothing to restore. The stash is
 * session-only, so this survives undo/redo of the destructive op but not
 * a save + reload (the op itself is still undoable through history).
 */
export function resetImage(e: EditorEngine): boolean {
  const scope = e.scope
  const stashedId = (node: paper.Item): string | null => {
    const id = (node as any).data?.id as string | undefined
    return id && e.imageStash.has(id) ? id : null
  }
  const find = (node: paper.Item): paper.Raster | null => {
    if ((node as any).locked || !node.parent) return null
    if (node instanceof scope.Raster) return stashedId(node) ? node : null
    const children = (node as any).children as paper.Item[] | undefined
    if (children) {
      for (const child of children) {
        const hit = find(child)
        if (hit) return hit
      }
    }
    return null
  }
  let source: paper.Raster | null = null
  for (const item of e.getSelection()) {
    source = find(item)
    if (source) break
  }
  if (!source) return false
  const url = e.imageStash.get(stashedId(source) as string)
  if (!url) return false
  const bounds = (source as any).bounds as paper.Rectangle | undefined
  if (!bounds || bounds.width < 1 || bounds.height < 1) return false
  const parent = source.parent ?? e.getActiveLayer()
  const at = parent.children.indexOf(source as any)
  const opacity = (source as any).opacity
  const next = new scope.Raster({ source: url }) as paper.Raster
  parent.insertChild(Math.min(Math.max(at, 0), parent.children.length), next as any)
  e.stampRasterIdentity(next)
  next.onLoad = () => {
    const nb = (next as any).bounds as paper.Rectangle | undefined
    if (nb && nb.width > 0 && nb.height > 0) {
      next.scale(bounds.width / nb.width, bounds.height / nb.height)
    }
    next.position = bounds.center.clone()
    next.opacity = opacity
    e.stampRasterIdentity(next)
    // Keep the stash reachable under the new id so Reset Image stays
    // repeatable instead of burning itself on the first use.
    e.carryImageStash(source as paper.Raster, next)
    try {
      ;(source as paper.Raster).remove()
    } catch { /* already gone */ }
    e.clearSelection()
    next.selected = true
    e.syncSelectionToStore()
    e.pushHistory('Reset Image')
    e.scope.view.update()
    e.showStatus('Image restored')
  }
  next.onError = () => {
    try {
      next.remove()
    } catch { /* already gone */ }
    e.showStatus('Image restore failed')
  }
  return true
}

/**
 * Swap the first selected raster's pixels for a new file (relink
 * parity): the replacement scales into the old bounds at the same
 * slot, opacity and selection carry over. Tainted/empty files fail
 * gracefully. Returns false when nothing was queued.
 */
export function replaceSelectedImage(e: EditorEngine, dataUrl: string): boolean {
  const scope = e.scope
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return false
  const find = (node: paper.Item): paper.Raster | null => {
    if ((node as any).locked || !node.parent) return null
    if (node instanceof scope.Raster) return node
    const children = (node as any).children as paper.Item[] | undefined
    if (children) {
      for (const child of children) {
        const hit = find(child)
        if (hit) return hit
      }
    }
    return null
  }
  let source: paper.Raster | null = null
  for (const item of e.getSelection()) {
    source = find(item)
    if (source) break
  }
  if (!source) return false
  const bounds = (source as any).bounds as paper.Rectangle | undefined
  if (!bounds || bounds.width < 1 || bounds.height < 1) return false
  e.stashOriginalSource(source)
  const parent = source.parent ?? e.getActiveLayer()
  const at = parent.children.indexOf(source as any)
  const opacity = (source as any).opacity
  const next = new scope.Raster({ source: dataUrl }) as paper.Raster
  parent.insertChild(Math.min(Math.max(at, 0), parent.children.length), next as any)
  e.stampRasterIdentity(next)
  next.onLoad = () => {
    const nb = (next as any).bounds as paper.Rectangle | undefined
    if (nb && nb.width > 0 && nb.height > 0) {
      next.scale(bounds.width / nb.width, bounds.height / nb.height)
    }
    next.position = bounds.center.clone()
    next.opacity = opacity
    e.stampRasterIdentity(next)
    e.carryImageStash(source as paper.Raster, next)
    try {
      ;(source as paper.Raster).remove()
    } catch { /* already gone */ }
    e.clearSelection()
    next.selected = true
    e.syncSelectionToStore()
    e.pushHistory('Replace Image')
    e.scope.view.update()
    e.showStatus('Image replaced')
  }
  next.onError = () => {
    try {
      next.remove()
    } catch { /* already gone */ }
    e.showStatus('Image replacement failed')
  }
  return true
}

/**
 * Trace the single selected bitmap into vector paths with the local
 * imagetracerjs build (lazy-loaded, so the main bundle stays untouched).
 * The traced artwork replaces the raster at its bounds with one history
 * entry. Returns the traced path count, or null when nothing traceable
 * is selected, pixels are unreadable, or the trace yields no paths —
 * failures never modify the document.
 */
export async function traceSelectedRaster(
  e: EditorEngine,
  opts: TraceOptions,
): Promise<{ paths: number } | null> {
  const scope = e.scope
  const rasters = e.getSelection().filter(
    (item) => !item.locked && item.parent && item instanceof scope.Raster
  ) as paper.Raster[]
  if (rasters.length !== 1) return null
  const raster = rasters[0]
  const options = cleanTraceOptions(opts)
  // Read (and downscale past the cap) off the raster's own canvas, so
  // the trace sees exactly the placed pixels at their placed aspect.
  let img: TraceImage | null = null
  try {
    const canvas = (raster as unknown as { canvas?: HTMLCanvasElement }).canvas
    if (!canvas || canvas.width < TRACE_MIN_DIM || canvas.height < TRACE_MIN_DIM) return null
    const fit = fitTraceSize(canvas.width, canvas.height)
    if (fit.width < TRACE_MIN_DIM || fit.height < TRACE_MIN_DIM) return null
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    if (fit.width === canvas.width && fit.height === canvas.height) {
      const full = ctx.getImageData(0, 0, canvas.width, canvas.height)
      img = { width: full.width, height: full.height, data: full.data }
    } else {
      const tmp = document.createElement('canvas')
      tmp.width = fit.width
      tmp.height = fit.height
      const tctx = tmp.getContext('2d')
      if (!tctx) return null
      tctx.drawImage(canvas, 0, 0, fit.width, fit.height)
      const small = tctx.getImageData(0, 0, fit.width, fit.height)
      img = { width: small.width, height: small.height, data: small.data }
    }
  } catch {
    // Tainted or otherwise unreadable canvas: leave the document alone.
    return null
  }
  if (!img) return null
  await yieldToUI()
  let svg: string
  try {
    const mod = await import('imagetracerjs')
    const tracer = ((mod as unknown as { default?: unknown }).default ?? mod) as ImageTracerInstance
    if (!tracer || typeof tracer.imagedataToSVG !== 'function') return null
    svg = traceImageData(img, options, (pixels, itOpts) => tracer.imagedataToSVG(pixels, itOpts))
  } catch {
    return null
  }
  const paths = countTracePaths(svg)
  if (paths === 0) return null
  const bounds = raster.bounds ? raster.bounds.clone() : null
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
  const parent = raster.parent ?? e.getActiveLayer()
  const rawAt = parent.children.indexOf(raster as unknown as paper.Item)
  const at = rawAt < 0 ? parent.children.length : rawAt
  let imported: paper.Item | paper.Item[]
  try {
    imported = e.project.importSVG(svg)
  } catch {
    return null
  }
  const items = (Array.isArray(imported) ? imported : [imported]).filter(Boolean) as paper.Item[]
  if (items.length === 0) return null
  // Refit input-px artwork onto the raster bounds: normalize to the
  // origin, scale to the placed size, then move into place.
  const united = unitedBoundsOf(items)
  if (!united || united.width <= 0 || united.height <= 0) {
    for (const item of items) item.remove()
    return null
  }
  const toOrigin = new scope.Point(-united.x, -united.y)
  const sx = bounds.width / united.width
  const sy = bounds.height / united.height
  const toPlace = new scope.Point(bounds.x, bounds.y)
  for (const item of items) {
    item.translate(toOrigin)
    item.scale(sx, sy, new scope.Point(0, 0))
    item.translate(toPlace)
    e.restampCloneTree(item)
    if (!(item as unknown as { data?: unknown }).data) {
      ;((item as unknown as { data?: unknown }).data as Record<string, unknown>) = {}
    }
    const data = (item as unknown as { data: Record<string, unknown> }).data
    data.id = e.genId()
    data.isUserItem = true
  }
  raster.remove()
  items.forEach((item, i) => {
    parent.insertChild(Math.min(at + i, parent.children.length), item as unknown as paper.Item)
  })
  e.syncLayersToStore()
  e.clearSelection()
  items.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  e.pushHistory('Trace Bitmap')
  e.scope.view.update()
  return { paths }
}
