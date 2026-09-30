/**
 * Width profiles: the geometry and the data contract.
 *
 * Two things are worth locking down. First the profile math, because a
 * variable width is sampled from it and a wrong scale is a wrong shape. Second
 * the round-trip — expand, then release — because the whole point of keeping
 * the profile and the source path is that the stroke comes back; a release
 * that loses the stroke would be worse than the destructive expand it
 * replaced.
 */
import { describe, expect, it } from 'vitest'
import paper from 'paper'
import {
  clampStop,
  defaultWidthProfiles,
  expandVariableWidth,
  flatStops,
  makeProfile,
  normalizeProfile,
  normalizeStops,
  profileMaxWidth,
  scaleAt,
} from './width-profile'
import {
  applyWidthProfileToSelection,
  expandWithProfile,
  releaseWidthProfile,
  updateItemWidthProfile,
  widthProfileOf,
} from '../engine-width'
import type { EditorEngine } from '../engine'

/** A scope with one user layer and a stroked horizontal path. */
function makeEngine() {
  const scope = new paper.PaperScope()
  scope.setup(document.createElement('canvas'))
  const layer = new scope.Layer()
  layer.data.isUserLayer = true
  scope.project.addLayer(layer)

  const path = new scope.Path({
    segments: [
      new scope.Segment(new scope.Point(0, 0)),
      new scope.Segment(new scope.Point(100, 0)),
    ],
  })
  ;(path as any).strokeColor = new scope.Color('#ff0000')
  ;(path as any).strokeWidth = 10
  path.data.id = 'p1'
  path.data.isUserItem = true
  layer.addChild(path)

  const history: string[] = []
  let selection: paper.Item[] = [path]
  const e = {
    scope,
    project: scope.project,
    getActiveLayer: () => layer,
    getSelection: () => selection,
    genId: () => `gen${Math.round(performance.now() * 1000) % 100000}`,
    selectItem: (item: paper.Item) => {
      selection = [item]
    },
    pushHistory: (name: string) => history.push(name),
    showStatus: () => {},
  } as unknown as EditorEngine
  return { e, scope, layer, path, history }
}

describe('profile stops', () => {
  it('clamps a stop into the range a drag can reach', () => {
    expect(clampStop({ offset: -2, scale: 99 })).toEqual({ offset: 0, scale: 5 })
    expect(clampStop({ offset: 4, scale: 0 })).toEqual({ offset: 1, scale: 0.05 })
  })

  it('sorts stops and drops duplicates at the same offset', () => {
    const stops = normalizeStops([
      { offset: 0.8, scale: 2 },
      { offset: 0.1, scale: 0.5 },
      { offset: 0.8, scale: 3 },
    ])
    expect(stops).toEqual([{ offset: 0.1, scale: 0.5 }, { offset: 0.8, scale: 2 }])
  })

  it('falls back to a flat profile on junk', () => {
    expect(normalizeStops(null)).toEqual(flatStops())
    expect(normalizeStops('nope')).toEqual(flatStops())
    // Unusable numbers become one constant stop, which renders as a flat
    // stroke: a profile with no usable scale data still has to draw something.
    expect(normalizeStops([{ offset: 'x', scale: null }])).toEqual([{ offset: 0, scale: 1 }])
  })

  it('parses a half-written profile without losing the item', () => {
    const p = normalizeProfile({ name: 'x'.repeat(80), stops: 'nope' }, 'id-1')
    expect(p.id).toBe('id-1')
    expect(p.name).toHaveLength(40)
    expect(p.stops).toEqual(flatStops())
    expect(p.baseWidth).toBe(1)
  })
})

