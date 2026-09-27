/**
 * Engine-level geometry integration tests (C3 remainder): the join and
 * pathfinder domain functions run against a REAL Paper.js scope so the
 * paper bridge (segment cloning, walk orientation, boolean math) is
 * exercised end to end, not just the pure decision cores.
 *
 * The engine is a stub over a real project: the domain functions take the
 * engine as an explicit first argument and only need selection, layer,
 * style and history hooks plus `scope`. jsdom has no 2D canvas backend,
 * so `src/test-setup.ts` serves a no-op context — geometry is pure path
 * math and never rasterizes, which keeps the view harmless.
 */
import { describe, expect, it } from 'vitest'
import paper from 'paper'
import { joinPaths, mergePathsEndToEnd } from './engine-join'
import { booleanOperation } from './engine-pathfinder'
import type { EditorEngine } from './engine'

function makeEngine() {
  const scope = new paper.PaperScope()
  scope.setup(document.createElement('canvas'))
  const project = scope.project
  const history: string[] = []
  let ids = 0
  const e = {
    scope,
    project,
    // paper's runtime exposes getSelectedItems(); its bundled types only
    // declare the `selectedItems` getter, hence the cast.
    getSelection: () => (project as unknown as { getSelectedItems(): paper.Item[] }).getSelectedItems(),
    getActiveLayer: () => project.activeLayer,
    clearSelection: () => {
      for (const item of (project as unknown as { getSelectedItems(): paper.Item[] }).getSelectedItems()) {
        item.selected = false
      }
    },
    syncSelectionToStore: () => {},
    pushHistory: (name: string) => {
      history.push(name)
    },
    genId: () => `gid-${++ids}`,
    applyStyleToItem: () => {},
    getStyleFromItem: () => null,
  } as unknown as EditorEngine
  return { e, scope, project, history }
}

function polyline(scope: typeof paper, pts: Array<[number, number]>): paper.Path {
  return new scope.Path({ segments: pts.map(([x, y]) => [x, y]) })
}

describe('joinPaths (engine-level)', () => {
  it('joins coincident ends without reversing the second path', () => {
    const { e, scope, project, history } = makeEngine()
    const a = polyline(scope, [[0, 0], [10, 0]])
    const b = polyline(scope, [[10, 0], [15, 5], [20, 0]])
    a.selected = b.selected = true

    expect(joinPaths(e)).toBe(true)
    expect(history).toEqual(['Join Paths'])
    const paths = project.activeLayer.children
    expect(paths.length).toBe(1)
    const merged = paths[0] as paper.Path
    // The walk must not flip B: the free end stays at (20,0) and no chord
    // through B's interior appears (the pre-fix bug ended at (10,0) with a
    // doubled anchor).
    expect(merged.segments.map((s) => [s.point.x, s.point.y])).toEqual([
      [0, 0], [10, 0], [15, 5], [20, 0],
    ])
    expect(merged.closed).toBe(false)
  })

  it('bridges a gap between the nearest ends', () => {
    const { e, scope, project } = makeEngine()
    polyline(scope, [[0, 0], [10, 0]]).selected = true
    polyline(scope, [[12, 0], [20, 0]]).selected = true

    expect(joinPaths(e)).toBe(true)
    const merged = project.activeLayer.children[0] as paper.Path
    expect(merged.segments.map((s) => [s.point.x, s.point.y])).toEqual([
      [0, 0], [10, 0], [12, 0], [20, 0],
    ])
  })

  it('orients a reversed second path by its nearest end', () => {
    // B is stored tail-first: its LAST point touches A's last point.
    const { e, scope, project } = makeEngine()
    polyline(scope, [[0, 0], [10, 0]]).selected = true
    polyline(scope, [[20, 0], [10, 0]]).selected = true

    expect(joinPaths(e)).toBe(true)
    const merged = project.activeLayer.children[0] as paper.Path
    expect(merged.segments.map((s) => [s.point.x, s.point.y])).toEqual([
      [0, 0], [10, 0], [20, 0],
    ])
  })

  it('refuses anything but exactly two open paths', () => {
    const { e, scope } = makeEngine()
    expect(joinPaths(e)).toBe(false)
    polyline(scope, [[0, 0], [5, 0]]).selected = true
    expect(joinPaths(e)).toBe(false)
  })
})

