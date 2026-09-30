/**
 * Printer marks for print PDF export.
 *
 * The export had crop marks only, which is what a designer sees on screen: a
 * print shop also needs registration targets (so a mis-fed sheet is caught
 * before the run) and a color bar (so the press can be density-checked), plus
 * a slug line naming the job. Those live in the bleed box, outside the trim,
 * exactly as they do in a real prepress PDF.
 *
 * The geometry is pure data so it can be unit tested without a canvas: the
 * SVG writer in engine-export turns it into elements.
 */

/** A hairline stroke between two points. */
export interface MarkLine {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Stroke width; registration targets draw a heavier ring. */
  width?: number
}

/** A filled patch: one square of the color bar. */
export interface MarkPatch {
  x: number
  y: number
  size: number
  fill: string
}

/** A short text run on the slug line. */
export interface MarkText {
  x: number
  y: number
  text: string
  size: number
}

/** Everything the printer draws around one board. */
export interface PrinterMarks {
  lines: MarkLine[]
  patches: MarkPatch[]
  texts: MarkText[]
  /** Registration target centers, for tests and for callers that need them. */
  registration: Array<{ x: number; y: number }>
}

/** The classic CMYK patch set every color bar starts with. */
const CMYK_PATCHES: Array<[string, number, number, number]> = [
  ['#000000', 0, 0, 0],
  ['#00aeef', 1, 0, 0],
  ['#ec008c', 0, 1, 0],
  ['#fff200', 0, 0, 1],
  ['#1f497d', 1, 1, 0],
  ['#00a651', 0, 1, 1],
  ['#ed1c24', 1, 0, 1],
  ['#ffffff', 0, 0, 0],
]

/**
 * Registration target radius, as a fraction of the bleed band.
 *
 * The target is centred on the middle of the bleed band, so a fraction keeps
 * the whole ring outside the trim: a fixed 4pt target on a 3pt bleed would
 * straddle the trim line and print over the artwork.
 */
const REG_RADIUS_RATIO = 0.4
const REG_RADIUS_MAX = 4

/**
 * Registration target: a ring with a cross through it.
 *
 * Ring plus cross is the standard shape for a reason — it shows a shift in
 * *either* direction and in any rotation, which a cross alone or a dot alone
 * does not.
 */
function registrationMarks(x: number, y: number, radius: number): MarkLine[] {
  const r = radius
  const lines: MarkLine[] = [
    { x1: x - r, y1: y, x2: x + r, y2: y },
    { x1: x, y1: y - r, x2: x, y2: y + r },
  ]
  // The ring is drawn as chords: SVG here has no arc primitive, and a polygon
  // approximation of a circle is smaller and prints cleaner.
  const steps = 12
  for (let i = 0; i < steps; i++) {
    const a0 = (i / steps) * Math.PI * 2
    const a1 = ((i + 1) / steps) * Math.PI * 2
    lines.push({
      x1: x + Math.cos(a0) * r,
      y1: y + Math.sin(a0) * r,
      x2: x + Math.cos(a1) * r,
      y2: y + Math.sin(a1) * r,
    })
  }
  return lines
}

/**
 * Build the mark set for one board.
 *
 * `bleed` is the margin the marks live in, so the caller has to guarantee it
 * is wide enough: at the default 3pt a 4pt registration target would collide
 * with the trim, which is worse than no mark at all.
 */
