// @vitest-environment node
/**
 * Regression test for legacy (X4 riffData) numeric color model 17.
 *
 * Production files link white uniform fills through a model-17 color record
 * (CMYK with 0-255 components: white = [0,0,0,0]). Before the fix the parser
 * fell back to opaque black, so whole garments rendered as black blobs.
 */
import { describe, it, expect } from 'vitest'
import { parseCdrBytes } from './cdr-to-svg'
import { buildMinimalLegacyCdr } from './cdr-legacy-test-fixture'

function colorRecord(model: number, comps: [number, number, number, number]): Uint8Array {
  const b = new Uint8Array(12)
  new DataView(b.buffer).setUint16(0, model, true)
  b.set(comps, 8)
  return b
}

describe('legacy numeric color model 17 (CMYK 0-255)', () => {
  it('keeps a model-17 white uniform fill white', async () => {
    const zip = buildMinimalLegacyCdr({
      fillId: 7,
      outlineId: 9,
      fillColorRecord: colorRecord(17, [0, 0, 0, 0]),
    })
    const doc = await parseCdrBytes(zip)
    expect(doc.pages.length).toBe(1)
    const svg = doc.pages[0].svg
    expect(svg).toContain('rgb(255,255,255)')
    const fills = [...svg.matchAll(/fill="([^"]*)"/g)].map((m) => m[1])
    expect(fills).toContain('rgb(255,255,255)')
    expect(fills).not.toContain('#000000')
    expect(fills).not.toContain('rgb(0,0,0)')
    expect(doc.warnings.some((w) => w.includes('17'))).toBe(false)
  })

  it('reports increasing progress ending at 1', async () => {
    const zip = buildMinimalLegacyCdr({
      fillId: 7,
      outlineId: 9,
      fillColorRecord: colorRecord(17, [0, 0, 0, 0]),
    })
    const seen: number[] = []
    await parseCdrBytes(zip, (f) => seen.push(f))
    expect(seen.length).toBeGreaterThan(0)
    for (let k = 1; k < seen.length; k++) {
      expect(seen[k]).toBeGreaterThanOrEqual(seen[k - 1])
    }
    expect(seen[seen.length - 1]).toBe(1)
  })

  it('decodes a model-17 black uniform fill as black', async () => {
    const zip = buildMinimalLegacyCdr({
      fillId: 7,
      outlineId: 9,
      fillColorRecord: colorRecord(17, [0, 0, 0, 255]),
    })
    const doc = await parseCdrBytes(zip)
    const svg = doc.pages[0].svg
    const fills = [...svg.matchAll(/fill="([^"]*)"/g)].map((m) => m[1])
    expect(fills).toContain('rgb(0,0,0)')
    expect(doc.warnings.some((w) => w.includes('17'))).toBe(false)
  })
})
