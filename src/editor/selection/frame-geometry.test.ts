import { describe, expect, it } from 'vitest'
import {
  diagonalCursorForHeading,
  frameHandlePositions,
  HANDLE_HEADINGS,
  isCornerHandle,
  isNearDiagonal,
  localHandlePoint,
  nearestCorner,
  normAngle180,
  oppositeHandle,
  pointerAngle,
  resizeCursorForHeading,
  rotateXy,
  toFrameLocal,
  type FrameHandle,
  type SelectionFrame,
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

describe('normAngle180', () => {
  it('wraps into (-180, 180]', () => {
    expect(normAngle180(0)).toBe(0)
    expect(normAngle180(180)).toBe(-180)
    expect(normAngle180(270)).toBe(-90)
    expect(normAngle180(-190)).toBe(170)
    expect(normAngle180(720 + 45)).toBe(45)
  })
})

describe('HANDLE_HEADINGS', () => {
  it('points each handle outward clockwise from east', () => {
    expect(HANDLE_HEADINGS).toEqual({
      middleRight: 0,
      bottomRight: 45,
      bottomCenter: 90,
      bottomLeft: 135,
      middleLeft: 180,
      topLeft: 225,
      topCenter: 270,
      topRight: 315,
    })
  })
})

describe('resizeCursorForHeading', () => {
  it('folds bidirectional headings onto the four axes', () => {
    expect(resizeCursorForHeading(0)).toBe('ew-resize')
    expect(resizeCursorForHeading(45)).toBe('nwse-resize')
    expect(resizeCursorForHeading(90)).toBe('ns-resize')
    expect(resizeCursorForHeading(135)).toBe('nesw-resize')
    // 180° folds back onto the horizontal axis.
    expect(resizeCursorForHeading(180)).toBe('ew-resize')
    expect(resizeCursorForHeading(-45)).toBe('nesw-resize')
    expect(resizeCursorForHeading(360 + 90)).toBe('ns-resize')
  })
})

describe('diagonalCursorForHeading', () => {
  it('never shows an axis arrow, only the nearer diagonal', () => {
    expect(diagonalCursorForHeading(0)).toBe('nwse-resize')
    expect(diagonalCursorForHeading(90)).toBe('nwse-resize')
    expect(diagonalCursorForHeading(135)).toBe('nesw-resize')
    expect(diagonalCursorForHeading(180)).toBe('nwse-resize')
  })
})

describe('isNearDiagonal', () => {
  it('accepts bisectors within half a degree of a diagonal', () => {
    expect(isNearDiagonal(45)).toBe(true)
    expect(isNearDiagonal(45.4)).toBe(true)
    expect(isNearDiagonal(135)).toBe(true)
    expect(isNearDiagonal(225)).toBe(true)
    expect(isNearDiagonal(45.6)).toBe(false)
    expect(isNearDiagonal(0)).toBe(false)
    expect(isNearDiagonal(90)).toBe(false)
  })
})

describe('rotateXy', () => {
  it('reproduces paper.js Point.rotate', () => {
    const a = rotateXy({ x: 1, y: 0 }, 90, { x: 0, y: 0 })
    expect(a.x).toBeCloseTo(0, 9)
    expect(a.y).toBeCloseTo(1, 9)
    const b = rotateXy({ x: 0, y: 1 }, -90, { x: 0, y: 0 })
    expect(b.x).toBeCloseTo(1, 9)
    expect(b.y).toBeCloseTo(0, 9)
    const p = { x: 3, y: 4 }
    const c = { x: 1, y: 1 }
    const there = rotateXy(p, 37, c)
    const back = rotateXy(there, -37, c)
    expect(back.x).toBeCloseTo(p.x, 9)
    expect(back.y).toBeCloseTo(p.y, 9)
  })
})

describe('frameHandlePositions / toFrameLocal', () => {
  const frame: SelectionFrame = { cx: 100, cy: 100, w: 60, h: 40, angle: 0, selKey: '', version: 0 }

  it('matches the local layout on an unrotated frame', () => {
    const pos = frameHandlePositions(frame)
    expect(pos.topLeft).toEqual({ x: 70, y: 80 })
    expect(pos.topCenter).toEqual({ x: 100, y: 80 })
    expect(pos.middleRight).toEqual({ x: 130, y: 100 })
    expect(pos.bottomRight).toEqual({ x: 130, y: 120 })
  })

  it('rotates corners about the center on a tilted frame', () => {
    const tilted: SelectionFrame = { ...frame, angle: 90 }
    const pos = frameHandlePositions(tilted)
    // Local topLeft (70, 80) rides 90° clockwise about (100, 100).
    expect(pos.topLeft.x).toBeCloseTo(120, 9)
    expect(pos.topLeft.y).toBeCloseTo(70, 9)
    // Edges stay midpoints of their rotated corners.
    expect(pos.topCenter.x).toBeCloseTo((pos.topLeft.x + pos.topRight.x) / 2, 9)
    expect(pos.topCenter.y).toBeCloseTo((pos.topLeft.y + pos.topRight.y) / 2, 9)
  })

  it('inverts the tilt mapping', () => {
    const tilted: SelectionFrame = { ...frame, angle: 30 }
    const world = frameHandlePositions(tilted).bottomRight
    const local = toFrameLocal(world, tilted)
    expect(local.x).toBeCloseTo(130, 9)
    expect(local.y).toBeCloseTo(120, 9)
    const center = toFrameLocal({ x: 100, y: 100 }, tilted)
    expect(center.x).toBeCloseTo(100, 9)
    expect(center.y).toBeCloseTo(100, 9)
  })
})
