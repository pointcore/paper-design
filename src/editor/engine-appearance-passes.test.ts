/**
 * Multi-appearance paint passes, over a real Paper.js scope.
 *
 * The properties worth pinning: the master paints the *top* of its stack, one
 * generated pass stands in for each entry below it, the passes follow the
 * master's geometry (including after a live drag, which is why the sync is
 * hooked into the view update), and they are invisible to the traversals that
 * treat the tree as a list of objects.
 */
import { describe, expect, it } from 'vitest'
import paper from 'paper'
import {
  appearancePassCount,
  dropAppearancePasses,
  installAppearancePassHook,
  isAppearancePass,
  syncAppearancePasses,
} from './engine-appearance-passes'
import { createDefaultAppearance, setAppearanceOnItem } from './engine-appearance'
import { getUserItems } from './engine-layers'
import { listLayerTree } from './engine-tree'
import type { EditorEngine } from './engine'
import type { AppearanceState } from './types'

/** A scope with one user layer, the hook installed, and a stacked rect. */
function makeEngine(fills = 2, strokes = 1) {
  const scope = new paper.PaperScope()
  scope.setup(document.createElement('canvas'))
  const project = scope.project
  const layer = new scope.Layer()
  layer.data.isUserLayer = true
  layer.data.layerId = 'layer-1'
  project.addLayer(layer)

  let ids = 0
  const e = {
    scope,
    project,
    store: { artboards: [], activeArtboardId: '', pageSize: { width: 100, height: 100 } },
    genId: () => `p${++ids}`,
    zoom: 1,
  } as unknown as EditorEngine

  const item = new scope.Path.Rectangle({
    from: new scope.Point(0, 0),
    to: new scope.Point(100, 100),
  }) as paper.Path
  item.fillColor = new scope.Color('#ff0000')
  item.data.id = 'master'
  item.data.isUserItem = true
  layer.addChild(item)

  const appearance = createDefaultAppearance(e)
  appearance.fills = Array.from({ length: fills }, (_, i) => ({
    id: `f${i}`,
    color: i === fills - 1 ? '#00ff00' : '#0000ff',
    gradient: null,
    pattern: null,
    fillRule: 'nonzero' as const,
    opacity: 1,
    blendMode: 'source-over' as const,
    visible: true,
  }))
  appearance.strokes = Array.from({ length: strokes }, (_, i) => ({
    id: `s${i}`,
    color: i === strokes - 1 ? '#ff00ff' : '#00ffff',
    strokeWidth: 2,
    strokeAlign: 'center' as const,
    lineCap: 'butt' as const,
    lineJoin: 'miter' as const,
    miterLimit: 4,
    dashArray: [],
    dashOffset: 0,
    opacity: 1,
    blendMode: 'source-over' as const,
    visible: true,
  }))
  setAppearanceOnItem(e, item, appearance)
  return { e, scope, layer, item, appearance }
}

const passesIn = (layer: paper.Layer) =>
  layer.children.filter((c) => isAppearancePass(c as paper.Item)) as paper.Item[]

