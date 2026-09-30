/**
 * Spot-colour separations.
 *
 * A separation is one plate: the artwork painted with a single spot colour in
 * solid black, everything else absent. That is what a printer composites, and
 * it is the only way to hand over artwork that uses spot inks — the editor's
 * spot colours are placeholder names today (there is no ink model, no
 * overprint, no CMYK conversion), so the honest deliverable is a set of
 * plates plus a note, not a fake "print-ready" PDF.
 *
 * Rendering works by repainting the document for one plate at a time and
 * restoring every paint afterwards from the values captured up front. The
 * alternative — cloning the scene into a scratch project — would have to
 * reproduce groups, patterns, gradients and clip masks exactly, and a
 * half-faithful clone produces plates that are subtly wrong in a way nobody
 * notices until the press.
 */
import type { EditorEngine } from './engine'
import type { RasterExportArea } from './types'

/** One plate to render. */
export interface Separation {
  /** The spot name as stored on the items. */
  spot: string
  /** File name stem, safe on every platform. */
  file: string
  /** How many items carry this spot. */
  items: number
}

/** What a plate render needs to hand back. */
export interface PlatePixels {
  separation: Separation
  width: number
  height: number
  /** RGBA, 4 bytes per pixel: black ink on transparent. */
  rgba: Uint8ClampedArray
  dpi: number
}

/** Characters that are unsafe in a file name on any of the usual platforms. */
const UNSAFE = /[^A-Za-z0-9._-]+/g

/** Turn a spot name into a file stem, keeping the name recognisable. */
export function separationFileName(spot: string, index: number): string {
  const cleaned = spot.trim().replace(UNSAFE, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  // Two spots can clean to the same stem ("PMS 185 C" and "PMS/185 C"), so
  // the plate number keeps the plates distinguishable in the output folder.
  return `${String(index + 1).padStart(2, '0')}-${cleaned || 'spot'}`
}

/** Case-insensitive spot name comparison, so "PMS 185" and "pms 185" are one ink. */
function spotKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The spelling to show for an ink: the object's own, whitespace collapsed. */
function spotDisplayName(data: Record<string, unknown>, key: string): string {
  for (const field of ['spotFill', 'spotStroke'] as const) {
    const raw = data[field]
    if (typeof raw === 'string' && spotKey(raw) === key) {
      return raw.trim().replace(/\s+/g, ' ')
    }
  }
  return key
}

/**
 * Every spot colour used in the document, with how many items carry it.
 * A group counts once: the plates are per ink, not per object.
 */
export function collectSeparations(e: EditorEngine): Separation[] {
  const counts = new Map<string, { display: string; items: number }>()
  const walk = (item: paper.Item) => {
    const data = (item as any).data ?? {}
    const kids = (item as any).children as paper.Item[] | undefined
    const isGroup = kids && item instanceof e.scope.Group
    if (!isGroup) {
      // One object counts once per ink, not once per field: an object with a
      // spot fill *and* a spot stroke of the same name is one object on one
      // plate.
      const inks = new Set<string>()
      for (const field of ['spotFill', 'spotStroke'] as const) {
        const raw = data[field]
        const name = typeof raw === 'string' ? raw.trim() : ''
        if (name) inks.add(spotKey(name))
      }
      for (const key of inks) {
        const display = spotDisplayName(data, key)
        const entry = counts.get(key)
        if (entry) entry.items++
        else counts.set(key, { display, items: 1 })
      }
    }
    if (kids) for (const kid of kids) walk(kid)
  }
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer) continue
    for (const child of layer.children) walk(child)
  }

  // Busiest ink first, then alphabetical: a stable order means re-running the
  // export produces the same file names.
  const ordered = [...counts.values()].sort(
    (a, b) => b.items - a.items || a.display.localeCompare(b.display)
  )
  return ordered.map((entry, index) => ({
    spot: entry.display,
    file: separationFileName(entry.display, index),
    items: entry.items,
  }))
}

/** The paint values captured before a plate render, and how to put them back. */
interface CapturedPaint {
  item: any
  fillColor: unknown
  strokeColor: unknown
  fillOpacity: number
  strokeOpacity: number
  opacity: number
  fillSpot: unknown
  strokeSpot: unknown
}

