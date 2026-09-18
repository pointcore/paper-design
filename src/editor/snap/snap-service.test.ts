/**
 * Unit tests for SnapService caching and exclusion semantics.
 *
 * SnapService imports EditorEngine type-only, so these tests run in plain
 * Node against a fake engine (no Paper.js needed) — run with `vitest run`.
 *
 * What is locked here (regression B4): per-query exclusions (dragged
 * items) must NOT trigger a full document re-walk. The shared cache is
 * built once per document version and queries filter by recorded owner
 * identity; getSnapCacheStats().builds counts rebuilds deterministically
 * (no wall-clock assertions for the perf guard).
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { SnapService, getSnapCacheStats } from './snap-service'
import type { EditorEngine } from '../engine'

/* ------------------------------------------------------------------ */
/* Minimal Paper.js stand-ins (only what SnapService touches)          */
/* ------------------------------------------------------------------ */

class FakePoint {
  constructor(
    public x = 0,
    public y = 0
  ) {}
  clone(): FakePoint {
    return new FakePoint(this.x, this.y)
  }
  getDistance(p: { x: number; y: number }): number {
    return Math.hypot(this.x - p.x, this.y - p.y)
  }
}

class FakeRect {
  constructor(
    public x = 0,
    public y = 0,
    public width = 0,
    public height = 0
  ) {}
  clone(): FakeRect {
    return new FakeRect(this.x, this.y, this.width, this.height)
  }
  expand(t: number): FakeRect {
    return new FakeRect(this.x - t, this.y - t, this.width + t * 2, this.height + t * 2)
  }
}

class FakePath {
  segments: Array<{ point: FakePoint }> = []
  data: Record<string, unknown> = {}
  locked = false
  visible = true
  parent: any = null
}

class FakeCompoundPath {
  children: any[] = []
  data: Record<string, unknown> = {}
  locked = false
  visible = true
  parent: any = null
}

class FakeGroup {
  children: any[] = []
  data: Record<string, unknown> = {}
  locked = false
  visible = true
  parent: any = null
  bounds: FakeRect | null = null
}

class FakePointText {
  point = new FakePoint()
  data: Record<string, unknown> = {}
  locked = false
  visible = true
  parent: any = null
}

const fakeScope: any = {
  Point: FakePoint,
  Rectangle: FakeRect,
  Path: FakePath,
  CompoundPath: FakeCompoundPath,
  Group: FakeGroup,
  PointText: FakePointText,
  view: { zoom: 1 },
}

function anchorPath(x: number, y: number): FakePath {
  const p = new FakePath()
  p.segments = [{ point: new FakePoint(x, y) }]
  return p
}

function topRect(x: number, y: number, w: number, h: number): FakeGroup {
  // Alignment targets only need top-level bounds (children never descended).
  const g = new FakeGroup()
  g.bounds = new FakeRect(x, y, w, h)
  return g
}

function makeEngine(children: any[]): any {
  return {
    store: {
      snap: { enable: true, point: true, grid: false, guides: false, smartGuides: true, gridSize: 10 },
      view: { showGuides: false },
      artboards: [],
    },
    scope: fakeScope,
    project: {
      layers: [{ data: { isUserLayer: true }, visible: true, locked: false, children }],
    },
    getGuides: () => [],
  }
}

function attach(children: any[]): SnapService {
  const svc = new SnapService()
  svc.invalidateCache()
  svc.attachEngine(makeEngine(children) as unknown as EditorEngine)
  return svc
}

/** Deterministic PRNG (mulberry-ish LCG) for the equivalence fuzz test. */
function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0x100000000
  }
}