describe('appearance passes', () => {
  it('paints the master with the top of the stack', () => {
    const { e, item } = makeEngine(3, 2)
    syncAppearancePasses(e)
    // The top fill is the last one in the list.
    expect((item as any).fillColor.toCSS(true)).toBe('#00ff00')
    expect((item as any).strokeColor.toCSS(true)).toBe('#ff00ff')
  })

  it('generates one pass per entry below the master', () => {
    const { e, layer } = makeEngine(3, 2)
    syncAppearancePasses(e)
    // 2 lower fills + 1 lower stroke.
    expect(appearancePassCount(e)).toBe(3)
    expect(passesIn(layer).length).toBe(3)
  })

  it('generates nothing for a single-paint item', () => {
    const { e, item } = makeEngine(1, 1)
    syncAppearancePasses(e)
    expect(appearancePassCount(e)).toBe(0)
    expect((item as any).fillColor.toCSS(true)).toBe('#00ff00')
  })

  it('orders the passes bottom-up under the master', () => {
    const { e, layer, item } = makeEngine(3, 1)
    syncAppearancePasses(e)
    const children = layer.children as paper.Item[]
    const masterAt = children.indexOf(item)
    const passAt = children.map((c, i) => (isAppearancePass(c) ? i : -1)).filter((i) => i >= 0)
    // Every pass sits below the master, and the lower fill is the lowest.
    checkBelow(passAt, masterAt)
    const colors = passAt.map((i) => String((children[i] as any).fillColor?.toCSS?.(true) ?? 'stroke'))
    expect(colors[0]).toBe('#0000ff')
  })

  function checkBelow(passAt: number[], masterAt: number) {
    expect(passAt.length).toBeGreaterThan(0)
    for (const at of passAt) expect(at).toBeLessThan(masterAt)
    // Descending pass order in the array means the last one is highest.
    const sorted = [...passAt].sort((a, b) => a - b)
    expect(passAt).toEqual(sorted)
  }

  it('a fill pass carries no stroke and a stroke pass no fill', () => {
    const { e, layer } = makeEngine(2, 2)
    syncAppearancePasses(e)
    const passes = passesIn(layer) as any[]
    const fills = passes.filter((p) => p.fillColor)
    const strokes = passes.filter((p) => p.strokeColor)
    expect(fills.length).toBe(1)
    expect(strokes.length).toBe(1)
    // Otherwise a pass would repaint the other paint and change the composite.
    for (const p of fills) expect(p.strokeColor).toBeNull()
    for (const p of strokes) expect(p.fillColor).toBeNull()
  })

  it('skips a lower pattern fill rather than faking it', () => {
    const { e, layer, item, appearance } = makeEngine(2, 1)
    // A pattern fill owns a clipped tile group; a pass cannot reproduce one.
    ;(appearance.fills[0] as any).pattern = { type: 'dots', color: '#000000', background: '#ffffff', scale: 1, angle: 0 }
    setAppearanceOnItem(e, item, appearance)
    syncAppearancePasses(e)
    // The lower pattern is dropped, so only the stroke pass remains.
    expect(appearancePassCount(e)).toBe(0)
  })

  it('follows the master geometry', () => {
    const { e, item, layer } = makeEngine(2, 1)
    syncAppearancePasses(e)
    const before = (passesIn(layer)[0] as any).bounds.width

    // A live drag: the geometry changes without any history entry.
    ;(item as any).scale(2, new (e.scope as paper.PaperScope).Point(0, 0))
    syncAppearancePasses(e)

    const pass = passesIn(layer)[0] as any
    expect(pass.bounds.width).toBeCloseTo(before * 2, 6)
  })

  it('rebuilds when the stack changes, not just the geometry', () => {
    const { e, item, layer, appearance } = makeEngine(2, 1)
    syncAppearancePasses(e)
    expect(appearancePassCount(e)).toBe(1)

    // Third fill added: two passes now, and the old one is gone (not stacked).
    appearance.fills.push({ ...appearance.fills[1], id: 'f2', color: '#123456' })
    setAppearanceOnItem(e, item, appearance)
    syncAppearancePasses(e)
    expect(appearancePassCount(e)).toBe(2)
    expect(passesIn(layer).length).toBe(2)
  })

  it('drops the passes when the stack collapses to one paint', () => {
    const { e, item, layer, appearance } = makeEngine(3, 1)
    syncAppearancePasses(e)
    expect(passesIn(layer).length).toBe(2)

    appearance.fills = [appearance.fills[2]]
    appearance.strokes = []
    setAppearanceOnItem(e, item, appearance)
    syncAppearancePasses(e)
    expect(appearancePassCount(e)).toBe(0)
    expect(passesIn(layer).length).toBe(0)
  })

  it('does not rebuild when nothing changed', () => {
    const { e, layer } = makeEngine(2, 1)
    syncAppearancePasses(e)
    const first = passesIn(layer)[0]
    syncAppearancePasses(e)
    syncAppearancePasses(e)
    // Same objects: a rebuild every frame would be visible as flicker and
    // would cost a clone per frame.
    expect(passesIn(layer)[0]).toBe(first)
  })

  it('is invisible to the object tree and to the artwork list', () => {
    const { e } = makeEngine(3, 2)
    syncAppearancePasses(e)
    const userItems = getUserItems(e)
    expect(userItems.length).toBe(1)
    expect(String((userItems[0] as any).data.id)).toBe('master')
    const tree = listLayerTree(e, 'layer-1')
    expect(tree.length).toBe(1)
    expect(tree[0].id).toBe('master')
  })

  it('gives the passes no id and locks them', () => {
    const { e, layer } = makeEngine(2, 1)
    syncAppearancePasses(e)
    for (const pass of passesIn(layer) as any[]) {
      // No id: a pass must not be selectable or styleable as its own object.
      expect(pass.data.id).toBeUndefined()
      expect(pass.data.isUserItem).toBe(false)
      // Locked is the editor's "not grabbable" marker.
      expect(pass.locked).toBe(true)
    }
  })

  it('drops every pass on request', () => {
    const { e, layer } = makeEngine(3, 3)
    syncAppearancePasses(e)
    expect(appearancePassCount(e)).toBe(4)
    dropAppearancePasses(e)
    expect(appearancePassCount(e)).toBe(0)
    expect(passesIn(layer).length).toBe(0)
  })

  it('forgets passes whose master was deleted', () => {
    const { e, item, layer } = makeEngine(2, 1)
    syncAppearancePasses(e)
    expect(appearancePassCount(e)).toBe(1)
    item.remove()
    syncAppearancePasses(e)
    expect(appearancePassCount(e)).toBe(0)
    expect(layer.children.filter((c) => isAppearancePass(c as paper.Item)).length).toBe(0)
  })

  it('rebuilds after a restore replaced the master object', () => {
    const { e, layer } = makeEngine(2, 1)
    syncAppearancePasses(e)
    // A history restore drops the tree and re-imports it: the registry's
    // master is now a detached object.
    ;(layer as any).removeChildren()
    const restored = new (e.scope as paper.PaperScope).Path.Rectangle({
      from: new (e.scope as paper.PaperScope).Point(0, 0),
      to: new (e.scope as paper.PaperScope).Point(100, 100),
    }) as paper.Path
    restored.data = { id: 'master', isUserItem: true, appearance: makeEngine(2, 1).appearance }
    layer.addChild(restored)
    syncAppearancePasses(e)
    expect(appearancePassCount(e)).toBe(1)
    expect(passesIn(layer)[0]).not.toBeNull()
  })

  it('survives a stack that has no appearance data at all', () => {
    const { e, item } = makeEngine(2, 1)
    delete (item.data as any).appearance
    expect(() => syncAppearancePasses(e)).not.toThrow()
    expect(appearancePassCount(e)).toBe(0)
  })
})

describe('installAppearancePassHook', () => {
  it('syncs before every draw, so a pass is never a frame behind', () => {
    const { e, item, layer } = makeEngine(2, 1)
    installAppearancePassHook(e)
    // No explicit sync: the geometry changes and the caller only repaints,
    // which is what every mutation in the editor ends with.
    ;(item as any).scale(3, new (e.scope as paper.PaperScope).Point(0, 0))
    e.scope.view.update()
    expect(passesIn(layer).length).toBe(1)
    expect((passesIn(layer)[0] as any).bounds.width).toBeCloseTo(300, 6)
  })

  it('is installed once, however many times it is called', () => {
    const { e } = makeEngine(2, 1)
    installAppearancePassHook(e)
    const wrapped = e.scope.view.update
    installAppearancePassHook(e)
    expect(e.scope.view.update).toBe(wrapped)
  })

  it('still draws when a pass cannot be built', () => {
    const { e, item } = makeEngine(2, 1)
    installAppearancePassHook(e)
    // A master whose parent vanished: the pass builder bails, and the draw
    // must still happen.
    item.remove()
    expect(() => e.scope.view.update()).not.toThrow()
  })
})

/** Unused import guard: AppearanceState is part of the public shape above. */
export type { AppearanceState }
