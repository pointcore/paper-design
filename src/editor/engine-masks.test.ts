/**
 * Opacity-mask composition, off-screen.
 *
 * The canvas pixels are covered by the e2e spec; what is worth locking down
 * here is the arrangement the clip depends on, because it is easy to reorder
 * by accident: paper clips a group's *other* children to the child flagged
 * `clipMask`, so the shape has to come first and carry no paint of its own.
 */
import { describe, expect, it } from 'vitest'
import paper from 'paper'
import {
  applyOpacityMask,
  getOpacityMask,
  maskCompositeNote,
  opacityMaskGroup,
  removeOpacityMask,
  toggleOpacityMask,
} from './engine-masks'
import type { EditorEngine } from './engine'

/** A scope with one user layer, a content rect and a mask circle. */
function makeEngine() {
  const scope = new paper.PaperScope()
  scope.setup(document.createElement('canvas'))
  const layer = new scope.Layer()
  layer.data.isUserLayer = true
  scope.project.addLayer(layer)

  const content = new scope.Path.Rectangle({
    from: new scope.Point(0, 0),
    to: new scope.Point(200, 200),
  })
  content.fillColor = new scope.Color('#0000ff')
  content.data.id = 'content'
  content.data.isUserItem = true
  layer.addChild(content)

  const mask = new scope.Path.Circle(new scope.Point(100, 100), 40)
  mask.fillColor = new scope.Color('#ffffff')
  mask.data.id = 'mask'
  mask.data.isUserItem = true
  layer.addChild(mask)

  let selection: paper.Item[] = []
  const e = {
    scope,
    project: scope.project,
    getActiveLayer: () => layer,
    genId: (() => {
      let n = 0
      return () => `gen${++n}`
    })(),
    getSelection: () => selection,
    syncSelectionToStore: () => {
      selection = scope.project.getItems({ match: (it: paper.Item) => it.selected })
    },
  } as unknown as EditorEngine
  return { e, scope, layer, content, mask }
}

describe('applyOpacityMask', () => {
  it('groups the content under a clip shape that paints nothing', () => {
    const { e, scope, content, mask } = makeEngine()
    applyOpacityMask(e, content, mask)

    const group = layer0(e)
    expect(group).not.toBeNull()
    expect((group as unknown as paper.Group).data.isOpacityMaskGroup).toBe(true)
    const kids = (group as unknown as paper.Group).children
    // The clip shape must be the *first* child: paper clips the group's other
    // children to the one flagged as the clip mask.
    expect((kids[0] as any).data.isOpacityMaskShape).toBe(true)
    expect((kids[0] as any).clipMask).toBe(true)
    expect((kids[0] as any).fillColor).toBeNull()
    expect((kids[0] as any).strokeColor).toBeNull()
    expect((kids[1] as any).data.isOpacityMaskContent).toBe(true)
    expect((kids[1] as any).data.id).toBe('content')
    expect(scope.project.getItems({ class: scope.Path }).length).toBe(2)
  })

  it('consumes the mask source instead of leaving it on top of the artwork', () => {
    const { e, content, mask } = makeEngine()
    applyOpacityMask(e, content, mask)
    // The original circle is gone; only the clip shape inside the group is
    // left, and it is not artwork.
    expect(mask.parent).toBeNull()
    const shapes = (opacityMaskGroup(e, findContent(e)) as paper.Group).children.filter(
      (k) => (k.data as any).isOpacityMaskShape,
    )
    expect(shapes.length).toBe(1)
    expect((shapes[0] as any).data.isUserItem).toBe(false)
  })

  it('keeps the mask state on the masked content', () => {
    const { e, content, mask } = makeEngine()
    applyOpacityMask(e, content, mask)
    const state = getOpacityMask(e, findContent(e))
    expect(state).not.toBeNull()
    expect(state?.contentJson).toContain('Path')
    expect(state?.bounds?.width).toBe(80)
  })

  it('records the disabled state on the content as well', () => {
    const { e, content, mask } = makeEngine()
    applyOpacityMask(e, content, mask)
    const masked = findContent(e)
    toggleOpacityMask(e, masked, false)
    expect(getOpacityMask(e, masked)?.enabled).toBe(false)
    expect(getOpacityMask(e, opacityMaskGroup(e, masked) as paper.Item)?.enabled).toBe(false)
  })
})

