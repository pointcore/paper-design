/**
 * Global loading-overlay helpers for long file operations (CDR/SVG/project
 * open and import). JavaScript runs these workloads on the main thread, so
 * without explicit yields the overlay could never paint and the app would
 * look frozen (clicks seem to do nothing).
 */

/** Minimal store surface needed by withBusy (keeps this module dependency-free). */
export interface BusyStore {
  setBusy: (active: boolean, message?: string, progress?: number | null) => void
}

/** Progress reporter handed to file operations: fraction 0..1 plus message. */
export type ProgressReport = (fraction: number, message?: string) => void

/**
 * Yield to the browser event loop so the loading overlay can paint between
 * work chunks. Double rAF waits for a paint frame, but rAF stalls while
 * the tab is hidden — the timeout guarantees progress resumes within one
 * frame budget even then (and covers non-DOM runtimes like unit tests).
 */
export function yieldToUI(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, 32)
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => requestAnimationFrame(finish))
    }
  })
}

/**
 * Run an async file operation under the global busy overlay. The overlay is
 * painted before work starts and always cleared afterwards; errors propagate
 * to the caller (which reports them to the status bar as usual).
 */
export async function withBusy<T>(
  store: BusyStore,
  message: string,
  fn: (report: ProgressReport) => Promise<T>,
): Promise<T> {
  store.setBusy(true, message, null)
  // Let the overlay paint before the first blocking chunk.
  await yieldToUI()
  try {
    return await fn((fraction, msg) => {
      // Cap at 99%: the bar reaches "done" by the overlay disappearing.
      const pct = Number.isFinite(fraction)
        ? Math.min(99, Math.max(0, fraction * 100))
        : NaN
      store.setBusy(true, msg ?? message, pct)
    })
  } finally {
    store.setBusy(false)
  }
}
