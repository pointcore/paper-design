/**
 * TIFF writer, verified by reading the file back.
 *
 * The encoder is the only implementation of the format in the repo, so
 * testing it against itself would prove nothing. The test therefore carries
 * an independent minimal IFD reader — parse the header, walk the directory,
 * pull the tag values, reassemble the strips — and compares the pixels it
 * recovers with the pixels that went in. If the writer and the reader agree
 * on a file the spec permits, the file is right; if they disagree, one of
 * them is wrong and the diff says which pixels.
 */
import { describe, expect, it } from 'vitest'
import { encodeTiff, TiffEncodeError } from './tiff'

interface Decoded {
  width: number
  height: number
  samples: number
  rgba: Uint8Array
  tags: Map<number, number[]>
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }

/** Independent reader for the subset the writer emits. */
function decodeTiff(bytes: Uint8Array): Decoded {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const order = String.fromCharCode(bytes[0], bytes[1])
  const le = order === 'II'
  if (!le) throw new Error('test reader only handles little-endian files')
  expect(view.getUint16(2, le)).toBe(42)

  const readTag = (type: number, count: number, at: number): number[] => {
    const size = TYPE_SIZE[type]
    if (!size) throw new Error(`unknown tag type ${type}`)
    const out: number[] = []
    for (let i = 0; i < count; i++) {
      const offset = at + i * size
      if (type === 3) out.push(view.getUint16(offset, le))
      else if (type === 4) out.push(view.getUint32(offset, le))
      else if (type === 1) out.push(bytes[offset])
      else if (type === 5) {
        const numerator = view.getUint32(offset, le)
        const denominator = view.getUint32(offset + 4, le)
        out.push(denominator === 0 ? 0 : numerator / denominator)
      } else throw new Error(`unhandled type ${type}`)
    }
    return out
  }

  const ifdAt = view.getUint32(4, le)
  const count = view.getUint16(ifdAt, le)
  const tags = new Map<number, number[]>()
  for (let i = 0; i < count; i++) {
    const at = ifdAt + 2 + i * 12
    const tag = view.getUint16(at, le)
    const type = view.getUint16(at + 2, le)
    const n = view.getUint32(at + 4, le)
    const bytesNeeded = (TYPE_SIZE[type] ?? 0) * n
    const valueAt = bytesNeeded <= 4 ? at + 8 : view.getUint32(at + 8, le)
    tags.set(tag, readTag(type, n, valueAt))
  }

  const width = tags.get(256)![0]
  const height = tags.get(257)![0]
  const samples = tags.get(277)![0]
  const rowsPerStrip = tags.get(278)?.[0] ?? height
  const compression = tags.get(259)?.[0] ?? 1
  expect(compression, 'uncompressed').toBe(1)
  const offsets = tags.get(273)!
  const byteCounts = tags.get(279)!

  const rgba = new Uint8Array(width * height * 4)
  let written = 0
  for (let strip = 0; strip < offsets.length; strip++) {
    const first = strip * rowsPerStrip
    const rows = Math.min(rowsPerStrip, height - first)
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < width; x++) {
        const src = offsets[strip] + (y * width + x) * samples
        expect(src + samples, 'strip holds every byte the IFD promised').toBeLessThanOrEqual(
          offsets[strip] + byteCounts[strip]
        )
        const dst = ((first + y) * width + x) * 4
        rgba[dst] = bytes[src]
        rgba[dst + 1] = bytes[src + 1]
        rgba[dst + 2] = bytes[src + 2]
        rgba[dst + 3] = samples === 4 ? bytes[src + 3] : 255
        written++
      }
    }
  }
  expect(written).toBe(width * height)
  return { width, height, samples, rgba, tags }
}

/** A deterministic test image: a gradient plus a few hard edges. */
function testPixels(width: number, height: number, alpha = 255): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      out[i] = (x * 7) % 256
      out[i + 1] = (y * 11) % 256
      out[i + 2] = (x * y) % 256
      out[i + 3] = alpha
    }
  }
  return out
}

