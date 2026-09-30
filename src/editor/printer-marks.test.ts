/**
 * Printer marks: the geometry a press needs around the trim box.
 *
 * The marks are the part of a print PDF nobody sees on screen and everybody
 * at the printer does, so the assertions are about placement (outside the
 * trim, inside the page) and count (four of each target) rather than exact
 * coordinates — a coordinate that drifts is fine, a mark on the artwork is not.
 */
import { describe, expect, it } from 'vitest'
import { buildPrinterMarks } from './printer-marks'

const TRIM = { x: 0, y: 0, width: 200, height: 100 }
const BLEED = 6

/** Is the point inside the trim box? */
const insideTrim = (x: number, y: number) =>
  x >= TRIM.x && x <= TRIM.x + TRIM.width && y >= TRIM.y && y <= TRIM.y + TRIM.height

describe('buildPrinterMarks', () => {
  it('draws nothing on the artwork', () => {
    const marks = buildPrinterMarks({ trim: TRIM, bleed: BLEED, slug: 'job.pdf' })
    for (const line of marks.lines) {
      const onTrim =
        insideTrim(line.x1, line.y1) && insideTrim(line.x2, line.y2)
      expect(onTrim).toBe(false)
    }
    for (const patch of marks.patches) {
      expect(insideTrim(patch.x, patch.y)).toBe(false)
    }
    for (const text of marks.texts) {
      expect(insideTrim(text.x, text.y)).toBe(false)
    }
  })

  it('puts every mark inside the bleed box', () => {
    const marks = buildPrinterMarks({ trim: TRIM, bleed: BLEED, slug: 'job.pdf' })
    const x0 = TRIM.x - BLEED
    const x1 = TRIM.x + TRIM.width + BLEED
    const y0 = TRIM.y - BLEED
    const y1 = TRIM.y + TRIM.height + BLEED
    const within = (v: number, lo: number, hi: number) => v >= lo - 1e-6 && v <= hi + 1e-6
    for (const line of marks.lines) {
      expect(within(line.x1, x0, x1) && within(line.y1, y0, y1)).toBe(true)
      expect(within(line.x2, x0, x1) && within(line.y2, y0, y1)).toBe(true)
    }
    for (const patch of marks.patches) {
      expect(within(patch.x, x0, x1) && within(patch.y, y0, y1)).toBe(true)
    }
  })

  it('draws four registration targets, one per edge midpoint', () => {
    const marks = buildPrinterMarks({ trim: TRIM, bleed: BLEED })
    expect(marks.registration).toHaveLength(4)
    const midX = TRIM.width / 2
    const midY = TRIM.height / 2
    const spots = marks.registration.map((r) => `${r.x.toFixed(2)},${r.y.toFixed(2)}`).sort()
    expect(spots).toEqual(
      [
        `${midX.toFixed(2)},${(TRIM.y - BLEED * 0.5).toFixed(2)}`,
        `${midX.toFixed(2)},${(TRIM.y + TRIM.height + BLEED * 0.5).toFixed(2)}`,
        `${(TRIM.x - BLEED * 0.5).toFixed(2)},${midY.toFixed(2)}`,
        `${(TRIM.x + TRIM.width + BLEED * 0.5).toFixed(2)},${midY.toFixed(2)}`,
      ].sort(),
    )
  })

  it('gives each registration target a ring and a cross', () => {
    const marks = buildPrinterMarks({ trim: TRIM, bleed: BLEED })
    const target = marks.registration[0]
    // The two arms are the only strokes centred on the target: each spans the
    // ring in one direction. A ring-only target cannot show a rotation, a
    // cross-only one cannot show scale, so both are drawn.
    const throughCenter = marks.lines.filter(
      (l) =>
        Math.abs((l.x1 + l.x2) / 2 - target.x) < 1e-6 &&
        Math.abs((l.y1 + l.y2) / 2 - target.y) < 1e-6,
    )
    expect(throughCenter).toHaveLength(2)
    // Four targets, 12 chords each, plus the crop marks.
    expect(marks.lines.length).toBeGreaterThanOrEqual(8 + (2 + 12) * 4)
  })

  it('starts the color bar with the CMYK solids', () => {
    const marks = buildPrinterMarks({ trim: TRIM, bleed: BLEED })
    const fills = marks.patches.map((p) => p.fill)
    expect(fills.slice(0, 4)).toEqual(['#000000', '#00aeef', '#ec008c', '#fff200'])
    // 4 solids + 4 inks x 4 tints.
    expect(marks.patches).toHaveLength(8 + 16)
  })

  it('adds one chip per spot ink, in the order given', () => {
    const plain = buildPrinterMarks({ trim: TRIM, bleed: BLEED })
    const withSpots = buildPrinterMarks({
      trim: TRIM,
      bleed: BLEED,
      spotNames: ['PMS 185 C', 'PMS 032 C'],
    })
    expect(withSpots.patches).toHaveLength(plain.patches.length + 2)
    // The chips are appended, so the CMYK solids keep their positions.
    expect(withSpots.patches.slice(0, 4).map((p) => p.fill)).toEqual(
      plain.patches.slice(0, 4).map((p) => p.fill),
    )
  })

  it('puts the slug on the bottom edge and skips it when unnamed', () => {
    const named = buildPrinterMarks({ trim: TRIM, bleed: BLEED, slug: 'export-print.pdf' })
    expect(named.texts).toHaveLength(1)
    expect(named.texts[0].text).toBe('export-print.pdf')
    expect(named.texts[0].y).toBeGreaterThan(TRIM.y + TRIM.height)
    expect(buildPrinterMarks({ trim: TRIM, bleed: BLEED }).texts).toHaveLength(0)
  })

  it('caps an absurd slug instead of writing it across the sheet', () => {
    const marks = buildPrinterMarks({ trim: TRIM, bleed: BLEED, slug: 'x'.repeat(400) })
    expect(marks.texts[0].text.length).toBe(80)
  })

  it('keeps the marks printable at a hairline bleed', () => {
    // A 1pt bleed is unusual but legal; the marks have to shrink rather than
    // land on the artwork.
    const marks = buildPrinterMarks({ trim: TRIM, bleed: 1 })
    for (const line of marks.lines) {
      expect(insideTrim(line.x1, line.y1) && insideTrim(line.x2, line.y2)).toBe(false)
    }
    for (const patch of marks.patches) {
      expect(patch.size).toBeLessThanOrEqual(1)
    }
  })
})
