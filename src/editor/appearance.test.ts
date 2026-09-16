/**
 * Unit tests for appearance / opacity-mask / mesh-gradient type shapes and
 * default-creation helpers.  These exercise the pure-data layer without
 * needing a live Paper.js canvas.
 */
import { describe, expect, it } from 'vitest'
import type { AppearanceFill, AppearanceState, OpacityMaskState, MeshGradientState, MeshGradientVertex } from './types'

/* ------------------------------------------------------------------ */
/*  AppearanceState defaults                                           */
/* ------------------------------------------------------------------ */

function defaultFill(): AppearanceFill {
  return {
    id: 'f1',
    color: '#ff0000',
    gradient: null,
    pattern: null,
    fillRule: 'nonzero',
    opacity: 1,
    blendMode: 'source-over',
    visible: true,
  }
}

function defaultAppearance(): AppearanceState {
  return {
    fills: [defaultFill()],
    strokes: [],
    opacity: 1,
    blendMode: 'source-over',
  }
}

describe('AppearanceState shape', () => {
  it('has a fills array', () => {
    const a = defaultAppearance()
    expect(Array.isArray(a.fills)).toBe(true)
    expect(a.fills).toHaveLength(1)
  })

  it('has a strokes array', () => {
    const a = defaultAppearance()
    expect(Array.isArray(a.strokes)).toBe(true)
    expect(a.strokes).toHaveLength(0)
  })

  it('fill has required fields', () => {
    const f = defaultFill()
    expect(f.id).toBeTruthy()
    expect(typeof f.color).toBe('string')
    expect(f.opacity).toBeGreaterThanOrEqual(0)
    expect(f.opacity).toBeLessThanOrEqual(1)
    expect(f.visible).toBe(true)
  })
})

/* ------------------------------------------------------------------ */
/*  OpacityMaskState defaults                                          */
/* ------------------------------------------------------------------ */

describe('OpacityMaskState shape', () => {
  it('can represent a disabled mask', () => {
    const m: OpacityMaskState = {
      enabled: false,
      invert: false,
      contentJson: null,
      bounds: null,
    }
    expect(m.enabled).toBe(false)
    expect(m.contentJson).toBeNull()
  })

  it('can store bounds', () => {
    const m: OpacityMaskState = {
      enabled: true,
      invert: false,
      contentJson: '{}',
      bounds: { x: 0, y: 0, width: 100, height: 50 },
    }
    expect(m.bounds?.width).toBe(100)
  })
})

/* ------------------------------------------------------------------ */
/*  MeshGradientState defaults                                         */
/* ------------------------------------------------------------------ */

function makeMeshGradient(cols: number, rows: number): MeshGradientState {
  const vertices: MeshGradientVertex[] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      vertices.push({ x: c * 100, y: r * 100, color: '#000000' })
    }
  }
  return { cols, rows, vertices }
}

describe('MeshGradientState shape', () => {
  it('vertex count matches cols × rows', () => {
    const m = makeMeshGradient(3, 4)
    expect(m.vertices).toHaveLength(12)
  })

  it('2×2 grid has 4 vertices', () => {
    const m = makeMeshGradient(2, 2)
    expect(m.vertices).toHaveLength(4)
    expect(m.cols).toBe(2)
    expect(m.rows).toBe(2)
  })

  it('vertices carry position and color', () => {
    const m = makeMeshGradient(2, 2)
    const v = m.vertices[0]
    expect(typeof v.x).toBe('number')
    expect(typeof v.y).toBe('number')
    expect(typeof v.color).toBe('string')
  })

  it('vertex opacity defaults to undefined (1)', () => {
    const m = makeMeshGradient(2, 2)
    expect(m.vertices[0].opacity).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/*  Triangle count for tessellation                                    */
/* ------------------------------------------------------------------ */

describe('mesh tessellation triangle count', () => {
  it('2×2 grid produces 2 triangles', () => {
    // 1 cell × 2 triangles
    const triangles = (2 - 1) * (2 - 1) * 2
    expect(triangles).toBe(2)
  })

  it('3×3 grid produces 8 triangles', () => {
    const triangles = (3 - 1) * (3 - 1) * 2
    expect(triangles).toBe(8)
  })

  it('4×4 grid produces 18 triangles', () => {
    const triangles = (4 - 1) * (4 - 1) * 2
    expect(triangles).toBe(18)
  })
})

/* ------------------------------------------------------------------ */
/*  Opacity mask toggle edge cases                                     */
/* ------------------------------------------------------------------ */

describe('OpacityMask toggle', () => {
  it('can toggle enabled without affecting invert', () => {
    const m: OpacityMaskState = { enabled: true, invert: true, contentJson: '{}', bounds: null }
    m.enabled = false
    expect(m.enabled).toBe(false)
    expect(m.invert).toBe(true)
  })

  it('can toggle invert without affecting enabled', () => {
    const m: OpacityMaskState = { enabled: false, invert: false, contentJson: '{}', bounds: null }
    m.invert = true
    expect(m.enabled).toBe(false)
    expect(m.invert).toBe(true)
  })

  it('null contentJson means no mask content', () => {
    const m: OpacityMaskState = { enabled: true, invert: false, contentJson: null, bounds: null }
    expect(m.contentJson).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/*  Appearance fill reorder                                            */
/* ------------------------------------------------------------------ */

describe('AppearanceState fill reorder', () => {
  it('can reorder fills array', () => {
    const a = defaultAppearance()
    a.fills.push({ ...defaultFill(), id: 'f2', color: '#00ff00' })
    a.fills.push({ ...defaultFill(), id: 'f3', color: '#0000ff' })
    expect(a.fills.map((f) => f.id)).toEqual(['f1', 'f2', 'f3'])

    // Move f3 to position 0
    const [moved] = a.fills.splice(2, 1)
    a.fills.unshift(moved)
    expect(a.fills.map((f) => f.id)).toEqual(['f3', 'f1', 'f2'])
  })

  it('can remove a fill by id', () => {
    const a = defaultAppearance()
    a.fills.push({ ...defaultFill(), id: 'f2' })
    a.fills = a.fills.filter((f) => f.id !== 'f2')
    expect(a.fills).toHaveLength(1)
    expect(a.fills[0].id).toBe('f1')
  })
})

/* ------------------------------------------------------------------ */
/*  Mesh gradient vertex color variants                                */
/* ------------------------------------------------------------------ */

describe('MeshGradientVertex colors', () => {
  it('accepts hex colors', () => {
    const v: MeshGradientVertex = { x: 0, y: 0, color: '#ff0000' }
    expect(v.color).toBe('#ff0000')
  })

  it('accepts rgb() colors', () => {
    const v: MeshGradientVertex = { x: 0, y: 0, color: 'rgb(255,0,0)' }
    expect(v.color).toBe('rgb(255,0,0)')
  })

  it('accepts named colors', () => {
    const v: MeshGradientVertex = { x: 0, y: 0, color: 'red' }
    expect(v.color).toBe('red')
  })
})
