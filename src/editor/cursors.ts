/**
 * Central cursor catalog — AI/CDR-aligned tool / scene cursors.
 *
 * Illustrator/CorelDRAW conventions mapped onto CSS + SVG data-URL cursors:
 * - select: plain arrow (`default`); direct-select: white arrow (custom SVG)
 * - pen family: pen-nib SVG with +/- badges for add/delete anchor
 * - text: `text` / `vertical-text` (native I-beam)
 * - shapes / measure / callout: `crosshair` (AI shows a plain crosshair for
 *   the shape tools, so the shapes stay native)
 * - brush / blob-brush / eraser: precision ring sized to the tool diameter
 *   (AI shows the brush footprint instead of an arrow)
 * - scissors / eyedropper / pencil / curvature / convert-anchor / wand /
 *   lasso / knife / width / spray / gradient / scale / mirror / free-transform /
 *   smooth / reshape / shape-builder / perspective-grid: tool-icon SVG
 * - hand: `grab` / `grabbing`; zoom: AI/CDR magnifier with a +/- badge
 *   (Alt toggles zoom-out)
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

// White-cased black-core strokes: black core reads on white artboards, the
// white halo keeps the silhouette visible on the dark canvas chrome.
const WAND_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M5 19 L13.2 10.8' stroke='white' stroke-width='3.4' stroke-linecap='round'/><path d='M5 19 L13.2 10.8' stroke='black' stroke-width='1.8' stroke-linecap='round'/><path d='M16.5 2.5 L17.6 5.4 L20.5 6.5 L17.6 7.6 L16.5 10.5 L15.4 7.6 L12.5 6.5 L15.4 5.4 Z' fill='white' stroke='black' stroke-width='1.1' stroke-linejoin='round'/><path d='M20.5 11 V14 M19 12.5 H22' stroke='white' stroke-width='2.6' stroke-linecap='round'/><path d='M20.5 11 V14 M19 12.5 H22' stroke='black' stroke-width='1.2' stroke-linecap='round'/></svg>`

const LASSO_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M5 8 C5 5.5 8 4 11.5 4 C15 4 18 5.5 18 8 C18 10.5 15 12 11.5 12 C8 12 5 10.5 5 8 Z' fill='none' stroke='white' stroke-width='3.2'/><path d='M6 10.5 C5 13.5 3.8 16 2.5 18.5' stroke='white' stroke-width='3' stroke-linecap='round'/><path d='M5 8 C5 5.5 8 4 11.5 4 C15 4 18 5.5 18 8 C18 10.5 15 12 11.5 12 C8 12 5 10.5 5 8 Z' fill='none' stroke='black' stroke-width='1.5'/><path d='M6 10.5 C5 13.5 3.8 16 2.5 18.5' stroke='black' stroke-width='1.4' stroke-linecap='round'/></svg>`

const KNIFE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M19 4 L14.5 4.8 L5.5 13.8 L4.5 19.5 L9.2 18.5 L18.2 9.5 Z' fill='white' stroke='black' stroke-width='1.3' stroke-linejoin='round'/><path d='M19 4 L9.2 18.5' stroke='black' stroke-width='0.8'/></svg>`

const WIDTH_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M5 4 V20 M19 4 V20 M5 12 H19' stroke='white' stroke-width='3.6' stroke-linecap='round'/><path d='M5 4 V20 M19 4 V20 M5 12 H19' stroke='black' stroke-width='1.7' stroke-linecap='round'/><path d='M8 9.4 L5 12 L8 14.6 M16 9.4 L19 12 L16 14.6' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>`

const SPRAY_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><rect x='3.5' y='10' width='7.5' height='10' rx='1' fill='white' stroke='black' stroke-width='1.3'/><path d='M5.8 10 V7.2 H8.7 V10' fill='white' stroke='black' stroke-width='1.2'/><circle cx='14.5' cy='5' r='1.4' fill='black' stroke='white' stroke-width='0.8'/><circle cx='18.5' cy='8.5' r='1.4' fill='black' stroke='white' stroke-width='0.8'/><circle cx='15' cy='10.5' r='1.4' fill='black' stroke='white' stroke-width='0.8'/></svg>`

const GRADIENT_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><rect x='3.5' y='3.5' width='17' height='17' fill='white' stroke='black' stroke-width='1.4'/><path d='M4.5 15 L15 4.5 M4.5 9.8 L9.8 4.5 M9.5 19.5 L19.5 9.5 M15 19.5 L19.5 15' stroke='black' stroke-width='1'/><path d='M8 16 L16 8' stroke='white' stroke-width='3' stroke-linecap='round'/><path d='M8 16 L16 8' stroke='black' stroke-width='1.4' stroke-linecap='round'/><circle cx='8' cy='16' r='1.6' fill='white' stroke='black' stroke-width='1'/><circle cx='16' cy='8' r='1.6' fill='white' stroke='black' stroke-width='1'/></svg>`

const SCALE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><rect x='3.5' y='14.5' width='6' height='6' fill='white' stroke='black' stroke-width='1.3'/><path d='M10.5 13.5 L20.5 3.5 M15.8 3.5 H20.5 V8.2 M15.2 13.5 H10.5 V8.8' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/><path d='M10.5 13.5 L20.5 3.5 M15.8 3.5 H20.5 V8.2 M15.2 13.5 H10.5 V8.8' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/></svg>`

const MIRROR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M12 3 V21' stroke='white' stroke-width='3.2' stroke-linecap='round'/><path d='M12 3 V21' stroke='black' stroke-width='1.4' stroke-dasharray='2.4 2' stroke-linecap='round'/><path d='M8.6 7.5 V16.5 L3.6 12 Z' fill='black' stroke='white' stroke-width='1' stroke-linejoin='round'/><path d='M15.4 7.5 V16.5 L20.4 12 Z' fill='white' stroke='black' stroke-width='1.3' stroke-linejoin='round'/></svg>`

const FREE_TRANSFORM_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><rect x='4' y='4' width='16' height='16' fill='none' stroke='white' stroke-width='2.8' stroke-dasharray='2.6 2'/><rect x='4' y='4' width='16' height='16' fill='none' stroke='black' stroke-width='1.3' stroke-dasharray='2.6 2'/><rect x='2.8' y='2.8' width='3.4' height='3.4' fill='white' stroke='black' stroke-width='1.1'/><rect x='17.8' y='2.8' width='3.4' height='3.4' fill='white' stroke='black' stroke-width='1.1'/><rect x='2.8' y='17.8' width='3.4' height='3.4' fill='white' stroke='black' stroke-width='1.1'/><rect x='17.8' y='17.8' width='3.4' height='3.4' fill='white' stroke='black' stroke-width='1.1'/></svg>`

const SMOOTH_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M3.5 21.5 C7 22.3 10.5 22 13.5 20.5' fill='none' stroke='white' stroke-width='3.2' stroke-linecap='round'/><path d='M3.5 21.5 C7 22.3 10.5 22 13.5 20.5' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round'/><path d='M4.5 19 L5.3 16.4 L14.5 7.2 L16.8 9.5 L7.6 18.7 Z' fill='white' stroke='black' stroke-width='1.2' stroke-linejoin='round'/><path d='M4.5 19 L7.6 18.7 L5.9 17 Z' fill='black'/></svg>`

const RESHAPE_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M3 18 C7 18 8 11 12 11 C16 11 17 18 21 18' fill='none' stroke='white' stroke-width='3.2' stroke-linecap='round'/><path d='M3 18 C7 18 8 11 12 11 C16 11 17 18 21 18' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round'/><path d='M12 11 V4.5 M9.6 6.6 L12 4.2 L14.4 6.6' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/><path d='M12 11 V4.5 M9.6 6.6 L12 4.2 L14.4 6.6' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round' stroke-linejoin='round'/></svg>`

const SHAPE_BUILDER_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'><path d='M3 3 L3 15.4 L6.2 12.6 L8.2 17.4 L10.6 16.4 L8.6 11.8 L12.6 11.5 Z' fill='white' stroke='black' stroke-width='1.4' stroke-linejoin='round'/><rect x='14' y='14' width='9.5' height='9.5' rx='1.5' fill='white' stroke='black' stroke-width='1.1'/><path d='M18.75 15.8 V21.7 M15.8 18.75 H21.7' stroke='black' stroke-width='1.4' stroke-linecap='round'/></svg>`

const PERSPECTIVE_GRID_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M12 3 L4 21 M12 3 L20 21 M3 21 H21 M6.8 14 H17.2' fill='none' stroke='white' stroke-width='3' stroke-linecap='round'/><path d='M12 3 L4 21 M12 3 L20 21 M3 21 H21 M6.8 14 H17.2' fill='none' stroke='black' stroke-width='1.4' stroke-linecap='round'/></svg>`

// Magnifier with a + / − badge (AI/CDR zoom cursor); Alt flips to minus.
function zoomSvg(zoomOut: boolean): string {
  const badge = zoomOut
    ? `<path d='M8.2 11 H13.8' stroke='black' stroke-width='1.6' stroke-linecap='round'/>`
    : `<path d='M8.2 11 H13.8 M11 8.2 V13.8' stroke='black' stroke-width='1.6' stroke-linecap='round'/>`
  return `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><circle cx='11' cy='11' r='6.2' fill='white' stroke='black' stroke-width='1.4'/><path d='M15.6 15.6 L21 21' stroke='white' stroke-width='3.4' stroke-linecap='round'/><path d='M15.6 15.6 L21 21' stroke='black' stroke-width='1.8' stroke-linecap='round'/>${badge}</svg>`
}

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
/** Magic wand (hotspot at the star tip). */
export const CURSOR_WAND = svgCursor(WAND_SVG, 17, 7, 'crosshair')
/** Lasso loop (hotspot where the loop starts). */
export const CURSOR_LASSO = svgCursor(LASSO_SVG, 5, 8, 'crosshair')
/** Knife blade (hotspot at the blade tip). */
export const CURSOR_KNIFE = svgCursor(KNIFE_SVG, 19, 4, 'crosshair')
/** Width tool: two edge bars with a double arrow (hotspot at center). */
export const CURSOR_WIDTH = svgCursor(WIDTH_SVG, 12, 12, 'ew-resize')
/** Symbol sprayer (hotspot at the nozzle spray). */
export const CURSOR_SPRAY = svgCursor(SPRAY_SVG, 16, 8, 'crosshair')
/** Gradient drag line inside a swatch (hotspot at center). */
export const CURSOR_GRADIENT = svgCursor(GRADIENT_SVG, 12, 12, 'crosshair')
/** Scale: corner square growing along the diagonal (hotspot on the shaft). */
export const CURSOR_SCALE = svgCursor(SCALE_SVG, 12, 12, 'nwse-resize')
/** Mirror: dashed axis with filled/hollow halves (hotspot at center). */
export const CURSOR_MIRROR = svgCursor(MIRROR_SVG, 12, 12, 'col-resize')
/** Free transform: dashed frame with corner handles (hotspot at center). */
export const CURSOR_FREE_TRANSFORM = svgCursor(FREE_TRANSFORM_SVG, 12, 12, 'move')
/** Smooth: pencil trailing a smoothed swoosh (hotspot at the pencil tip). */
export const CURSOR_SMOOTH = svgCursor(SMOOTH_SVG, 4, 19, 'crosshair')
/** Reshape: path bump pulled upward (hotspot at the pulled point). */
export const CURSOR_RESHAPE = svgCursor(RESHAPE_SVG, 12, 11, 'crosshair')
/** Shape builder: arrow with a combine badge (hotspot at the arrow tip). */
export const CURSOR_SHAPE_BUILDER = svgCursor(SHAPE_BUILDER_SVG, 3, 3, 'default')
/** Perspective grid: converging vanishing lines (hotspot at center). */
export const CURSOR_PERSPECTIVE_GRID = svgCursor(PERSPECTIVE_GRID_SVG, 12, 12, 'crosshair')

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
    lasso: CURSOR_LASSO,
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
    gradient: CURSOR_GRADIENT,
    reshape: CURSOR_RESHAPE,
    smooth: CURSOR_SMOOTH,
    spray: CURSOR_SPRAY,
    wand: CURSOR_WAND,
    'blob-brush': blobRing,
    brush: brushRing,
    eraser: eraserRing,
    scissors: CURSOR_SCISSORS,
    knife: CURSOR_KNIFE,
    width: CURSOR_WIDTH,
    rotate: CURSOR_ROTATE,
    scale: CURSOR_SCALE,
    mirror: CURSOR_MIRROR,
    'free-transform': CURSOR_FREE_TRANSFORM,
    'view-hand': 'grab',
    zoom: zoomCursor(false),
    measure: crosshair,
    callout: crosshair,
    'shape-builder': CURSOR_SHAPE_BUILDER,
    eyedropper: CURSOR_EYEDROPPER,
    'perspective-grid': CURSOR_PERSPECTIVE_GRID,
  }
}

export const TOOL_CURSORS: Record<ToolName, string> = buildToolCursors()

/** Default cursor for a tool (falls back to `default`). */
export function cursorForTool(tool: ToolName): string {
  return TOOL_CURSORS[tool] ?? 'default'
}

/** Zoom tool cursor: AI/CDR magnifier, Alt / right-click swaps + for −. */
export function zoomCursor(isZoomOut: boolean): string {
  return svgCursor(zoomSvg(isZoomOut), 11, 11, isZoomOut ? 'zoom-out' : 'zoom-in')
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
