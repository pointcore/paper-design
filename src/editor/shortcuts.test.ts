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

  it('repeats the last transform on Ctrl+Shift+D and keeps Ctrl+D as duplicate', () => {
    const engine = { transformAgain: vi.fn(() => true), duplicateInPlace: vi.fn() } as any
    handleGlobalKeydown(
      key({ key: 'd', code: 'KeyD', ctrlKey: true, shiftKey: true, target: null }) as KeyboardEvent,
      {} as any,
      engine
    )
    expect(engine.transformAgain).toHaveBeenCalledTimes(1)
    expect(engine.duplicateInPlace).not.toHaveBeenCalled()
    const failing = { transformAgain: vi.fn(() => false) } as any
    const store = { setStatusMessage: vi.fn() } as any
    handleGlobalKeydown(
      key({ key: 'd', code: 'KeyD', ctrlKey: true, shiftKey: true, target: null }) as KeyboardEvent,
      store,
      failing
    )
    expect(store.setStatusMessage).toHaveBeenCalledWith('No transform to repeat')
  })

  it('combines on Ctrl+L and breaks apart on Ctrl+K (CDR parity)', () => {
    const engine = { getSelection: vi.fn(() => ['a', 'b']), makeCompoundPath: vi.fn(() => true), releaseCompoundPath: vi.fn(() => true) } as any
    handleGlobalKeydown(
      key({ key: 'l', code: 'KeyL', ctrlKey: true, target: null }) as KeyboardEvent,
      {} as any,
      engine
    )
    expect(engine.makeCompoundPath).toHaveBeenCalledTimes(1)
    handleGlobalKeydown(
      key({ key: 'k', code: 'KeyK', ctrlKey: true, target: null }) as KeyboardEvent,
      {} as any,
      engine
    )
    expect(engine.releaseCompoundPath).toHaveBeenCalledTimes(1)
  })

  it('deselects on Ctrl+Shift+A and reselecs on Ctrl+6 (AI parity)', () => {
    const engine = { clearSelection: vi.fn(), reselect: vi.fn(() => 1) } as any
    handleGlobalKeydown(
      key({ key: 'A', code: 'KeyA', ctrlKey: true, shiftKey: true, target: null }) as KeyboardEvent,
      {} as any,
      engine
    )
    expect(engine.clearSelection).toHaveBeenCalledTimes(1)
    expect(engine.reselect).not.toHaveBeenCalled()
    handleGlobalKeydown(
      key({ key: '6', code: 'Digit6', ctrlKey: true, target: null }) as KeyboardEvent,
      {} as any,
      engine
    )
    expect(engine.reselect).toHaveBeenCalledTimes(1)
  })

  it('opens Save As on Ctrl+Shift+S and downloads on Ctrl+S', () => {
    const store = { setSaveDialogOpen: vi.fn() } as any
    const engine = { downloadProjectFile: vi.fn() } as any
    handleGlobalKeydown(
      key({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true, target: null }) as KeyboardEvent,
      store,
      engine
    )
    expect(store.setSaveDialogOpen).toHaveBeenCalledWith(true)
    expect(engine.downloadProjectFile).not.toHaveBeenCalled()
    const plain = { setSaveDialogOpen: vi.fn() } as any
    handleGlobalKeydown(
      key({ key: 's', code: 'KeyS', ctrlKey: true, target: null }) as KeyboardEvent,
      plain,
      engine
    )
    expect(engine.downloadProjectFile).toHaveBeenCalledTimes(1)
    expect(plain.setSaveDialogOpen).not.toHaveBeenCalled()
  })

  it('toggles the bounding box on Ctrl+Shift+B', () => {
    const select = { dropFrame: vi.fn(), refreshSelectionChrome: vi.fn() } as any
    const engine = { getController: vi.fn(() => select) } as any
    const store = { view: { showBoundingBox: true }, updateView: vi.fn() } as any
    handleGlobalKeydown(
      key({ key: 'B', code: 'KeyB', ctrlKey: true, shiftKey: true, target: null }) as KeyboardEvent,
      store,
      engine
    )
    expect(store.updateView).toHaveBeenCalledWith({ showBoundingBox: false })
    expect(select.dropFrame).toHaveBeenCalledTimes(1)
    expect(select.refreshSelectionChrome).toHaveBeenCalledTimes(1)
  })

  it('fits all artwork on F4 and frames the page on Shift+F4', () => {
    const engine = { fitToContent: vi.fn(), zoomToArtboard: vi.fn() } as any
    handleGlobalKeydown(key({ key: 'F4', code: 'F4', target: null }) as KeyboardEvent, {} as any, engine)
    expect(engine.fitToContent).toHaveBeenCalledTimes(1)
    handleGlobalKeydown(
      key({ key: 'F4', code: 'F4', shiftKey: true, target: null }) as KeyboardEvent,
      {} as any,
      engine
    )
    expect(engine.zoomToArtboard).toHaveBeenCalledTimes(1)
    expect(engine.fitToContent).toHaveBeenCalledTimes(1)
  })

  it('toggles guides on Ctrl+Semicolon', () => {
    const store = { view: { showGuides: false }, updateView: vi.fn() } as any
    handleGlobalKeydown(
      key({ key: ';', code: 'Semicolon', ctrlKey: true, target: null }) as KeyboardEvent,
      store,
      null
    )
    expect(store.updateView).toHaveBeenCalledWith({ showGuides: true })
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
