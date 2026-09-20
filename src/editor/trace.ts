/**
 * Bitmap auto-trace (D6).
 *
 * Dependency decision (2026-09-20, recorded here per the TODO product call):
 * pure-JS `imagetracerjs` (public-domain Unlicense, zero dependencies, 47KB
 * raw) over a wasm build (no maintained potrace-wasm, custom build step,
 * larger payload) and over Node-centric `potrace` (needs Jimp/fs shims in
 * the browser). The library lazy-loads via dynamic import at trace time,
 * so the main bundle stays untouched; only the async chunk carrying the
 * trace entry grows.
 *
 * This file is the pure layer (no Vue / Paper.js): option validation,
 * ImageTracer option mapping, input-size fitting and SVG result probes.
 * The engine owns pixels-to-paths (`traceSelectedRaster`); ActionsPanel
 * owns the controls. The tracer itself injects as a callback so unit
 * tests run against a stub, never the 47KB library.
 */

/** Detail preset: path fidelity vs output size. */
export type TraceDetail = 'low' | 'medium' | 'high'

/** v1 trace controls (all JSON-serializable for future batch support). */
export interface TraceOptions {
  /** Posterization levels, 2..16. */
  colors: number
  detail: TraceDetail
}

export const TRACE_DETAILS: TraceDetail[] = ['low', 'medium', 'high']

/** Hard cap on palette size (matches the ImageTracer sane range). */
export const TRACE_MAX_COLORS = 16
export const TRACE_MIN_COLORS = 2

/**
 * Longest input side in px. Larger bitmaps downscale before tracing:
 * trace time grows superlinearly with pixels, and a 512px source already
 * resolves print-scale edges after refit.
 */
export const TRACE_MAX_DIM = 512

/** Minimal pixel input (avoids degenerate 0-area canvases). */
export const TRACE_MIN_DIM = 2

export function defaultTraceOptions(): TraceOptions {
  return { colors: 8, detail: 'medium' }
}

/** True when options are runnable as-is. */
export function isValidTraceOptions(v: unknown): v is TraceOptions {
  if (!v || typeof v !== 'object') return false
  const o = v as Partial<TraceOptions>
  if (typeof o.colors !== 'number' || !Number.isInteger(o.colors)) return false
  if (o.colors < TRACE_MIN_COLORS || o.colors > TRACE_MAX_COLORS) return false
  return typeof o.detail === 'string' && (TRACE_DETAILS as string[]).includes(o.detail)
}

/** Clamp/sanitize loaded options (storage may be corrupt or hand-edited). */
export function cleanTraceOptions(v: unknown): TraceOptions {
  const fallback = defaultTraceOptions()
  if (!v || typeof v !== 'object') return fallback
  const raw = v as Partial<TraceOptions>
  const colors = Number.isInteger(raw.colors)
    ? Math.min(TRACE_MAX_COLORS, Math.max(TRACE_MIN_COLORS, raw.colors as number))
    : fallback.colors
  const detail = typeof raw.detail === 'string' && (TRACE_DETAILS as string[]).includes(raw.detail)
    ? (raw.detail as TraceDetail)
    : fallback.detail
  return { colors, detail }
}

/** ImageTracer option record (see its options.md for field semantics). */
export type ImageTracerOpts = {
  numberofcolors: number
  ltres: number
  qtres: number
  pathomit: number
  colorsampling: number
  mincolorratio: number
  blurradius: number
}

/**
 * Map v1 controls onto ImageTracer fields. colorsampling 2 is the
 * deterministic sampler (no run-to-run palette flicker); the detail
 * presets trade line-fit error (ltres/qtres) against small-path pruning
 * (pathomit).
 */
export function traceOptionsToImageTracer(opts: TraceOptions): ImageTracerOpts {
  const base = {
    numberofcolors: opts.colors,
    colorsampling: 2,
    mincolorratio: 0.02,
    blurradius: 1,
  }
  switch (opts.detail) {
    case 'low':
      return { ...base, ltres: 10, qtres: 10, pathomit: 16 }
    case 'high':
      return { ...base, ltres: 1, qtres: 1, pathomit: 4 }
    case 'medium':
    default:
      return { ...base, ltres: 2, qtres: 2, pathomit: 8 }
  }
}

/** Minimal pixel buffer (ImageData satisfies this structurally). */
export interface TraceImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** True when a buffer is traceable (sized, backed, RGBA-complete). */
export function isTraceableImage(img: Partial<TraceImage> | null | undefined): img is TraceImage {
  if (!img || typeof img !== 'object') return false
  if (!Number.isInteger(img.width) || !Number.isInteger(img.height)) return false
  if ((img.width as number) < TRACE_MIN_DIM || (img.height as number) < TRACE_MIN_DIM) return false
  if (!(img.data instanceof Uint8ClampedArray)) return false
  return img.data.length >= (img.width as number) * (img.height as number) * 4
}

/** Fit an input size into TRACE_MAX_DIM, preserving aspect (never upscales). */
export function fitTraceSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0 }
  }
  const scale = Math.min(1, TRACE_MAX_DIM / Math.max(width, height))
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) }
}

/** Tracer injection seam (defaults to the lazy-loaded library at call time). */
export type TraceFn = (img: TraceImage, opts: ImageTracerOpts) => string

/**
 * Run the tracer synchronously once pixels are ready. Throws an English
 * Error on invalid input; tracer failures propagate to the caller, which
 * reports them to the status bar as usual.
 */
export function traceImageData(img: TraceImage, opts: TraceOptions, tracer: TraceFn): string {
  if (!isTraceableImage(img)) throw new Error('Trace needs a loaded bitmap')
  if (!isValidTraceOptions(opts)) throw new Error('Invalid trace options')
  const svg = tracer(img, traceOptionsToImageTracer(opts))
  if (!isPlausibleTraceSvg(svg)) throw new Error('Trace produced no vector output')
  return svg
}

/** Count vector paths in a trace result (sanity probe, not a parser). */
export function countTracePaths(svg: unknown): number {
  if (typeof svg !== 'string') return 0
  const m = svg.match(/<path[\s>]/g)
  return m ? m.length : 0
}

/** Cheap shape check: an <svg> document containing at least one path. */
export function isPlausibleTraceSvg(svg: unknown): boolean {
  if (typeof svg !== 'string' || svg.length === 0) return false
  return svg.includes('<svg') && countTracePaths(svg) > 0
}

/** One-line result summary for status messages, e.g. `14 paths · 8 KB`. */
export function summarizeTrace(svg: string): string {
  const paths = countTracePaths(svg)
  const kb = Math.max(1, Math.round(svg.length / 1024))
  return `${paths} path${paths === 1 ? '' : 's'} · ${kb} KB`
}
