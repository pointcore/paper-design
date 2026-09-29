// @vitest-environment node
/**
 * Cancellation reaches the CDR parser.
 *
 * The parser is a main-thread loop that hands control back only at its
 * existing UI-yield points, so those points are the only places a cancel can
 * be observed. This asserts the signal actually unwinds a parse rather than
 * being ignored until the file is fully converted.
 */
import { describe, expect, it } from 'vitest'
import { parseCdrBytes } from './cdr-to-svg'
import { buildMinimalLegacyCdr } from './cdr-legacy-test-fixture'
import { isCancelled } from '../busy'

function sampleCdr(): Uint8Array {
  const colorRecord = new Uint8Array(12)
  new DataView(colorRecord.buffer).setUint16(0, 17, true)
  colorRecord.set([0, 0, 0, 0], 8)
  return buildMinimalLegacyCdr({ fillId: 7, outlineId: 9, fillColorRecord: colorRecord })
}

describe('parseCdrBytes cancellation', () => {
  it('rejects with an AbortError when the signal is already aborted', async () => {
    const c = new AbortController()
    c.abort()
    await expect(parseCdrBytes(sampleCdr(), undefined, c.signal)).rejects.toSatisfy(isCancelled)
  }, 10_000)

  it('unwinds a parse aborted while it is running', async () => {
    const c = new AbortController()
    // Abort on the first progress tick, which lands inside the object walk.
    await expect(parseCdrBytes(sampleCdr(), () => c.abort(), c.signal)).rejects.toSatisfy(isCancelled)
  }, 10_000)

  it('stops early instead of running to completion', async () => {
    const c = new AbortController()
    const seen: number[] = []
    await expect(
      parseCdrBytes(
        sampleCdr(),
        (f) => {
          seen.push(f)
          c.abort()
        },
        c.signal,
      ),
    ).rejects.toSatisfy(isCancelled)
    // A parse that ignored the abort would have run its progress to 1.
    expect(seen[seen.length - 1]).toBeLessThan(1)
  }, 10_000)

  it('still parses normally with an un-aborted signal', async () => {
    const c = new AbortController()
    const doc = await parseCdrBytes(sampleCdr(), undefined, c.signal)
    expect(doc.pages.length).toBe(1)
    expect(c.signal.aborted).toBe(false)
  }, 10_000)
})
