/**
 * Runtime error capture (global safety net).
 *
 * The editor is one large synchronous canvas surface: a throw inside a tool
 * controller, a panel watcher or a Paper.js callback used to escape into
 * Vue's default handler, which logged to the console and left the document
 * in whatever half-applied state the interrupted gesture had reached. Nothing
 * was reported to the user, so the failure was invisible unless they had the
 * devtools open.
 *
 * This module is the pure data layer — no Vue, no Paper.js, no store — so it
 * stays unit-testable and out of the heavy import path. `main.ts` installs it
 * before the app mounts; ErrorDialog.vue renders what it records.
 */

import type { App } from 'vue'

/** A recorded failure, normalized so the UI never has to inspect a raw throw. */
export interface ErrorNotice {
  /** `Error` constructor name, or the typeof the thrown value had. */
  name: string
  /** Human-readable message (never empty). */
  message: string
  /** Stack trace when the thrown value carried one, else ''. */
  stack: string
  /** Where it came from: a controller, a menu action, a component, ... */
  context: string
  /** How many times this exact failure was seen. */
  count: number
  /** Epoch ms of the first occurrence. */
  firstSeen: number
  /** Epoch ms of the most recent occurrence. */
  lastSeen: number
}

/** Result of recording: the notice, plus whether it opened a new log slot. */
export interface ErrorRecord {
  notice: ErrorNotice
  /** False when an identical failure was already in the log (dedupe hit). */
  isNew: boolean
}

/** Normalized shape produced by describeError. */
export interface ErrorDescription {
  name: string
  message: string
  stack: string
}

const MAX_MESSAGE = 400

/**
 * Normalize anything that can be thrown into a printable description.
 *
 * `throw undefined`, `throw 'boom'` and rejected promises carrying plain
 * objects all reach the handlers; `String(err)` alone would print
 * `[object Object]` or `undefined` and lose the stack.
 */
export function describeError(err: unknown): ErrorDescription {
  if (err instanceof Error) {
    const name = err.name || 'Error'
    // Some DOM errors carry no message; the name alone still identifies them.
    const message = err.message || name
    return { name, message, stack: typeof err.stack === 'string' ? err.stack : '' }
  }
  if (typeof err === 'string') {
    return { name: 'String', message: err || 'Unknown error', stack: '' }
  }
  if (err === null) {
    return { name: 'Null', message: 'null was thrown', stack: '' }
  }
  if (typeof err === 'object') {
    const rec = err as { name?: unknown; message?: unknown; stack?: unknown; toString?: () => string }
    const name = typeof rec.name === 'string' && rec.name ? rec.name : 'Object'
    const raw = typeof rec.message === 'string' && rec.message ? rec.message : safeToString(err)
    return {
      name,
      message: raw || 'Unknown error',
      stack: typeof rec.stack === 'string' ? rec.stack : '',
    }
  }
  return { name: typeof err, message: String(err) || 'Unknown error', stack: '' }
}

function safeToString(value: object): string {
  try {
    return String(value)
  } catch {
    return 'Unprintable thrown value'
  }
}

/** Identity of a failure: same type, message and origin count as the same one. */
export function errorKey(desc: ErrorDescription, context: string): string {
  return `${desc.name}: ${desc.message} @ ${context}`
}

/** Subscriber notified after every record, whether new or a dedupe hit. */
export type ErrorSubscriber = (record: ErrorRecord) => void

/**
 * Bounded, deduplicating error log.
 *
 * Repeat failures collapse into one entry with a counter, so a handler that
 * throws on every mousemove cannot flood the dialog or the console. The log
 * only ever holds `limit` entries and is memory-only (no localStorage), so
 * it cannot outlive the tab or leak a document's content into storage.
 */
export class ErrorLog {
  private slots: ErrorNotice[] = []
  private listeners: ErrorSubscriber[] = []

  constructor(private readonly limit: number = 12) {}

  /** Record a failure and notify subscribers. Never throws. */
  record(err: unknown, context = '', now: number = Date.now()): ErrorRecord {
    const desc = describeError(err)
    const contextText = context || 'unknown'
    const key = errorKey(desc, contextText)
    // Compare against each entry's OWN context: keying existing slots with the
    // incoming context would make every failure look like a repeat.
    const existing = this.slots.find((n) => errorKey(n, n.context) === key)
    if (existing) {
      existing.count++
      existing.lastSeen = now
      const record: ErrorRecord = { notice: existing, isNew: false }
      this.emit(record)
      return record
    }
    const notice: ErrorNotice = {
      name: desc.name,
      message: desc.message.slice(0, MAX_MESSAGE),
      stack: desc.stack,
      context: contextText,
      count: 1,
      firstSeen: now,
      lastSeen: now,
    }
    // Newest first: the dialog lists the most recent failure on top.
    this.slots.unshift(notice)
    if (this.slots.length > this.limit) this.slots.length = this.limit
    const record: ErrorRecord = { notice, isNew: true }
    this.emit(record)
    return record
  }

  /** Snapshot of the log, newest first. Callers get a copy to keep reactive. */
  entries(): ErrorNotice[] {
    return this.slots.map((n) => ({ ...n }))
  }

  /** The most recent failure, or null when nothing was recorded. */
  latest(): ErrorNotice | null {
    return this.slots.length ? { ...this.slots[0] } : null
  }

