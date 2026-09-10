/**
 * Unit tests for global keyboard-shortcut routing. The shortcut module is
 * runtime-dependency-free (type-only imports), so matching logic runs in
 * plain Node — run with `vitest run`.
 */
import { describe, expect, it, vi } from 'vitest'
import { handleGlobalKeydown, resolveToolShortcut } from './shortcuts'

/** Minimal synthetic key event for matcher tests. */
function key(init: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: '',
    code: '',
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    preventDefault: () => undefined,
    ...init,
  } as unknown as KeyboardEvent
}

describe('resolveToolShortcut', () => {
  it('maps plain letter tools', () => {
    expect(resolveToolShortcut(key({ key: 'v' }))).toBe('select')
    expect(resolveToolShortcut(key({ key: 't' }))).toBe('type')
    expect(resolveToolShortcut(key({ key: 'i' }))).toBe('eyedropper')
    expect(resolveToolShortcut(key({ key: 'z' }))).toBe('zoom')
    expect(resolveToolShortcut(key({ key: 'h' }))).toBe('view-hand')
  })

  it('prefers shifted bindings over plain letters', () => {
    expect(resolveToolShortcut(key({ key: 'm', shiftKey: true }))).toBe('shape-builder')
    expect(resolveToolShortcut(key({ key: 'w', shiftKey: true }))).toBe('width')
    expect(resolveToolShortcut(key({ key: 'e', shiftKey: true }))).toBe('eraser')
    expect(resolveToolShortcut(key({ key: 'b', shiftKey: true }))).toBe('blob-brush')
    expect(resolveToolShortcut(key({ key: 'c', shiftKey: true }))).toBe('convert-anchor')
  })

  it('keeps plain letters for the base tools', () => {
    expect(resolveToolShortcut(key({ key: 'b' }))).toBe('brush')
    expect(resolveToolShortcut(key({ key: 'c' }))).toBe('scissors')
  })

  it('returns null for unbound keys', () => {
    expect(resolveToolShortcut(key({ key: 'm' }))).toBeNull()
    expect(resolveToolShortcut(key({ key: 'w' }))).toBeNull()
    expect(resolveToolShortcut(key({ key: 'F1' }))).toBeNull()
  })
})

describe('handleGlobalKeydown', () => {
  it('toggles the grid on Ctrl+Quote without an engine', () => {
    const store = { view: { showGrid: false }, updateView: vi.fn() } as any
    handleGlobalKeydown(
      key({ key: '"', code: 'Quote', ctrlKey: true, target: null }) as KeyboardEvent,
      store,
      null
    )
    expect(store.updateView).toHaveBeenCalledWith({ showGrid: true })
  })

  it('ignores arrow keys without crashing when nothing can move', () => {
    const store = { nudgeStep: 1 } as any
    expect(() =>
      handleGlobalKeydown(key({ key: 'ArrowLeft', target: null }), store, null)
    ).not.toThrow()
  })
})
