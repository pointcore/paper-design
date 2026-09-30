/**
 * Guide domain over a real Paper.js scope.
 *
 * The math is unit tested in guide-geometry.test.ts; what this pins is the
 * part that touches paper: the item data, the endpoints actually written to
 * the segments, and the list/patch round trip the Guides dialog drives. A
 * guide whose data says one thing and whose segments say another renders in
 * the wrong place and snaps in the wrong place, and neither shows up in a
 * geometry-only test.
 */
import { describe, expect, it } from 'vitest'
import paper from 'paper'
import {
  createGuide,
  getGuideGeometry,
  listGuides,
  setGuideGeometry,
  updateGuideById,
} from '../engine-guides'
import type { EditorEngine } from '../engine'
import type { GuideOrientation } from '../types'

function makeEngine() {
  const scope = new paper.PaperScope()
  scope.setup(document.createElement('canvas'))
  const guideLayer = new scope.Layer()
  guideLayer.locked = true
  scope.project.addLayer(guideLayer)
  let ids = 0
  const e = {
    scope,
    project: scope.project,
    getGuideLayer: () => guideLayer,
    genId: () => `g${++ids}`,
    zoom: 1,
    store: { view: { showGuides: true, guidesLocked: false } },
  } as unknown as EditorEngine
  return { e, scope, guideLayer }
}

/** Segment endpoints of a guide item. */
function segmentEnds(guide: paper.Path): Array<{ x: number; y: number }> {
  const segs = guide.segments
  return [
    { x: (segs[0] as paper.Segment).point.x, y: (segs[0] as paper.Segment).point.y },
    {
      x: (segs[segs.length - 1] as paper.Segment).point.x,
      y: (segs[segs.length - 1] as paper.Segment).point.y,
    },
  ]
}

describe('createGuide', () => {
  it('creates an axis-aligned guide at the given coordinate', () => {
    const { e } = makeEngine()
    const guide = createGuide(e, 120, 'vertical')!
    expect(guide).toBeTruthy()
    expect(getGuideGeometry(e, guide)).toEqual({
      orientation: 'vertical',
      position: 120,
      cross: 0,
      angle: 0,
    })
    const [a, b] = segmentEnds(guide)
    expect(a.x).toBe(120)
    expect(b.x).toBe(120)
    expect(b.y).toBeGreaterThan(a.y)
  })

  it('creates a diagonal guide through the anchor at the given angle', () => {
    const { e } = makeEngine()
    const guide = createGuide(e, 200, 'diagonal', { angle: 30, y: 100 })!
    expect(getGuideGeometry(e, guide)).toEqual({
      orientation: 'diagonal',
      position: 200,
      cross: 100,
      angle: 30,
    })
    // The endpoints must be collinear with the anchor along the angle.
    const [a, b] = segmentEnds(guide)
    const dx = b.x - a.x
    const dy = b.y - a.y
    expect(Math.atan2(dy, dx) * (180 / Math.PI)).toBeCloseTo(30, 6)
  })

  it('folds an angle past 180 into the same line', () => {
    const { e } = makeEngine()
    const guide = createGuide(e, 0, 'diagonal', { angle: 225, y: 0 })!
    expect(getGuideGeometry(e, guide)!.angle).toBe(45)
  })

  it('adds the guide to the guide layer even though it is locked', () => {
    const { e, guideLayer } = makeEngine()
    const before = guideLayer.children.length
    createGuide(e, 10, 'horizontal')
    expect(guideLayer.children.length).toBe(before + 1)
    // And the lock is restored: the layer must not be left editable.
    expect(guideLayer.locked).toBe(true)
  })
})