export function buildPrinterMarks(opts: {
  trim: { x: number; y: number; width: number; height: number }
  bleed: number
  /** Job description for the slug line. */
  slug?: string
  /** Extra spot inks to show on the bar, in addition to CMYK. */
  spotNames?: string[]
}): PrinterMarks {
  const { trim, bleed } = opts
  const lines: MarkLine[] = []
  const patches: MarkPatch[] = []
  const texts: MarkText[] = []
  const registration: Array<{ x: number; y: number }> = []

  // The marks are drawn in the bleed box, so they scale with it: a 3pt bleed
  // gets marks that fit, a 12pt bleed gets marks you can see across a room.
  const unit = Math.max(0.5, Math.min(4, bleed))
  const len = Math.max(3, Math.min(12, bleed * 0.8))
  const x0 = trim.x
  const x1 = trim.x + trim.width
  const y0 = trim.y
  const y1 = trim.y + trim.height

  // Crop marks: hairline, flush with the page edges, inside the bleed box.
  const crops: Array<[number, number, number, number]> = [
    [x0 - bleed, y0, x0 - bleed + len, y0],
    [x0, y0 - bleed, x0, y0 - bleed + len],
    [x1 + bleed - len, y0, x1 + bleed, y0],
    [x1, y0 - bleed, x1, y0 - bleed + len],
    [x0 - bleed, y1, x0 - bleed + len, y1],
    [x0, y1 + bleed - len, x0, y1 + bleed],
    [x1 + bleed - len, y1, x1 + bleed, y1],
    [x1, y1 + bleed - len, x1, y1 + bleed],
  ]
  for (const [ax, ay, bx, by] of crops) {
    lines.push({ x1: ax, y1: ay, x2: bx, y2: by, width: 0.5 })
  }

  // Registration targets at the four edge midpoints, centred in the bleed
  // band so the ring never reaches the trim.
  const midX = (x0 + x1) / 2
  const midY = (y0 + y1) / 2
  const regRadius = Math.min(REG_RADIUS_MAX, bleed * REG_RADIUS_RATIO)
  const spots: Array<[number, number]> = [
    [midX, y0 - bleed * 0.5],
    [midX, y1 + bleed * 0.5],
    [x0 - bleed * 0.5, midY],
    [x1 + bleed * 0.5, midY],
  ]
  for (const [x, y] of spots) {
    registration.push({ x, y })
    lines.push(...registrationMarks(x, y, regRadius).map((l) => ({ ...l, width: 0.5 })))
  }

  // Color bar along the top edge, in the bleed box: CMYK solids, the three
  // tint ramps a press operator actually checks (75/50/25 of each), and any
  // spot inks the document uses.
  const patch = Math.max(1, unit * 0.9)
  const gap = Math.max(0.4, unit * 0.25)
  let cursor = x0 - bleed + gap
  const barY = y0 - bleed + gap * 0.5
  for (const [fill] of CMYK_PATCHES) {
    patches.push({ x: cursor, y: barY, size: patch, fill })
    cursor += patch + gap
  }
  // Tint ramps, 100/75/50/25 in one patch column each.
  for (let ink = 0; ink < 4; ink++) {
    for (const tint of [1, 0.75, 0.5, 0.25]) {
      const cmyk = [0, 0, 0, 0]
      cmyk[ink] = tint
      patches.push({ x: cursor, y: barY, size: patch, fill: cmykCss(cmyk) })
      cursor += patch + gap
    }
  }
  for (const name of opts.spotNames ?? []) {
    // A real ink value is not knowable here (spot colors are placeholders in
    // this editor), so the bar shows a neutral chip with the ink's position
    // marked by a hole, which is what tells the press the separation exists.
    patches.push({ x: cursor, y: barY, size: patch, fill: '#b0b0b0' })
    cursor += patch + gap
  }

  // Slug line: job name on the bottom edge, so a separated sheet identifies
  // itself even if the color bar is trimmed off.
  const slug = (opts.slug ?? '').slice(0, 80)
  if (slug) {
    texts.push({
      x: x0 - bleed + gap,
      y: y1 + bleed - gap * 0.5,
      text: slug,
      size: Math.max(2, unit * 0.8),
    })
  }

  return { lines, patches, texts, registration }
}

/** CMYK (0-1) to a CSS color, the same naive conversion the panel previews. */
function cmykCss(cmyk: number[]): string {
  const [c, m, y, k] = cmyk
  const r = Math.round(255 * (1 - Math.min(1, c + k)))
  const g = Math.round(255 * (1 - Math.min(1, m + k)))
  const b = Math.round(255 * (1 - Math.min(1, y + k)))
  return `rgb(${r},${g},${b})`
}
