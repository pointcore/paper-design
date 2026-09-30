// @vitest-environment node
/**
 * Legacy CDR text tests: the X4 style-table font record carries three
 * size-like slots; "fit text to frame" stretching leaves a stale nominal
 * first slot that is an order of magnitude off the size CorelDRAW displays.
 * The renderer must pick the effective size without touching plain styles.
 */
import { describe, expect, it } from 'vitest'
import { parseCdrBytes } from './cdr-to-svg'
import { buildLegacyTextCdr } from './cdr-legacy-test-fixture'

const TEXT_UNIT = 254000 / 300

async function textFontSize(spec: {
  nominalSize: number
  stretchedSize: number
  thirdSlotSize?: number
}): Promise<{ svg: string; sizePx: number }> {
  const doc = await parseCdrBytes(buildLegacyTextCdr(spec))
  expect(doc.pages.length).toBe(1)
  const svg = doc.pages[0].svg
  const match = /font-size="([\d.]+)px"/.exec(svg)
  expect(match, 'text element with font-size').toBeTruthy()
  return { svg, sizePx: Number(match![1]) }
}

describe('legacy CDR text style sizes', () => {
  it('repairs a frame-stretched nominal size (201.9pt title stored, 16.1pt displayed)', async () => {
    const { svg, sizePx } = await textFontSize({ nominalSize: 712375, stretchedSize: 56809 })
    expect(sizePx).toBeCloseTo(56809 / TEXT_UNIT, 2)
    // The unrepaired nominal slot would render as 841.39px (the factory-file bug).
    expect(svg).not.toContain('841.38')
  })

  it('repairs a shrunken nominal size (0.77pt stored, 9pt displayed)', async () => {
    const { sizePx } = await textFontSize({ nominalSize: 2700, stretchedSize: 31750 })
    expect(sizePx).toBeCloseTo(31750 / TEXT_UNIT, 2)
    expect(sizePx).toBeCloseTo(37.5, 2)
  })

  it('keeps plain styles whose slots agree', async () => {
    const { sizePx } = await textFontSize({ nominalSize: 31750, stretchedSize: 31750 })
    expect(sizePx).toBeCloseTo(37.5, 2)
  })

  it('keeps the nominal slot when the slots only differ moderately', async () => {
    // 10.08pt vs 9.16pt — real production files hold such styles; the repair
    // must not fire on them.
    const { sizePx } = await textFontSize({ nominalSize: 35560, stretchedSize: 32050 })
    expect(sizePx).toBeCloseTo(35560 / TEXT_UNIT, 2)
    expect(sizePx).toBeCloseTo(42, 2)
  })
})
