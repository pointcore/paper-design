/**
 * In-memory builders for minimal CDR files used by regression tests.
 *
 * - buildMinimalLegacyCdr: legacy (X4 riffData/CDRE) ZIP with one page and a
 *   single rectangle using a caller-supplied uniform fill color record, so
 *   color-model decoding can be tested end to end without binary fixtures.
 * - buildGradientLegacyCdr: same shell with a `fild` type-2 fountain fill
 *   (X4-era record body: v1300+ layout, 5-byte stop pads).
 * - buildModernGradientCdr: X5+-style ZIP (content/root.dat + dataFileList.dat
 *   with 16-byte data references) carrying the same fountain fill plus the
 *   JSON object style, with a selectable vrsn to lock both stop-pad layouts.
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
function f64(n: number): Uint8Array {
  const b = new Uint8Array(8)
  new DataView(b.buffer).setFloat64(0, n, true)
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
  return storedZipMulti([{ name, data }])
}
/** Stored (method 0) ZIP with several content/ entries. */
function storedZipMulti(entries: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const { name, data } of entries) {
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
    locals.push(local, nameBytes, data)
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
      u32(offset),
    )
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }
  const centralBlob = cat(...centrals)
  const eocd = cat(
    ascii('PK\x05\x06'),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralBlob.length),
    u32(offset),
    u16(0),
  )
  return cat(...locals, centralBlob, eocd)
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
 * Shared assembly: a 20x20 mm page holding one 20x10 mm rectangle whose
 * loda references fillId (arg 20) and outlineId (arg 10).
 */
