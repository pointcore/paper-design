/**
 * Minimal baseline TIFF writer.
 *
 * Print workflows ask for TIFF and the browser will not give us one:
 * `canvas.toBlob` supports PNG and JPEG only, and no installed codec writes
 * TIFF either. So this encodes one directly.
 *
 * Scope is deliberately narrow — what a print shop actually needs to open the
 * file:
 * - uncompressed RGB, 8 bits per channel, one strip (or a few rows per strip)
 * - optional alpha, emitted as an extra channel plus an associated alpha tag
 * - a resolution tag in pixels per inch, which is the difference between
 *   "placed at the right size" and "placed at a guessed size"
 * - little-endian ("II", 42) byte order
 *
 * Deliberately not implemented: JPEG-in-TIFF (compression 7), LZW and
 * PackBits (would cut file size 5-10x), CMYK (the editor has no CMYK
 * rendering to write), tiled layouts, and multi-page files. An uncompressed
 * 300dpi A4 page is about 25 MB, which every print tool opens happily; a
 * partial LZW implementation that produces files some tools reject is worse
 * than a large file that always opens.
 */

/** What the writer needs to know. */
export interface TiffEncodeOptions {
  width: number
  height: number
  /** RGBA bytes, row-major, 4 bytes per pixel. */
  rgba: Uint8Array | Uint8ClampedArray
  /** Pixels per inch for the resolution tags; omitted when not positive. */
  dpi?: number
  /**
   * Target bytes per strip (default 8 MB). Exposed because the strip layout
   * is part of the file's structure, and testing a multi-strip file needs a
   * small image rather than a 48 MB one.
   */
  maxStripBytes?: number
}

/** Raised for input the writer refuses rather than emitting a broken file. */
export class TiffEncodeError extends Error {}

/** Bytes written so far, grown in chunks (the total size is not known up front). */
class ByteWriter {
  private buf = new Uint8Array(1024)
  private len = 0

  private ensure(extra: number) {
    if (this.len + extra <= this.buf.length) return
    let size = this.buf.length * 2
    while (size < this.len + extra) size *= 2
    const next = new Uint8Array(size)
    next.set(this.buf.subarray(0, this.len))
    this.buf = next
  }

  u8(v: number) {
    this.ensure(1)
    this.buf[this.len++] = v & 0xff
  }

  u16(v: number) {
    this.ensure(2)
    this.buf[this.len++] = v & 0xff
    this.buf[this.len++] = (v >> 8) & 0xff
  }

  u32(v: number) {
    this.ensure(4)
    this.buf[this.len++] = v & 0xff
    this.buf[this.len++] = (v >> 8) & 0xff
    this.buf[this.len++] = (v >> 16) & 0xff
    this.buf[this.len++] = (v >>> 24) & 0xff
  }

  bytes(b: Uint8Array) {
    this.ensure(b.length)
    this.buf.set(b, this.len)
    this.len += b.length
  }

  /** Offset one past everything written, for the IFD pointer fields. */
  get offset() {
    return this.len
  }

  result(): Uint8Array {
    return this.buf.subarray(0, this.len)
  }
}

/** Rows per strip: `targetBytes` per strip, at least one row. */
function rowsPerStrip(width: number, height: number, samples: number, targetBytes: number): number {
  const rowBytes = width * samples
  const rows = Math.floor(targetBytes / Math.max(1, rowBytes))
  return Math.max(1, Math.min(height, rows))
}

/**
 * Encode RGBA pixels as a baseline TIFF. Returns the file bytes.
 *
 * The pixel data is written as contiguous strips in row order, and every
 * value is masked to its byte width, so an alpha of 0 or a channel of 255 in
 * a typed array cannot spill into the neighbouring pixel.
 */
