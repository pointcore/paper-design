/**
 * Unit tests for artboard move-with-artwork overlap — run with `vitest run`.
 *
 * moveArtboard mutates store artboards in place, so the overlap rect must
 * be captured from the board's SOURCE position before the update; these
 * tests pin that with a minimal fake engine (no Paper.js needed).
 */
import { describe, expect, it } from 'vitest'
import { moveArtboard } from './engine-artboards'
import type { EditorEngine } from './engine'

interface FakeRect {
  x: number
  y: number
  width: number
  height: number
  intersects(other: FakeRect): boolean
}

function rect(x: number, y: number, width: number, height: number): FakeRect {
  return {
    x, y, width, height,
    intersects(o: FakeRect) {
      return (
        this.x < o.x + o.width && this.x + this.width > o.x &&
        this.y < o.y + o.height && this.y + this.height > o.y
      )
    },
  }
}

interface FakeItem {
  bounds: FakeRect
  position: { x: number; y: number; add(d: { x: number; y: number }): { x: number; y: number } }
  visible: boolean
  locked?: boolean
  data: Record<string, unknown>
}

function item(b: FakeRect): FakeItem {
  return {
    bounds: b,
    position: {
      x: b.x + b.width / 2, y: b.y + b.height / 2,
      add(d: { x: number; y: number }) { this.x += d.x; this.y += d.y; return this },
    },
    visible: true,
    data: {},
  }
}

function makeEngine(boards: Array<{ x: number; y: number; width: number; height: number }>, items: FakeItem[]): EditorEngine {
  return {
    store: {
      artboards: boards.map((b, i) => ({ id: `b${i}`, ...b })),
      updateArtboard(id: string, partial: Partial<{ x: number; y: number }>) {
        const board = this.artboards.find((b: { id: string }) => b.id === id)
        if (board) Object.assign(board, partial)
      },
    },
    project: { layers: [{ data: { isUserLayer: true }, visible: true, locked: false, children: items }] },
    scope: {
      Rectangle: rect,
      Point: class { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y } },
      view: { update() { /* noop */ } },
    },
    refreshArtboards() { /* noop */ },
    pushHistory(_name: string) { /* noop */ },
    refreshItemGradient(_item: unknown) { /* noop */ },
    reflowTextsForItems(_items: unknown[]) { /* noop */ },
  } as unknown as EditorEngine
}

describe('moveArtboard withArtwork', () => {
  it('moves artwork overlapping the board source rect, not the destination', () => {
    // Board A at (0,0) 800x600; a rect inside it at (100,100); unrelated
    // item B sitting at (2500,300) — which overlaps the DESTINATION
    // (2400,0,800,600) but not the source.
    const inside = item(rect(100, 100, 50, 50))
    const foreign = item(rect(2500, 300, 50, 50))
    const e = makeEngine([{ x: 0, y: 0, width: 800, height: 600 }], [inside, foreign])

    expect(moveArtboard(e, 'b0', 2400, 0, { withArtwork: true })).toBe(true)
    // The inside rect travels by the board delta…
    expect(inside.position.x).toBe(125 + 2400)
    expect(inside.position.y).toBe(125)
    // …and the foreign item stays put.
    expect(foreign.position.x).toBe(2525)
    expect(foreign.position.y).toBe(325)
  })

  it('leaves artwork alone without withArtwork', () => {
    const inside = item(rect(100, 100, 50, 50))
    const e = makeEngine([{ x: 0, y: 0, width: 800, height: 600 }], [inside])
    expect(moveArtboard(e, 'b0', 500, 200)).toBe(true)
    expect(inside.position.x).toBe(125)
    expect(inside.position.y).toBe(125)
  })

  it('returns false for an unmoved board', () => {
    const e = makeEngine([{ x: 10, y: 20, width: 800, height: 600 }], [])
    expect(moveArtboard(e, 'b0', 10, 20, { withArtwork: true })).toBe(false)
  })
})
