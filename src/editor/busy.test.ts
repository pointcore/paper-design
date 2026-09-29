/**
 * Unit tests for the global loading-overlay helpers (busy.ts) and the
 * store busy slot. File open/import wraps long main-thread work with
 * withBusy so the UI shows a spinner/progress instead of freezing.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEditorStore } from './store'
import { withBusy, yieldToUI, isCancelled, throwIfCancelled, CancelledError } from './busy'

function fakeStore() {
  return {
    calls: [] as Array<{ active: boolean; message?: string; progress?: number | null }>,
    setBusy(active: boolean, message?: string, progress?: number | null) {
      this.calls.push({ active, message, progress })
    },
  }
}

/** fakeStore plus the cancel affordance withBusy attaches for cancellable work. */
function cancellableStore() {
  return {
    calls: [] as Array<{ active: boolean; message?: string; progress?: number | null }>,
    cancellable: false,
    cancel: null as (() => void) | null,
    setBusy(active: boolean, message?: string, progress?: number | null) {
      this.calls.push({ active, message, progress })
    },
    setBusyCancellable(cancellable: boolean, onCancel: (() => void) | null = null) {
      this.cancellable = cancellable
      this.cancel = onCancel
    },
  }
}

describe('yieldToUI', () => {
  it('resolves without a DOM', async () => {
    await expect(yieldToUI()).resolves.toBeUndefined()
  }, 5000)

  it('resolves via timeout when rAF stalls (background tab)', async () => {
    const realRaf = (globalThis as any).requestAnimationFrame
    // Stall forever, like a hidden tab: the frame callback never runs.
    ;(globalThis as any).requestAnimationFrame = () => 0
    try {
      const t0 = performance.now()
      await yieldToUI()
      const dt = performance.now() - t0
      // The 32ms safety timer fired, not rAF.
      expect(dt).toBeGreaterThanOrEqual(30)
      expect(dt).toBeLessThan(1000)
    } finally {
      if (realRaf === undefined) delete (globalThis as any).requestAnimationFrame
      else (globalThis as any).requestAnimationFrame = realRaf
    }
  }, 5000)

  it('resolves the stalled path on fake timers without wall-clock waiting', async () => {
    vi.useFakeTimers()
    const realRaf = (globalThis as any).requestAnimationFrame
    // rAF never fires no matter how far the clock advances.
    ;(globalThis as any).requestAnimationFrame = () => 0
    try {
      const pending = yieldToUI()
      // Only the 32ms safety timer can settle this promise.
      await vi.advanceTimersByTimeAsync(32)
      await expect(pending).resolves.toBeUndefined()
    } finally {
      if (realRaf === undefined) delete (globalThis as any).requestAnimationFrame
      else (globalThis as any).requestAnimationFrame = realRaf
      vi.useRealTimers()
    }
  })
})

