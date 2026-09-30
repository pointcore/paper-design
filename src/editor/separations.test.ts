/**
 * Spot separations: discovery, file naming and the plate repaint.
 *
 * The repaint is the part worth testing off-screen: it mutates every paint in
 * the document and promises to put them back exactly. A restore that is
 * almost right is worse than no export, because the document looks fine until
 * the next edit.
 */
import { describe, expect, it } from 'vitest'
import paper from 'paper'
import { collectSeparations, applyPlate, plateBounds, plateSize, separationFileName } from './separations'
import type { EditorEngine } from './engine'

/** A scope with one user layer, a spot item and a plain item. */
function makeEngine() {
  const scope = new paper.PaperScope()
  scope.setup(document.createElement('canvas'))
  const project = scope.project
  const layer = new scope.Layer()
  layer.data.isUserLayer = true
  project.addLayer(layer)

  const plain = new scope.Path.Rectangle({
    from: new scope.Point(0, 0),
    to: new scope.Point(50, 50),
  })
  plain.fillColor = new scope.Color('#3366cc')
  plain.data.id = 'plain'
  plain.data.isUserItem = true
  layer.addChild(plain)

  const spotted = new scope.Path.Rectangle({
    from: new scope.Point(60, 0),
    to: new scope.Point(110, 50),
  })
  spotted.fillColor = new scope.Color('#c0392b')
  spotted.strokeColor = new scope.Color('#000000')
  spotted.strokeWidth = 2
  spotted.data.id = 'spotted'
  spotted.data.isUserItem = true
  spotted.data.spotFill = 'PMS 185 C'
  layer.addChild(spotted)

  const e = {
    scope,
    project,
    store: {
      artboards: [{ id: 'b1', x: 0, y: 0, width: 200, height: 100 }],
      activeArtboardId: 'b1',
      pageSize: { width: 200, height: 100 },
    },
  } as unknown as EditorEngine
  return { e, scope, layer, plain, spotted }
}

describe('separationFileName', () => {
  it('keeps the ink name recognisable', () => {
    expect(separationFileName('PMS 185 C', 0)).toBe('01-PMS-185-C')
  })

  it('strips characters no filesystem accepts', () => {
    expect(separationFileName('a/b\\c:d*e?f"g<h>i|j', 0)).toBe('01-a-b-c-d-e-f-g-h-i-j')
  })

  it('prefixes the plate number so two similar inks stay distinct', () => {
    // "PMS 185 C" and "PMS/185 C" clean to the same stem.
    expect(separationFileName('PMS 185 C', 0)).not.toBe(separationFileName('PMS/185 C', 1))
  })

  it('survives a name that cleans to nothing', () => {
    expect(separationFileName('///', 2)).toBe('03-spot')
  })
})

describe('collectSeparations', () => {
  it('finds the spot and counts the item', () => {
    const { e } = makeEngine()
    expect(collectSeparations(e)).toEqual([
      { spot: 'PMS 185 C', file: '01-PMS-185-C', items: 1 },
    ])
  })

  it('ignores objects with no spot', () => {
    const { e } = makeEngine()
    expect(collectSeparations(e).some((s) => s.spot.includes('3366cc'))).toBe(false)
  })

  it('merges case and spacing variants into one ink', () => {
    const { e, layer, scope } = makeEngine()
    const second = new scope.Path.Circle(new scope.Point(150, 50), 20)
    second.fillColor = new scope.Color('#000000')
    second.data.id = 'spotted2'
    second.data.isUserItem = true
    second.data.spotFill = 'pms  185 c'
    layer.addChild(second)
    const found = collectSeparations(e)
    expect(found.length).toBe(1)
    expect(found[0].items).toBe(2)
    // The first spelling encountered is the one shown.
    expect(found[0].spot).toBe('PMS 185 C')
  })

  it('finds spots inside groups', () => {
    const { e, layer, scope } = makeEngine()
    const group = new scope.Group()
    const inner = new scope.Path.Circle(new scope.Point(20, 80), 10)
    inner.fillColor = new scope.Color('#000000')
    inner.data.id = 'inner'
    inner.data.isUserItem = true
    inner.data.spotStroke = 'FOGRA 51'
    group.addChild(inner)
    layer.addChild(group)
    const found = collectSeparations(e)
    expect(found.map((s) => s.spot).sort()).toEqual(['FOGRA 51', 'PMS 185 C'])
  })

  it('counts a fill and a stroke on the same object once', () => {
    const { e, spotted } = makeEngine()
    ;(spotted.data as any).spotStroke = 'PMS 185 C'
    expect(collectSeparations(e)[0].items).toBe(1)
  })

  it('is empty for a document with no spots', () => {
    const { e, spotted } = makeEngine()
    delete (spotted.data as any).spotFill
    expect(collectSeparations(e)).toEqual([])
  })
})

