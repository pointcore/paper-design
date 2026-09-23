import { describe, expect, it } from 'vitest'
import {
  MAX_VERSIONS,
  cleanVersions,
  createNamedVersion,
  describeVersion,
  diffProjectFiles,
  isValidNamedVersion,
  renameNamedVersion,
  summarizeVersion,
  type NamedVersion,
} from './versions'

function fileText(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    app: 'vue-vector-editor',
    version: 2,
    pageSize: { width: 1920, height: 1080 },
    bleed: 0,
    // Real exportProjectFile() shape: Paper native ["Class", {...}] tuples,
    // no top-level "layers" key (see project-file.ts).
    snapshot: [['Layer', { name: 'Layer 1' }]],
    artboards: [{ id: 'b1', name: 'Artboard 1', x: 0, y: 0, width: 1920, height: 1080 }],
    activeArtboardId: 'b1',
    ...overrides,
  })
}

function version(overrides: Partial<NamedVersion> = {}): NamedVersion {
  return {
    id: 'ver-abc',
    name: 'Milestone',
    savedAt: 1700000000000,
    fileText: fileText(),
    ...overrides,
  }
}

describe('isValidNamedVersion', () => {
  it('accepts a well-formed entry', () => {
    expect(isValidNamedVersion(version())).toBe(true)
  })

  it('accepts the object-shaped snapshot hand-made envelopes still use', () => {
    const v = version({ fileText: '{"snapshot":{"layers":[{"name":"L"}]}}' })
    expect(isValidNamedVersion(v)).toBe(true)
  })

  it('rejects blank names, bad timestamps and non-project payloads', () => {
    expect(isValidNamedVersion(version({ name: '   ' }))).toBe(false)
    expect(isValidNamedVersion(version({ savedAt: 0 }))).toBe(false)
    expect(isValidNamedVersion(version({ fileText: '{}' }))).toBe(false)
    expect(isValidNamedVersion(version({ fileText: '' }))).toBe(false)
    expect(isValidNamedVersion(null as unknown as NamedVersion)).toBe(false)
  })
})

describe('cleanVersions', () => {
  it('drops corrupt entries and trims names', () => {
    const out = cleanVersions([version({ name: '  Spaced  ' }), null, { id: 'bad' }, 'zzz'])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Spaced')
  })

  it('caps the list at MAX_VERSIONS', () => {
    const list = Array.from({ length: MAX_VERSIONS + 5 }, (_, i) =>
      version({ id: `ver-${i}`, name: `V${i}` }),
    )
    expect(cleanVersions(list)).toHaveLength(MAX_VERSIONS)
  })

  it('round-trips through JSON (save/reopen contract)', () => {
    const list = [version(), version({ id: 'ver-2', name: 'Second' })]
    expect(cleanVersions(JSON.parse(JSON.stringify(list)))).toEqual(list)
  })
})

describe('createNamedVersion / renameNamedVersion', () => {
  it('creates entries with trimmed names and stable timestamps', () => {
    const v = createNamedVersion('  Launch  ', fileText(), 1700000000000, 'fixed')
    expect(v.name).toBe('Launch')
    expect(v.savedAt).toBe(1700000000000)
    expect(v.id).toBe('ver-fixed')
    expect(isValidNamedVersion(v)).toBe(true)
  })

  it('falls back to a default name', () => {
    expect(createNamedVersion('   ', fileText()).name).toBe('Version')
  })

  it('renames one entry and ignores unknown ids or blank names', () => {
    const list = [version({ id: 'a', name: 'A' }), version({ id: 'b', name: 'B' })]
    const renamed = renameNamedVersion(list, 'a', '  Alpha  ')
    expect(renamed.find((v) => v.id === 'a')?.name).toBe('Alpha')
    expect(renamed.find((v) => v.id === 'b')?.name).toBe('B')
    expect(renameNamedVersion(list, 'missing', 'X')).toBe(list)
    expect(renameNamedVersion(list, 'a', '   ')).toBe(list)
  })
})

describe('summarizeVersion / describeVersion', () => {
  it('summarizes boards, page and size', () => {
    const s = summarizeVersion(fileText())
    expect(s.readable).toBe(true)
    expect(s.boards).toBe(1)
    expect(s.page).toBe('1920x1080')
    const label = describeVersion(version())
    expect(label).toContain('1 board')
    expect(label).toContain('1920x1080')
  })

  it('marks unparseable payloads unreadable without throwing', () => {
    expect(summarizeVersion('not json').readable).toBe(false)
  })
})

describe('diffProjectFiles', () => {
  it('returns no lines for identical payloads', () => {
    const text = fileText()
    expect(diffProjectFiles(text, text)).toEqual([])
  })

  it('reports board add/remove/rename/resize and artwork changes', () => {
    const before = fileText()
    const after = fileText({
      bleed: 5,
      artboards: [
        { id: 'b1', name: 'Cover', x: 0, y: 0, width: 1000, height: 800 },
        { id: 'b2', name: 'Inside', x: 0, y: 0, width: 500, height: 500 },
      ],
      snapshot: [['Layer', { name: 'Layer 1' }], ['Layer', { name: 'Layer 2' }]],
    })
    const lines = diffProjectFiles(before, after)
    expect(lines.some((l) => l.includes('Bleed'))).toBe(true)
    expect(lines.some((l) => l.includes('+ Board "Inside"'))).toBe(true)
    expect(lines.some((l) => l.includes('renamed'))).toBe(true)
    expect(lines.some((l) => l.includes('resized'))).toBe(true)
    expect(lines.some((l) => l.includes('artwork'))).toBe(true)
  })

  it('reports removed boards and page changes', () => {
    const before = fileText({
      pageSize: { width: 1920, height: 1080 },
      artboards: [
        { id: 'b1', name: 'A', x: 0, y: 0, width: 10, height: 10 },
        { id: 'gone', name: 'Gone', x: 0, y: 0, width: 10, height: 10 },
      ],
    })
    const after = fileText({
      pageSize: { width: 800, height: 600 },
      artboards: [{ id: 'b1', name: 'A', x: 0, y: 0, width: 10, height: 10 }],
    })
    const lines = diffProjectFiles(before, after)
    expect(lines.some((l) => l.includes('Page:'))).toBe(true)
    expect(lines.some((l) => l.includes('- Board "Gone"'))).toBe(true)
  })

  it('explains unreadable payloads and caps long diffs', () => {
    expect(diffProjectFiles('oops', fileText())).toEqual(['Unreadable version data'])
    const before = fileText({ artboards: [] })
    const many = Array.from({ length: 40 }, (_, i) => ({
      id: `n${i}`,
      name: `Board ${i}`,
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }))
    const lines = diffProjectFiles(before, fileText({ artboards: many }), 5)
    expect(lines).toHaveLength(6)
    expect(lines[5]).toContain('more change')
  })
})
