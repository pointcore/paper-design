/**
 * Baseline grid: the geometry and the two behaviours that make it worth
 * setting — snapping a dragged baseline, and forcing text onto the grid.
 *
 * The arithmetic is pure, so the cases that matter can be stated exactly:
 * which line a y lands on, when the tolerance rejects a snap, and that a
 * decimated grid stays *on* the grid rather than drifting off it.
 */
import { describe, expect, it } from 'vitest'
import {
  alignFirstBaseline,
  baselineLines,
  baselineOffsetFor,
  defaultBaselineGrid,
  nearestBaseline,
  normalizeBaselineGrid,
  snapBaseline,
  type BaselineGridSettings,
} from './baseline-grid'

const grid = (over: Partial<BaselineGridSettings> = {}): BaselineGridSettings => ({
  ...defaultBaselineGrid(),
  interval: 10,
  origin: 0,
  ...over,
})

describe('normalizeBaselineGrid', () => {
  it('keeps sane settings as they are', () => {
    const s = normalizeBaselineGrid({ visible: true, interval: 12, origin: 4, color: '#ff0000', alignText: true, snap: true })
    expect(s).toEqual({ visible: true, interval: 12, origin: 4, color: '#ff0000', alignText: true, snap: true })
  })

  it('falls back to the defaults for junk', () => {
    expect(normalizeBaselineGrid(null)).toEqual(defaultBaselineGrid())
    expect(normalizeBaselineGrid('nope')).toEqual(defaultBaselineGrid())
    expect(normalizeBaselineGrid({})).toEqual(defaultBaselineGrid())
  })

  it('clamps an interval that would break the layout', () => {
    expect(normalizeBaselineGrid({ interval: 0 }).interval).toBe(1)
    expect(normalizeBaselineGrid({ interval: -5 }).interval).toBe(1)
    expect(normalizeBaselineGrid({ interval: 99999 }).interval).toBe(400)
    expect(normalizeBaselineGrid({ interval: Number.NaN }).interval).toBe(defaultBaselineGrid().interval)
  })

  it('accepts a negative or large origin: it is a position, not a count', () => {
    expect(normalizeBaselineGrid({ origin: -120 }).origin).toBe(-120)
    expect(normalizeBaselineGrid({ origin: 99999 }).origin).toBe(99999)
    expect(normalizeBaselineGrid({ origin: 'x' }).origin).toBe(0)
  })

  it('rejects a color that is not a hex value', () => {
    // An unvalidated color reaches the canvas as an invalid argument and the
    // grid draws black, which looks like the feature is broken.
    expect(normalizeBaselineGrid({ color: 'red' }).color).toBe(defaultBaselineGrid().color)
    expect(normalizeBaselineGrid({ color: '#ff00zz' }).color).toBe(defaultBaselineGrid().color)
    expect(normalizeBaselineGrid({ color: '#12345' }).color).toBe(defaultBaselineGrid().color)
    expect(normalizeBaselineGrid({ color: '#4a90d9' }).color).toBe('#4a90d9')
    expect(normalizeBaselineGrid({ color: '#4a90d9cc' }).color).toBe('#4a90d9cc')
  })

  it('only trusts a real true for the switches', () => {
    expect(normalizeBaselineGrid({ visible: 'yes' }).visible).toBe(false)
    expect(normalizeBaselineGrid({ alignText: 1 }).alignText).toBe(false)
  })
})

describe('nearestBaseline', () => {
  it('lands on the grid when the y is already on it', () => {
    for (const y of [0, 10, 20, -10, 100]) {
      const near = nearestBaseline(y, grid())
      expect(near.y).toBe(y)
      expect(near.distance).toBe(0)
    }
  })

  it('picks the closer of the two neighbours', () => {
    expect(nearestBaseline(14, grid()).y).toBe(10)
    expect(nearestBaseline(16, grid()).y).toBe(20)
    // A tie rounds to the later line, which is the behaviour a designer
    // expects when dragging downwards.
    expect(nearestBaseline(15, grid()).y).toBe(20)
  })

  it('measures the distance from the requested y', () => {
    expect(nearestBaseline(13, grid()).distance).toBe(3)
    expect(nearestBaseline(18, grid()).distance).toBe(2)
  })

  it('works from a non-zero origin', () => {
    const g = grid({ origin: 7, interval: 12 })
    expect(nearestBaseline(7, g).y).toBe(7)
    expect(nearestBaseline(19, g).y).toBe(19)
    expect(nearestBaseline(13, g).y).toBe(19)
  })

  it('survives a zero interval instead of dividing by zero', () => {
    const near = nearestBaseline(5, grid({ interval: 0 }))
    expect(Number.isFinite(near.y)).toBe(true)
  })
})

