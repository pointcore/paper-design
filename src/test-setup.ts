/**
 * Vitest global setup: headless canvas 2D context.
 *
 * jsdom has no canvas backend, so `canvas.getContext('2d')` returns null
 * and importing Paper.js throws at module load (its BlendMode probe and
 * Project constructor demand a context). The geometry under test never
 * rasterizes, so when the real backend is missing we hand back a universal
 * no-op context stub: every method returns the stub, every property reads
 * as the stub, writes are accepted. Real canvas backends (if ever added)
 * win unchanged.
 */
const noop: unknown = new Proxy(function () {}, {
  get: (_target, prop) => {
    if (prop === Symbol.toPrimitive) return () => 0
    return noop
  },
  apply: () => noop,
  set: () => true,
})

const originalGetContext = HTMLCanvasElement.prototype.getContext

// eslint-disable-next-line @typescript-eslint/no-explicit-any
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: any[]) {
  const ctx = (originalGetContext as (...a: unknown[]) => unknown).apply(this, args)
  return ctx ?? noop
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any
