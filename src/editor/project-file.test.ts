/**
 * Unit tests for project file envelope parsing — run with `vitest run`.
 * This guards the data-loss-sensitive open path without needing Paper.js.
 */
import { describe, expect, it } from 'vitest'
import { MAX_PROJECT_FILE_BYTES, looksLikeProjectFileText, parseProjectFile } from './project-file'

const MAX_VERSION = 2

/** Paper's native project format: an array of ["Class", {...}] tuples. */
function realSnapshot(): unknown[][] {
  return [
    ['Layer', { name: 'grid', visible: false, children: [] }],
    ['Layer', { name: 'Layer 1', children: [] }],
  ]
}

function envelope(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    app: 'vue-vector-editor',
    version: 2,
    pageSize: { width: 1920, height: 1080 },
    snapshot: realSnapshot(),
    artboards: [],
    ...overrides,
  })
}

describe('parseProjectFile', () => {
  it('accepts v2 tuple-array snapshots (the engine native format)', () => {
    const parsed = parseProjectFile(envelope(), MAX_VERSION)
    expect(parsed.version).toBe(2)
    expect(Array.isArray(parsed.snapshot)).toBe(true)
  })

  it('accepts v1 string snapshots', () => {
    const parsed = parseProjectFile(
      envelope({ version: 1, snapshot: JSON.stringify(realSnapshot()) }),
      MAX_VERSION
    )
    expect(typeof parsed.snapshot).toBe('string')
  })

  it('rejects non-JSON input', () => {
    expect(() => parseProjectFile('not json{{{', MAX_VERSION)).toThrow(
      'Invalid project file: not valid JSON'
    )
  })

  it('rejects missing or empty snapshots', () => {
    expect(() => parseProjectFile(envelope({ snapshot: undefined }), MAX_VERSION)).toThrow(
      'Invalid project file: missing snapshot'
    )
    expect(() => parseProjectFile(envelope({ snapshot: '' }), MAX_VERSION)).toThrow(
      'Invalid project file: missing snapshot'
    )
    expect(() => parseProjectFile(envelope({ snapshot: null }), MAX_VERSION)).toThrow(
      'Invalid project file: missing snapshot'
    )
    expect(() => parseProjectFile('{}', MAX_VERSION)).toThrow(
      'Invalid project file: missing snapshot'
    )
  })

  it('rejects snapshots that are not project-shaped', () => {
    // These used to pass validation: Paper imports them without throwing,
    // so the open document was silently replaced by an empty scene.
    expect(() => parseProjectFile(envelope({ snapshot: {} }), MAX_VERSION)).toThrow(
      'Invalid project file: missing snapshot'
    )
    expect(() => parseProjectFile(envelope({ snapshot: { foo: 1 } }), MAX_VERSION)).toThrow(
      'Invalid project file: missing snapshot'
    )
    expect(() => parseProjectFile(envelope({ snapshot: [] }), MAX_VERSION)).toThrow(
      'Invalid project file: missing snapshot'
    )
    expect(() => parseProjectFile(envelope({ snapshot: [[]] }), MAX_VERSION)).toThrow(
      'Invalid project file: missing snapshot'
    )
    expect(() => parseProjectFile(envelope({ snapshot: [['Layer']] }), MAX_VERSION)).toThrow(
      'Invalid project file: missing snapshot'
    )
    expect(() => parseProjectFile(envelope({ snapshot: ['just-a-string'] }), MAX_VERSION)).toThrow(
      'Invalid project file: missing snapshot'
    )
    expect(() => parseProjectFile(envelope({ snapshot: { layers: [] } }), MAX_VERSION)).toThrow(
      'Invalid project file: missing snapshot'
    )
    expect(() => parseProjectFile(envelope({ version: 1, snapshot: '{}' }), MAX_VERSION)).toThrow(
      'Invalid project file: missing snapshot'
    )
  })

  it('rejects future versions', () => {
    expect(() => parseProjectFile(envelope({ version: 99 }), MAX_VERSION)).toThrow(
      'Unsupported project file version'
    )
  })

  it('rejects oversized payloads before parsing', () => {
    const big = `{"snapshot": "${'x'.repeat(MAX_PROJECT_FILE_BYTES)}"}`
    expect(() => parseProjectFile(big, MAX_VERSION)).toThrow(
      'Project file too large (over 150 MB)'
    )
  })
})

describe('looksLikeProjectFileText', () => {
  it('accepts real exportProjectFile() output (tuple snapshot, no layers key)', () => {
    expect(looksLikeProjectFileText(envelope())).toBe(true)
  })

  it('accepts v1 string snapshots (escaped tuple form)', () => {
    expect(
      looksLikeProjectFileText(envelope({ version: 1, snapshot: JSON.stringify(realSnapshot()) }))
    ).toBe(true)
  })

  it('accepts hand-made object envelopes with a layers array', () => {
    expect(looksLikeProjectFileText('{"snapshot":{"layers":[{"name":"User"}]}}')).toBe(true)
  })

  it('rejects junk without a snapshot or project markers', () => {
    expect(looksLikeProjectFileText('')).toBe(false)
    expect(looksLikeProjectFileText('{"a":1}')).toBe(false)
    expect(looksLikeProjectFileText('{"snapshot":1}')).toBe(false)
    expect(looksLikeProjectFileText('hello')).toBe(false)
    expect(looksLikeProjectFileText(42 as unknown as string)).toBe(false)
  })
})
