import { describe, it, expect } from 'vitest'
import {
  isLikelyCdrBytes,
  cdrMmToPx,
  cdrSvgToImportSvg,
  cdrViewBoxScale,
  countCdrUrlFills,
  approximateCdrPatternsForPaper,
  scaleCdrImportedStrokes,
  stripCdrCanvasClip,
  parseCdrBytes,
} from './cdr-to-svg'

describe('cdr helpers', () => {
  it('detects CDR magic (PK zip / RIFF)', () => {
    expect(isLikelyCdrBytes(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true)
    expect(isLikelyCdrBytes(new Uint8Array([0x52, 0x49, 0x46, 0x46]))).toBe(true)
    expect(isLikelyCdrBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]))).toBe(false)
    expect(isLikelyCdrBytes(new Uint8Array([]))).toBe(false)
  })

  it('converts mm to 96dpi px', () => {
    expect(cdrMmToPx(25.4)).toBeCloseTo(96, 6)
    expect(cdrMmToPx(0)).toBe(0)
  })

  it('rewrites SVG header to 96dpi without touching viewBox', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="100px" height="50px" viewBox="0 0 1000 500"><rect width="10" height="10"/></svg>'
    const out = cdrSvgToImportSvg(svg, 25.4, 12.7)
    expect(out).toContain('width="96.0000px"')
    expect(out).toContain('height="48.0000px"')
    expect(out).toContain('viewBox="0 0 1000 500"')
  })

  it('strips the canvas clip but keeps bitmap clips', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<defs><clipPath id="canvas-clip"><rect x="0" y="0" width="10" height="10"/></clipPath>' +
      '<clipPath id="bitmap-clip-1"><path d="M0 0h1v1H0z"/></clipPath></defs>' +
      '<g clip-path="url(#canvas-clip)"><rect width="5" height="5"/></g></svg>'
    const out = cdrSvgToImportSvg(svg, 25.4, 25.4)
    expect(out).not.toContain('canvas-clip')
    expect(out).toContain('bitmap-clip-1')
  })

  it('computes the viewport scale from the SVG header', () => {
    // 96dpi header over a 254000-unit (=25.4mm) viewBox -> 96/254000.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="96.0000px" height="96.0000px" viewBox="0 0 254000 254000"></svg>'
    expect(cdrViewBoxScale(svg)).toBeCloseTo(96 / 254000, 12)
    expect(cdrViewBoxScale('not svg')).toBeCloseTo(96 / 254000, 12)
  })

  it('rescales imported stroke widths by the viewport scale', () => {
    // Paper.js keeps raw user-unit stroke widths on import: a 1524-unit
    // CDR stroke must become ~0.576px at 96dpi, not stay 1524px wide.
    const child = { strokeColor: '#111', strokeWidth: 2000, dashArray: [4000, 6000], dashOffset: 1000 }
    const text = { strokeColor: '#111', strokeWidth: 0.9 }
    const group = { children: [child, text] }
    scaleCdrImportedStrokes(group, 96 / 254000)
    expect(child.strokeWidth).toBeCloseTo(2000 * (96 / 254000), 9)
    expect(child.dashArray[0]).toBeCloseTo(4000 * (96 / 254000), 9)
    expect(child.dashOffset).toBeCloseTo(1000 * (96 / 254000), 9)
    expect(text.strokeWidth).toBeCloseTo(0.9 * (96 / 254000), 12)
    // Zero widths stay zero; scale 1 is a no-op.
    const hairline = { strokeColor: '#111', strokeWidth: 0 }
    scaleCdrImportedStrokes(hairline, 96 / 254000)
    expect(hairline.strokeWidth).toBe(0)
    const untouched = { strokeWidth: 5 }
    scaleCdrImportedStrokes(untouched, 1)
    expect(untouched.strokeWidth).toBe(5)
  })

  it('leaves unstroked items alone (Paper defaults strokeWidth to 1)', () => {
    // Without the strokeColor guard every imported shape would end up with
    // a ~0.0004px width, breaking later attempts to add a stroke.
    const plain = { strokeColor: null, strokeWidth: 1, dashArray: [], dashOffset: 0 }
    const group = { strokeColor: null, strokeWidth: 1, children: [plain] }
    scaleCdrImportedStrokes(group, 96 / 254000)
    expect(plain.strokeWidth).toBe(1)
    expect(group.strokeWidth).toBe(1)
    expect('strokeColor' in group && group.strokeColor).toBeNull()
  })

  it('stripCdrCanvasClip leaves SVGs without the clip untouched', () => {
    const svg = '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>'
    expect(stripCdrCanvasClip(svg)).toBe(svg)
  })

  it('approximates pattern fills with the motif primary color', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">' +
      '<defs><g id="pattern-pixels-9"><rect width="8" height="8" fill="#ffffff"/>' +
      '<path d="M0 0h8v1H0z" fill="#cccccc"/></g>' +
      '<pattern id="pattern-3" patternUnits="userSpaceOnUse" width="5" height="5">' +
      '<use href="#pattern-pixels-9"/></pattern></defs>' +
      '<path d="M0 0h10v10H0z" fill="url(#pattern-3)"/>' +
      '<path d="M0 0h1v1H0z" fill="url(#pattern-unknown)"/></svg>'
    expect(countCdrUrlFills(svg)).toBe(2)
    const { svg: out, approximated } = approximateCdrPatternsForPaper(svg)
    expect(approximated).toBe(2)
    expect(out).toContain('fill="#cccccc"')
    expect(out).toContain('fill="none"')
    expect(out).not.toContain('url(#')
  })

  it('leaves SVGs without pattern fills untouched', () => {
    const svg = '<svg viewBox="0 0 1 1"><rect width="1" height="1" fill="#fff"/></svg>'
    expect(countCdrUrlFills(svg)).toBe(0)
    const { svg: out, approximated } = approximateCdrPatternsForPaper(svg)
    expect(out).toBe(svg)
    expect(approximated).toBe(0)
  })

  it('rejects non-CDR payloads', async () => {
    await expect(parseCdrBytes(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow()
  })

  it('rejects truncated ZIP CDR', async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])
    await expect(parseCdrBytes(bytes)).rejects.toThrow()
  })
})
