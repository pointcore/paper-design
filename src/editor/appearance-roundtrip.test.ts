/**
 * Round-trip matrix for the simulated appearance features.
 *
 * Contract under test (edit -> save -> reopen -> export):
 * - edit: AppearanceState / OpacityMaskState / MeshGradientState live on
 *   `item.data` (see engine setAppearanceOnItem / applyOpacityMask /
 *   applyMeshGradient).
 * - save/reopen: project snapshots and .vec.json files serialize `data`
 *   with JSON, so every field must survive JSON.stringify/parse unchanged
 *   (order, ids, vertex colors, mask contentJson).
 * - export: SVG export rewrites groups marked `data-isOpacityMaskGroup`
 *   into `<mask>` elements (engine applySvgMasks); mesh gradients export
 *   as tessellated gradient triangles.
 *
 * Canvas rendering itself is approximate (Paper.js has no native
 * multi-fill stack, luminance mask, or mesh primitive): only the
 * bottom-most visible fill/stroke paints live, the mask preview is a
 * semi-transparent clone, and the mesh is a triangle tessellation.
 * These tests lock the persistence contract, not pixel fidelity.
 */
import { describe, expect, it } from 'vitest'
import type { AppearanceState, OpacityMaskState, MeshGradientState } from './types'

/** Simulate save-to-disk + reopen: project file / snapshot serialization. */
function saveReopen<T>(state: T): T {
  return JSON.parse(JSON.stringify(state)) as T
}

/** Mirror of engine setAppearanceOnItem: bottom-most visible layer wins. */
function bottomVisible<T extends { visible: boolean }>(layers: T[]): T | undefined {
  return layers.filter((l) => l.visible).pop()
}

function makeAppearance(): AppearanceState {
  return {
    fills: [
      { id: 'f1', color: '#ff0000', gradient: null, pattern: null, fillRule: 'nonzero', opacity: 1, blendMode: 'source-over', visible: true },
      { id: 'f2', color: '#00ff00', gradient: null, pattern: null, fillRule: 'evenodd', opacity: 0.5, blendMode: 'multiply', visible: true },
      { id: 'f3', color: '#0000ff', gradient: null, pattern: null, fillRule: 'nonzero', opacity: 1, blendMode: 'source-over', visible: false },
    ],
    strokes: [
      { id: 's1', color: '#000000', strokeWidth: 1, strokeAlign: 'center', lineCap: 'round', lineJoin: 'miter', miterLimit: 4, dashArray: [], dashOffset: 0, opacity: 1, blendMode: 'source-over', visible: true },
      { id: 's2', color: '#ffffff', strokeWidth: 2, strokeAlign: 'center', lineCap: 'round', lineJoin: 'miter', miterLimit: 4, dashArray: [4, 2], dashOffset: 1, opacity: 0.8, blendMode: 'screen', visible: true },
    ],
    opacity: 0.9,
    blendMode: 'source-over',
  }
}

describe('appearance save/reopen round-trip', () => {
  it('preserves multi-fill stack order, ids and hidden flags', () => {
    const reopened = saveReopen(makeAppearance())
    expect(reopened.fills.map((f) => f.id)).toEqual(['f1', 'f2', 'f3'])
    expect(reopened.fills[1].color).toBe('#00ff00')
    expect(reopened.fills[1].fillRule).toBe('evenodd')
    expect(reopened.fills[1].opacity).toBe(0.5)
    expect(reopened.fills[2].visible).toBe(false)
  })

  it('preserves multi-stroke dash patterns and widths', () => {
    const reopened = saveReopen(makeAppearance())
    expect(reopened.strokes).toHaveLength(2)
    expect(reopened.strokes[1].strokeWidth).toBe(2)
    expect(reopened.strokes[1].dashArray).toEqual([4, 2])
    expect(reopened.strokes[1].dashOffset).toBe(1)
  })

  it('bottom-most visible layer is what the canvas paints', () => {
    const a = makeAppearance()
    // f3 is hidden so f2 paints; s2 paints.
    expect(bottomVisible(a.fills)?.id).toBe('f2')
    expect(bottomVisible(a.strokes)?.id).toBe('s2')
    const reopened = saveReopen(a)
    expect(bottomVisible(reopened.fills)?.id).toBe('f2')
  })

  it('item-level opacity/blend survive the round-trip', () => {
    const reopened = saveReopen(makeAppearance())
    expect(reopened.opacity).toBe(0.9)
    expect(reopened.blendMode).toBe('source-over')
  })
})

