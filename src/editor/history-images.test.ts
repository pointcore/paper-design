import { describe, expect, it } from 'vitest'
import {
  IMAGE_INLINE_LIMIT,
  IMAGE_TOKEN_PREFIX,
  hashImageSource,
  inflateHistoryImages,
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

  it('drops pre-edit pixel copies from snapshots', () => {
    const store = new Map<string, string>()
    const node = { data: { id: 'r1', originalSource: bigUrl } }
    const slim = slimHistoryImages(node, store)
    expect('originalSource' in (slim.data as Record<string, unknown>)).toBe(false)
    expect(store.size).toBe(0)
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