describe('scaleAt', () => {
  it('is flat for a flat profile', () => {
    const p = makeProfile('', '', 4, flatStops())
    expect(scaleAt(p, 0)).toBe(1)
    expect(scaleAt(p, 0.5)).toBe(1)
    expect(scaleAt(p, 1)).toBe(1)
  })

  it('interpolates linearly between stops', () => {
    const p = makeProfile('', '', 1, [
      { offset: 0, scale: 0.5 },
      { offset: 1, scale: 2.5 },
    ])
    expect(scaleAt(p, 0.25)).toBe(1)
    expect(scaleAt(p, 0.75)).toBe(2)
  })

  it('clamps a stop scale to the reachable range', () => {
    // A zero scale is a real pinch request, and the minimum is 5%: the drag
    // cannot go below it, and neither can a profile.
    const p = makeProfile('', '', 1, [
      { offset: 0, scale: 0 },
      { offset: 1, scale: 4 },
    ])
    expect(p.stops[0].scale).toBe(0.05)
    expect(scaleAt(p, 0)).toBe(0.05)
  })

  it('holds the end value outside the stop range', () => {
    const p = makeProfile('', '', 1, [
      { offset: 0.25, scale: 0.5 },
      { offset: 0.75, scale: 2 },
    ])
    expect(scaleAt(p, 0)).toBe(0.5)
    expect(scaleAt(p, 1)).toBe(2)
  })

  it('reports the widest point in document units', () => {
    const p = makeProfile('', '', 12, [
      { offset: 0, scale: 1 },
      { offset: 0.5, scale: 3 },
    ])
    expect(profileMaxWidth(p)).toBe(36)
  })
})

describe('expandVariableWidth', () => {
  it('gives a straight stroke a wider middle than its ends', () => {
    const { scope, path } = makeEngine()
    const built = expandVariableWidth(
      scope,
      path,
      makeProfile('', '', 10, [
        { offset: 0, scale: 0.2 },
        { offset: 0.5, scale: 1 },
        { offset: 1, scale: 0.2 },
      ]),
    )
    expect(built).not.toBeNull()
    const b = built!.bounds
    // Tapered ends: the outline is taller than the uniform 10pt stroke, and
    // still about as long as the 100pt path.
    expect(b.height).toBeGreaterThan(9)
    expect(b.height).toBeLessThan(13)
    expect(b.width).toBeGreaterThan(95)
    expect(b.width).toBeLessThan(110)
  })

  it('keeps a flat profile the width of the stroke', () => {
    const { scope, path } = makeEngine()
    const built = expandVariableWidth(scope, path, makeProfile('', '', 10, flatStops()))!
    expect(built.bounds.height).toBeGreaterThan(9)
    expect(built.bounds.height).toBeLessThan(11)
  })

  it('takes the stroke paint and drops the stroke', () => {
    const { scope, path } = makeEngine()
    const built = expandVariableWidth(scope, path, makeProfile('', '', 10, flatStops()))!
    expect(built.strokeColor).toBeNull()
    const fill = built.fillColor
    expect(fill && (fill as any).toCSS(true)).toBe('#ff0000')
  })

  it('refuses a profile with no width to scale', () => {
    const { scope, path } = makeEngine()
    // Built raw rather than through makeProfile, which normalizes a zero base
    // width to 1: this covers the guard in the expansion itself.
    const zero = { id: '', name: '', baseWidth: 0, stops: flatStops() }
    expect(expandVariableWidth(scope, path, zero)).toBeNull()
  })

  it('gives a closed path no end caps', () => {
    const { scope, path } = makeEngine()
    // A circle outline: two rails around the centerline, closed, so the
    // outline is a ring rather than a bar with rounded ends.
    const circle = new scope.Path.Circle(new scope.Point(50, 50), 30)
    ;(circle as any).strokeColor = new scope.Color('#000000')
    ;(circle as any).strokeWidth = 8
    const built = expandVariableWidth(scope, circle, makeProfile('', '', 8, flatStops()))!
    expect(built.closed).toBe(true)
    expect(built.bounds.width).toBeGreaterThan(64)
    expect(built.bounds.width).toBeLessThan(70)
  })

  it('ships built-in profiles that are all usable', () => {
    const list = defaultWidthProfiles()
    expect(list.length).toBeGreaterThanOrEqual(3)
    for (const p of list) {
      expect(p.name).toBeTruthy()
      expect(p.stops.length).toBeGreaterThanOrEqual(2)
      expect(p.baseWidth).toBeGreaterThan(0)
    }
    expect(new Set(list.map((p) => p.id)).size).toBe(list.length)
  })
})