describe('encodeTiff', () => {
  it('round-trips RGB pixels through a file another reader can parse', () => {
    const width = 37
    const height = 23
    const rgba = testPixels(width, height)
    const decoded = decodeTiff(encodeTiff({ width, height, rgba }))

    expect(decoded.width).toBe(width)
    expect(decoded.height).toBe(height)
    expect(decoded.samples, 'an opaque image needs no alpha channel').toBe(3)
    expect([...decoded.rgba]).toEqual([...rgba])
  })

  it('keeps the alpha channel when something is transparent', () => {
    const width = 8
    const height = 4
    const rgba = testPixels(width, height, 200)
    rgba[3] = 0 // first pixel fully transparent
    const decoded = decodeTiff(encodeTiff({ width, height, rgba }))

    expect(decoded.samples).toBe(4)
    expect([...decoded.rgba]).toEqual([...rgba])
    // Associated alpha: the colour channels are stored as-is, not premultiplied.
    expect(decoded.tags.get(338)).toEqual([1])
  })

  it('writes the resolution in pixels per inch', () => {
    const decoded = decodeTiff(encodeTiff({ width: 2, height: 2, rgba: testPixels(2, 2), dpi: 300 }))
    expect(decoded.tags.get(282)).toEqual([300])
    expect(decoded.tags.get(283)).toEqual([300])
    expect(decoded.tags.get(296)).toEqual([2])
  })

  it('omits the resolution tags when no dpi is given', () => {
    const decoded = decodeTiff(encodeTiff({ width: 2, height: 2, rgba: testPixels(2, 2) }))
    expect(decoded.tags.has(282)).toBe(false)
    expect(decoded.tags.has(296)).toBe(false)
  })

  it('splits tall images into several strips and reassembles them in order', () => {
    // A 16x16 image with a one-row strip budget, so the multi-strip layout
    // (offset and byte-count arrays living out of line) is exercised without
    // allocating a 48 MB page.
    const width = 16
    const height = 16
    const rgba = testPixels(width, height)
    const decoded = decodeTiff(
      encodeTiff({ width, height, rgba, maxStripBytes: width * 3 })
    )
    expect(decoded.tags.get(278)).toEqual([1])
    expect(decoded.tags.get(279)!.length, 'one strip per row').toBe(height)
    expect(decoded.tags.get(273)!.length).toBe(height)
    // Row order is the whole point of the strip bookkeeping.
    expect([...decoded.rgba]).toEqual([...rgba])
  })

  it('keeps a normal page in a single strip', () => {
    const width = 64
    const height = 64
    const decoded = decodeTiff(encodeTiff({ width, height, rgba: testPixels(width, height) }))
    expect(decoded.tags.get(278)).toEqual([height])
    expect(decoded.tags.get(279)!.length).toBe(1)
  })

  it('lists the IFD entries in ascending tag order', () => {
    // The spec requires it, and readers do rely on it to binary-search.
    const bytes = encodeTiff({ width: 4, height: 4, rgba: testPixels(4, 4, 128), dpi: 150 })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const ifdAt = view.getUint32(4, true)
    const count = view.getUint16(ifdAt, true)
    const tags: number[] = []
    for (let i = 0; i < count; i++) tags.push(view.getUint16(ifdAt + 2 + i * 12, true))
    expect(tags).toEqual([...tags].sort((a, b) => a - b))
    expect(new Set(tags).size, 'no duplicate tags').toBe(tags.length)
  })

  it('ends with a null next-IFD pointer', () => {
    const bytes = encodeTiff({ width: 2, height: 2, rgba: testPixels(2, 2) })
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const ifdAt = view.getUint32(4, true)
    const count = view.getUint16(ifdAt, true)
    expect(view.getUint32(ifdAt + 2 + count * 12, true)).toBe(0)
  })

  it('refuses impossible input instead of writing a broken file', () => {
    expect(() => encodeTiff({ width: 0, height: 4, rgba: new Uint8Array(0) })).toThrow(TiffEncodeError)
    expect(() => encodeTiff({ width: 2.5, height: 4, rgba: new Uint8Array(64) })).toThrow(TiffEncodeError)
    expect(() => encodeTiff({ width: 4, height: 4, rgba: new Uint8Array(8) })).toThrow(TiffEncodeError)
  })
})
