/**
 * EditorEngine.recoverFromError — the post-failure unwind path.
 *
 * A throw inside a mouse handler skips the rest of that handler, so the
 * mouse-up which would normally commit the gesture never runs: drag flags
 * stay set, pointer capture is held, and transient chrome (rubber bands,
 * stroke previews) survives. Nothing in the app swept that state, so a single
 * thrown error left the canvas unusable until the user reloaded the page.
 *
 * These run against a real EditorEngine over a real Paper.js scope (jsdom
 * has no 2D backend; src/test-setup.ts serves a no-op context, and this path
 * never rasterizes) so the assertions cover the actual method rather than a
 * reimplementation of it.
 */
import { describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { EditorEngine } from './engine'
import { useEditorStore } from './store'

function makeEngine() {
  setActivePinia(createPinia())
  const canvas = document.createElement('canvas')
  document.body.appendChild(canvas)
  const store = useEditorStore()
  const engine = new EditorEngine(canvas, store)
  return { engine, store }
}

/** Transient preview item on the overlay layer — what a live gesture stages. */
function stagePreview(engine: EditorEngine): number {
  const item = new engine.scope.Path.Rectangle({
    rectangle: [0, 0, 20, 20],
    fillColor: '#f00',
  })
  ;(item.data as Record<string, unknown>).isPreview = true
  return engine.getOverlayLayer().addChild(item).parent.children.length
}

describe('EditorEngine.recoverFromError', () => {
  it('sweeps transient chrome left by an interrupted gesture', () => {
    const { engine } = makeEngine()
    expect(stagePreview(engine)).toBeGreaterThan(0)

    engine.recoverFromError()

    expect(engine.getOverlayLayer().children).toHaveLength(0)
    engine.destroy()
  })

  it('unwinds the active controller so its drag state is cleared', () => {
    const { engine, store } = makeEngine()
    const deactivate = vi.fn()
    engine.registerController('select', { deactivate })
    engine.setTool('select')
    store.setDragging(true)

    engine.recoverFromError()

    expect(deactivate).toHaveBeenCalledTimes(1)
    expect(store.isDragging).toBe(false)
    engine.destroy()
  })

  it('restores paper.js native decoration on the selection', () => {
    const { engine } = makeEngine()
    const release = vi.fn()
    engine.registerController('select', { deactivate: () => {}, releaseNativeSuppressions: release })
    engine.setTool('select')

    engine.recoverFromError()

    expect(release).toHaveBeenCalledTimes(1)
    engine.destroy()
  })

  it('completes every step even when one throws, and never rethrows', () => {
    const { engine, store } = makeEngine()
    const release = vi.fn()
    engine.registerController('select', {
      deactivate: () => {
        throw new Error('deactivate failed')
      },
      releaseNativeSuppressions: release,
    })
    engine.setTool('select')
    store.setDragging(true)

    expect(() => engine.recoverFromError()).not.toThrow()

    // Recovery must not stop at the first failure: the later steps are what
    // actually free the canvas, and masking the original error would hide it.
    expect(release).toHaveBeenCalledTimes(1)
    expect(store.isDragging).toBe(false)
    engine.destroy()
  })

  it('tolerates a controller with no deactivate hook', () => {
    const { engine } = makeEngine()
    engine.registerController('select', {})
    engine.setTool('select')
    expect(() => engine.recoverFromError()).not.toThrow()
    engine.destroy()
  })
})
