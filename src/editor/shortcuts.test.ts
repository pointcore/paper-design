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
    expect(resolveToolShortcut(key({ key: 'q' }))).toBe('lasso')
    expect(resolveToolShortcut(key({ key: 'g' }))).toBe('gradient')
    expect(resolveToolShortcut(key({ key: 'y' }))).toBe('wand')
  })

  it('prefers shifted bindings over plain letters', () => {
    expect(resolveToolShortcut(key({ key: 'm', shiftKey: true }))).toBe('shape-builder')
    expect(resolveToolShortcut(key({ key: 'w', shiftKey: true }))).toBe('width')
    expect(resolveToolShortcut(key({ key: 'e', shiftKey: true }))).toBe('eraser')
    expect(resolveToolShortcut(key({ key: 'b', shiftKey: true }))).toBe('blob-brush')
    expect(resolveToolShortcut(key({ key: 'c', shiftKey: true }))).toBe('convert-anchor')
    expect(resolveToolShortcut(key({ key: 'r', shiftKey: true }))).toBe('rotate')
    expect(resolveToolShortcut(key({ key: 's', shiftKey: true }))).toBe('scale')
    expect(resolveToolShortcut(key({ key: 'o', shiftKey: true }))).toBe('mirror')
    expect(resolveToolShortcut(key({ key: 'f', shiftKey: true }))).toBe('free-transform')
  })

  it('keeps plain letters for the base tools', () => {
    expect(resolveToolShortcut(key({ key: 'b' }))).toBe('brush')
    expect(resolveToolShortcut(key({ key: 'c' }))).toBe('scissors')
    expect(resolveToolShortcut(key({ key: 'r' }))).toBe('rect')
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

  it('steps zoom in/out on Ctrl+= and Ctrl+-', () => {
    const engine = { zoomAt: vi.fn() } as any
    handleGlobalKeydown(
      key({ key: '=', code: 'Equal', ctrlKey: true, target: null }) as KeyboardEvent,
      {} as any,
      engine
    )
    expect(engine.zoomAt).toHaveBeenCalledWith(1.2)
    handleGlobalKeydown(
      key({ key: '-', code: 'Minus', ctrlKey: true, target: null }) as KeyboardEvent,
      {} as any,
      engine
    )
    expect(engine.zoomAt).toHaveBeenCalledWith(1 / 1.2)
  })

  it('zooms to the selection on Shift+F2 and reports an empty selection', () => {
    const engine = { zoomToSelection: vi.fn() } as any
    const dirty = { hasSelection: true, setStatusMessage: vi.fn() } as any
    handleGlobalKeydown(
      key({ key: 'F2', code: 'F2', shiftKey: true, target: null }) as KeyboardEvent,
      dirty,
      engine
    )
    expect(engine.zoomToSelection).toHaveBeenCalledTimes(1)
    const empty = { hasSelection: false, setStatusMessage: vi.fn() } as any
    handleGlobalKeydown(
      key({ key: 'F2', code: 'F2', shiftKey: true, target: null }) as KeyboardEvent,
      empty,
      engine
    )
    expect(empty.setStatusMessage).toHaveBeenCalledWith('Nothing selected to zoom to')
    expect(engine.zoomToSelection).toHaveBeenCalledTimes(1)
  })

  it('toggles rulers on Ctrl+R and leaves Ctrl+Shift+R to the browser', () => {
    const store = { view: { rulersVisible: false }, updateView: vi.fn() } as any
    handleGlobalKeydown(
      key({ key: 'r', code: 'KeyR', ctrlKey: true, target: null }) as KeyboardEvent,
      store,
      null
    )
    expect(store.updateView).toHaveBeenCalledWith({ rulersVisible: true })
    store.updateView.mockClear()
    handleGlobalKeydown(
      key({ key: 'R', code: 'KeyR', ctrlKey: true, shiftKey: true, target: null }) as KeyboardEvent,
      store,
      null
    )
    expect(store.updateView).not.toHaveBeenCalled()
  })
})