describe('mergePathsEndToEnd (sub-selection join contract)', () => {
  it('ends the first walk and starts the second walk at the anchors', () => {
    // Same convention select-controller uses: firstIdx === 0 (anchor is
    // A's first segment) and secondIdx !== 0 (anchor is B's last). Both
    // anchors coincide at (0,0), so the junction merges into one anchor.
    const { e, scope, project, history } = makeEngine()
    const a = polyline(scope, [[0, 0], [10, 0]])
    const b = polyline(scope, [[20, 0], [0, 0]])

    expect(mergePathsEndToEnd(e, a, b, true, true)).toBe(true)
    expect(history).toEqual(['Join Paths'])
    const merged = project.activeLayer.children[0] as paper.Path
    // First reversed: 10,0 -> 0,0 (ends at its anchor). Second reversed:
    // 0,0 -> 20,0 (starts at its anchor). The coincident junction is one
    // anchor, so the chain is continuous.
    expect(merged.segments.map((s) => [s.point.x, s.point.y])).toEqual([
      [10, 0], [0, 0], [20, 0],
    ])
  })
})

/** Signed child areas can cancel in a CompoundPath (exclude winds its
 * pieces oppositely), so shape size is measured as the sum of |area|.
 * `area` is missing from paper's PathItem type, hence the reads via cast. */
function absArea(item: paper.Item): number {
  const kids = (item as paper.CompoundPath).children as paper.Item[] | undefined
  if (Array.isArray(kids) && kids.length > 0) {
    return kids.reduce((sum, c) => sum + Math.abs((c as unknown as { area: number }).area), 0)
  }
  return Math.abs((item as unknown as { area: number }).area)
}

describe('booleanOperation (engine-level)', () => {
  const R = 10

  /** Lens area of the standard test pair, measured via paper intersect. */
  function lensOf(): number {
    const scope = new paper.PaperScope()
    scope.setup(document.createElement('canvas'))
    const a = new scope.Path.Circle(new scope.Point(0, 0), R)
    const b = new scope.Path.Circle(new scope.Point(10, 0), R)
    const lens = a.intersect(b, { insert: false }) as unknown as { area: number }
    return Math.abs(lens.area)
  }

  function twoCircles(scope: typeof paper) {
    const back = new scope.Path.Circle(new scope.Point(0, 0), R)
    const front = new scope.Path.Circle(new scope.Point(10, 0), R)
    back.selected = front.selected = true
    return { back, front }
  }

  it('intersects to the lens area and replaces both operands', () => {
    const { e, scope, project, history } = makeEngine()
    const { back, front } = twoCircles(scope)
    const lens = lensOf()

    expect(booleanOperation(e, 'intersect')).toBe(true)
    expect(history).toEqual(['Intersect'])
    const result = project.activeLayer.children[0] as paper.Item
    expect(absArea(result)).toBeCloseTo(lens, 0)
    expect(project.activeLayer.children.filter((c) => c === back || c === front).length).toBe(0)
    expect(result.selected).toBe(true)
  })

  it('unites to back + front minus the lens', () => {
    const { e, scope, project, history } = makeEngine()
    const { back, front } = twoCircles(scope)
    const expected = back.area + front.area - lensOf()

    expect(booleanOperation(e, 'unite')).toBe(true)
    expect(history[history.length - 1]).toBe('Unite')
    const result = project.activeLayer.children[0] as paper.Item
    expect(absArea(result)).toBeCloseTo(expected, 0)
  })

  it('subtracts the front operand from the back one', () => {
    const { e, scope, project, history } = makeEngine()
    const { back, front } = twoCircles(scope)
    const expected = back.area - lensOf()

    expect(booleanOperation(e, 'subtract')).toBe(true)
    expect(history[history.length - 1]).toBe('Subtract')
    const result = project.activeLayer.children[0] as paper.Item
    expect(absArea(result)).toBeCloseTo(expected, 0)
  })

  it('excludes to back + front minus twice the lens', () => {
    const { e, scope, project } = makeEngine()
    const { back, front } = twoCircles(scope)
    const expected = back.area + front.area - 2 * lensOf()

    expect(booleanOperation(e, 'exclude')).toBe(true)
    const result = project.activeLayer.children[0] as paper.Item
    expect(absArea(result)).toBeCloseTo(expected, 0)
  })

  it('refuses fewer than two selected paths', () => {
    const { e, scope } = makeEngine()
    expect(booleanOperation(e, 'unite')).toBe(false)
    new scope.Path.Circle(new scope.Point(0, 0), R)
    expect(booleanOperation(e, 'unite')).toBe(false)
  })
})
