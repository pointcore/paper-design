/**
 * In-memory builder for a minimal legacy (X4 riffData) ZIP CDR used by
 * regression tests. The file holds one page with a single rectangle using a
 * caller-supplied uniform fill color record, so color-model decoding can be
 * tested end to end without binary fixtures.
 */
import { deflateSync } from 'node:zlib'

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2)
  new DataView(b.buffer).setUint16(0, n, true)
  return b
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setUint32(0, n, true)
  return b
}
function i32(n: number): Uint8Array {
  const b = new Uint8Array(4)
  new DataView(b.buffer).setInt32(0, n, true)
  return b
}
function ascii(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}
function cat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
function zeros(n: number): Uint8Array {
  return new Uint8Array(n)
}
/** Standard CRC-32 (ZIP local/central headers). */
function crc32(data: Uint8Array): number {
  let table: Uint32Array | null = (crc32 as unknown as { _t?: Uint32Array })._t ?? null
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
    ;(crc32 as unknown as { _t?: Uint32Array })._t = table
  }
  let crc = 0xffffffff
  for (const byte of data) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
/**
 * One legacy record: 4-char id + length-table index + payload. Odd payloads
 * carry one alignment pad byte (the walker advances `len + (len & 1)`), while
 * length-table entries and outer indices use the unpadded payload length.
 */
function record(id4: string, lenIdx: number, payload: Uint8Array): Uint8Array {
  const pad = payload.length & 1 ? zeros(1) : new Uint8Array(0)
  return cat(ascii(id4), u32(lenIdx), payload, pad)
}
/** Minimal stored (method 0) ZIP with a single content/ entry. */
function storedZip(name: string, data: Uint8Array): Uint8Array {
  const nameBytes = ascii(name)
  const crc = crc32(data)
  const local = cat(
    ascii('PK\x03\x04'),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(crc),
    u32(data.length),
    u32(data.length),
    u16(nameBytes.length),
    u16(0),
  )
  const central = cat(
    ascii('PK\x01\x02'),
    u16(20),
    u16(20),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(crc),
    u32(data.length),
    u32(data.length),
    u16(nameBytes.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
  )
  const centralOff = local.length + nameBytes.length + data.length
  const eocd = cat(
    ascii('PK\x05\x06'),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(central.length + nameBytes.length),
    u32(centralOff),
    u16(0),
  )
  return cat(local, nameBytes, data, central, nameBytes, eocd)
}

export interface LegacyFillSpec {
  /** Uniform fill record id referenced by the test rectangle. */
  fillId: number
  /** Outline record id referenced by the test rectangle. */
  outlineId: number
  /** 12-byte legacy color record placed at fild offset 27. */
  fillColorRecord: Uint8Array
}

/**
 * Build the fixture ZIP. Geometry: 20x20 mm page, one 20x10 mm rectangle.
 * The rectangle uses fillId/outlineId below; the color record decides the
 * expected fill (e.g. model-17 white = [17,0,5,0,0,0,0,0,0,0,0,0]).
 */
export function buildMinimalLegacyCdr(spec: LegacyFillSpec): Uint8Array {
  // loda blob: 3 args {10: outline id, 20: fill id, 30: rect geometry}, type 1.
  const loda = cat(
    u32(60),
    u32(3),
    u32(20),
    u32(32),
    u32(1),
    u32(44),
    u32(48),
    u32(52),
    u32(30),
    u32(20),
    u32(10),
    u32(spec.outlineId),
    u32(spec.fillId),
    i32(200000),
    i32(100000),
  )
  const lodaLeaf = record('loda', 4, loda)
  const lgobPayload = cat(ascii('lgob'), lodaLeaf)
  const lgob = record('LIST', 3, lgobPayload)
  // Page/object bounds: 20x20 mm in CDR units.
  const bbox = record('bbox', 1, cat(i32(-100000), i32(100000), i32(100000), i32(-100000)))
  const objPayload = cat(ascii('obj '), lgob, bbox)
  const obj = record('LIST', 2, objPayload)
  const pagePayload = cat(ascii('page'), bbox, obj)
  const page = record('LIST', 0, pagePayload)
  const lengths = cat(
    u32(pagePayload.length),
    u32(16),
    u32(objPayload.length),
    u32(lgobPayload.length),
    u32(loda.length),
  )
  const zR = new Uint8Array(deflateSync(page))
  const zT = new Uint8Array(deflateSync(lengths))
  const size = zR.length + 8
  const cmprPayload = cat(
    ascii('cmpr'),
    u32(size),
    zeros(12),
    ascii('CPng'),
    zeros(4),
    zR,
    ascii('CPng'),
    zeros(4),
    zT,
  )
  const cmpr = record('LIST', cmprPayload.length, cmprPayload)
  // Uniform fill record: id, padding, type 1, padding, color record, pad.
  const fild = record(
    'fild',
    40,
    cat(u32(spec.fillId), zeros(8), u16(1), zeros(13), spec.fillColorRecord, zeros(1)),
  )
  // Outline record id 9, CMYK black, width 500 (see legacyTables layout).
  const outl = record(
    'outl',
    108,
    cat(
      u32(spec.outlineId),
      u32(1),
      u32(0),
      u16(0),
      u16(1),
      u16(1),
      i32(500),
      zeros(54),
      ascii('\x02\x00\x05\x00'),
      zeros(4),
      new Uint8Array([0, 0, 0, 100]),
      zeros(16),
      u16(0),
      zeros(2),
    ),
  )
  const records = cat(cmpr, fild, outl)
  const riffData = cat(ascii('RIFF'), u32(4 + records.length), ascii('CDRE'), records)
  return storedZip('content/riffData.cdr', riffData)
}
