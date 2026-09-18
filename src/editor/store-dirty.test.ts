/**
 * Regression tests for the document dirty flag.
 *
 * The flag used to compare (historyIndex, history.length), which froze once
 * the 100-entry stack filled up and reported long sessions as clean forever.
 * It now compares a monotonic revision counter, and clearing history must
 * not mark an edited document as saved. Run with `vitest run`.
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEditorStore } from './store'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('hasUnsavedChanges', () => {
  it('is clean after save, dirty after an edit', () => {
    const store = useEditorStore()
    store.markRevisionSaved()
    expect(store.hasUnsavedChanges).toBe(false)
    store.bumpRevision()
    expect(store.hasUnsavedChanges).toBe(true)
  })

  it('stays dirty past the 100-entry history cap', () => {
    const store = useEditorStore()
    store.markRevisionSaved()
    // Simulate a long session: save, then edit 120 times (over the cap).
    // An (index, length) comparison would freeze and report clean here.
    for (let i = 0; i < 120; i++) {
      store.bumpRevision()
    }
    expect(store.hasUnsavedChanges).toBe(true)
    store.markRevisionSaved()
    expect(store.hasUnsavedChanges).toBe(false)
    store.bumpRevision()
    expect(store.hasUnsavedChanges).toBe(true)
  })

  it('undo/redo style bumps keep the flag honest', () => {
    const store = useEditorStore()
    store.markRevisionSaved()
    store.bumpRevision() // edit
    store.bumpRevision() // undo still changes the revision
    expect(store.hasUnsavedChanges).toBe(true)
  })
})