describe('applyPlate', () => {
  it('paints the plate ink black and everything else invisible', () => {
    const { e, plain, spotted } = makeEngine()
    const restore = applyPlate(e, 'PMS 185 C')

    expect((spotted as any).fillColor.toCSS(true)).toBe('#000000')
    expect((spotted as any).strokeColor.toCSS(true)).toBe('#000000')
    // Off-plate artwork is removed, not whitened: a white rectangle prints.
    expect((plain as any).fillColor).toBeNull()

    restore()
  })

  it('restores every paint exactly', () => {
    const { e, plain, spotted } = makeEngine()
    const before = {
      plainFill: (plain as any).fillColor.toCSS(true),
      spotFill: (spotted as any).fillColor.toCSS(true),
      spotStroke: (spotted as any).strokeColor.toCSS(true),
      spotWidth: (spotted as any).strokeWidth,
    }
    const restore = applyPlate(e, 'PMS 185 C')
    restore()
    expect((plain as any).fillColor.toCSS(true)).toBe(before.plainFill)
    expect((spotted as any).fillColor.toCSS(true)).toBe(before.spotFill)
    expect((spotted as any).strokeColor.toCSS(true)).toBe(before.spotStroke)
    expect((spotted as any).strokeWidth).toBe(before.spotWidth)
  })

  it('restores object identity, so a live selection stays valid', () => {
    const { e, spotted } = makeEngine()
    const id = String((spotted as any).data.id)
    const restore = applyPlate(e, 'PMS 185 C')
    restore()
    expect(String((spotted as any).data.id)).toBe(id)
  })

  it('matches a spot case-insensitively', () => {
    const { e, spotted, plain } = makeEngine()
    const restore = applyPlate(e, 'pms 185 c')
    expect((spotted as any).fillColor.toCSS(true)).toBe('#000000')
    expect((plain as any).fillColor).toBeNull()
    restore()
  })

  it('blanks every object for a plate nobody uses', () => {
    const { e, plain, spotted } = makeEngine()
    const restore = applyPlate(e, 'an ink nobody uses')
    // Nothing is on this plate, so nothing may print: no black, and no white
    // rectangle standing in for the artwork either.
    expect((spotted as any).fillColor).toBeNull()
    expect((plain as any).fillColor).toBeNull()
    restore()
    expect((plain as any).fillColor.toCSS(true)).toBe('#3366cc')
    expect((spotted as any).fillColor.toCSS(true)).toBe('#c0392b')
  })
})

describe('plateBounds', () => {
  it('uses the active board for the page', () => {
    const { e } = makeEngine()
    const bounds = plateBounds(e, 'page')!
    expect(bounds.width).toBe(200)
    expect(bounds.height).toBe(100)
  })

  it('unites the artwork for the artwork area', () => {
    const { e } = makeEngine()
    const bounds = plateBounds(e, 'artwork')!
    expect(bounds.width).toBeGreaterThan(100)
    expect(bounds.height).toBe(50)
  })

  it('is null when there is no artwork', () => {
    const { e, layer, plain, spotted } = makeEngine()
    plain.remove()
    spotted.remove()
    expect(layer.children.length).toBe(0)
    expect(plateBounds(e, 'artwork')).toBeNull()
  })
})

describe('plateSize', () => {
  it('reports the physical page size at the plate resolution', () => {
    // 300 dpi over one inch is 25.4mm.
    expect(plateSize(300, 300, 300)).toBe('25.4 x 25.4 mm')
    expect(plateSize(1500, 750, 300)).toBe('127.0 x 63.5 mm')
  })
})