function buildLegacyZip(fillId: number, outlineId: number, fildPayload: Uint8Array): Uint8Array {
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
    u32(outlineId),
    u32(fillId),
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
  const fild = record('fild', fildPayload.length, fildPayload)
  // Outline record id 9, CMYK black, width 500 (see legacyTables layout).
  const outl = record(
    'outl',
    108,
    cat(
      u32(outlineId),
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

export function buildMinimalLegacyCdr(spec: LegacyFillSpec): Uint8Array {
  return buildLegacyZip(
    spec.fillId,
    spec.outlineId,
    // Uniform fill record: id, padding, type 1, padding, color record, pad.
    cat(u32(spec.fillId), zeros(8), u16(1), zeros(13), spec.fillColorRecord, zeros(1)),
  )
}

export interface GradientStopSpec {
  /** Numeric color model (5 = RGB255, 3/17 = CMYK255). */
  model: number
  /** Raw 4 value bytes at the color record's offset 8 (see legacyColor). */
  comps: [number, number, number, number]
  /** Stop offset in percent (0-100). */
  offset: number
}

export interface GradientFildSpec {
  /** Fill id referenced by the test rectangle's loda arg 20. */
  fillId: number
  outlineId: number
  /** 1 = linear, 2 = radial, 3 = conical, 4 = square. */
  gradientType: number
  /** Edge pad percent (0-49). */
  edgeOffset: number
  /** Ramp angle in degrees, counterclockwise. */
  angleDeg: number
  /** Radial center offsets in percent*2 (libcdr's /200 convention). */
  centerXOffset: number
  centerYOffset: number
  /** Color blend mode: 0 = direct. */
  mode: number
  stops: GradientStopSpec[]
  /**
   * Fill id written into the fild record (defaults to fillId); set it to a
   * dangling value to exercise the unresolved-fill fallback.
   */
  registeredFillId?: number
}

/**
 * `fild` type-2 payload in the v1300+ record layout shared by X4 CDRE and
 * modern root.dat files. `version` only selects the per-stop pad (26 bytes
 * on v1500+, else 5).
 */
function gradientFildPayload(spec: GradientFildSpec, version: number): Uint8Array {
  const stopPad = version >= 1500 ? 26 : 5
  const parts: Uint8Array[] = [
    u32(spec.registeredFillId ?? spec.fillId),
    zeros(8),
    u16(2),
    zeros(8),
    new Uint8Array([spec.gradientType]),
    zeros(17),
    u16(spec.edgeOffset),
    i32(Math.round(spec.angleDeg * 1e6)),
    i32(spec.centerXOffset),
    i32(spec.centerYOffset),
    zeros(2),
    u32(spec.mode),
    zeros(2),
    u32(spec.stops.length),
    zeros(3),
  ]
  for (const st of spec.stops) {
    // 12-byte color record: u16 model, u16 palette, 4-byte pad, raw value.
    parts.push(
      u16(st.model),
      u16(0),
      zeros(4),
      new Uint8Array(st.comps),
      zeros(stopPad),
      u32(st.offset),
      zeros(3),
    )
  }
  return cat(...parts)
}

export function buildGradientLegacyCdr(spec: GradientFildSpec): Uint8Array {
  return buildLegacyZip(spec.fillId, spec.outlineId, gradientFildPayload(spec, 1400))
}

export interface ModernGradientSpec extends GradientFildSpec {
  /** vrsn payload: 1400 uses 5-byte stop pads, 1500+ uses 26-byte pads. */
  version: number
}/**
 * X5+-style ZIP CDR: content/root.dat RIFF (vrsn + one page/rectangle) with
 * the fountain-fill `fild` and the object's loda blob living in
 * content/data/* behind 16-byte data references. The object style arrives as
 * inline JSON ({"fill":{"type":"2"}}) the modern renderer reads from loda
 * arg 10.
 */
export function buildModernGradientCdr(spec: ModernGradientSpec): Uint8Array {
  const fild = gradientFildPayload(spec, spec.version)
  const styleJson = '{"fill":{"type":"2"}}'
  const styleArg = cat(u32(styleJson.length), ascii(styleJson))
  // Modern rectangle record: f64 w/h, unit scales, relative flag, corner data.
  const geometry = cat(f64(200000), f64(100000), f64(1), f64(1), zeros(96))
  const data = cat(styleArg, u32(spec.fillId), geometry)
  const d0 = 44 // 20-byte loda header + 12-byte offset table + 12-byte id table
  const offFill = d0 + styleArg.length
  const loda = cat(
    u32(d0 + data.length),
    u32(3),
    u32(20),
    u32(32),
    u32(1),
    u32(d0),
    u32(offFill),
    u32(offFill + 4),
    u32(30),
    u32(20),
    u32(10),
    data,
  )
  const lodaLeaf = record('loda', 16, cat(u32(1), u32(loda.length), u32(0), u32(0)))
  const lgobPayload = cat(ascii('lgob'), lodaLeaf)
  const lgob = record('LIST', lgobPayload.length, lgobPayload)
  // Every referenced chunk in modern files is a 16-byte redirect, bbox
  // included; page and object bounds share one data file.
  const bboxPayload = cat(i32(-100000), i32(100000), i32(100000), i32(-100000))
  const bboxRef = cat(u32(0), u32(bboxPayload.length), u32(0), u32(0))
  const bbox = record('bbox', 16, bboxRef)
  const objPayload = cat(ascii('obj '), lgob, bbox)
  const obj = record('LIST', objPayload.length, objPayload)
  const pagePayload = cat(ascii('page'), bbox, obj)
  const page = record('LIST', pagePayload.length, pagePayload)
  const vrsn = record('vrsn', 4, u32(spec.version))
  const fildRec = record('fild', 16, cat(u32(2), u32(fild.length), u32(0), u32(0)))
  const records = cat(vrsn, page, fildRec)
  const root = cat(ascii('RIFF'), u32(4 + records.length), ascii('CDRX'), records)
  return storedZipMulti([
    { name: 'content/root.dat', data: root },
    { name: 'content/dataFileList.dat', data: ascii('bbox.dat\nloda.dat\nfild.dat') },
    { name: 'content/data/bbox.dat', data: bboxPayload },
    { name: 'content/data/loda.dat', data: loda },
    { name: 'content/data/fild.dat', data: fild },
  ])
}

export interface LayeredLayerSpec {
  /** Layer name written as UTF-16LE arg1000 ("" to omit the arg). */
  name: string
  /** Layer loda type: 0 = user layer, 12 = guides, 17 = desktop. */
  kind: number
  /** RGB uniform fill for the layer's single test rectangle. */
  color: [number, number, number]
}

export interface LayeredCdrSpec {
  outlineId: number
  layers: LayeredLayerSpec[]
  /** Mark the page with the master-page flag the parser skips. */
  master?: boolean
}

/**
 * Legacy (X4 riffData/CDRE) ZIP CDR whose page carries a CorelDRAW layer
 * stack (page > gobj > layr, matching production files): one layer object
 * (loda type + optional UTF-16 name) plus one rectangle per layer.
 */
export function buildLayeredLegacyCdr(spec: LayeredCdrSpec): Uint8Array {
  // Legacy records inside the inflated tree reference the deflate length
  // table by index; records of equal length share one entry.
  const lens: number[] = []
  const idxMap = new Map<number, number>()
  const idx = (len: number): number => {
    let i = idxMap.get(len)
    if (i === undefined) {
      i = lens.length
      lens.push(len)
      idxMap.set(len, i)
    }
    return i
  }
  const rectObj = (fillId: number): Uint8Array => {
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
      u32(fillId),
      i32(200000),
      i32(100000),
    )
    const lgobPayload = cat(ascii('lgob'), record('loda', idx(loda.length), loda))
    const bboxPayload = cat(i32(-100000), i32(100000), i32(100000), i32(-100000))
    return cat(
      ascii('obj '),
      record('LIST', idx(lgobPayload.length), lgobPayload),
      record('bbox', idx(bboxPayload.length), bboxPayload),
    )
  }
  const layerRec = (layer: LayeredLayerSpec, fillId: number): Uint8Array => {
    const nameArg = cat(
      Uint8Array.from(
        Array.from(layer.name).flatMap((ch) => {
          const c = ch.charCodeAt(0)
          return [c & 0xff, (c >> 8) & 0xff]
        }),
      ),
      zeros(2),
    )
    const loda = cat(
      u32(28 + nameArg.length),
      u32(1),
      u32(20),
      u32(24),
      u32(layer.kind),
      u32(28),
      u32(1000),
      nameArg,
    )
    const lgobPayload = cat(ascii('lgob'), record('loda', idx(loda.length), loda))
    const objPayload = rectObj(fillId)
    const payload = cat(
      ascii('layr'),
      record('flgs', idx(4), u32(0x9801000a)),
      record('LIST', idx(lgobPayload.length), lgobPayload),
      record('LIST', idx(objPayload.length), objPayload),
    )
    return record('LIST', idx(payload.length), payload)
  }
  const gobjPayload = cat(ascii('gobj'), ...spec.layers.map((l, i) => layerRec(l, 7 + i)))
  const gobj = record('LIST', idx(gobjPayload.length), gobjPayload)
  const pagePayload = cat(
    ascii('page'),
    record('flgs', idx(4), u32(spec.master ? 0x90010040 : 0x90000040)),
    record('bbox', idx(16), cat(i32(-100000), i32(100000), i32(100000), i32(-100000))),
    gobj,
  )
  const page = record('LIST', idx(pagePayload.length), pagePayload)
  const lengths = cat(...lens.map((n) => u32(n)))
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
  // One uniform fill per layer (RGB255 via the shared legacy color record).
  const filds = spec.layers.map((l, i) =>
    record(
      'fild',
      40,
      cat(
        u32(7 + i),
        zeros(8),
        u16(1),
        zeros(13),
        cat(u16(5), u16(0), zeros(4), new Uint8Array([l.color[2], l.color[1], l.color[0], 0])),
        zeros(1),
      ),
    ),
  )
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
  const records = cat(cmpr, ...filds, outl)
  const riffData = cat(ascii('RIFF'), u32(4 + records.length), ascii('CDRE'), records)
  return storedZip('content/riffData.cdr', riffData)
}

export interface LegacyTextSpec {
  /** Font-table entry's first size slot in CDR units (254000 per inch). */
  nominalSize: number
  /** Middle size slot: the size CorelDRAW displays for the style. */
  stretchedSize: number
  /** Third size slot (echoes the nominal slot in production files). */
  thirdSlotSize?: number
}

function utf16le(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2)
  for (let k = 0; k < s.length; k++) {
    out[k * 2] = s.charCodeAt(k) & 0xff
    out[k * 2 + 1] = s.charCodeAt(k) >> 8
  }
  return out
}

/**
 * Legacy (X4 riffData/CDRE) ZIP with one page holding a single artistic text
 * object ("测试") styled through a `stlt` style table whose font record
 * carries three size slots, so the frame-stretch repair in readOldStyleTable
 * can be tested end to end: the character style inherits the font entry, and
 * the rendered font-size must come from the effective (middle) slot when the
 * nominal first slot is absurd, and from the nominal slot otherwise.
 */
export function buildLegacyTextCdr(spec: LegacyTextSpec): Uint8Array {
  // loda blob: type 4 (artistic text), no parameters; the payload is txsm.
  const loda = cat(u32(20), u32(0), u32(0), u32(0), u32(4))
  const lodaLeaf = record('loda', 3, loda)
  const lgobPayload = cat(ascii('lgob'), lodaLeaf)
  const lgob = record('LIST', 2, lgobPayload)
  // txsm: frame header + one paragraph ("测试") with a table-inherited style.
  const txsm = cat(
    u32(0xffffffff), // frame flag (set)
    zeros(32),
    u32(1), // one frame
    zeros(52), // frame record (no on-path)
    u32(0), // textOnPath
    u32(1), // one paragraph
    u32(1001), // base style id -> stlt record
    zeros(2), // skip(1 + frame?1)
    u32(1), // one character style
    u16(2), // chars covered (discarded)
    new Uint8Array([0, 0]), // flags = 0: inherit the table's font + size
    u32(2), // two characters
    u32(1),
    zeros(4), // char 0: wide, style 0
    u32(1),
    zeros(4), // char 1: wide, style 0
    u32(4), // text byte length
    utf16le('测试'),
    zeros(1), // terminator
  )
  const objPayload = cat(ascii('obj '), lgob, record('txsm', 4, txsm))
  const obj = record('LIST', 1, objPayload)
  // 20x20 mm page bounds in CDR units (no canvas size -> no culling).
  const bbox = record('bbox', 5, cat(i32(-100000), i32(100000), i32(100000), i32(-100000)))
  const pagePayload = cat(ascii('page'), bbox, obj)
  const page = record('LIST', 0, pagePayload)
  const lengths = cat(
    u32(pagePayload.length),
    u32(objPayload.length),
    u32(lgobPayload.length),
    u32(loda.length),
    u32(txsm.length),
    u32(16),
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
  // Style table: one font entry with the three size slots, one style record
  // (num=2: fill, outline, font, justify) pointing at the font entry.
  const stltPayload = cat(
    u32(1), // style count
    u32(0), // fills
    u32(0), // outlines
    u32(1), // fonts
    u32(2001), // font entry id
    zeros(20),
    u16(0), // font id (unnamed -> default fallback font; peeked, p stays)
    u16(0), // charset (peeked)
    zeros(8), // rest of the parser's skip(12)
    u32(spec.nominalSize), // first size slot (the one libcdr reads)
    u32(spec.stretchedSize), // middle slot: the effective displayed size
    u32(spec.thirdSlotSize ?? spec.nominalSize), // third slot
    zeros(12),
    u32(0), // aligns
    u32(0), // 52-byte section
    u32(0), // 152-byte section
    u32(0), // 784-byte section
    u32(0), // intervals
    u32(0), // 28-byte section
    u32(0), // 36-byte section
    u32(0), // 28-byte section
    u32(0), // 12-byte section
    u32(2), // record: fill/outline/font/justify level
    u32(1001), // record id
    u32(0), // parent
    zeros(8),
    u32(0), // no extra words
    u32(0), // fill table id (dangling)
    u32(0), // outline table id (dangling)
    u32(2001), // font entry
    u32(0), // align id (dangling)
    zeros(12),
  )
  const stlt = record('stlt', stltPayload.length, stltPayload)
  const records = cat(cmpr, stlt)
  const riffData = cat(ascii('RIFF'), u32(4 + records.length), ascii('CDRE'), records)
  return storedZip('content/riffData.cdr', riffData)
}
