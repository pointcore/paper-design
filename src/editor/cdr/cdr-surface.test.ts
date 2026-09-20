/**
 * Module-surface lock for the CDR parser (residual D1).
 *
 * The 2026-09-19 review found ~90 lines of ported-but-never-called helpers
 * (`CDR.zip` write-back, `CDR.scaleText`) hanging off the internal facade.
 * They have since been removed; the facade returns only
 * `{ unzip, parse, esc, fontSegments }` and the module exports only read
 * helpers plus `parseCdrBytes`. This test fails if dead write-back APIs
 * creep back onto the public surface.
 */
import { describe, expect, it } from 'vitest'
import * as Cdr from './cdr-to-svg'

describe('cdr module surface (no dead write-back APIs)', () => {
  it('exposes no zip write-back helper', () => {
    expect('zip' in Cdr).toBe(false)
    for (const key of Object.keys(Cdr)) {
      expect(key.toLowerCase()).not.toContain('writezip')
    }
  })

  it('exposes no font-scale helper', () => {
    expect('scaleText' in Cdr).toBe(false)
    for (const key of Object.keys(Cdr)) {
      expect(key.toLowerCase()).not.toContain('scaletext')
    }
  })

  it('keeps the read path intact', () => {
    for (const key of ['parseCdrBytes', 'isLikelyCdrBytes', 'cdrMmToPx']) {
      expect(typeof (Cdr as Record<string, unknown>)[key]).toBe('function')
    }
  })
})