/** Walk every drawable user item, groups included. */
function eachPaintable(e: EditorEngine, fn: (item: any) => void) {
  const walk = (item: paper.Item) => {
    const kids = (item as any).children as paper.Item[] | undefined
    const isGroup = kids && item instanceof e.scope.Group
    if (
      !isGroup &&
      (item instanceof e.scope.Path ||
        item instanceof e.scope.CompoundPath ||
        item instanceof e.scope.PointText)
    ) {
      fn(item)
    }
    if (kids) for (const kid of kids) walk(kid)
  }
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer) continue
    for (const child of layer.children) walk(child)
  }
}

/**
 * Repaint the document for one plate: items carrying `spot` go solid black,
 * everything else loses its paint entirely.
 *
 * Returns the restore function, which puts back the exact values captured —
 * including the object identities, so any selection held by the caller stays
 * valid. Nothing is pushed to history: this is a render, not an edit.
 */
export function applyPlate(e: EditorEngine, spot: string): () => void {
  const key = spotKey(spot)
  const captured: CapturedPaint[] = []
  const black = new e.scope.Color('#000000')

  eachPaintable(e, (item) => {
    captured.push({
      item,
      fillColor: item.fillColor,
      strokeColor: item.strokeColor,
      fillOpacity: item.fillOpacity,
      strokeOpacity: item.strokeOpacity,
      opacity: item.opacity,
      fillSpot: item.data?.spotFill,
      strokeSpot: item.data?.spotStroke,
    })
    const onPlate =
      spotKey(String(item.data?.spotFill ?? '')) === key ||
      spotKey(String(item.data?.spotStroke ?? '')) === key
    if (!onPlate) {
      // Off-plate artwork becomes invisible rather than white: a plate is
      // alpha-keyed by the printer, and a white rectangle would print.
      item.fillColor = null
      item.strokeColor = null
      return
    }
    // On-plate artwork is solid ink at full opacity: the plate carries the
    // coverage, not the object's own tint.
    if (item.fillColor) {
      item.fillColor = black
      item.fillOpacity = 1
    }
    if (item.strokeColor) {
      item.strokeColor = black
      item.strokeOpacity = 1
    }
    item.opacity = 1
  })

  return () => {
    for (const entry of captured) {
      entry.item.fillColor = entry.fillColor
      entry.item.strokeColor = entry.strokeColor
      entry.item.fillOpacity = entry.fillOpacity
      entry.item.strokeOpacity = entry.strokeOpacity
      entry.item.opacity = entry.opacity
    }
    e.scope.view.update()
  }
}

/** The plate's bounds, matching the raster export's page/artwork rules. */
export function plateBounds(
  e: EditorEngine,
  area: RasterExportArea
): paper.Rectangle | null {
  if (area === 'artwork') {
    const items: paper.Item[] = []
    eachPaintable(e, (item) => items.push(item))
    if (items.length === 0) return null
    return items.reduce(
      (acc, item) => acc.unite(item.bounds),
      new e.scope.Rectangle(items[0].bounds.clone()) as paper.Rectangle
    )
  }
  const board =
    e.store.artboards.find((b) => b.id === e.store.activeArtboardId) ?? e.store.artboards[0]
  const page = e.store.pageSize
  const rect = board ?? { x: 0, y: 0, width: page.width, height: page.height }
  if (!(rect.width > 0) || !(rect.height > 0)) return null
  return new e.scope.Rectangle(rect.x, rect.y, rect.width, rect.height)
}

/** Millimetres per inch, for the dpi -> page-size conversion in the report. */
const MM_PER_INCH = 25.4

/** Physical size of a plate, for the manifest a printer reads. */
export function plateSize(widthPx: number, heightPx: number, dpi: number): string {
  const mmW = (widthPx / dpi) * MM_PER_INCH
  const mmH = (heightPx / dpi) * MM_PER_INCH
  return `${mmW.toFixed(1)} x ${mmH.toFixed(1)} mm`
}