describe('SnapService exclusions', () => {
  let svc: SnapService

  beforeEach(() => {
    svc = new SnapService()
    svc.invalidateCache()
  })

  it('snaps to anchors and filters excluded items without rebuilding', () => {
    const a = anchorPath(100, 100)
    const b = anchorPath(500, 500)
    const locked = anchorPath(200, 200)
    locked.locked = true
    const hidden = anchorPath(300, 300)
    hidden.visible = false
    svc.attachEngine(makeEngine([a, b, locked, hidden]) as unknown as EditorEngine)

    const buildsBefore = getSnapCacheStats().builds

    // Control: snaps to A.
    const hit = svc.snapPoint(new FakePoint(102, 100) as any) as unknown as FakePoint
    expect(hit.x).toBe(100)
    expect(hit.y).toBe(100)

    // A excluded (dragged): its cached anchor must not win; B is far away.
    const miss = svc.snapPoint(new FakePoint(102, 100) as any, [a] as any) as unknown as FakePoint
    expect(miss.x).toBe(102)
    expect(miss.y).toBe(100)

    // Locked / hidden art never pulls, even unexcluded.
    const skip = svc.snapPoint(new FakePoint(201, 200) as any) as unknown as FakePoint
    expect(skip.x).toBe(201)
    expect(skip.y).toBe(200)

    // Warm-up loop with varying exclusions (simulates drag frames).
    for (let i = 0; i < 50; i++) {
      svc.snapPoint(new FakePoint(100 + (i % 5), 100) as any, i % 2 === 0 ? ([a] as any) : undefined)
    }

    // Exactly one cache build for the whole sequence (cold first query).
    expect(getSnapCacheStats().builds - buildsBefore).toBe(1)
  })

  it('excludes a nested path without silencing its siblings', () => {
    const p1 = anchorPath(100, 100)
    const p2 = anchorPath(110, 110)
    const group = new FakeGroup()
    group.children = [p1, p2]
    p1.parent = group
    p2.parent = group
    svc.attachEngine(makeEngine([group]) as unknown as EditorEngine)

    // p1 excluded: query at p1 stays raw (p2 is 12.7 away, outside tol 6).
    const nearP1 = svc.snapPoint(new FakePoint(101, 100) as any, [p1] as any) as unknown as FakePoint
    expect(nearP1.x).toBe(101)
    expect(nearP1.y).toBe(100)

    // Sibling p2 still snaps while p1 is excluded.
    const nearP2 = svc.snapPoint(new FakePoint(111, 110) as any, [p1] as any) as unknown as FakePoint
    expect(nearP2.x).toBe(110)
    expect(nearP2.y).toBe(110)

    // Excluding the group prunes the whole subtree.
    const viaGroup = svc.snapPoint(new FakePoint(111, 110) as any, [group] as any) as unknown as FakePoint
    expect(viaGroup.x).toBe(111)
    expect(viaGroup.y).toBe(110)
  })

  it('aligns to nearby targets and honors top-level exclusion', () => {
    const near = topRect(0, 0, 100, 100)
    const dragged = topRect(1000, 1000, 50, 50)
    svc.attachEngine(makeEngine([near, dragged]) as unknown as EditorEngine)

    // Candidate left edge 103 vs target right edge 100 -> dx -3 (within tol).
    const cand = new FakeRect(103, 10, 40, 40)
    const r1 = svc.alignDraggedBounds(cand as any)
    expect(r1.dx).toBeCloseTo(-3, 9)
    expect(r1.lines.length).toBeGreaterThan(0)

    // Excluding an unrelated item changes nothing.
    const r2 = svc.alignDraggedBounds(cand as any, [dragged] as any)
    expect(r2.dx).toBeCloseTo(-3, 9)

    // Excluding the only aligner yields no correction.
    const r3 = svc.alignDraggedBounds(cand as any, [near] as any)
    expect(r3.dx).toBe(0)
    expect(r3.dy).toBe(0)
  })

  it('matches brute-force alignment on a seeded layout, with exclusions', () => {
    const rand = lcg(20260918)
    const items: FakeGroup[] = []
    for (let i = 0; i < 40; i++) {
      items.push(topRect(rand() * 2000, rand() * 2000, 20 + rand() * 180, 20 + rand() * 180))
    }
    svc.attachEngine(makeEngine(items) as unknown as EditorEngine)
    const tol = 6

    const brute = (cand: FakeRect, skip: Set<any>): { dx: number; dy: number } => {
      let bestDx = 0
      let bestDxDist = tol + 1e-9
      let bestDy = 0
      let bestDyDist = tol + 1e-9
      const candX = [cand.x, cand.x + cand.width / 2, cand.x + cand.width]
      const candY = [cand.y, cand.y + cand.height / 2, cand.y + cand.height]
      for (const t of items) {
        if (skip.has(t)) continue
        const b = t.bounds as FakeRect
        const tx = [b.x, b.x + b.width / 2, b.x + b.width]
        const ty = [b.y, b.y + b.height / 2, b.y + b.height]
        for (const cx of candX)
          for (const gx of tx) {
            const d = Math.abs(cx - gx)
            if (d < bestDxDist) {
              bestDxDist = d
              bestDx = gx - cx
            }
          }
        for (const cy of candY)
          for (const gy of ty) {
            const d = Math.abs(cy - gy)
            if (d < bestDyDist) {
              bestDyDist = d
              bestDy = gy - cy
            }
          }
      }
      return { dx: bestDx, dy: bestDy }
    }

    for (let q = 0; q < 25; q++) {
      const cand = new FakeRect(rand() * 2000, rand() * 2000, 60, 60)
      const skip = new Set<any>([items[q % items.length], items[(q * 7 + 3) % items.length]])
      const got = svc.alignDraggedBounds(cand as any, [...skip] as any)
      const want = brute(cand, skip)
      expect(got.dx).toBeCloseTo(want.dx, 9)
      expect(got.dy).toBeCloseTo(want.dy, 9)
    }
  })

  it('drops retained data on invalidate and rebuilds on next query', () => {
    const a = anchorPath(100, 100)
    svc.attachEngine(makeEngine([a]) as unknown as EditorEngine)

    svc.snapPoint(new FakePoint(102, 100) as any)
    const warm = getSnapCacheStats()
    expect(warm.anchorCount).toBeGreaterThan(0)
    const buildsBefore = warm.builds

    svc.invalidateCache()
    const cold = getSnapCacheStats()
    expect(cold.anchorCount).toBe(0)
    expect(cold.targetCount).toBe(0)

    const hit = svc.snapPoint(new FakePoint(102, 100) as any) as unknown as FakePoint
    expect(hit.x).toBe(100)
    expect(getSnapCacheStats().builds - buildsBefore).toBe(1)
  })

  it('serves a 5000-anchor document from one build across warm frames', () => {
    const items: FakePath[] = []
    for (let i = 0; i < 5000; i++) {
      items.push(anchorPath((i % 100) * 30, Math.floor(i / 100) * 30))
    }
    const dragged = items[0]
    svc.attachEngine(makeEngine(items) as unknown as EditorEngine)
    const buildsBefore = getSnapCacheStats().builds

    const t0 = Date.now()
    // 200 warm frames with a dragged exclusion, querying near other anchors.
    for (let i = 1; i <= 200; i++) {
      const anchor = (items[i * 7 % items.length].segments[0].point) as FakePoint
      const got = svc.snapPoint(new FakePoint(anchor.x + 2, anchor.y) as any, [dragged] as any) as unknown as FakePoint
      expect(got.x).toBe(anchor.x)
      expect(got.y).toBe(anchor.y)
    }
    const elapsed = Date.now() - t0

    expect(getSnapCacheStats().builds - buildsBefore).toBe(1)
    // Smoke guard only (misses are caught by the builds assertion above).
    expect(elapsed).toBeLessThan(15000)
  })
})
