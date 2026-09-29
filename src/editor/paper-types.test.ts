/**
 * Typed Paper.js accessors (paper-types.ts).
 *
 * These exist so the editor's own invariants are checkable: a misspelled
 * `data` key used to read `undefined` silently, and `data.isUserLayer` is the
 * flag that separates user layers from system layers throughout the engine.
 * The behaviour is asserted against a real Paper.js scope, since every one of
 * these accessors depends on Paper's runtime shape rather than its types.
 */
import { describe, expect, it } from 'vitest'
import paper from 'paper'
import {
  childrenOf,
  isClipMask,
  dataOf,
  flagOf,
  isContainer,
  isUserItem,
  isUserLayer,
  itemIdOf,
  setFlag,
  writeData,
} from './paper-types'

function scope() {
  const s = new paper.PaperScope()
  s.setup(document.createElement('canvas'))
  return s
}

describe('dataOf / writeData', () => {
  it('returns an empty bag for an item that has never been written to', () => {
    const { Path } = scope()
    expect(dataOf(new Path())).toEqual({})
  })

  it('survives a null or undefined item', () => {
    expect(dataOf(null)).toEqual({})
    expect(dataOf(undefined)).toEqual({})
  })

  it('reads back what was written', () => {
    const { Path } = scope()
    const item = new Path()
    writeData(item, { id: 'abc', isUserItem: true })
    expect(dataOf(item).id).toBe('abc')
    expect(isUserItem(item)).toBe(true)
  })

  it('merges rather than replacing on a second write', () => {
    const { Path } = scope()
    const item = new Path()
    writeData(item, { id: 'a', isUserLayer: true })
    writeData(item, { name: 'Layer 1' })
    expect(dataOf(item)).toMatchObject({ id: 'a', isUserLayer: true, name: 'Layer 1' })
  })

  it('treats non-boolean flags as false rather than truthy', () => {
    const { Path } = scope()
    const item = new Path()
    // A stray truthy value must not make an item count as user artwork.
    writeData(item, { isUserItem: 'yes' as unknown as boolean })
    expect(isUserItem(item)).toBe(false)
    expect(isUserLayer(item)).toBe(false)
  })
})

describe('itemIdOf', () => {
  it('returns the id, or an empty string when absent or not a string', () => {
    const { Path } = scope()
    const item = new Path()
    expect(itemIdOf(item)).toBe('')
    writeData(item, { id: 42 as unknown as string })
    expect(itemIdOf(item)).toBe('')
    writeData(item, { id: 'x1' })
    expect(itemIdOf(item)).toBe('x1')
    expect(itemIdOf(null)).toBe('')
  })
})

describe('childrenOf / isContainer', () => {
  it('lists children of a container', () => {
    const { Group, Path } = scope()
    const group = new Group()
    const child = new Path()
    group.addChild(child)
    expect(childrenOf(group)).toHaveLength(1)
    expect(childrenOf(group)[0]).toBe(child)
    expect(isContainer(group)).toBe(true)
  })

  it('returns an empty list for a leaf and for nothing', () => {
    const { Path } = scope()
    expect(childrenOf(new Path())).toEqual([])
    expect(childrenOf(null)).toEqual([])
    expect(childrenOf(undefined)).toEqual([])
    expect(isContainer(new Path())).toBe(false)
  })
})

describe('flagOf / setFlag', () => {
  it('reads and writes locked and visible through paper, not a shadow field', () => {
    const { Path } = scope()
    const item = new Path()
    setFlag(item, 'locked', true)
    expect(item.locked).toBe(true)
    expect(flagOf(item, 'locked')).toBe(true)
    setFlag(item, 'locked', false)
    expect(flagOf(item, 'locked')).toBe(false)

    setFlag(item, 'visible', false)
    expect(item.visible).toBe(false)
    expect(flagOf(item, 'visible')).toBe(false)
  })

  it('reports a non-boolean value as false', () => {
    const { Path } = scope()
    const item = new Path()
    setFlag(item, 'visible', 0 as unknown as boolean)
    expect(flagOf(item, 'visible')).toBe(false)
  })
})

describe('isClipMask', () => {
  it('is true only for the child carrying the marker', () => {
    const { Group, Path } = scope()
    const group = new Group()
    const art = new Path()
    const mask = new Path()
    group.addChild(art)
    group.addChild(mask)
    // Nothing marked yet: a plain group's children are not masks.
    expect(isClipMask(art)).toBe(false)
    expect(isClipMask(mask)).toBe(false)

    // clipMask is a marker on the child; `parent.clipped` is what enables
    // clipping and, as Paper defines it, marks the first child itself.
    mask.clipMask = true
    expect(isClipMask(mask)).toBe(true)
    expect(isClipMask(art)).toBe(false)
    mask.clipMask = false
    expect(isClipMask(mask)).toBe(false)
  })

  it('is false for a leaf and for nothing', () => {
    const { Path } = scope()
    expect(isClipMask(new Path())).toBe(false)
    expect(isClipMask(null)).toBe(false)
    expect(isClipMask(undefined)).toBe(false)
  })
})