describe('expand / release round-trip', () => {
  it('keeps the stroke recoverable and the id stable', () => {
    const { e, path } = makeEngine()
    const built = expandWithProfile(e, path, makeProfile('', 'Taper', 10, [
      { offset: 0, scale: 0.2 },
      { offset: 1, scale: 1 },
    ]))!
    // Same object identity, new rendering: this is the non-destructive part.
    expect(built.data.id).toBe('p1')
    expect((built.data as any).widthProfile.stops).toHaveLength(2)
    expect(built.strokeColor).toBeNull()

    expect(releaseWidthProfile(e, built)).toBe(true)
    const back = e.getActiveLayer().children[0] as any
    expect(back.data.id).toBe('p1')
    expect(back.strokeWidth).toBe(10)
    expect((back.strokeColor as any).toCSS(true)).toBe('#ff0000')
    expect((back.data as any).widthProfile).toBeUndefined()
    expect(e.getSelection()[0]).toBe(back)
  })

  it('re-expands with a different profile without a source file', () => {
    const { e, path } = makeEngine()
    const first = expandWithProfile(e, path, makeProfile('', 'A', 10, [
      { offset: 0, scale: 0.2 },
      { offset: 1, scale: 1 },
    ]))!
    const beforeId = first.data.id
    const ok = updateItemWidthProfile(
      e,
      first,
      makeProfile('', 'B', 20, [
        { offset: 0, scale: 1 },
        { offset: 0.5, scale: 0.2 },
        { offset: 1, scale: 1 },
      ]),
    )
    expect(ok).toBe(true)
    const second = e.getActiveLayer().children[0] as any
    expect(second.data.id).toBe(beforeId)
    expect(widthProfileOf(e, second)?.name).toBe('B')
    // 20pt at the ends against the first profile's 10pt: it really re-expanded.
    expect(second.bounds.height).toBeGreaterThan(19)
  })

  it('refuses to release an item that never had a profile', () => {
    const { e, path } = makeEngine()
    expect(releaseWidthProfile(e, path)).toBe(false)
    expect(updateItemWidthProfile(e, path, makeProfile('', '', 1, flatStops()))).toBe(false)
    expect(widthProfileOf(e, path)).toBeNull()
  })

  it('records one history entry per committed change', () => {
    const { e, path, history } = makeEngine()
    const built = expandWithProfile(e, path, makeProfile('', '', 10, flatStops()))!
    expect(history).toEqual(['Apply Width Profile'])
    releaseWidthProfile(e, built)
    expect(history).toEqual(['Apply Width Profile', 'Release Width Profile'])
  })
})

describe('applyWidthProfileToSelection', () => {
  it('expands a selected stroke and keeps the stroke width as the base', () => {
    const { e, path, history } = makeEngine()
    const done = applyWidthProfileToSelection(e, makeProfile('p', 'Spike', 3, [
      { offset: 0, scale: 1 },
      { offset: 1, scale: 0.2 },
    ]))
    expect(done).toBe(1)
    // The panel's 10pt stroke wins over the profile's own base width: a
    // profile is a shape, not a width.
    const built = e.getActiveLayer().children[0] as any
    expect(built.data.widthProfile.baseWidth).toBe(10)
    expect(history).toEqual(['Apply Width Profile'])
  })

  it('reports doing nothing without a stroked path', () => {
    const { e, path } = makeEngine()
    ;(path as any).strokeColor = null
    expect(applyWidthProfileToSelection(e, makeProfile('p', 'x', 4, flatStops()))).toBe(0)
  })
})