describe('withBusy', () => {
  it('shows the overlay, reports progress and hides it', async () => {
    const store = fakeStore()
    const seen: number[] = []
    const result = await withBusy(store, 'Loading…', async (report) => {
      report(0.5, 'Halfway…')
      seen.push(store.calls[store.calls.length - 1].progress ?? -1)
      return 'done'
    })
    expect(result).toBe('done')
    expect(store.calls[0]).toMatchObject({ active: true, message: 'Loading…' })
    expect(seen).toEqual([50])
    const last = store.calls[store.calls.length - 1]
    expect(last).toMatchObject({ active: false })
  })

  it('hides the overlay when the operation throws', async () => {
    const store = fakeStore()
    await expect(
      withBusy(store, 'Loading…', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    const last = store.calls[store.calls.length - 1]
    expect(last).toMatchObject({ active: false })
  })

  it('clamps out-of-range fractions', async () => {
    const store = fakeStore()
    await withBusy(store, 'Loading…', async (report) => {
      report(7, 'Overflow')
    })
    const mid = store.calls.find((c) => c.message === 'Overflow')
    expect(mid?.progress).toBe(99)
  })
})

describe('cancellation', () => {
  it('recognises cancellations and not ordinary errors', () => {
    expect(isCancelled(new CancelledError())).toBe(true)
    // The parsers cannot import CancelledError, so they raise the DOM name.
    const foreign = new Error('Operation cancelled')
    foreign.name = 'AbortError'
    expect(isCancelled(foreign)).toBe(true)
    expect(isCancelled(new Error('boom'))).toBe(false)
    expect(isCancelled(undefined)).toBe(false)
    expect(isCancelled('nope')).toBe(false)
  })

  it('throws only once the signal has aborted', () => {
    const c = new AbortController()
    expect(() => throwIfCancelled(c.signal)).not.toThrow()
    expect(() => throwIfCancelled(undefined)).not.toThrow()
    c.abort()
    expect(() => throwIfCancelled(c.signal)).toThrow(CancelledError)
  })

  it('rejects a yield that is already aborted', async () => {
    const c = new AbortController()
    c.abort()
    await expect(yieldToUI(c.signal)).rejects.toThrow(CancelledError)
  }, 5000)

  it('rejects a yield aborted while it is pending', async () => {
    const c = new AbortController()
    const pending = yieldToUI(c.signal)
    setTimeout(() => c.abort(), 5)
    await expect(pending).rejects.toThrow(CancelledError)
  }, 5000)

  it('offers a cancel callback only while the operation is cancellable', async () => {
    const store = cancellableStore()
    const seen: Array<{ cancellable: boolean; hasCancel: boolean }> = []

    await withBusy(store, 'Loading…', async () => {
      seen.push({ cancellable: store.cancellable, hasCancel: store.cancel !== null })
    })
    await withBusy(
      store,
      'Loading…',
      async () => {
        seen.push({ cancellable: store.cancellable, hasCancel: store.cancel !== null })
      },
      { cancellable: true },
    )
    // Asserted from inside: by the time withBusy resolves, the affordance is
    // already torn down, and checking only afterwards would prove nothing.
    // Serialized so a mismatch shows the actual booleans rather than
    // truncating both sides into identical-looking objects.
    expect(JSON.stringify(seen)).toBe(
      JSON.stringify([
        { cancellable: false, hasCancel: false },
        { cancellable: true, hasCancel: true },
      ]),
    )
    // Cleared afterwards, or the button would outlive the overlay.
    expect(store.cancellable).toBe(false)
    expect(store.cancel).toBeNull()
  })

  it('aborts the signal the callback aborts, and unwinds the operation', async () => {
    const store = cancellableStore()
    await expect(
      withBusy(
        store,
        'Loading…',
        async (_report, signal) => {
          expect(signal.aborted).toBe(false)
          // Simulate the overlay's button: grab the cancel hook and fire it.
          store.cancel?.()
          expect(signal.aborted).toBe(true)
          await yieldToUI(signal)
          return 'unreachable'
        },
        { cancellable: true },
      ),
    ).rejects.toThrow(CancelledError)
  })

  it('hides the overlay after a cancellation', async () => {
    const store = cancellableStore()
    await expect(
      withBusy(
        store,
        'Loading…',
        async (_r, signal) => {
          store.cancel?.()
          throwIfCancelled(signal)
        },
        { cancellable: true },
      ),
    ).rejects.toThrow(CancelledError)
    expect(store.calls[store.calls.length - 1]).toMatchObject({ active: false })
    expect(store.cancel).toBeNull()
  })

  it('shares one controller across nested operations', async () => {
    const store = cancellableStore()
    const innerShared = { value: false as boolean }
    await withBusy(
      store,
      'Outer…',
      async (_r, outer) => {
        await withBusy(store, 'Inner…', async (_r2, inner) => {
          innerShared.value = inner === outer
        })
        // The inner call must not steal or tear down the outer's Cancel button.
        expect(store.cancellable).toBe(true)
        expect(store.cancel).not.toBeNull()
      },
      { cancellable: true },
    )
    expect(innerShared.value).toBe(true)
    expect(store.cancellable).toBe(false)
  })

  it('does not mark a plain operation cancellable', async () => {
    const store = cancellableStore()
    let sawSignal = false
    await withBusy(store, 'Quick…', async (_r, signal) => {
      sawSignal = signal instanceof AbortSignal
    })
    expect(sawSignal).toBe(true)
    expect(store.cancellable).toBe(false)
  })
})

describe('store busy slot', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts idle and clamps progress', () => {
    const store = useEditorStore()
    expect(store.busy.active).toBe(false)
    store.setBusy(true, 'Working…', 150)
    expect(store.busy).toMatchObject({ active: true, message: 'Working…', progress: 100 })
    store.setBusy(true, 'Working…', -20)
    expect(store.busy.progress).toBe(0)
    store.setBusy(false)
    expect(store.busy.active).toBe(false)
  })

  it('accepts an indeterminate spinner (null progress)', () => {
    const store = useEditorStore()
    store.setBusy(true, 'Working…', null)
    expect(store.busy.progress).toBeNull()
    store.setBusy(false)
    expect(store.busy.active).toBe(false)
  })
})
