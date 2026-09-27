// @vitest-environment node
/**
 * Regression tests for CDR fountain (gradient) fills.
 *
 * Before the fix every `fild` type-2 fill collapsed to its primary color
 * ("Gradient/pattern fill approximated as solid"). These tests build minimal
 * legacy (X4 CDRE) and modern (root.dat) ZIP CDRs with fountain fills and
 * lock the emitted SVG linear/radial gradients end to end: stop colors and
 * offsets, angle geometry, edge pad, radial center, blend-mode warnings and
 * the unresolved-fill fallback.
 */
import { describe, it, expect } from 'vitest'
import { parseCdrBytes } from './cdr-to-svg'
import {
  buildGradientLegacyCdr,
  buildModernGradientCdr,
  type GradientFildSpec,
} from './cdr-legacy-test-fixture'

/** RGB255 value bytes are little-endian packed with red at byte 2. */
function rgbComps(r: number, g: number, b: number): [number, number, number, number] {
  return [b, g, r, 0]
}

const RED = rgbComps(255, 0, 0)
const BLUE = rgbComps(0, 0, 255)

const LINEAR: GradientFildSpec = {
  fillId: 7,
  outlineId: 9,
  gradientType: 1,
  edgeOffset: 0,
  angleDeg: 0,
  centerXOffset: 0,
  centerYOffset: 0,
  mode: 0,
  stops: [
    { model: 5, comps: RED, offset: 0 },
    { model: 5, comps: BLUE, offset: 100 },
  ],
}

describe('legacy CDR fountain fills (fild type 2)', () => {
  it('emits a linear gradient with both stop colors', async () => {
    const doc = await parseCdrBytes(buildGradientLegacyCdr(LINEAR))
    expect(doc.pages.length).toBe(1)
    const svg = doc.pages[0].svg
    expect(svg).toContain('fill="url(#grad-1)"')
    expect(svg).toContain(
      '<linearGradient id="grad-1" gradientUnits="objectBoundingBox" x1="0" y1="0.5" x2="1" y2="0.5">',
    )
    expect(svg).toContain('<stop offset="0" stop-color="#ff0000"/>')
    expect(svg).toContain('<stop offset="1" stop-color="#0000ff"/>')
    expect(doc.warnings.some((w) => w.includes('approximated as solid'))).toBe(false)
  })

  it('keeps a 90-degree ramp vertical', async () => {
    const doc = await parseCdrBytes(buildGradientLegacyCdr({ ...LINEAR, angleDeg: 90 }))
    const svg = doc.pages[0].svg
    expect(svg).toContain('x1="0.5" y1="0" x2="0.5" y2="1"')
  })

  it('encodes edge pad as solid cap stops', async () => {
    const doc = await parseCdrBytes(buildGradientLegacyCdr({ ...LINEAR, edgeOffset: 20 }))
    const svg = doc.pages[0].svg
    expect(svg).toContain(
      '<stop offset="0" stop-color="#ff0000"/>' +
        '<stop offset="0.2" stop-color="#ff0000"/>' +
        '<stop offset="0.8" stop-color="#0000ff"/>' +
        '<stop offset="1" stop-color="#0000ff"/>',
    )
  })

  it('emits a radial gradient with the offset center', async () => {
    const doc = await parseCdrBytes(
      buildGradientLegacyCdr({ ...LINEAR, gradientType: 2, centerXOffset: 40, centerYOffset: -20 }),
    )
    const svg = doc.pages[0].svg
    expect(svg).toContain('<radialGradient id="grad-1"')
    expect(svg).toContain('cx="0.7" cy="0.4"')
    expect(svg).toContain('fill="url(#grad-1)"')
    // Radius reaches the farthest object-bounds corner: hypot(0.7, 0.6).
    expect(svg).toContain('r="0.921954"')
  })

  it('collapses a single-stop ramp to its solid color', async () => {
    const doc = await parseCdrBytes(
      buildGradientLegacyCdr({ ...LINEAR, stops: [{ model: 5, comps: RED, offset: 0 }] }),
    )
    const svg = doc.pages[0].svg
    expect(svg).toContain('fill="#ff0000"')
    expect(svg).not.toContain('<linearGradient')
    expect(doc.warnings.some((w) => w.includes('approximated as solid'))).toBe(false)
  })

  it('decodes CMYK255 stop colors through the shared color path', async () => {
    const doc = await parseCdrBytes(
      buildGradientLegacyCdr({
        ...LINEAR,
        stops: [
          { model: 5, comps: RED, offset: 0 },
          { model: 3, comps: [0, 0, 0, 0], offset: 100 },
        ],
      }),
    )
    expect(doc.pages[0].svg).toContain('<stop offset="1" stop-color="rgb(255,255,255)"/>')
  })

  it('warns when the blend mode is not direct', async () => {
    const doc = await parseCdrBytes(buildGradientLegacyCdr({ ...LINEAR, mode: 1 }))
    expect(
      doc.warnings.some((w) => w.startsWith('Rainbow/custom gradient blend approximated as direct')),
    ).toBe(true)
  })
})

describe('modern CDR fountain fills (root.dat + data refs)', () => {
  it('resolves gradients through the 16-byte data references (v1400)', async () => {
    const doc = await parseCdrBytes(buildModernGradientCdr({ ...LINEAR, version: 1400 }))
    const svg = doc.pages[0].svg
    expect(svg).toContain('fill="url(#grad-1)"')
    expect(svg).toContain('<stop offset="0" stop-color="#ff0000"/>')
    expect(svg).toContain('<stop offset="1" stop-color="#0000ff"/>')
    expect(doc.warnings.some((w) => w.includes('approximated as solid'))).toBe(false)
  })

  it('reads v1500 stop layout with the 26-byte pad', async () => {
    const doc = await parseCdrBytes(buildModernGradientCdr({ ...LINEAR, version: 1500 }))
    const svg = doc.pages[0].svg
    expect(svg).toContain('<stop offset="0" stop-color="#ff0000"/>')
    expect(svg).toContain('<stop offset="1" stop-color="#0000ff"/>')
    expect(doc.warnings.some((w) => w.includes('approximated as solid'))).toBe(false)
  })

  it('falls back to the solid approximation when the fill id dangles', async () => {
    const doc = await parseCdrBytes(
      buildModernGradientCdr({ ...LINEAR, version: 1400, registeredFillId: 99 }),
    )
    const svg = doc.pages[0].svg
    expect(svg).not.toContain('<linearGradient')
    expect(svg).toContain('fill="none"')
    expect(doc.warnings.some((w) => w.includes('approximated as solid'))).toBe(true)
  })
})