describe('setGuideGeometry', () => {
  it('moves a diagonal guide in both anchor coordinates', () => {
    const { e } = makeEngine()
    const guide = createGuide(e, 0, 'diagonal', { angle: 45, y: 0 })!
    setGuideGeometry(e, guide, { orientation: 'diagonal', position: 50, cross: -20, angle: 45 })
    expect(getGuideGeometry(e, guide)).toEqual({
      orientation: 'diagonal',
      position: 50,
      cross: -20,
      angle: 45,
    })
    // The midpoint of the endpoints is the anchor.
    const [a, b] = segmentEnds(guide)
    expect((a.x + b.x) / 2).toBeCloseTo(50, 6)
    expect((a.y + b.y) / 2).toBeCloseTo(-20, 6)
  })

  it('normalizes the angle it stores', () => {
    const { e } = makeEngine()
    const guide = createGuide(e, 0, 'diagonal', { angle: 0, y: 0 })!
    setGuideGeometry(e, guide, { orientation: 'diagonal', position: 0, cross: 0, angle: -45 })
    expect(getGuideGeometry(e, guide)!.angle).toBe(135)
  })

  it('ignores items that are not guides', () => {
    const { e, scope } = makeEngine()
    const plain = new scope.Path.Line(new scope.Point(0, 0), new scope.Point(10, 10))
    expect(() => setGuideGeometry(e, plain, { orientation: 'diagonal', position: 1, cross: 1, angle: 5 })).not.toThrow()
    expect(getGuideGeometry(e, plain)).toBeNull()
  })
})

describe('listGuides and updateGuideById', () => {
  it('round-trips every field the dialog edits', () => {
    const { e } = makeEngine()
    createGuide(e, 5, 'horizontal')
    const vertical = createGuide(e, 15, 'vertical')!
    createGuide(e, 100, 'diagonal', { angle: -30, y: 200 })

    const listed = listGuides(e)
    expect(listed.length).toBe(3)
    // Top-first, matching the panel's display order.
    expect(listed[0].orientation).toBe('diagonal')
    // -30 is stored canonically as 150: the same line, one representation.
    expect(listed[0]).toMatchObject({ position: 100, cross: 200, angle: 150 })
    expect(listed[2].orientation).toBe('horizontal')

    const id = String((vertical.data as any).guideId)
    expect(updateGuideById(e, id, { position: 77 })).toBe(true)
    expect(getGuideGeometry(e, vertical)!.position).toBe(77)
    // Patching one field leaves the others alone.
    expect(getGuideGeometry(e, vertical)!.orientation).toBe('vertical')
  })

  it('keeps a diagonal angle through a position patch', () => {
    const { e } = makeEngine()
    const guide = createGuide(e, 0, 'diagonal', { angle: 60, y: 0 })!
    const id = String((guide.data as any).guideId)
    updateGuideById(e, id, { position: 40, cross: 40 })
    expect(getGuideGeometry(e, guide)).toMatchObject({ angle: 60, position: 40, cross: 40 })
  })

  it('reports an unknown id instead of throwing', () => {
    const { e } = makeEngine()
    expect(updateGuideById(e, 'nope', { position: 1 })).toBe(false)
    expect(updateGuideById(e, '', { position: 1 })).toBe(false)
  })

  it('treats a guide with a junk orientation as horizontal', () => {
    const { e } = makeEngine()
    const guide = createGuide(e, 33, 'vertical')!
    ;(guide.data as any).guideOrientation = 'sideways'
    expect(getGuideGeometry(e, guide)!.orientation).toBe('horizontal')
  })
})

describe('legacy guides', () => {
  it('reads a guide whose position was stored only in its segments', () => {
    // Before the geometry refactor a guide's coordinate lived in the segment
    // points. A project saved by that version must still open and drag.
    const { e, guideLayer } = makeEngine()
    const legacy = new (e.scope as paper.PaperScope).Path.Line(
      new (e.scope as paper.PaperScope).Point(64, -1e6),
      new (e.scope as paper.PaperScope).Point(64, 1e6)
    ) as paper.Path
    legacy.data.isGuide = true
    legacy.data.guideId = 'legacy-1'
    legacy.data.guideOrientation = 'vertical'
    guideLayer.addChild(legacy)

    const geometry = getGuideGeometry(e, legacy)!
    expect(geometry.orientation).toBe('vertical')
    // No stored position: fall back to the segment, not to 0.
    expect(geometry.position).toBe(64)
  })
})

describe('GuideOrientation', () => {
  it('still accepts the axis-aligned values', () => {
    const values: GuideOrientation[] = ['horizontal', 'vertical', 'diagonal']
    expect(values).toHaveLength(3)
  })
})