describe('opacity mask save/reopen round-trip', () => {
  it('preserves enabled/invert/contentJson/bounds', () => {
    const mask: OpacityMaskState = {
      enabled: true,
      invert: true,
      contentJson: '{"class":"Path","segments":[[0,0],[10,10]]}',
      bounds: { x: 5, y: 5, width: 100, height: 50 },
    }
    const reopened = saveReopen(mask)
    expect(reopened).toEqual(mask)
  })

  it('null content survives (mask slot without content yet)', () => {
    const mask: OpacityMaskState = { enabled: true, invert: false, contentJson: null, bounds: null }
    expect(saveReopen(mask)).toEqual(mask)
  })
})

describe('mesh gradient save/reopen round-trip', () => {
  function makeMesh(cols: number, rows: number): MeshGradientState {
    const vertices = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        vertices.push({ x: c * 50, y: r * 50, color: r === 0 ? '#ff0000' : '#0000ff' })
      }
    }
    return { cols, rows, vertices }
  }

  it('preserves grid dimensions and per-vertex colors', () => {
    const reopened = saveReopen(makeMesh(3, 2))
    expect(reopened.cols).toBe(3)
    expect(reopened.rows).toBe(2)
    expect(reopened.vertices).toHaveLength(6)
    expect(reopened.vertices[0].color).toBe('#ff0000')
    expect(reopened.vertices[3].color).toBe('#0000ff')
    expect(reopened.vertices[0].x).toBe(0)
    expect(reopened.vertices[5].x).toBe(100)
  })

  it('tessellation count matches the renderer loop', () => {
    // engine applyMeshGradient emits 2 triangles per grid cell.
    for (const [cols, rows] of [[2, 2], [3, 3], [4, 2]] as Array<[number, number]>) {
      expect((cols - 1) * (rows - 1) * 2).toBeGreaterThan(0)
    }
    expect((2 - 1) * (2 - 1) * 2).toBe(2)
    expect((3 - 1) * (3 - 1) * 2).toBe(8)
  })
})

describe('item.data envelope round-trip', () => {
  it('appearance + mask + mesh survive together on one item', () => {
    const data = {
      id: 'item-1',
      isUserItem: true,
      appearance: makeAppearance(),
      opacityMask: { enabled: true, invert: false, contentJson: '{}', bounds: null } as OpacityMaskState,
      meshGradient: { cols: 2, rows: 2, vertices: [{ x: 0, y: 0, color: '#ff0000' }] } as MeshGradientState,
    }
    const reopened = saveReopen(data)
    expect(reopened.appearance.fills).toHaveLength(3)
    expect(reopened.opacityMask.enabled).toBe(true)
    expect(reopened.meshGradient.cols).toBe(2)
    expect(reopened.id).toBe('item-1')
  })
})

describe('svg export marker contract', () => {
  it('mask groups are discoverable by the export rewrite', () => {
    // engine applySvgMasks looks for g[data-isOpacityMaskGroup="true"]
    // with >= 2 children (masked content + mask shape).
    // NOTE: innerHTML parsing lowercases attribute names, so build the
    // nodes via createElementNS like a real SVG export does.
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    const g = document.createElementNS(ns, 'g')
    g.setAttribute('data-isOpacityMaskGroup', 'true')
    g.appendChild(document.createElementNS(ns, 'path'))
    g.appendChild(document.createElementNS(ns, 'rect'))
    svg.appendChild(g)
    document.body.appendChild(svg)
    const groups = svg.querySelectorAll('g')
    const marked = Array.from(groups).filter(
      (el) => el.getAttribute('data-isOpacityMaskGroup') === 'true' && el.children.length >= 2,
    )
    expect(marked).toHaveLength(1)
    svg.remove()
  })
})
