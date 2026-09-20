import { describe, expect, it } from 'vitest'
import {
  isCornerHandle,
  localHandlePoint,
  nearestCorner,
  oppositeHandle,
  pointerAngle,
  type FrameHandle,
} from './frame-geometry'

const pt = (x: number, y: number) => ({ x, y })

describe('oppositeHandle', () => {
  it('maps every handle to its fixed pivot', () => {
    expect(oppositeHandle('topLeft')).toBe('bottomRight')
    expect(oppositeHandle('topRight')).toBe('bottomLeft')
    expect(oppositeHandle('bottomLeft')).toBe('topRight')
    expect(oppositeHandle('bottomRight')).toBe('topLeft')
    expect(oppositeHandle('topCenter')).toBe('bottomCenter')
    expect(oppositeHandle('bottomCenter')).toBe('topCenter')
    expect(oppositeHandle('middleLeft')).toBe('middleRight')
    expect(oppositeHandle('middleRight')).toBe('middleLeft')
  })

  it('is an involution (opposite of opposite is itself)', () => {
    const handles: FrameHandle[] = [
      'topLeft', 'topCenter', 'topRight',
      'middleLeft', 'middleRight',
      'bottomLeft', 'bottomCenter', 'bottomRight',
    ]
    for (const h of handles) expect(oppositeHandle(oppositeHandle(h))).toBe(h)
  })
})

describe('isCornerHandle', () => {
  it('accepts only the four corners', () => {
    for (const h of ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const) {
      expect(isCornerHandle(h)).toBe(true)
    }
    for (const h of ['topCenter', 'middleLeft', 'bottomCenter', 'none', 'rotate'] as const) {
      expect(isCornerHandle(h)).toBe(false)
    }
  })
})

describe('pointerAngle', () => {
  it('reports screen-space clockwise degrees from east', () => {
    const c = pt(0, 0)
    expect(pointerAngle(pt(10, 0), c)).toBeCloseTo(0, 9)
    expect(pointerAngle(pt(0, 10), c)).toBeCloseTo(90, 9)
    expect(pointerAngle(pt(-10, 0), c)).toBeCloseTo(180, 9)
    expect(pointerAngle(pt(0, -10), c)).toBeCloseTo(-90, 9)
  })
})

describe('nearestCorner', () => {
  const positions: Record<FrameHandle, { x: number; y: number }> = {
    topLeft: pt(0, 0),
    topCenter: pt(50, 0),
    topRight: pt(100, 0),
    middleLeft: pt(0, 50),
    middleRight: pt(100, 50),
    bottomLeft: pt(0, 100),
    bottomCenter: pt(50, 100),
    bottomRight: pt(100, 100),
  }

  it('picks the closest corner', () => {
    expect(nearestCorner(pt(5, 5), positions)).toBe('topLeft')
    expect(nearestCorner(pt(90, 95), positions)).toBe('bottomRight')
  })

  it('keeps the first corner on ties', () => {
    // Center is equidistant to all four: strict less-than keeps topLeft.
    expect(nearestCorner(pt(50, 50), positions)).toBe('topLeft')
  })
})

describe('localHandlePoint', () => {
  const base = { cx: 100, cy: 100, w: 60, h: 40 }

  it('lays handles on the unrotated box', () => {
    expect(localHandlePoint(base, 'topLeft')).toEqual({ x: 70, y: 80 })
    expect(localHandlePoint(base, 'topCenter')).toEqual({ x: 100, y: 80 })
    expect(localHandlePoint(base, 'topRight')).toEqual({ x: 130, y: 80 })
    expect(localHandlePoint(base, 'middleLeft')).toEqual({ x: 70, y: 100 })
    expect(localHandlePoint(base, 'middleRight')).toEqual({ x: 130, y: 100 })
    expect(localHandlePoint(base, 'bottomLeft')).toEqual({ x: 70, y: 120 })
    expect(localHandlePoint(base, 'bottomCenter')).toEqual({ x: 100, y: 120 })
    expect(localHandlePoint(base, 'bottomRight')).toEqual({ x: 130, y: 120 })
  })
})
