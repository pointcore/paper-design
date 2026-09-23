import { describe, expect, it } from 'vitest'
import { validateRecoveryPayload } from './recovery'

function validPayload() {
  return {
    savedAt: Date.now(),
    // Real exportProjectFile() shape: Paper native ["Class", {...}] tuples,
    // no top-level "layers" key (see project-file.ts).
    fileText: '{"app":"vue-vector-editor","version":2,"snapshot":[["Layer",{"name":"User"}]]}',
  }
}

describe('validateRecoveryPayload', () => {
  it('accepts a well-formed payload', () => {
    const p = validPayload()
    expect(validateRecoveryPayload(p)).toEqual(p)
  })

  it('accepts the object-shaped snapshot hand-made envelopes still use', () => {
    const p = {
      savedAt: Date.now(),
      fileText: '{"snapshot":{"layers":[{"name":"User"}]}}',
    }
    expect(validateRecoveryPayload(p)).toEqual(p)
  })

  it('rejects non-object values', () => {
    expect(validateRecoveryPayload(null)).toBeNull()
    expect(validateRecoveryPayload(undefined)).toBeNull()
    expect(validateRecoveryPayload('nope')).toBeNull()
    expect(validateRecoveryPayload(42)).toBeNull()
  })

  it('rejects bad timestamps', () => {
    const p = validPayload()
    expect(validateRecoveryPayload({ ...p, savedAt: 'now' })).toBeNull()
    expect(validateRecoveryPayload({ ...p, savedAt: NaN })).toBeNull()
    expect(validateRecoveryPayload({ ...p, savedAt: 0 })).toBeNull()
    expect(validateRecoveryPayload({ ...p, savedAt: -5 })).toBeNull()
  })

  it('rejects bad file text', () => {
    const p = validPayload()
    expect(validateRecoveryPayload({ ...p, fileText: '' })).toBeNull()
    expect(validateRecoveryPayload({ ...p, fileText: 123 })).toBeNull()
    expect(validateRecoveryPayload({ ...p, fileText: '{"a":1}' })).toBeNull()
  })

  it('rejects oversized payloads', () => {
    const p = validPayload()
    const huge = 'x'.repeat(150 * 1024 * 1024 + 1)
    expect(validateRecoveryPayload({ ...p, fileText: huge })).toBeNull()
  })
})
