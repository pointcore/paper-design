/**
 * Spot-separation export: render one plate per ink and hand the set over as a
 * ZIP of grayscale TIFFs plus a manifest.
 *
 * Kept apart from engine-export.ts because it is a different shape of work:
 * it repaints the document between renders and restores it afterwards, and it
 * has to report a per-plate result rather than a single data URL.
 */
import type { EditorEngine } from './engine'
import type { RasterExportArea } from './types'
import { encodeTiff } from './tiff'
import {
  applyPlate,
  collectSeparations,
  plateBounds,
  plateSize,
  type PlatePixels,
  type Separation,
} from './separations'

// Re-exported so the engine facade has one import for the whole domain.
export { collectSeparations } from './separations'
export type { Separation, PlatePixels } from './separations'

/** What one plate produced, ready to be written or reported. */
export interface PlateResult extends PlatePixels {
  /** The encoded TIFF. */
  tiff: Uint8Array
  /** Physical page size at the plate's resolution. */
  physical: string
}

export interface SeparationExportResult {
  plates: Array<{ separation: Separation; physical: string; bytes: number }>
  /** True when nothing was rendered (no spots, or an empty frame). */
  empty: boolean
  /** Set when a plate could not be rendered; the others still exported. */
  warnings: string[]
}

export interface SeparationExportOptions {
  area?: RasterExportArea
  /** Output resolution. 300 is the print default; 600 doubles the file size. */
  dpi?: number
  /** Cap on the long edge in pixels, so a 600dpi A3 page cannot hang the tab. */
  maxPixels?: number
}

/**
 * Render every plate. Returns the encoded TIFFs; the caller decides whether
 * to zip them (the File menu does) or to hand them over one by one.
 *
 * The document is left exactly as it was found: each plate's repaint is
 * restored from the paints captured immediately before it, and the restore
 * runs even when the render throws.
 */
export async function exportSeparations(
  e: EditorEngine,
  options: SeparationExportOptions = {}
): Promise<{ plates: PlateResult[]; result: SeparationExportResult }> {
  const area = options.area ?? 'page'
  const separations = collectSeparations(e)
  const warnings: string[] = []
  if (separations.length === 0) {
    return { plates: [], result: { plates: [], empty: true, warnings } }
  }
  const bounds = plateBounds(e, area)
  if (!bounds || bounds.width < 1 || bounds.height < 1) {
    return {
      plates: [],
      result: { plates: [], empty: true, warnings: ['Nothing to separate: the frame is empty'] },
    }
  }

  // A plate is coverage, so 300dpi is the useful default; the pixel cap keeps
  // the canvas inside its own size limit for large pages.
  const dpi = Number.isFinite(options.dpi) && (options.dpi as number) > 0 ? (options.dpi as number) : 300
  const cap = Number.isFinite(options.maxPixels) && (options.maxPixels as number) > 0
    ? (options.maxPixels as number)
    : 6000
  const scale = Math.min(1, cap / Math.max(bounds.width, bounds.height))

  const plates: PlateResult[] = []
  for (const separation of separations) {
    const restore = applyPlate(e, separation.spot)
    try {
      const pixels = renderPlate(e, bounds, scale)
      if (!pixels) {
        warnings.push(`${separation.spot}: nothing to render`)
        continue
      }
      // Grayscale: a plate is one ink's coverage, and RGB would triple the
      // file for no information.
      const gray = new Uint8Array(pixels.width * pixels.height)
      for (let i = 0, g = 0; g < gray.length; i += 4, g++) {
        // Composite over white so the value is coverage, not premultiplied
        // darkness: an ink at 50% over a white sheet is a mid grey.
        const a = pixels.data[i + 3] / 255
        gray[g] = Math.round(255 * (1 - a))
      }
      const tiff = encodeTiff({
        width: pixels.width,
        height: pixels.height,
        rgba: gray,
        grayscale: true,
        dpi,
      })
      plates.push({
        separation,
        width: pixels.width,
        height: pixels.height,
        rgba: pixels.data,
        dpi,
        tiff,
        physical: plateSize(pixels.width, pixels.height, dpi),
      })
    } catch (err) {
      warnings.push(`${separation.spot}: ${err instanceof Error ? err.message : 'render failed'}`)
    } finally {
      restore()
    }
    // Yield between plates: each render is a synchronous canvas draw of the
    // whole page, and a document with eight inks would otherwise block the
    // tab for seconds with no way to cancel.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  return {
    plates,
    result: {
      plates: plates.map((p) => ({
        separation: p.separation,
        physical: p.physical,
        bytes: p.tiff.length,
      })),
      empty: plates.length === 0,
      warnings,
    },
  }
}

/** One synchronous render of the current document state through the view. */
function renderPlate(
  e: EditorEngine,
  bounds: paper.Rectangle,
  scale: number
): { width: number; height: number; data: Uint8ClampedArray } | null {
  const view = e.scope.view
  const prevSize = view.viewSize.clone()
  const prevCenter = view.center.clone()
  const prevZoom = view.zoom
  // Everything that is not artwork is hidden, artboard sheets included: a
  // plate is ink coverage, and a white sheet would read as solid ink across
  // the whole page (BlackIsZero: opaque = 0 = full ink).
  const hidden: paper.Layer[] = []
  for (const layer of e.project.layers) {
    const data = (layer.data as any) ?? {}
    if (!data.isUserLayer && layer.visible) {
      layer.visible = false
      hidden.push(layer)
    }
  }
  try {
    view.viewSize = new e.scope.Size(
      Math.max(1, Math.ceil(bounds.width * scale)),
      Math.max(1, Math.ceil(bounds.height * scale))
    )
    view.zoom = scale
    view.center = bounds.center
    view.update()
    const canvas = e.canvas
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const width = canvas.width
    const height = canvas.height
    if (width < 1 || height < 1) return null
    const image = ctx.getImageData(0, 0, width, height)
    return { width, height, data: image.data }
  } finally {
    for (const layer of hidden) layer.visible = true
    view.viewSize = prevSize
    view.zoom = prevZoom
    view.center = prevCenter
    view.update()
    e.refreshArtboards()
  }
}

/** The manifest a printer reads alongside the plates. */
export function separationManifest(
  plates: Array<{ separation: Separation; physical: string }>,
  area: RasterExportArea,
  dpi: number
): string {
  const lines = [
    'Spot separations',
    `Area: ${area}`,
    `Resolution: ${dpi} dpi`,
    'Colour space: single-channel coverage per plate (BlackIsZero grayscale TIFF)',
    '',
    'These plates carry coverage only. There is no ink model behind the spot',
    'names, no overprint control and no CMYK conversion, so the composite is',
    'the printer\'s job, not this export\'s.',
    '',
  ]
  for (const plate of plates) {
    lines.push(`${plate.separation.file}.tif  ${plate.separation.spot}  ${plate.physical}`)
  }
  return lines.join('\n')
}
