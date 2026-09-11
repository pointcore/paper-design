/**
 * Print-color helpers (CMYK preview + spot placeholders).
 *
 * The canvas renders RGB (Paper.js has no CMYK pipeline), so CMYK here is
 * numeric: conversions use the naive uncoated model and gamut warnings flag
 * vivid RGB paints that will shift on press. Spot names are metadata on
 * `item.data` (persisted in project JSON); paints still render/export with
 * their RGB preview.
 */

/** Parsed 8-bit RGBA color. */
export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

/** CMYK percentages (0-100 integers). */
export interface Cmyk {
  c: number
  m: number
  y: number
  k: number
}

/** Parse #rgb/#rrggbb/#rrggbbaa/rgb()/rgba() into 8-bit channels. */
export function parseCssColor(css: string | null | undefined): Rgba | null {
  if (!css || typeof css !== 'string') return null
  const text = css.trim().toLowerCase()
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/)
  if (hex) {
    let h = hex[1]
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('')
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
    if ([r, g, b].some((n) => !Number.isFinite(n))) return null
    return { r, g, b, a }
  }
  const fn = text.match(/^rgba?\(\s*([^)]+)\)$/)
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3) return null
    const channel = (v: string): number => {
      if (v.endsWith('%')) return Math.round((parseFloat(v) / 100) * 255)
      return Math.round(parseFloat(v))
    }
    const r = channel(parts[0])
    const g = channel(parts[1])
    const b = channel(parts[2])
    const a = parts[3] !== undefined
      ? (parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]))
      : 1
    if ([r, g, b].some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return null
    return { r, g, b, a: Number.isFinite(a) ? Math.min(1, Math.max(0, a)) : 1 }
  }
  return null
}

/** Naive RGB (0-255) to CMYK (0-100) conversion. */
export function rgbToCmyk(r: number, g: number, b: number): Cmyk {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const k = 1 - Math.max(rn, gn, bn)
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 100 }
  const pct = (v: number): number => Math.round(((1 - v - k) / (1 - k)) * 100)
  return { c: pct(rn), m: pct(gn), y: pct(bn), k: Math.round(k * 100) }
}

/** Naive CMYK (0-100) back to RGB (0-255). */
export function cmykToRgb(c: number, m: number, y: number, k: number): Rgba {
  const cn = c / 100
  const mn = m / 100
  const yn = y / 100
  const kn = k / 100
  return {
    r: Math.round(255 * (1 - cn) * (1 - kn)),
    g: Math.round(255 * (1 - mn) * (1 - kn)),
    b: Math.round(255 * (1 - yn) * (1 - kn)),
    a: 1,
  }
}

/** CSS color to `C.. M.. Y.. K..` readout, or null when unparseable. */
export function cssToCmykString(css: string | null | undefined): string | null {
  const rgba = parseCssColor(css)
  if (!rgba) return null
  const { c, m, y, k } = rgbToCmyk(rgba.r, rgba.g, rgba.b)
  return `C${c} M${m} Y${y} K${k}`
}

/**
 * Whether a CSS color likely shifts on a CMYK press. The naive conversion
 * above is near-exact invertible (round-trip drift peaks at ~2 steps), so
 * drift cannot detect anything — instead this flags fully saturated RGB
 * vertices (one channel at 255, another at 0: pure red/green/blue/cyan/
 * magenta/yellow). Those sit outside the process gamut and visibly shift
 * on press; everything else passes. Coarse by design, documented as such.
 */
export function isOutOfCmykGamut(css: string | null | undefined): boolean {
  const rgba = parseCssColor(css)
  if (!rgba) return false
  const peak = Math.max(rgba.r, rgba.g, rgba.b)
  const floor = Math.min(rgba.r, rgba.g, rgba.b)
  return peak === 255 && floor === 0
}

/** HSL channels (h 0-360, s/l 0-1). */
export interface Hsl {
  h: number
  s: number
  l: number
}

/** 8-bit RGB to HSL. */
export function rgbToHsl(r: number, g: number, b: number): Hsl {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const peak = Math.max(rn, gn, bn)
  const floor = Math.min(rn, gn, bn)
  const l = (peak + floor) / 2
  if (peak === floor) return { h: 0, s: 0, l }
  const d = peak - floor
  const s = l > 0.5 ? d / (2 - peak - floor) : d / (peak + floor)
  let h = 0
  if (peak === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  else if (peak === gn) h = ((bn - rn) / d + 2) * 60
  else h = ((rn - gn) / d + 4) * 60
  return { h, s, l }
}

/** HSL back to 8-bit RGB. */
export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hn = (((h % 360) + 360) % 360) / 360
  const sn = Math.min(1, Math.max(0, s))
  const ln = Math.min(1, Math.max(0, l))
  if (sn === 0) {
    const v = Math.round(ln * 255)
    return { r: v, g: v, b: v }
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn
  const p = 2 * ln - q
  const channel = (t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return {
    r: Math.round(channel(hn + 1 / 3) * 255),
    g: Math.round(channel(hn) * 255),
    b: Math.round(channel(hn - 1 / 3) * 255),
  }
}

/**
 * Shift a CSS paint through HSL (Recolor-artwork lite): hue rotates by
 * degrees, saturation/lightness move relatively by percent points.
 * Unparseable input passes through unchanged; alpha is preserved.
 */export function shiftCssColor(css: string, dh: number, ds: number, dl: number): string {
  const rgba = parseCssColor(css)
  if (!rgba) return css
  const { h, s, l } = rgbToHsl(rgba.r, rgba.g, rgba.b)
  const { r, g, b } = hslToRgb(
    h + (Number.isFinite(dh) ? dh : 0),
    s + (Number.isFinite(ds) ? ds : 0) / 100,
    l + (Number.isFinite(dl) ? dl : 0) / 100
  )
  const hex = (n: number): string => Math.min(255, Math.max(0, n)).toString(16).padStart(2, '0')
  if (rgba.a >= 1) return `#${hex(r)}${hex(g)}${hex(b)}`
  return `rgba(${r}, ${g}, ${b}, ${Math.round(rgba.a * 100) / 100})`
}

/**
 * Euclidean RGB distance between parsed colors (alpha ignored, 0-442).
 * Drives magic-wand tolerance matching.
 */
export function colorDistanceRgb(a: Rgba, b: Rgba): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}
