import { describe, expect, it, vi } from 'vitest'
import {
  ErrorLog,
  describeError,
  errorKey,
  formatDiagnostics,
  installGlobalErrorHandlers,
} from './error-reporting'

describe('describeError', () => {
  it('keeps the name, message and stack of a real Error', () => {
    const err = new TypeError('bad bounds')
    const desc = describeError(err)
    expect(desc.name).toBe('TypeError')
    expect(desc.message).toBe('bad bounds')
    expect(desc.stack).toBe(err.stack)
  })

  it('falls back to the name when the error has no message', () => {
    const err = new Error('')
    err.name = 'QuotaExceededError'
    expect(describeError(err).message).toBe('QuotaExceededError')
  })

  it('normalizes non-Error throws', () => {
    expect(describeError('boom').message).toBe('boom')
    expect(describeError(undefined).message).toBe('undefined')
    expect(describeError(null).message).toBe('null was thrown')
    expect(describeError(42).name).toBe('number')
  })

  it('reads name/message/stack off a plain rejected object', () => {
    const desc = describeError({ name: 'AbortError', message: 'cancelled', stack: 'x' })
    expect(desc).toEqual({ name: 'AbortError', message: 'cancelled', stack: 'x' })
  })

  it('does not throw on values that cannot be stringified', () => {
    const hostile = {
      name: 'Weird',
      message: '',
      toString() {
        throw new Error('nope')
      },
    }
    expect(describeError(hostile).message).toBe('Unprintable thrown value')
  })
})

describe('ErrorLog.record', () => {
  it('returns a normalized notice and marks the first occurrence as new', () => {
    const log = new ErrorLog()
    const { notice, isNew } = log.record(new Error('boom'), 'select.onMouseMove', 1000)
    expect(isNew).toBe(true)
    expect(notice.context).toBe('select.onMouseMove')
    expect(notice.count).toBe(1)
    expect(notice.firstSeen).toBe(1000)
    expect(notice.lastSeen).toBe(1000)
  })

  it('collapses repeats into one entry with a counter', () => {
    const log = new ErrorLog()
    log.record(new Error('boom'), 'ctx', 1000)
    const second = log.record(new Error('boom'), 'ctx', 2000)
    expect(second.isNew).toBe(false)
    expect(second.notice.count).toBe(2)
    expect(second.notice.firstSeen).toBe(1000)
    expect(second.notice.lastSeen).toBe(2000)
    expect(log.entries()).toHaveLength(1)
  })

  it('treats a different context as a different failure', () => {
    const log = new ErrorLog()
    log.record(new Error('boom'), 'a', 1000)
    const other = log.record(new Error('boom'), 'b', 1000)
    expect(other.isNew).toBe(true)
    expect(log.entries()).toHaveLength(2)
  })

  it('orders entries newest first and enforces the limit', () => {
    const log = new ErrorLog(3)
    log.record(new Error('one'), 'c', 1)
    log.record(new Error('two'), 'c', 2)
    log.record(new Error('three'), 'c', 3)
    log.record(new Error('four'), 'c', 4)
    const entries = log.entries()
    expect(entries.map((e) => e.message)).toEqual(['four', 'three', 'two'])
  })

  it('orders by recording order, not by the supplied timestamps', () => {
    const log = new ErrorLog()
    log.record(new Error('earlier'), 'c', 5000)
    log.record(new Error('later'), 'c', 1000)
    expect(log.entries().map((e) => e.message)).toEqual(['later', 'earlier'])
  })

  it('defaults a missing context instead of grouping everything together', () => {
    const log = new ErrorLog()
    expect(log.record(new Error('boom')).notice.context).toBe('unknown')
  })

  it('truncates an oversized message', () => {
    const log = new ErrorLog()
    const notice = log.record(new Error('x'.repeat(5000)), 'c').notice
    expect(notice.message.length).toBe(400)
  })

  it('hands out copies so callers cannot mutate the log', () => {
    const log = new ErrorLog()
    log.record(new Error('boom'), 'c')
    log.entries()[0].message = 'tampered'
    expect(log.latest()?.message).toBe('boom')
  })

  it('clears back to empty', () => {
    const log = new ErrorLog()
    expect(log.isEmpty()).toBe(true)
    log.record(new Error('boom'), 'c')
    expect(log.isEmpty()).toBe(false)
    log.clear()
    expect(log.isEmpty()).toBe(true)
    expect(log.latest()).toBeNull()
  })
})

