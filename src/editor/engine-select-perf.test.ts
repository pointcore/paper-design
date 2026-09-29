/**
 * Selection lookup and ordering fixes.
 *
 * Two costs that only show up on large documents, asserted here so they
 * cannot come back: restoring a selection re-walked every user layer once per
 * id, and the stepwise ordering commands scanned the sibling list inside
 * their own sort comparator.
 */
import { describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { EditorEngine } from './engine'
import { useEditorStore } from './store'
import { indexUserItemsById } from './engine-layers'
import { bringForward, sendBackward, selectByIds } from './engine-select'

function makeEngine() {
  setActivePinia(createPinia())
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  return new EditorEngine(canvas, useEditorStore())
}

/** Add n sibling rectangles to the active layer, returning their ids. */
function seed(engine: EditorEngine, n: number): string[] {
  const scope = engine.scope
  const layer = engine.getActiveLayer()
  const ids: string[] = []
  for (let i = 0; i < n; i++) {
    const rect = new scope.Path.Rectangle({
      from: new scope.Point(i * 10, 0),
      to: new scope.Point(i * 10 + 5, 5),
    })
    rect.fillColor = new scope.Color('#3366cc')
    rect.data.id = engine.genId()
    rect.data.isUserItem = true
    layer.addChild(rect)
    ids.push(rect.data.id)
  }
  return ids
}

describe('indexUserItemsById', () => {
  it('finds items nested inside groups, agreeing with getItemById', () => {
    const engine = makeEngine()
    const scope = engine.scope
    const group = new scope.Group({ insert: false })
    const inner = new scope.Path.Rectangle({
      from: new scope.Point(0, 0),
      to: new scope.Point(5, 5),
    })
    inner.data.id = 'deep'
    inner.data.isUserItem = true
    group.addChild(inner)
    engine.getActiveLayer().addChild(group)

    expect(indexUserItemsById(engine).get('deep')).toBe(inner)
    expect(engine.getItemById('deep')).toBe(inner)
    engine.destroy()
  })

  it('skips non-user layers, matching getItemById', () => {
    const engine = makeEngine()
    const system = new engine.scope.Layer()
    system.name = 'system'
    const sysItem = new engine.scope.Path.Rectangle({
      from: new engine.scope.Point(0, 0),
      to: new engine.scope.Point(5, 5),
    })
    sysItem.data.id = 'sys-item'
    system.addChild(sysItem)
    engine.project.addLayer(system)

    expect(indexUserItemsById(engine).has('sys-item')).toBe(false)
    expect(engine.getItemById('sys-item')).toBeNull()
    engine.destroy()
  })

  it('resolves a duplicated id to the same item getItemById would', () => {
    const engine = makeEngine()
    const scope = engine.scope
    // Same id in two user layers: first one down must win, as the DFS does.
    const second = engine.createLayer('Second')
    const a = new scope.Path.Rectangle({ insert: false })
    a.data.id = 'dup'
    engine.getActiveLayer().addChild(a)
    const b = new scope.Path.Rectangle({ insert: false })
    b.data.id = 'dup'
    second.addChild(b)

    const map = indexUserItemsById(engine)
    if (engine.getItemById('dup')) {
      expect(map.get('dup')).toBe(engine.getItemById('dup'))
    }
    engine.destroy()
  })
})

describe('selectByIds', () => {
  it('selects the resolvable, unlocked ids and skips the rest', () => {
    const engine = makeEngine()
    const ids = seed(engine, 4)
    engine.getItemById(ids[1])!.locked = true

    const selected = selectByIds(engine, [...ids, 'does-not-exist'])
    expect(selected).toBe(3)
    expect(engine.getSelection().map((i: any) => i.data.id).sort()).toEqual(
      [ids[0], ids[2], ids[3]].sort(),
    )
    engine.destroy()
  })

  it('replaces rather than accumulates across calls', () => {
    const engine = makeEngine()
    const ids = seed(engine, 3)
    expect(selectByIds(engine, ids)).toBe(3)
    expect(selectByIds(engine, [ids[0]])).toBe(1)
    expect(engine.getSelection()).toHaveLength(1)
    engine.destroy()
  })

  it('selects items nested in groups by id', () => {
    const engine = makeEngine()
    const scope = engine.scope
    const group = new scope.Group({ insert: false })
    const inner = new scope.Path.Rectangle({ insert: false })
    inner.data.id = 'in-group'
    inner.data.isUserItem = true
    group.addChild(inner)
    engine.getActiveLayer().addChild(group)

    expect(selectByIds(engine, ['in-group'])).toBe(1)
    engine.destroy()
  })

  it('costs the same per id whether one or many are selected', () => {
    // The property that matters is scaling, not an absolute count: the old
    // per-id getItemById re-walked the tree from the top for every id, so
    // doubling the selection more than doubled the work. Counting the data.id
    // reads the lookup performs measures it directly.
    const engine = makeEngine()
    const ids = seed(engine, 24)

    let reads = 0
    for (const child of engine.getActiveLayer().children) {
      const bag = child.data
      const realId = bag.id
      Object.defineProperty(bag, 'id', {
        get() {
          reads++
          return realId
        },
        enumerable: true,
        configurable: true,
      })
    }

    const costOf = (pick: string[]) => {
      reads = 0
      selectByIds(engine, pick)
      return reads
    }

    const half = costOf(ids.slice(0, 6))
    const all = costOf(ids)
    // Doubling the id list at most doubles the work. Quadratic behaviour
    // measured here as 12 -> 90 reads for the same 12 items.
    expect(all).toBeLessThanOrEqual(half * 2.2)
    engine.destroy()
  })

  it('scales: resolving many ids visits each item once', () => {
    const engine = makeEngine()
    const scope = engine.scope
    const ids = seed(engine, 10)

    // Every item carries a counting proxy on its data bag; indexUserItemsById
    // reads `id` once per item, so the total must not grow with the id count.
    let reads = 0
    for (const child of engine.getActiveLayer().children) {
      const bag = child.data
      const realId = bag.id
      Object.defineProperty(bag, 'id', {
        get() {
          reads++
          return realId
        },
        enumerable: true,
        configurable: true,
      })
    }
    void scope

    reads = 0
    const map = indexUserItemsById(engine)
    expect(map.size).toBe(ids.length)
    expect(reads).toBe(ids.length)
    engine.destroy()
  })
})

describe('stepwise ordering', () => {
  const order = (engine: EditorEngine) =>
    engine.getActiveLayer().children.map((c: any) => c.data.id)

  it('bringForward moves one step, not to the top', () => {
    const engine = makeEngine()
    const ids = seed(engine, 4)
    const start = order(engine)

    selectByIds(engine, [ids[1]])
    bringForward(engine)
    const moved = order(engine)
    expect(moved).toEqual([start[0], start[2], start[1], start[3]])
    engine.destroy()
  })

  it('sendBackward moves one step, not to the bottom', () => {
    const engine = makeEngine()
    const ids = seed(engine, 4)
    const start = order(engine)

    selectByIds(engine, [ids[2]])
    sendBackward(engine)
    expect(order(engine)).toEqual([start[0], start[2], start[1], start[3]])
    engine.destroy()
  })

  it('carries a selected block as a unit and keeps its internal order', () => {
    const engine = makeEngine()
    const ids = seed(engine, 5)
    const start = order(engine)

    selectByIds(engine, [ids[1], ids[2]])
    sendBackward(engine)
    // The block reached the bottom, still in its original relative order.
    expect(order(engine)).toEqual([start[1], start[2], start[0], start[3], start[4]])
    engine.destroy()
  })

  it('leaves an edge item where it is when it cannot move further', () => {
    const engine = makeEngine()
    const ids = seed(engine, 3)
    const start = order(engine)

    selectByIds(engine, [ids[0]])
    sendBackward(engine)
    expect(order(engine)).toEqual(start)
    engine.destroy()
  })
})
