/**
 * Recolor Artwork: grouping and mapping.
 *
 * The grouping is the feature, so these cases are about which colors end up
 * together rather than about exact output hex values — except for the two
 * properties that must hold for every input: the mapping is total over the
 * collected colors, and it preserves each color's lightness.
 */
import { describe, expect, it } from 'vitest'
import { parseCssColor, rgbToHsl } from './color'
import {
  buildMapping,
  collectPaints,
  groupPaints,
  previewRecolor,
  RECOLOR_THEMES,
  type Theme,
} from './recolor'

const theme = (id: string): Theme => {
  const found = RECOLOR_THEMES.find((t) => t.id === id)
  if (!found) throw new Error(`no theme ${id}`)
  return found
}

/** Hue of a mapped color, for "the hue family changed" assertions. */
const hueOf = (css: string): number => {
  const rgba = parseCssColor(css)!
  return rgbToHsl(rgba.r, rgba.g, rgba.b).h
}

describe('collectPaints', () => {
  it('counts each color and sorts by usage', () => {
    expect(collectPaints(['#ff0000', '#00ff00', '#ff0000'])).toEqual([
      { css: '#ff0000', count: 2 },
      { css: '#00ff00', count: 1 },
    ])
  })

  it('merges near-duplicates into one entry', () => {
    // Two blues a designer would call the same color.
    const paints = collectPaints(['#3366cc', '#3467cd', '#ff0000'])
    expect(paints.length).toBe(2)
    expect(paints[0].count).toBe(2)
  })

  it('drops unparseable and fully transparent colors', () => {
    expect(collectPaints(['not-a-color', 'rgba(0,0,0,0)', '#123456'])).toEqual([
      { css: '#123456', count: 1 },
    ])
  })
})

describe('groupPaints', () => {
  it('separates distinct hue families', () => {
    const groups = groupPaints(collectPaints(['#ff0000', '#00ff00', '#0000ff', '#ffff00']), 5)
    expect(groups.length).toBe(4)
    for (const group of groups) expect(group.colors.length).toBe(1)
  })

  it('keeps achromatic colors out of the chromatic buckets', () => {
    // Black, white and a blue: none of them may be folded together.
    const groups = groupPaints(collectPaints(['#000000', '#ffffff', '#3366cc']), 5)
    expect(groups.length).toBe(3)
  })

  it('splits the same hue by lightness when there are not enough families', () => {
    // One hue, two values, asked for two groups.
    const groups = groupPaints(collectPaints(['#3366cc', '#99bbff']), 2)
    expect(groups.length).toBe(2)
    expect(groups[0].colors[0].css).not.toBe(groups[1].colors[0].css)
  })

  it('assigns theme indices in order, most used first', () => {
    const groups = groupPaints(collectPaints(['#00ff00', '#ff0000', '#ff0000']), 3)
    expect(groups[0].colors[0].css).toBe('#ff0000')
    expect(groups.map((g) => g.themeIndex)).toEqual([0, 1])
  })

  it('returns nothing for an empty palette', () => {
    expect(groupPaints([], 5)).toEqual([])
  })
})

describe('buildMapping', () => {
  const mapping = (colors: string[], t: Theme, groups = 5) =>
    buildMapping(groupPaints(collectPaints(colors), groups), t, groups)

  it('is total: every collected color gets a replacement', () => {
    const colors = ['#ff0000', '#00ff00', '#0000ff', '#123456', '#abcdef']
    const map = mapping(colors, theme('cool'))
    for (const css of colors) {
      expect(map.has(css.toLowerCase()), css).toBe(true)
    }
  })

  it('moves the colors into the theme hue family', () => {
    // A red drawing recolored with a cool theme comes out blue-ish.
    const map = mapping(['#ff0000', '#cc3333'], theme('cool'))
    for (const to of map.values()) expect(hueOf(to)).toBeGreaterThan(150)
  })

  it('keeps each color its own lightness', () => {
    const map = mapping(['#3366cc', '#99bbff'], theme('warm'))
    const light = [...map.entries()].map(([from, to]) => {
      const a = parseCssColor(from)!
      const b = parseCssColor(to)!
      return Math.abs(rgbToHsl(a.r, a.g, a.b).l - rgbToHsl(b.r, b.g, b.b).l)
    })
    for (const delta of light) expect(delta).toBeLessThan(0.12)
  })

  it('is a no-op for a theme with no colors', () => {
    expect(buildMapping(groupPaints(collectPaints(['#ff0000']), 5), { id: 'x', label: 'x', colors: [] }).size).toBe(0)
  })
})

describe('previewRecolor', () => {
  it('returns the groups and the mapping together', () => {
    const { groups, mapping } = previewRecolor(['#ff0000', '#00ff00'], theme('earth'), 2)
    expect(groups.length).toBe(2)
    expect(mapping.size).toBe(2)
  })
})