describe('ErrorLog.subscribe', () => {
  it('notifies on new entries and on dedupe hits', () => {
    const log = new ErrorLog()
    const seen: Array<{ isNew: boolean; count: number }> = []
    log.subscribe((r) => seen.push({ isNew: r.isNew, count: r.notice.count }))
    log.record(new Error('boom'), 'c')
    log.record(new Error('boom'), 'c')
    expect(seen).toEqual([{ isNew: true, count: 1 }, { isNew: false, count: 2 }])
  })

  it('unsubscribes', () => {
    const log = new ErrorLog()
    const fn = vi.fn()
    const stop = log.subscribe(fn)
    stop()
    log.record(new Error('boom'), 'c')
    expect(fn).not.toHaveBeenCalled()
  })

  it('keeps notifying the other subscribers when one throws', () => {
    const log = new ErrorLog()
    const bad = vi.fn(() => {
      throw new Error('recovery failed')
    })
    const good = vi.fn()
    log.subscribe(bad)
    log.subscribe(good)
    expect(() => log.record(new Error('boom'), 'c')).not.toThrow()
    expect(bad).toHaveBeenCalledTimes(1)
    expect(good).toHaveBeenCalledTimes(1)
  })
})

describe('errorKey', () => {
  it('separates failures by message and context', () => {
    const a = describeError(new Error('boom'))
    const b = describeError(new Error('other'))
    expect(errorKey(a, 'x')).toBe(errorKey(describeError(new Error('boom')), 'x'))
    expect(errorKey(a, 'x')).not.toBe(errorKey(b, 'x'))
    expect(errorKey(a, 'x')).not.toBe(errorKey(a, 'y'))
  })
})

describe('formatDiagnostics', () => {
  it('includes runtime facts and the newest failure first', () => {
    const log = new ErrorLog()
    log.record(new Error('older'), 'other', 500)
    log.record(new TypeError('bad bounds'), 'select.onMouseMove', 1000)
    const text = formatDiagnostics(log.entries(), {
      documentName: 'poster.pve',
      tool: 'select',
      boardCount: 2,
      hasUnsavedChanges: true,
      zoom: 1.5,
      viewport: '1440x900',
      devicePixelRatio: 2,
    }, 2000)
    expect(text).toContain('Document: poster.pve')
    expect(text).toContain('Tool: select')
    expect(text).toContain('Artboards: 2')
    expect(text).toContain('Unsaved changes: yes')
    expect(text).toContain('Zoom: 150%')
    expect(text).toContain('Device pixel ratio: 2')
    expect(text.indexOf('bad bounds')).toBeLessThan(text.indexOf('older'))
    expect(text).toContain('seen: 1x')
  })

  it('says so when nothing was recorded', () => {
    expect(formatDiagnostics([])).toContain('No errors were recorded.')
  })
})

describe('installGlobalErrorHandlers', () => {
  it('routes Vue component errors into the log', () => {
    const log = new ErrorLog()
    const app = { config: { errorHandler: undefined as unknown } } as never
    const err = new Error('render blew up')
    installGlobalErrorHandlers(app as never, log)
    const handler = (app as unknown as { config: { errorHandler: Function } }).config.errorHandler
    handler(err, null, 'render function')
    expect(log.latest()?.message).toBe('render blew up')
    expect(log.latest()?.context).toBe('vue:render function')
  })

  it('routes unhandled rejections into the log', () => {
    const log = new ErrorLog()
    installGlobalErrorHandlers({ config: {} } as never, log)
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: new Error('import failed'),
      }),
    )
    expect(log.latest()?.message).toBe('import failed')
    expect(log.latest()?.context).toBe('promise')
  })

  it('records resource-load errors that carry no Error object', () => {
    const log = new ErrorLog()
    installGlobalErrorHandlers({ config: {} } as never, log)
    window.dispatchEvent(
      new ErrorEvent('error', { message: 'Failed to load resource', filename: 'http://h/a/x.js?ts=1' }),
    )
    expect(log.latest()?.message).toBe('Failed to load resource')
    expect(log.latest()?.context).toBe('window:x.js')
  })

  it('removes its window listeners on teardown', () => {
    const log = new ErrorLog()
    const dispose = installGlobalErrorHandlers({ config: {} } as never, log)
    dispose()
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', { promise: Promise.resolve(), reason: new Error('late') }),
    )
    expect(log.isEmpty()).toBe(true)
  })
})
