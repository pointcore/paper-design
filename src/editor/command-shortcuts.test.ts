import { describe, expect, it } from 'vitest'
import { COMMAND_SHORTCUTS } from './shortcuts'

describe('COMMAND_SHORTCUTS', () => {
  it('has unique labels', () => {
    const labels = COMMAND_SHORTCUTS.map((c) => c.label)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('has a non-empty description on every entry', () => {
    for (const c of COMMAND_SHORTCUTS) {
      expect(c.desc.trim().length).toBeGreaterThan(0)
      expect(c.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('stays a meaningful list', () => {
    expect(COMMAND_SHORTCUTS.length).toBeGreaterThanOrEqual(20)
  })
})
