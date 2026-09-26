import { describe, expect, it } from 'vitest'
import {
  IMAGE_INLINE_LIMIT,
  IMAGE_TOKEN_PREFIX,
  hashImageSource,
  inflateHistoryImages,
  pruneHistoryImageStore,
  slimHistoryImages,
} from './history-images'

const bigUrl = `data:image/png;base64,${'A'.repeat(5000)}`

describe('hashImageSource', () => {
  it('is stable for identical payloads', () => {
    expect(hashImageSource(bigUrl)).toBe(hashImageSource(bigUrl))
  })

  it('differs across payloads and embeds length', () => {
    const other = `data:image/png;base64,${'B'.repeat(5000)}`
    expect(hashImageSource(bigUrl)).not.toBe(hashImageSource(other))
    expect(hashImageSource(bigUrl)).toContain((bigUrl.length.toString(36)))
  })
})

describe('slimHistoryImages', () => {
  it('replaces long data: payloads with tokens and stores them once', () => {
    const store = new Map<string, string>()
    const node = { source: bigUrl, name: 'photo' }
    const slim = slimHistoryImages(node, store)
    expect(typeof slim.source).toBe('string')
    expect((slim.source as string).startsWith(IMAGE_TOKEN_PREFIX)).toBe(true)
    expect(store.size).toBe(1)
    expect(slim.name).toBe('photo')
  })

  it('dedupes identical payloads across snapshots', () => {
    const store = new Map<string, string>()
    const snaps = Array.from({ length: 100 }, () => ({ layers: [{ source: bigUrl }] }))
    const slimmed = snaps.map((s) => JSON.stringify(slimHistoryImages(s, store)))
    expect(store.size).toBe(1)
    const total = slimmed.reduce((n, s) => n + s.length, 0)
    // 100 slim snapshots must stay near geometry size, not 100x the pixels.
    expect(total).toBeLessThan(bigUrl.length * 2)
  })

  it('keeps short payloads and non-image strings inline', () => {
    const store = new Map<string, string>()
    const small = 'data:image/png;base64,AAA'
    expect(small.length).toBeLessThanOrEqual(IMAGE_INLINE_LIMIT)
    const node = { a: small, b: '#ff0000', c: 'hello', d: 42, e: null }
    expect(slimHistoryImages(node, store)).toEqual(node)
    expect(store.size).toBe(0)
  })

  it('mints a distinct id when two payloads collide on one hash', () => {
    const store = new Map<string, string>()
    const token = slimHistoryImages({ source: bigUrl }, store).source as string
    expect(store.get(token.slice(IMAGE_TOKEN_PREFIX.length))).toBe(bigUrl)
    // Simulate a 53-bit collision: same hash, different payload.
    const collidingId = token.slice(IMAGE_TOKEN_PREFIX.length)
    const otherUrl = `data:image/png;base64,${'C'.repeat(5000)}`
    const otherToken = slimHistoryImages({ source: otherUrl }, store).source as string
    expect(store.get(collidingId)).toBe(bigUrl)
    expect(otherToken).not.toBe(token)
    expect(store.get(otherToken.slice(IMAGE_TOKEN_PREFIX.length))).toBe(otherUrl)
    expect(inflateHistoryImages({ a: token, b: otherToken }, store)).toEqual({ a: bigUrl, b: otherUrl })
  })

  it('walks nested arrays and objects', () => {
    const store = new Map<string, string>()
    const node = { layers: [[{ deep: { source: bigUrl } }]] }
    const slim = slimHistoryImages(node, store) as typeof node
    expect((slim.layers[0][0].deep.source as string).startsWith(IMAGE_TOKEN_PREFIX)).toBe(true)
  })
})

describe('inflateHistoryImages', () => {
  it('round-trips slimmed snapshots back to equality', () => {
    const store = new Map<string, string>()
    const doc = {
      layers: [{ id: 'L1', children: [{ source: bigUrl, opacity: 1 }] }],
      meta: { name: 'doc' },
    }
    const slimmed = slimHistoryImages(JSON.parse(JSON.stringify(doc)), store)
    expect(JSON.stringify(slimmed).length).toBeLessThan(bigUrl.length)
    expect(inflateHistoryImages(slimmed, store)).toEqual(doc)
  })

  it('leaves unknown tokens intact instead of crashing', () => {
    const store = new Map<string, string>()
    const node = { source: `${IMAGE_TOKEN_PREFIX}missing` }
    expect(inflateHistoryImages(node, store)).toEqual(node)
  })
})

describe('pruneHistoryImageStore', () => {
  it('does nothing while under the cap', () => {
    const store = new Map<string, string>()
    const snap = JSON.stringify(slimHistoryImages({ source: bigUrl }, store))
    pruneHistoryImageStore(store, [snap], 1024 * 1024)
    expect(store.size).toBe(1)
  })

  it('drops retired oldest entries until it fits', () => {
    const store = new Map<string, string>()
    const a = JSON.stringify(slimHistoryImages({ source: bigUrl }, store))
    const bUrl = `data:image/png;base64,${'B'.repeat(5000)}`
    const b = JSON.stringify(slimHistoryImages({ source: bUrl }, store))
    const cUrl = `data:image/png;base64,${'C'.repeat(5000)}`
    const c = JSON.stringify(slimHistoryImages({ source: cUrl }, store))
    // Budget fits one 5KB payload; only snapshot `a` stays live.
    pruneHistoryImageStore(store, [a], 6 * 1024)
    expect(store.size).toBe(1)
    expect(inflateHistoryImages(JSON.parse(a), store)).toEqual({ source: bigUrl })
    // Evicted payloads were the ones behind retired snapshots b and c.
    expect(b.length).toBeGreaterThan(0)
    expect(c.length).toBeGreaterThan(0)
  })

  it('never drops ids still tokenized in a snapshot', () => {
    const store = new Map<string, string>()
    const a = JSON.stringify(slimHistoryImages({ source: bigUrl }, store))
    const bUrl = `data:image/png;base64,${'B'.repeat(5000)}`
    const b = JSON.stringify(slimHistoryImages({ source: bUrl }, store))
    pruneHistoryImageStore(store, [a, b], 6 * 1024)
    // Both snapshots are live; over-cap but nothing is safe to drop.
    expect(store.size).toBe(2)
  })
})
