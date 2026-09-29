/**
 * Global loading-overlay helpers for long file operations (CDR/SVG/project
 * open and import). JavaScript runs these workloads on the main thread, so
 * without explicit yields the overlay could never paint and the app would
 * look frozen (clicks seem to do nothing).
 */

/** Minimal store surface needed by withBusy (keeps this module dependency-free). */
export interface BusyStore {
  setBusy: (active: boolean, message?: string, progress?: number | null) => void
  setBusyCancellable?: (cancellable: boolean, onCancel?: (() => void) | null) => void
}

/** Progress reporter handed to file operations: fraction 0..1 plus message. */
export type ProgressReport = (fraction: number, message?: string) => void

/**
 * Thrown when the user cancels a long operation.
 *
 * Carries the DOM's conventional `AbortError` name so the dependency-free
 * parsers (cdr/ai, which cannot import from here) can signal cancellation the
 * same way without sharing this module.
 */
export class CancelledError extends Error {
  constructor(message = 'Cancelled') {
    super(message)
    this.name = 'AbortError'
  }
}

/** True for our cancellation error and for a native one. */
export function isCancelled(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: string }).name === 'AbortError'
}

/**
 * Throw if the operation was cancelled.
 *
 * Callers put this at the same places they already yield to the UI, so
 * cancellation costs nothing extra: the yield loop is already the only place
 * long runs hand control back.
 */
export function throwIfCancelled(signal?: AbortSignal | null): void {
  if (signal?.aborted) throw new CancelledError()
}

/** The controller for the operation currently showing the overlay. */
let activeController: AbortController | null = null

/**
 * Abort the running operation, if it is cancellable.
 *
 * The overlay calls this from its Cancel button. Returns false when nothing
 * cancellable is running, so callers can avoid showing a dead control.
 */
export function cancelActiveOperation(): boolean {
  if (!activeController) return false
  activeController.abort()
  return true
}

/** Whether a cancellable operation is running right now. */
export function isOperationActive(): boolean {
  return activeController !== null
}

/**
 * Yield to the browser event loop so the loading overlay can paint between
 * work chunks. Double rAF waits for a paint frame, but rAF stalls while
 * the tab is hidden — the timeout guarantees progress resumes within one
 * frame budget even then (and covers non-DOM runtimes like unit tests).
 *
 * Rejects with a CancelledError when `signal` aborts, so a cancelled parse
 * unwinds at its next yield rather than at the end of the file.
 */
export function yieldToUI(signal?: AbortSignal | null): Promise<void> {
  if (signal?.aborted) return Promise.reject(new CancelledError())
  return new Promise((resolve, reject) => {
    let settled = false
    // An `abort` listener reacts immediately. A polling watchdog was tried
    // first and raced the frame callback: the yield resolved via rAF before
    // the poll ever ran, so a cancellation that arrived mid-yield was lost.
    const detach = () => {
      if (!signal) return
      signal.removeEventListener('abort', abort)
    }
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      detach()
      resolve()
    }
    const abort = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      detach()
      reject(new CancelledError())
    }
    const timer = setTimeout(finish, 32)
    if (signal) signal.addEventListener('abort', abort, { once: true })
    const resolveFrame =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(() => requestAnimationFrame(finish))
        : undefined
  })
}

/** Options for withBusy. */
export interface BusyOptions {
  /**
   * Whether the Cancel button should appear. Only pass true for work that
   * actually polls the signal — offering a control that cannot take effect
   * until the operation finishes is worse than offering none.
   */
  cancellable?: boolean
}

/**
 * Run an async file operation under the global busy overlay. The overlay is
 * painted before work starts and always cleared afterwards; errors propagate
 * to the caller (which reports them to the status bar as usual).
 *
 * Cancellable operations receive an `AbortSignal` and are aborted by the
 * overlay's Cancel button; they exit by throwing a CancelledError.
 */
export async function withBusy<T>(
  store: BusyStore,
  message: string,
  fn: (report: ProgressReport, signal: AbortSignal) => Promise<T> | T,
  options: BusyOptions = {},
): Promise<T> {
  // Nested calls (a dialog opens a second operation) inherit the outer
  // controller's lifetime so one Cancel button still governs everything.
  const controller = activeController ?? new AbortController()
  const owned = activeController === null
  if (owned) activeController = controller

  store.setBusy(true, message, null)
  // Only the owner touches the cancel affordance: a nested call that finished
  // its own work must not remove the outer operation's Cancel button.
  // The callback is passed only when the operation is cancellable, so
  // `cancellable === false` never leaves a live handler behind.
  if (owned) {
    const cancellable = options.cancellable === true
    store.setBusyCancellable?.(cancellable, cancellable ? () => controller.abort() : null)
  }
  // Let the overlay paint before the first blocking chunk.
  await yieldToUI(controller.signal)
  try {
    return await fn((fraction, msg) => {
      // Cap at 99%: the bar reaches "done" by the overlay disappearing.
      const pct = Number.isFinite(fraction)
        ? Math.min(99, Math.max(0, fraction * 100))
        : NaN
      store.setBusy(true, msg ?? message, pct)
    }, controller.signal)
  } finally {
    if (owned) {
      activeController = null
      store.setBusyCancellable?.(false, null)
    }
    store.setBusy(false)
  }
}