export function encodeTiff(options: TiffEncodeOptions): Uint8Array {
  const { width, height, rgba } = options
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new TiffEncodeError(`Bad TIFF size ${width}x${height}`)
  }
  if (rgba.length < width * height * 4) {
    throw new TiffEncodeError(`Pixel buffer too small: ${rgba.length} for ${width}x${height}`)
  }

  // Alpha is written only when something is actually transparent: a fully
  // opaque page is smaller and prints identically without the extra channel.
  let hasAlpha = false
  for (let i = 3; i < width * height * 4; i += 4) {
    if (rgba[i] !== 255) {
      hasAlpha = true
      break
    }
  }
  const samples = hasAlpha ? 4 : 3
  const rowBytes = width * samples
  const targetBytes =
    Number.isFinite(options.maxStripBytes) && (options.maxStripBytes as number) > 0
      ? (options.maxStripBytes as number)
      : 8 * 1024 * 1024
  const rows = rowsPerStrip(width, height, samples, targetBytes)
  const stripCount = Math.ceil(height / rows)

  const w = new ByteWriter()
  // Header: little-endian, magic 42, offset of the first IFD (patched below).
  w.u16(0x4949) // "II"
  w.u16(42)
  w.u32(8)

  // Pixel data first so the IFD can point at it with known offsets.
  const stripOffsets: number[] = []
  const stripByteCounts: number[] = []
  for (let strip = 0; strip < stripCount; strip++) {
    const first = strip * rows
    const count = Math.min(rows, height - first)
    stripOffsets.push(w.offset)
    stripByteCounts.push(count * rowBytes)
    for (let y = 0; y < count; y++) {
      let src = ((first + y) * width) * 4
      // Interleaved RGBA -> the file's channel order, dropping alpha when
      // the image turned out to be opaque.
      if (hasAlpha) {
        for (let x = 0; x < width; x++) {
          w.u8(rgba[src]); w.u8(rgba[src + 1]); w.u8(rgba[src + 2]); w.u8(rgba[src + 3])
          src += 4
        }
      } else {
        for (let x = 0; x < width; x++) {
          w.u8(rgba[src]); w.u8(rgba[src + 1]); w.u8(rgba[src + 2])
          src += 4
        }
      }
    }
  }

  // IFD. Entries must be sorted by tag; every value that does not fit in the
  // four inline bytes needs an offset into the trailing value area.
  const requestedDpi = Number(options.dpi)
  const dpi = Number.isFinite(requestedDpi) && requestedDpi > 0 ? requestedDpi : 0
  const typeShort = 3
  const typeLong = 4
  const typeRational = 5
  interface Entry {
    tag: number
    type: number
    count: number
    /** Inline value, or the offset to a value written after the IFD. */
    value: number
  }
  const entries: Entry[] = [
    { tag: 256, type: typeLong, count: 1, value: width }, // ImageWidth
    { tag: 257, type: typeLong, count: 1, value: height }, // ImageLength
    // BitsPerSample: one short per channel. Two samples would fit inline;
    // three or four go to the value area below.
    { tag: 258, type: typeShort, count: samples, value: 0 },
    { tag: 259, type: typeShort, count: 1, value: 1 }, // Compression: none
    { tag: 262, type: typeShort, count: 1, value: 2 }, // Photometric: RGB
    // A single strip's offset and byte count are four bytes each, which the
    // spec requires to be stored *inline* in the value field rather than at
    // an offset. The pixel data was written above, so both are known here.
    { tag: 273, type: typeLong, count: stripCount, value: stripCount === 1 ? stripOffsets[0] : 0 },
    { tag: 277, type: typeShort, count: 1, value: samples }, // SamplesPerPixel
    // RowsPerStrip is the strip height, not the image height: readers use it
    // to walk the strips, and writing the image height there makes every
    // strip after the first look like it holds the whole page.
    { tag: 278, type: typeLong, count: 1, value: rows },
    { tag: 279, type: typeLong, count: stripByteCounts.length, value: stripByteCounts.length === 1 ? stripByteCounts[0] : 0 },
  ]
  if (hasAlpha) {
    // 1 = associated alpha, i.e. the colour channels are already premultiplied.
    entries.push({ tag: 338, type: typeShort, count: 1, value: 1 })
  }
  if (dpi > 0) {
    // XResolution / YResolution are rationals (numerator, denominator), which
    // is eight bytes and so always lives in the value area.
    entries.push({ tag: 282, type: typeRational, count: 1, value: 0 })
    entries.push({ tag: 283, type: typeRational, count: 1, value: 0 })
    entries.push({ tag: 296, type: typeShort, count: 1, value: 2 }) // ResolutionUnit: inch
  }
  entries.sort((a, b) => a.tag - b.tag)

  const ifdOffset = w.offset
  w.u16(entries.length)
  /** Entries whose value did not fit inline and is written after the IFD. */
  const deferred: Array<{ entry: Entry; bytes: Uint8Array }> = []
  for (const entry of entries) {
    w.u16(entry.tag)
    w.u16(entry.type)
    w.u32(entry.count)
    if (entry.tag === 258) {
      const bytes = new Uint8Array(samples * 2)
      for (let i = 0; i < samples; i++) {
        bytes[i * 2] = 8
        bytes[i * 2 + 1] = 0
      }
      deferred.push({ entry, bytes })
      w.u32(0)
    } else if (entry.tag === 273 && stripCount > 1) {
      const bytes = new Uint8Array(stripCount * 4)
      const view = new DataView(bytes.buffer)
      stripOffsets.forEach((offset, i) => view.setUint32(i * 4, offset, true))
      deferred.push({ entry, bytes })
      w.u32(0)
    } else if (entry.tag === 279 && stripByteCounts.length > 1) {
      const bytes = new Uint8Array(stripByteCounts.length * 4)
      const view = new DataView(bytes.buffer)
      stripByteCounts.forEach((count, i) => view.setUint32(i * 4, count, true))
      deferred.push({ entry, bytes })
      w.u32(0)
    } else if (entry.tag === 282 || entry.tag === 283) {
      // 300 dpi is exact; anything else is stored over a 1/1 unit rational.
      const bytes = new Uint8Array(8)
      const view = new DataView(bytes.buffer)
      view.setUint32(0, Math.round(dpi), true)
      view.setUint32(4, 1, true)
      deferred.push({ entry, bytes })
      w.u32(0)
    } else if (entry.type === typeShort) {
      // A single short is left-justified in the four value bytes.
      w.u16(entry.value)
      w.u16(0)
    } else {
      w.u32(entry.value)
    }
  }
  w.u32(0) // no next IFD

  // Anything that did not fit inline, 4-byte aligned as the spec requires.
  for (const { entry, bytes } of deferred) {
    entry.value = w.offset
    w.bytes(bytes)
    const pad = (4 - (bytes.length % 4)) % 4
    for (let i = 0; i < pad; i++) w.u8(0)
  }

  // Patch the value fields of the deferred entries, whose offsets were not
  // known while the directory was being written. Inline entries are left
  // alone: overwriting them would replace, say, ImageWidth with a file
  // offset, which is the kind of bug a reader cannot explain.
  const out = w.result()
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  view.setUint32(4, ifdOffset, true)
  for (const { entry } of deferred) {
    const index = entries.indexOf(entry)
    if (index < 0) continue
    view.setUint32(ifdOffset + 2 + index * 12 + 8, entry.value, true)
  }
  return out
}
