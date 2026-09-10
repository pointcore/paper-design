/**
 * Central cursor catalog — AI-aligned tool / scene cursors.
 *
 * Illustrator conventions mapped onto CSS + SVG data-URL cursors:
 * - select: plain arrow (`default`); direct-select: white arrow (custom SVG)
 * - pen family: pen-nib SVG with +/- badges for add/delete anchor
 * - text: `text` / `vertical-text` (native I-beam)
 * - shapes / measure / callout: `crosshair`
 * - brush / blob-brush / eraser: precision ring sized to the tool diameter
 *   (AI shows the brush footprint instead of an arrow)
 * - scissors / eyedropper / pencil / curvature / convert-anchor: tool-icon SVG
 * - hand: `grab` / `grabbing`; zoom: `zoom-in` / `zoom-out` (Alt toggles)
 * - scene overrides: transform handles -> resize cursors, guides -> move /
 *   axis resize, object drag -> `move`
 */
import type { ToolName } from './types'

/** Encode an SVG document into a data URL safe for CSS url(). */
function svgUrl(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Wrap a data URL + hotspot + CSS fallback into a cursor value. */
function svgCursor(svg: string, hotX: number, hotY: number, fallback: string): string {
  return `url("${svgUrl(svg)}") ${hotX} ${hotY}, ${fallback}`
}

// ------------------------------------------------------------------
// Tool-icon SVGs (24x24, white fill + black stroke stays visible on both
// the dark canvas chrome and white artboards, like Illustrator).
// ------------------------------------------------------------------

const DIRECT_SELECT_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M7 3 L7 19 L11 15 L13.5 20 L16 18.8 L13.5 13.8 L18 13.8 Z' fill='white' stroke='black' stroke-width='1.6' stroke-linejoin='round'/></svg>`

const PEN_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M4 20 L5.5 14.5 L15.5 4.5 L19.5 8.5 L9.5 18.5 Z' fill='white' stroke='black' stroke-width='1.4' stroke-linejoin='round'/><path d='M4 20 L9.5 18.5 L6 15 Z' fill='black'/></svg>`

const PEN_PLUS_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'><path d='M4 20 L5.5 14.5 L15.5 4.5 L19.5 8.5 L9.5 18.5 Z' fill='white' stroke='black' stroke-width='1.4' stroke-linejoin='round'/><path d='M4 20 L9.5 18.5 L6 15 Z' fill='black'/><rect x='16' y='16' width='9' height='9' rx='1.5' fill='white' stroke='black' stroke-width='1.1'/><path d='M20.5 17.8 V23.2 M17.8 20.5 H23.2' stroke='black' stroke-width='1.4' stroke-linecap='round'/></svg>`

const PEN_MINUS_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'><path d='M4 20 L5.5 14.5 L15.5 4.5 L19.5 8.5 L9.5 18.5 Z' fill='white' stroke='black' stroke-width='1.4' stroke-linejoin='round'/><path d='M4 20 L9.5 18.5 L6 15 Z' fill='black'/><rect x='16' y='16' width='9' height='9' rx='1.5' fill='white' stroke='black' stroke-width='1.1'/><path d='M17.8 20.5 H23.2' stroke='black' stroke-width='1.4' stroke-linecap='round'/></svg>`

const PEN_CONTINUE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'><path d='M4 20 L5.5 14.5 L15.5 4.5 L19.5 8.5 L9.5 18.5 Z' fill='white' stroke='black' stroke-width='1.4' stroke-linejoin='round'/><path d='M4 20 L9.5 18.5 L6 15 Z' fill='black'/><path d='M17 16 L23 23' stroke='black' stroke-width='1.6' stroke-linecap='round'/><path d='M17 16 L23 23' stroke='white' stroke-width='0.6' stroke-linecap='round'/></svg>`

const CURVATURE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M4 19 Q9 5 13 12 T21 7' fill='none' stroke='black' stroke-width='1.8' stroke-linecap='round'/><path d='M4 19 Q9 5 13 12 T21 7' fill='none' stroke='white' stroke-width='0.7' stroke-linecap='round'/><circle cx='4' cy='19' r='2.2' fill='white' stroke='black' stroke-width='1.2'/><circle cx='13' cy='12' r='2.2' fill='white' stroke='black' stroke-width='1.2'/><circle cx='21' cy='7' r='2.2' fill='white' stroke='black' stroke-width='1.2'/></svg>`

const CONVERT_ANCHOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M6 14 L12 5 L18 14' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/><path d='M6 14 L12 5 L18 14' fill='none' stroke='white' stroke-width='0.7' stroke-linecap='round' stroke-linejoin='round'/><path d='M8 19 H16 M8 19 L10.5 17 M8 19 L10.5 21 M16 19 L13.5 17 M16 19 L13.5 21' stroke='black' stroke-width='1.4' stroke-linecap='round' fill='none'/></svg>`

const PENCIL_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M4 20 L6.2 15.2 L16 5.4 L18.6 8 L8.8 17.8 Z' fill='#FFC825' stroke='black' stroke-width='1.3' stroke-linejoin='round'/><path d='M4 20 L6.2 15.2 L8.8 17.8 Z' fill='#E8C39E' stroke='black' stroke-width='1'/><circle cx='5.4' cy='18.6' r='0.9' fill='black'/><path d='M16 5.4 L18.6 8 L17.4 9.2 L14.8 6.6 Z' fill='#F2768B' stroke='black' stroke-width='1'/></svg>`

const SCISSORS_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><circle cx='6' cy='6' r='2.4' fill='white' stroke='black' stroke-width='1.3'/><circle cx='6' cy='18' r='2.4' fill='white' stroke='black' stroke-width='1.3'/><path d='M8.2 7.2 L20 17 M8.2 16.8 L20 7' stroke='black' stroke-width='1.7' stroke-linecap='round'/></svg>`

const EYEDROPPER_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M14 3 L21 10 L11 20 L9 18 L17 10 L14 7 L6 15 L4 13 Z' fill='white' stroke='black' stroke-width='1.3' stroke-linejoin='round'/><path d='M4 13 L2 22 L11 20 L9 18 L6 15 Z' fill='white' stroke='black' stroke-width='1.3' stroke-linejoin='round'/></svg>`

// Tilted-frame affordances (32px): black fill with a thin white outline —
// black core underneath, white edge on top. Strokes stay chunky enough to
// rasterize smooth; hairlines shimmer and alias at cursor size.
const ROTATE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32' shape-rendering='geometricPrecision'><path d='M26 16 A10 10 0 1 1 16 6' fill='none' stroke='white' stroke-width='4.2' stroke-linecap='round'/><path d='M26 16 A10 10 0 1 1 16 6' fill='none' stroke='black' stroke-width='2.6' stroke-linecap='round'/><path d='M21.5 6 L16.3 2.6 L16.3 9.4 Z' fill='black' stroke='white' stroke-width='1' stroke-linejoin='round'/></svg>`

// ------------------------------------------------------------------
// Named cursors (CSS value ready to assign to canvas.style.cursor)
// ------------------------------------------------------------------

/** White-arrow cursor for direct-select (AI shows a hollow arrow). */
export const CURSOR_DIRECT_SELECT = svgCursor(DIRECT_SELECT_SVG, 7, 3, 'default')
/** Pen nib (AI pen tool). Hotspot sits on the nib tip. */
export const CURSOR_PEN = svgCursor(PEN_SVG, 4, 20, 'crosshair')
/** Pen nib with a continue slash (hovering an open endpoint). */
export const CURSOR_PEN_CONTINUE = svgCursor(PEN_CONTINUE_SVG, 4, 20, 'copy')
/** Add-anchor: pen nib with a + badge. */
export const CURSOR_ADD_ANCHOR = svgCursor(PEN_PLUS_SVG, 4, 20, 'copy')
/** Delete-anchor: pen nib with a - badge. */
export const CURSOR_DELETE_ANCHOR = svgCursor(PEN_MINUS_SVG, 4, 20, 'pointer')
/** Curvature tool: through-point curve with anchors. */
export const CURSOR_CURVATURE = svgCursor(CURVATURE_SVG, 4, 19, 'crosshair')
/** Convert-anchor: caret with a double arrow. */
export const CURSOR_CONVERT_ANCHOR = svgCursor(CONVERT_ANCHOR_SVG, 12, 12, 'pointer')
/** Pencil tool icon. */
export const CURSOR_PENCIL = svgCursor(PENCIL_SVG, 4, 20, 'crosshair')
/** Scissors tool icon (hotspot at the blade crossing). */
export const CURSOR_SCISSORS = svgCursor(SCISSORS_SVG, 12, 12, 'pointer')
/** Eyedropper tool icon (hotspot at the dropper tip). */
export const CURSOR_EYEDROPPER = svgCursor(EYEDROPPER_SVG, 2, 22, 'crosshair')
/** Rotate affordance: circular arrow (32px black, thin white edge), hotspot at center. */
export const CURSOR_ROTATE = svgCursor(ROTATE_SVG, 16, 16, 'grab')

/**
 * Precision ring cursor for size-based tools (brush / blob-brush / eraser).
 * Illustrator draws the tool footprint; the ring diameter matches the screen
 * pixel size plus a center dot for exact placement. The double stroke
 * (white halo + dark ring) stays visible on white artboards and dark chrome.
 */
export function ringCursor(diameterPx: number, fallback = 'crosshair'): string {
  const d = Math.max(6, Math.round(diameterPx))
  const pad = 4
  const size = d + pad * 2
  const c = size / 2
  const r = d / 2
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='0 0 ${size} ${size}'>` +
    `<circle cx='${c}' cy='${c}' r='${r}' fill='none' stroke='white' stroke-width='2.4' opacity='0.9'/>` +
    `<circle cx='${c}' cy='${c}' r='${r}' fill='none' stroke='black' stroke-width='1.3'/>` +
    `<circle cx='${c}' cy='${c}' r='1.1' fill='black'/>` +
    `<circle cx='${c}' cy='${c}' r='1.1' fill='none' stroke='white' stroke-width='0.5'/>` +
    `</svg>`
  return svgCursor(svg, c, c, fallback)
}

/** Default ring diameters (screen px) mirroring each tool's paint width. */
export const BRUSH_RING_PX = 20
export const BLOB_RING_PX = 20
export const ERASER_RING_PX = 20

// ------------------------------------------------------------------
// Exact-angle resize arrows (tilted-frame corners)
// ------------------------------------------------------------------

/** Cache of exact-angle resize cursors by folded integer degree. */
const arrowCursorCache = new Map<number, string>()

function fmt1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Double-headed straight-arrow cursor pointing exactly along `angleDeg`
 * (clockwise degrees from east, screen coords). Corners of a tilted
 * selection resize along their 45° bisector, which rarely lands on one of
 * the four native resize cursors — this arrow matches it exactly at 32px:
 * black fill with a thin white outline. Hotspot sits at the arrow center.
 * Results cache by integer degree.
 */
export function arrowResizeCursor(angleDeg: number, fallback = 'nwse-resize'): string {
  const folded = ((angleDeg % 180) + 180) % 180
  const key = Math.round(folded) % 180
  const hit = arrowCursorCache.get(key)
  if (hit) return hit
  const a = (key * Math.PI) / 180
  const ux = Math.cos(a)
  const uy = Math.sin(a)
  const nx = -uy
  const ny = ux
  const cx = 16
  const cy = 16
  const shaft = 8.5
  const tip = 11.5
  const base = 7
  const half = 3.4
  const pt = (x: number, y: number) => `${fmt1(x)},${fmt1(y)}`
  const x1 = cx - ux * shaft
  const y1 = cy - uy * shaft
  const x2 = cx + ux * shaft
  const y2 = cy + uy * shaft
  const heads = [1, -1]
    .map((s) => {
      const tx = cx + s * ux * tip
      const ty = cy + s * uy * tip
      const bx = cx + s * ux * base
      const by = cy + s * uy * base
      return `<polygon points='${pt(tx, ty)} ${pt(bx + nx * half, by + ny * half)} ${pt(bx - nx * half, by - ny * half)}' fill='black' stroke='white' stroke-width='1' stroke-linejoin='round'/>`
    })
    .join('')
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32' shape-rendering='geometricPrecision'>` +
    `<line x1='${fmt1(x1)}' y1='${fmt1(y1)}' x2='${fmt1(x2)}' y2='${fmt1(y2)}' stroke='white' stroke-width='3.6' stroke-linecap='round'/>` +
    `<line x1='${fmt1(x1)}' y1='${fmt1(y1)}' x2='${fmt1(x2)}' y2='${fmt1(y2)}' stroke='black' stroke-width='2' stroke-linecap='round'/>` +
    heads +
    `</svg>`
  const cursor = svgCursor(svg, cx, cy, fallback)
  arrowCursorCache.set(key, cursor)
  return cursor
}

// ------------------------------------------------------------------
// Tool -> default cursor (AI-aligned)
// ------------------------------------------------------------------

function buildToolCursors(): Record<ToolName, string> {
  const crosshair = 'crosshair'
  const brushRing = ringCursor(BRUSH_RING_PX)
  const blobRing = ringCursor(BLOB_RING_PX)
  const eraserRing = ringCursor(ERASER_RING_PX, 'cell')
  return {
    select: 'default',
    'direct-select': CURSOR_DIRECT_SELECT,
    lasso: crosshair,
    pen: CURSOR_PEN,
    curvature: CURSOR_CURVATURE,
    'add-anchor': CURSOR_ADD_ANCHOR,
    'delete-anchor': CURSOR_DELETE_ANCHOR,
    'convert-anchor': CURSOR_CONVERT_ANCHOR,
    type: 'text',
    'area-type': 'text',
    'type-on-path': 'text',
    'vertical-type': 'vertical-text',
    line: crosshair,
    rect: crosshair,
    'rounded-rect': crosshair,
    ellipse: crosshair,
    polygon: crosshair,
    arc: crosshair,
    spiral: crosshair,
    'rect-grid': crosshair,
    'polar-grid': crosshair,
    pencil: CURSOR_PENCIL,
    gradient: crosshair,
    wand: crosshair,
    'blob-brush': blobRing,
    brush: brushRing,
    eraser: eraserRing,
    scissors: CURSOR_SCISSORS,
    width: crosshair,
    rotate: CURSOR_ROTATE,
    scale: crosshair,
    mirror: crosshair,
    'free-transform': crosshair,
    'view-hand': 'grab',
    zoom: 'zoom-in',
    measure: crosshair,
    callout: crosshair,
    'shape-builder': crosshair,
    eyedropper: CURSOR_EYEDROPPER,
  }
}

export const TOOL_CURSORS: Record<ToolName, string> = buildToolCursors()

/** Default cursor for a tool (falls back to `default`). */
export function cursorForTool(tool: ToolName): string {
  return TOOL_CURSORS[tool] ?? 'default'
}

/** Zoom tool cursor: Alt / right-click zooms out (AI convention). */
export function zoomCursor(isZoomOut: boolean): string {
  return isZoomOut ? 'zoom-out' : 'zoom-in'
}

/** Hand tool cursor: open hand at rest, closed fist while panning. */
export function handCursor(isDragging: boolean): string {
  return isDragging ? 'grabbing' : 'grab'
}

/** Assign a cursor value to the canvas element. */
export function setCanvasCursor(canvas: HTMLCanvasElement | null | undefined, cursor: string): void {
  if (canvas) canvas.style.cursor = cursor
}

/** Apply the AI-aligned default cursor for a tool to the canvas. */
export function applyToolCursor(canvas: HTMLCanvasElement | null | undefined, tool: ToolName): void {
  setCanvasCursor(canvas, cursorForTool(tool))
}
