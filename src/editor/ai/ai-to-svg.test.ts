// @vitest-environment node
/**
 * Tests for the AI/PDF -> SVG parser.
 *
 * The fixture builder assembles a small but structurally valid PDF (classic
 * xref table, page tree, uncompressed + Flate content streams) covering the
 * operator subset the interpreter supports: rectangles, strokes, colors,
 * clipping, text, and an axial shading. The EPS-style .ai refusal and the
 * no-PDF-artwork guard are locked as well.
 */
import { describe, it, expect } from 'vitest'
import { deflateSync } from 'node:zlib'
import { parseAiBytes, isLikelyAiBytes } from './ai-to-svg'

function ascii(s: string): Uint8Array {
  return new Uint8Array(Array.from(s).map((c) => c.charCodeAt(0) & 0xff))
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

interface PdfObj {
  num: number
  head: string
  stream?: Uint8Array
}

/**
 * Assemble objects into a PDF with a classic xref table. Object heads must
 * include their own /Length when they carry streams.
 */
function buildPdf(objs: PdfObj[]): Uint8Array {
  let head = '%PDF-1.6\n%\xE2\xE3\xCF\xD3\n'
  const offsets: Array<{ num: number; off: number }> = []
  let pos = head.length
  const chunks: Uint8Array[] = [ascii(head)]
  for (const o of objs) {
    offsets.push({ num: o.num, off: pos })
    const piece =
      `${o.num} 0 obj\n${o.head}\n` +
      (o.stream !== undefined ? `stream\n` : `endobj\n`)
    chunks.push(ascii(piece))
    pos += piece.length
    if (o.stream !== undefined) {
      chunks.push(o.stream)
      pos += o.stream.length
      const tail = `\nendstream\nendobj\n`
      chunks.push(ascii(tail))
      pos += tail.length
    }
  }
  const xrefPos = pos
  const count = objs.length + 1
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let k = 1; k < count; k++) {
    const e = offsets.find((x) => x.num === k)
    xref += `${String(e?.off ?? 0).padStart(10, '0')} 00000 n \n`
  }
  xref += `trailer\n<</Size ${count}/Root 1 0 R>>\nstartxref\n${xrefPos}\n%%EOF\n`
  chunks.push(ascii(xref))
  return cat(...chunks)
}

const PAGE_ART = `1 0 0 -1 0 100 cm
q 1 0 0 1 10 10 cm
1 0 0 rg
0 0 50 30 re f
0 0 0 RG 2 w
5 5 m 60 40 l S
0 0 0 rg
BT /F1 12 Tf 15 0 Td (Hello AI) Tj ET
Q
q 10 10 80 60 re W n
/Sh1 sh
Q`

const FONT_OBJ: PdfObj = {
  num: 7,
  head: '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
}
const SHADING_OBJ: PdfObj = {
  num: 8,
  head:
    '<</ShadingType 2/ColorSpace /DeviceRGB/Coords[0 0 100 0]/Function<</FunctionType 2/C0[1 0 0]/C1[0 0 1]/Domain[0 1]/N 1>>>>',
}

function buildTwoPagePdf(): Uint8Array {
  const resources = '/Resources<</Font<</F1 7 0 R>>/Shading<</Sh1 8 0 R>>>>'
  return buildPdf([
    { num: 1, head: '<</Type/Catalog/Pages 2 0 R>>' },
    { num: 2, head: '<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>' },
    { num: 3, head: `<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 100]/Contents 5 0 R${resources}>>` },
    { num: 4, head: '<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]/Contents 6 0 R>>' },
    { num: 5, head: '<</Length ' + PAGE_ART.length + '>>', stream: ascii(PAGE_ART) },
    {
      num: 6,
      head: '<</Filter/FlateDecode/Length ' + deflateSync(ascii('1 0 0 1 0 0 cm 0 0 20 20 re f')).length + '>>',
      stream: deflateSync(ascii('1 0 0 1 0 0 cm 0 0 20 20 re f')),
    },
    FONT_OBJ,
    SHADING_OBJ,
  ])
}

describe('AI/PDF parser', () => {
  it('flags AI/PDF magic and EPS-style files', () => {
    expect(isLikelyAiBytes(ascii('%PDF-1.6\n%'))).toBe(true)
    expect(isLikelyAiBytes(ascii('%!PS-Adobe-3.0 EPSF-3.0'))).toBe(true)
    expect(isLikelyAiBytes(ascii('PK\x03\x04'))).toBe(false)
  })

  it('rejects EPS-style .ai with a conversion hint', async () => {
    await expect(parseAiBytes(ascii('%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe'))).rejects.toThrow(
      /PDF compatibility/
    )
  })

  it('parses pages in tree order with px page sizes', async () => {
    const doc = await parseAiBytes(buildTwoPagePdf())
    expect(doc.pages).toHaveLength(2)
    // 200x100 pt at 96dpi -> 266.67 x 133.33 px
    expect(doc.pages[0].width).toBeCloseTo(200 * (96 / 72), 4)
    expect(doc.pages[0].height).toBeCloseTo(100 * (96 / 72), 4)
    expect(doc.pages[1].width).toBeCloseTo(100 * (96 / 72), 4)
  })

  it('emits the filled rect with the baked flip+translate transform', async () => {
    const doc = await parseAiBytes(buildTwoPagePdf())
    const svg = doc.pages[0].svg
    // rect (0,0,50,30) under [1 0 0 -1 10 110]: corners flip to y 110/80.
    expect(svg).toContain('d="M 10 110 L 10 80 L 60 80 L 60 110 Z"')
    expect(svg).toContain('fill="rgb(255,0,0)"')
  })

  it('scales stroke widths by the CTM and keeps colors', async () => {
    const doc = await parseAiBytes(buildTwoPagePdf())
    const svg = doc.pages[0].svg
    expect(svg).toContain('d="M 15 105 L 70 70"')
    expect(svg).toContain('stroke="rgb(0,0,0)" stroke-width="2"')
  })

  it('emits text upright with the counter-flipped matrix', async () => {
    const doc = await parseAiBytes(buildTwoPagePdf())
    const svg = doc.pages[0].svg
    expect(svg).toContain('font-family="Helvetica"')
    expect(svg).toContain('font-size="12"')
    expect(svg).toContain('>Hello AI</text>')
    expect(svg).toContain('matrix(1 0 0 1 25 110)')
  })

  it('resolves FlateDecode content streams', async () => {
    const doc = await parseAiBytes(buildTwoPagePdf())
    expect(doc.pages[1].svg).toContain('d="M 0 0 L 0 20 L 20 20 L 20 0 Z"')
  })

  it('turns an axial shading into a userSpace gradient clipped by W n', async () => {
    const doc = await parseAiBytes(buildTwoPagePdf())
    const svg = doc.pages[0].svg
    expect(svg).toContain('<linearGradient id="sh-1" gradientUnits="userSpaceOnUse"')
    expect(svg).toContain('x1="0" y1="100"')
    expect(svg).toContain('x2="100" y2="100"')
    expect(svg).toContain('<stop offset="0" stop-color="rgb(255,0,0)"/>')
    expect(svg).toContain('<stop offset="1" stop-color="rgb(0,0,255)"/>')
    expect(svg).toContain('<clipPath id="clip-1"')
    expect(svg).toContain('<rect x="10" y="30" width="80" height="60" fill="url(#sh-1)"/>')
  })

  it('warns on text approximation', async () => {
    const doc = await parseAiBytes(buildTwoPagePdf())
    expect(doc.warnings.some((w) => w.startsWith('Text encoding approximated'))).toBe(true)
  })
})
