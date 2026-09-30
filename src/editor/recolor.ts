/**
 * Recolor Artwork: remap a selection's colors onto a theme palette.
 *
 * The existing color tools are all global nudges (HSL shift, channel
 * invert, swap fill/stroke) or exact-match replacements (global colors,
 * spot placeholders). What Illustrator's Recolor Artwork does is neither:
 * it *groups* the colors already in the artwork by similarity, then hands
 * each group a color from a chosen theme, so a drawing that used six
 * unrelated blues comes out as five intentional ones.
 *
 * The grouping is the whole feature, and it is pure: no Paper.js, no DOM.
 * Colors are bucketed by hue (with achromatic colors kept apart, since
 * black and gray must not be dragged into a blue theme) and then by
 * lightness within the bucket, because two colors of the same hue at very
 * different lightness read as two different design decisions even though a
 * hue-only grouping would merge them.
 */
import { parseCssColor, rgbToHsl, hslToRgb, colorDistanceRgb, type Rgba } from './color'

/** One color found in the artwork, with how many paints use it. */
export interface PaintCount {
  css: string
  count: number
}

/** A set of source colors treated as one design decision. */
export interface ColorGroup {
  /** Index into the theme palette this group maps to. */
  themeIndex: number
  colors: PaintCount[]
  /** Representative source color, for the preview swatch. */
  representative: string
}

/** A named set of replacement colors. */
export interface Theme {
  id: string
  label: string
  colors: string[]
}

/** Bundled themes, in the spirit of Illustrator's recolor presets. */
export const RECOLOR_THEMES: Theme[] = [
  { id: 'mono', label: 'Monochrome', colors: ['#1a1a1a', '#4d4d4d', '#808080', '#b3b3b3', '#e6e6e6'] },
  { id: 'warm', label: 'Warm', colors: ['#7a1f1f', '#c0392b', '#e67e22', '#f1c40f', '#f5deb3'] },
  { id: 'cool', label: 'Cool', colors: ['#154360', '#1f78b4', '#48c9b0', '#a3e4d7', '#d5f5e3'] },
  { id: 'earth', label: 'Earth', colors: ['#3b2f2f', '#7f5539', '#b08968', '#ddb892', '#e6ccb2'] },
  { id: 'contrast', label: 'High Contrast', colors: ['#000000', '#7f0000', '#0000cc', '#008000', '#ffff00'] },
  { id: 'pastel', label: 'Pastel', colors: ['#f4acb7', '#9d8189', '#ffe5d9', '#f1cac0', '#84a59d'] },
]

/**
 * How many groups to aim for. More than the theme has colors wraps around,
 * which merges groups; fewer leaves theme colors unused.
 */
const DEFAULT_GROUPS = 5

/** Hue bucket width in degrees. */
const HUE_STEP = 30

/**
 * Bucket key for a color: hue band, or an achromatic band.
 *
 * Achromatic colors (near-zero saturation) are split by lightness instead of
 * hue, because "black" and "pale gray" have no meaningful hue and would
 * otherwise all land in the same bucket as whatever accent happens to sit
 * near hue 0.
 */
function bucketOf(rgba: Rgba): number {
  const { h, s, l } = rgbToHsl(rgba.r, rgba.g, rgba.b)
  if (s < 0.12) return 1000 + Math.round(l * 10)
  return Math.floor(h / HUE_STEP)
}

/**
 * Count how often each opaque color appears. Near-duplicates (within a small
 * RGB distance) are merged into the first entry so that a drawing assembled
 * from slightly different blues does not report eight colors where the
 * designer sees two.
 */
export function collectPaints(cssColors: string[], tolerance = 24): PaintCount[] {
  const out: PaintCount[] = []
  const parsed: Rgba[] = []
  for (const css of cssColors) {
    const rgba = parseCssColor(css)
    if (!rgba) continue
    if (rgba.a < 0.02) continue
    const hit = out.findIndex((entry, i) => colorDistanceRgb(parsed[i], rgba) <= tolerance)
    if (hit >= 0) {
      out[hit].count++
    } else {
      out.push({ css, count: 1 })
      parsed.push(rgba)
    }
  }
  return out.sort((a, b) => b.count - a.count)
}

/**
 * Group counted colors into at most `groupCount` clusters, most-used first.
 *
 * Colors are assigned to their hue bucket, buckets are ranked by total usage,
 * and each bucket contributes one group. If there are fewer buckets than
 * asked for, the busiest buckets split by lightness so the result still has
 * the requested number of distinguishable groups.
 */
export function groupPaints(paints: PaintCount[], groupCount = DEFAULT_GROUPS): ColorGroup[] {
  const usable = paints.filter((p) => parseCssColor(p.css) !== null)
  if (usable.length === 0) return []

  const buckets = new Map<number, PaintCount[]>()
  for (const paint of usable) {
    const key = bucketOf(parseCssColor(paint.css)!)
    const list = buckets.get(key)
    if (list) list.push(paint)
    else buckets.set(key, [paint])
  }
  const ranked = [...buckets.entries()].sort(
    (a, b) => b[1].reduce((n, p) => n + p.count, 0) - a[1].reduce((n, p) => n + p.count, 0)
  )

  const groups: ColorGroup[] = []
  for (const [, colors] of ranked) {
    if (groups.length >= groupCount) break
    groups.push({ themeIndex: 0, colors, representative: colors[0].css })
  }
  // Not enough distinct hues: split the busiest groups by lightness so the
  // theme's colors all get used.
  let i = 0
  while (groups.length < groupCount && groups.length < usable.length) {
    const source = groups[i % groups.length]
    const keep = source.colors.find((c) => c.css === source.representative)
    const rest = source.colors.filter((c) => c !== keep)
    if (!keep || rest.length === 0) break
    source.colors = [keep]
    groups.push({ themeIndex: 0, colors: rest, representative: rest[0].css })
    i++
  }
  groups.forEach((group, index) => {
    group.themeIndex = index % Math.max(1, groupCount)
  })
  return groups
}

/**
 * Build the old -> new color map for a set of groups.
 *
 * Within a group the theme color is nudged toward each source color's own
 * lightness, so two shades of the same hue do not collapse onto one flat
 * swatch: the artwork keeps its value structure and changes hue family.
 */
export function buildMapping(groups: ColorGroup[], theme: Theme, groupCount = DEFAULT_GROUPS): Map<string, string> {
  const map = new Map<string, string>()
  if (theme.colors.length === 0) return map
  for (const group of groups) {
    const base = theme.colors[group.themeIndex % theme.colors.length]
    const baseRgba = parseCssColor(base)
    if (!baseRgba) continue
    const baseHsl = rgbToHsl(baseRgba.r, baseRgba.g, baseRgba.b)
    for (const paint of group.colors) {
      const rgba = parseCssColor(paint.css)
      if (!rgba) continue
      const hsl = rgbToHsl(rgba.r, rgba.g, rgba.b)
      const rgb = hslToRgb(baseHsl.h, baseHsl.s, hsl.l)
      map.set(paint.css.toLowerCase(), `rgb(${Math.round(rgb.r)} ${Math.round(rgb.g)} ${Math.round(rgb.b)})`)
    }
  }
  return map
}

/**
 * A dry run: what recoloring the given colors would do, without touching a
 * document. The dialog uses this for its preview.
 */
export function previewRecolor(
  cssColors: string[],
  theme: Theme,
  groupCount = DEFAULT_GROUPS
): { groups: ColorGroup[]; mapping: Map<string, string> } {
  const groups = groupPaints(collectPaints(cssColors), groupCount)
  return { groups, mapping: buildMapping(groups, theme, groupCount) }
}