  /** True when nothing has been recorded since the last clear(). */
  isEmpty(): boolean {
    return this.slots.length === 0
  }

  clear(): void {
    this.slots = []
  }

  /** Subscribe to records. Returns an unsubscribe function. */
  subscribe(fn: ErrorSubscriber): () => void {
    this.listeners.push(fn)
    return () => {
      const i = this.listeners.indexOf(fn)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  /**
   * Notify subscribers defensively: a subscriber that throws (the recovery
   * hook itself, say) must not prevent the remaining ones from running or
   * turn one caught error into an unhandled one.
   */
  private emit(record: ErrorRecord): void {
    for (const fn of this.listeners.slice()) {
      try {
        fn(record)
      } catch {
        // Recovery path: swallow, the error was already logged.
      }
    }
  }
}

/** Process-wide log the app installs handlers into. */
export const errorLog = new ErrorLog()

function isoAt(ms: number): string {
  try {
    return new Date(ms).toISOString()
  } catch {
    return String(ms)
  }
}

/** Runtime facts worth pasting alongside a stack when filing a report. */
export interface DiagnosticsContext {
  documentName?: string
  tool?: string
  boardCount?: number
  historyLength?: number
  hasUnsavedChanges?: boolean
  zoom?: number
  userAgent?: string
  viewport?: string
  devicePixelRatio?: number
}

function contextLines(ctx: DiagnosticsContext): string[] {
  const lines: string[] = []
  if (ctx.documentName) lines.push(`Document: ${ctx.documentName}`)
  if (ctx.tool) lines.push(`Tool: ${ctx.tool}`)
  if (typeof ctx.boardCount === 'number') lines.push(`Artboards: ${ctx.boardCount}`)
  if (typeof ctx.historyLength === 'number') lines.push(`History entries: ${ctx.historyLength}`)
  if (typeof ctx.hasUnsavedChanges === 'boolean') {
    lines.push(`Unsaved changes: ${ctx.hasUnsavedChanges ? 'yes' : 'no'}`)
  }
  if (typeof ctx.zoom === 'number') lines.push(`Zoom: ${Math.round(ctx.zoom * 100)}%`)
  if (ctx.viewport) lines.push(`Viewport: ${ctx.viewport}`)
  if (typeof ctx.devicePixelRatio === 'number') lines.push(`Device pixel ratio: ${ctx.devicePixelRatio}`)
  if (ctx.userAgent) lines.push(`User agent: ${ctx.userAgent}`)
  return lines
}

/**
 * Render the log as plain text for the clipboard.
 *
 * `navigator.clipboard` is unavailable over plain http, so the dialog keeps
 * a selectable text fallback; formatting here is what both paths use.
 */
export function formatDiagnostics(
  entries: ErrorNotice[],
  ctx: DiagnosticsContext = {},
  now: number = Date.now(),
): string {
  const lines = ['Vector Editor error log', `Generated: ${isoAt(now)}`]
  lines.push(...contextLines(ctx))
  if (entries.length === 0) {
    lines.push('', 'No errors were recorded.')
    return lines.join('\n')
  }
  entries.forEach((n, i) => {
    lines.push('')
    lines.push(`[${i + 1}] ${n.name}: ${n.message}`)
    lines.push(`    context: ${n.context}`)
    lines.push(`    seen: ${n.count}x  first: ${isoAt(n.firstSeen)}  last: ${isoAt(n.lastSeen)}`)
    if (n.stack) {
      lines.push('    stack:')
      for (const frame of n.stack.split('\n').slice(0, 12)) lines.push(`      ${frame.trim()}`)
    }
  })
  return lines.join('\n')
}

/**
 * Attach the three global sinks: Vue's own error handler, `window.onerror`
 * and unhandled promise rejections.
 *
 * Must run before mount — a failure during the first render has no component
 * tree to bubble through, so `app.config.errorHandler` is the only catch-all.
 * Vue's handler intentionally does not rethrow: the failure is already
 * recorded, and letting it escape would add a second, noisier report.
 *
 * Returns a teardown that removes the window listeners.
 */
export function installGlobalErrorHandlers(app: App, log: ErrorLog = errorLog): () => void {
  app.config.errorHandler = (err, _instance, info) => {
    const record = log.record(err, `vue:${info}`)
    console.error('[vue error]', info, record.notice.message, err)
  }

  if (typeof window === 'undefined') return () => {}

  const onError = (event: ErrorEvent) => {
    // Resource load failures (img/script) fire `error` with no Error object;
    // message is then the only thing worth keeping.
    const err = event.error ?? event.message ?? 'Unknown window error'
    const context = `window:${event.filename ? shortFile(event.filename) : 'inline'}`
    const record = log.record(err, context)
    console.error('[window error]', record.notice.message, event.error ?? '')
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    const record = log.record(event.reason, 'promise')
    console.error('[unhandled rejection]', record.notice.message, event.reason)
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}

/** `http://host/a/b/x.js?ts` → `x.js`: full URLs add noise, not information. */
function shortFile(filename: string): string {
  const clean = filename.split('?')[0].split('#')[0]
  const parts = clean.split('/')
  return parts[parts.length - 1] || clean
}