describe('toggleOpacityMask', () => {
  it('turns the clip off and on again, not just a flag', () => {
    const { e, content, mask } = makeEngine()
    applyOpacityMask(e, content, mask)
    const masked = findContent(e)
    const shape = (opacityMaskGroup(e, masked) as paper.Group).children.find(
      (k) => (k.data as any).isOpacityMaskShape,
    ) as any
    expect(shape.clipMask).toBe(true)
    toggleOpacityMask(e, masked, false)
    expect(shape.clipMask).toBe(false)
    toggleOpacityMask(e, masked, true)
    expect(shape.clipMask).toBe(true)
  })
})

describe('removeOpacityMask', () => {
  it('brings the artwork back and drops the clip shape', () => {
    const { e, content, mask } = makeEngine()
    applyOpacityMask(e, content, mask)
    const masked = findContent(e)
    removeOpacityMask(e, masked)

    expect(layer0(e)).toBeNull()
    const paths = e.project.getItems({ class: e.scope.Path })
    expect(paths.length).toBe(1)
    expect((paths[0] as any).data.id).toBe('content')
    expect((paths[0] as any).data.isOpacityMaskContent).toBeUndefined()
    expect(getOpacityMask(e, paths[0])).toBeNull()
  })

  it('accepts the group itself, as the panel hands it over', () => {
    const { e, content, mask } = makeEngine()
    applyOpacityMask(e, content, mask)
    removeOpacityMask(e, layer0(e) as paper.Item)
    expect(layer0(e)).toBeNull()
    expect(e.project.getItems({ class: e.scope.Path }).length).toBe(1)
  })
})

describe('maskCompositeNote', () => {
  it('says nothing about an item that is not masked', () => {
    const { e, content } = makeEngine()
    expect(maskCompositeNote(e, content)).toBeNull()
    expect(maskCompositeNote(e, null)).toBeNull()
  })

  it('describes the silhouette of a flat shape', () => {
    const { e, content, mask } = makeEngine()
    applyOpacityMask(e, content, mask)
    expect(maskCompositeNote(e, findContent(e))).toBe('Composites as the shape silhouette')
  })

  it('warns that a gradient mask loses its tones', () => {
    const { e, scope, layer, content } = makeEngine()
    const shape = new scope.Path.Rectangle({
      from: new scope.Point(0, 0),
      to: new scope.Point(200, 200),
    })
    const gradient = new scope.Gradient()
    gradient.stops = [
      new scope.GradientStop(new scope.Color('#000000'), 0),
      new scope.GradientStop(new scope.Color('#ffffff'), 1),
    ]
    shape.fillColor = new scope.Color(
      gradient,
      new scope.Point(0, 0),
      new scope.Point(200, 200),
    )
    shape.data.id = 'grad'
    shape.data.isUserItem = true
    layer.addChild(shape)
    applyOpacityMask(e, content, shape)
    const note = maskCompositeNote(e, findContent(e))
    expect(note).toMatch(/gradient silhouette/)
  })

  it('warns that a photo mask loses its tones', () => {
    const { e, scope, layer, content } = makeEngine()
    const raster = new scope.Raster({ width: 20, height: 20 })
    raster.data.id = 'rast'
    raster.data.isUserItem = true
    layer.addChild(raster)
    applyOpacityMask(e, content, raster)
    expect(maskCompositeNote(e, findContent(e))).toMatch(/photo silhouette/)
  })
})

/** The mask group in the document, or null. */
function layer0(e: EditorEngine): paper.Item | null {
  const groups = e.project.getItems({ class: e.scope.Group }) as paper.Group[]
  return groups.find((g) => (g.data as any)?.isOpacityMaskGroup) ?? null
}

/** The masked content inside the group. */
function findContent(e: EditorEngine): paper.Item {
  const group = layer0(e) as paper.Group
  return group.children.find((k) => (k.data as any)?.isOpacityMaskContent) as paper.Item
}