describe('snapBaseline', () => {
  it('snaps inside the tolerance and leaves it outside', () => {
    const g = grid()
    // 12 is 2 from the line at 10, so a 2-unit tolerance takes it.
    expect(snapBaseline(12, g, 2)).toEqual({ y: 10, snapped: true })
    // 11 is 1 away, so even a 1-unit tolerance takes it.
    expect(snapBaseline(11, g, 1)).toEqual({ y: 10, snapped: true })
    // 14 is 4 from the nearest line: outside a 2-unit tolerance.
    expect(snapBaseline(14, g, 2)).toEqual({ y: 14, snapped: false })
    expect(snapBaseline(14, g, 3.9)).toEqual({ y: 14, snapped: false })
  })

  it('never snaps without a tolerance', () => {
    expect(snapBaseline(10, grid(), 0)).toEqual({ y: 10, snapped: false })
    expect(snapBaseline(10, grid(), -1)).toEqual({ y: 10, snapped: false })
  })

  it('leaves a dead zone in the middle of each step', () => {
    // With a 10pt grid, a 6-unit screen tolerance and a 40% cap, the grid claims
    // the 4 units around each line and leaves the middle 2 alone. Without the
    // cap every position would snap, and the grid would stop being a choice.
    const g = grid({ interval: 10 })
    expect(snapBaseline(10, g, 100)).toEqual({ y: 10, snapped: true })
    expect(snapBaseline(14, g, 100)).toEqual({ y: 10, snapped: true })
    // 15 is halfway: the dead zone.
    expect(snapBaseline(15, g, 100)).toEqual({ y: 15, snapped: false })
    expect(snapBaseline(16, g, 100)).toEqual({ y: 20, snapped: true })
  })

  it('honours a tolerance inside the cap', () => {
    const g = grid({ interval: 10 })
    expect(snapBaseline(12, g, 2)).toEqual({ y: 10, snapped: true })
    expect(snapBaseline(13, g, 2)).toEqual({ y: 13, snapped: false })
  })
})

describe('alignFirstBaseline', () => {
  it('puts a y on the grid', () => {
    expect(alignFirstBaseline(0, grid())).toBe(0)
    expect(alignFirstBaseline(4, grid())).toBe(0)
    expect(alignFirstBaseline(6, grid())).toBe(10)
  })

  it('leaves a y alone with a negative interval', () => {
    expect(alignFirstBaseline(5, grid({ interval: -4 }))).toBe(5)
  })
})

describe('baselineOffsetFor', () => {
  it('does nothing unless align-text is on', () => {
    const g = grid({ alignText: false })
    expect(baselineOffsetFor(4, g)).toEqual({ shift: 0, onGrid: true })
  })

  it('reports the shift needed to reach the grid', () => {
    expect(baselineOffsetFor(4, grid({ alignText: true }))).toEqual({ shift: -4, onGrid: false })
    expect(baselineOffsetFor(10, grid({ alignText: true }))).toEqual({ shift: 0, onGrid: true })
  })
})

describe('baselineLines', () => {
  const view = { x: 0, y: 0, width: 200, height: 100 }

  it('draws one line per interval across the viewport', () => {
    const lines = baselineLines(view, grid())
    expect(lines.map((l) => l.y)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100])
  })

  it('majors every fifth line', () => {
    const lines = baselineLines(view, grid())
    expect(lines.filter((l) => l.major).map((l) => l.y)).toEqual([0, 50, 100])
  })

  it('starts at the viewport edge, not at the origin', () => {
    const lines = baselineLines({ x: 0, y: 35, width: 200, height: 40 }, grid())
    expect(lines[0].y).toBe(40)
    expect(lines.every((l) => l.y >= 35 && l.y <= 75)).toBe(true)
  })

  it('decimates by doubling, and stays on the real grid', () => {
    // 10pt lines over 100pt would be 11 of them; ask for fewer and the step
    // doubles. The lines drawn must still be baselines, not a coarse grid that
    // has drifted off it.
    const dense = baselineLines(view, grid(), 4)
    expect(dense.length).toBeLessThanOrEqual(5)
    for (const line of dense) {
      expect(line.y % 10).toBe(0)
      expect(line.y % 20).toBe(0)
    }
  })

  it('draws nothing for a viewport with no area', () => {
    expect(baselineLines({ x: 0, y: 0, width: 0, height: 100 }, grid())).toEqual([])
    expect(baselineLines({ x: 0, y: 0, width: 200, height: 0 }, grid())).toEqual([])
  })

  it('never returns more than the cap, however extreme the settings', () => {
    const lines = baselineLines({ x: 0, y: 0, width: 10, height: 1e6 }, grid({ interval: 0.001 }), 50)
    expect(lines.length).toBeLessThanOrEqual(51)
  })
})
