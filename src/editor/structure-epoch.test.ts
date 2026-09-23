/**
 * structureEpoch: Layers panel / thumbnail invalidation.
 *
 * Pure translation (Move/Nudge) must not bump the epoch — a moved item's
 * node metadata and rendered thumbnail are unchanged — while undo/redo and
 * every other history name must, or the panel keeps serving pre-edit pixels.
 * Run with `vitest run`.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEditorStore } from './store'
import { TRANSLATION_ONLY_HISTORY } from './engine-history'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('TRANSLATION_ONLY_HISTORY', () => {
  it('treats pure moves as panel-safe', () => {
    expect(TRANSLATION_ONLY_HISTORY.has('Move')).toBe(true)
    expect(TRANSLATION_ONLY_HISTORY.has('Nudge')).toBe(true)
  })

  it('requires a rebuild for structure and pixel edits', () => {
    for (const name of [
      'Delete',
      'Duplicate',
      'Edit Path',
      'Rotate',
      'Scale',
      'Show',
      'Hide',
      'Open CDR',
      'Open Project',
      'Undo',
    ]) {
      expect(TRANSLATION_ONLY_HISTORY.has(name)).toBe(false)
    }
  })
})

describe('structureEpoch', () => {
  it('starts at zero and bumps via the store action', () => {
    const store = useEditorStore()
    expect(store.structureEpoch).toBe(0)
    store.bumpStructureEpoch()
    expect(store.structureEpoch).toBe(1)
    store.bumpStructureEpoch()
    expect(store.structureEpoch).toBe(2)
  })

  it('stays independent of historyIndex (Move still records history)', () => {
    const store = useEditorStore()
    store.setHistory([{ name: 'Move', icon: '', timestamp: 1 }], 0)
    expect(store.historyIndex).toBe(0)
    expect(store.structureEpoch).toBe(0)
    store.bumpStructureEpoch()
    expect(store.historyIndex).toBe(0)
    expect(store.structureEpoch).toBe(1)
  })
})
