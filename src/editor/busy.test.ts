/**
 * Unit tests for the global loading-overlay helpers (busy.ts) and the
 * store busy slot. File open/import wraps long main-thread work with
 * withBusy so the UI shows a spinner/progress instead of freezing.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEditorStore } from './store'
import { withBusy, yieldToUI } from './busy'

function fakeStore() {
  return {
    calls: [] as Array<{ active: boolean; message?: string; progress?: number | null }>,
    setBusy(active: boolean, message?: string, progress?: number | null) {
      this.calls.push({ active, message, progress })
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
