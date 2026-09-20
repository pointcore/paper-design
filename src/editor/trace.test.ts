import { describe, expect, it } from 'vitest'
import {
  TRACE_MAX_COLORS,
  TRACE_MAX_DIM,
  TRACE_MIN_COLORS,
  cleanTraceOptions,
  countTracePaths,
  defaultTraceOptions,
  fitTraceSize,
  isPlausibleTraceSvg,
  isTraceableImage,
  isValidTraceOptions,
  summarizeTrace,
  traceImageData,
  traceOptionsToImageTracer,
  type TraceImage,
} from './trace'

function image(w = 4, h = 4): TraceImage {
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) }
}

describe('defaultTraceOptions / isValidTraceOptions', () => {
  it('ships runnable defaults', () => {
    expect(isValidTraceOptions(defaultTraceOptions())).toBe(true)
  })

  it('rejects out-of-range palettes, bad details and non-objects', () => {
    expect(isValidTraceOptions({ colors: 8, detail: 'medium' })).toBe(true)
    expect(isValidTraceOptions({ colors: 1, detail: 'medium' })).toBe(false)
    expect(isValidTraceOptions({ colors: 17, detail: 'medium' })).toBe(false)
    expect(isValidTraceOptions({ colors: 8.5, detail: 'medium' })).toBe(false)
    expect(isValidTraceOptions({ colors: 8, detail: 'ultra' })).toBe(false)
    expect(isValidTraceOptions(null)).toBe(false)
    expect(isValidTraceOptions({})).toBe(false)
  })

  it('spans the documented palette range', () => {
    expect(TRACE_MIN_COLORS).toBe(2)
    expect(TRACE_MAX_COLORS).toBe(16)
  })
})

describe('cleanTraceOptions', () => {
  it('clamps palettes and falls back on corrupt input', () => {
    expect(cleanTraceOptions({ colors: 99, detail: 'high' }).colors).toBe(TRACE_MAX_COLORS)
    expect(cleanTraceOptions({ colors: 0, detail: 'low' }).colors).toBe(TRACE_MIN_COLORS)
    expect(cleanTraceOptions({ colors: 8, detail: 'nope' })).toEqual(defaultTraceOptions())
    expect(cleanTraceOptions(null)).toEqual(defaultTraceOptions())
    expect(cleanTraceOptions('zzz')).toEqual(defaultTraceOptions())
  })

  it('round-trips through JSON (persistence contract)', () => {
    const opts = { colors: 4, detail: 'low' } as const
    expect(cleanTraceOptions(JSON.parse(JSON.stringify(opts)))).toEqual(opts)
  })
})

describe('traceOptionsToImageTracer', () => {
  it('maps palettes and uses the deterministic sampler', () => {
    const mapped = traceOptionsToImageTracer({ colors: 6, detail: 'medium' })
    expect(mapped.numberofcolors).toBe(6)
    expect(mapped.colorsampling).toBe(2)
  })

  it('trades fit error against pruning across details', () => {
    const low = traceOptionsToImageTracer({ colors: 8, detail: 'low' })
    const high = traceOptionsToImageTracer({ colors: 8, detail: 'high' })
    expect(low.ltres).toBeGreaterThan(high.ltres)
    expect(low.pathomit).toBeGreaterThan(high.pathomit)
  })
})

describe('isTraceableImage / fitTraceSize', () => {
  it('accepts complete RGBA buffers', () => {
    expect(isTraceableImage(image())).toBe(true)
    expect(isTraceableImage({ width: 4, height: 4, data: new Uint8ClampedArray(8) })).toBe(false)
    expect(isTraceableImage({ width: 0, height: 4, data: new Uint8ClampedArray(0) })).toBe(false)
    expect(isTraceableImage(null)).toBe(false)
  })

  it('fits long sides into the cap without upscaling', () => {
    expect(TRACE_MAX_DIM).toBe(512)
    expect(fitTraceSize(2048, 1024)).toEqual({ width: 512, height: 256 })
    expect(fitTraceSize(100, 800)).toEqual({ width: 64, height: 512 })
    expect(fitTraceSize(100, 80)).toEqual({ width: 100, height: 80 })
    expect(fitTraceSize(0, 10)).toEqual({ width: 0, height: 0 })
    expect(fitTraceSize(NaN, 10)).toEqual({ width: 0, height: 0 })
  })
})

describe('traceImageData', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L10 10"/></svg>'

  it('delegates validated input to the injected tracer', () => {
    const seen: unknown[] = []
    const out = traceImageData(image(), { colors: 4, detail: 'low' }, (img, opts) => {
      seen.push([img.width, (opts as { numberofcolors: number }).numberofcolors])
      return svg
    })
    expect(out).toBe(svg)
    expect(seen).toEqual([[4, 4]])
  })

  it('throws English errors on bad input or empty output', () => {
    const ok = () => svg
    expect(() => traceImageData({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, defaultTraceOptions(), ok))
      .toThrow('Trace needs a loaded bitmap')
    expect(() => traceImageData(image(), { colors: 99, detail: 'medium' }, ok)).toThrow('Invalid trace options')
    expect(() => traceImageData(image(), defaultTraceOptions(), () => '<svg></svg>')).toThrow(
      'Trace produced no vector output',
    )
  })

  it('lets tracer crashes propagate for status-bar reporting', () => {
    expect(() => traceImageData(image(), defaultTraceOptions(), () => { throw new Error('boom') })).toThrow('boom')
  })
})

describe('countTracePaths / isPlausibleTraceSvg / summarizeTrace', () => {
  it('counts paths and checks document shape', () => {
    expect(countTracePaths('<svg><path d="a"/><path d="b"/></svg>')).toBe(2)
    expect(countTracePaths('<svg></svg>')).toBe(0)
    expect(isPlausibleTraceSvg('<svg><path d="a"/></svg>')).toBe(true)
    expect(isPlausibleTraceSvg('<svg></svg>')).toBe(false)
    expect(isPlausibleTraceSvg('nope')).toBe(false)
  })

  it('summarizes results for status messages', () => {
    expect(summarizeTrace('<svg><path d="a"/></svg>')).toContain('1 path')
    expect(summarizeTrace('<svg><path d="a"/><path d="b"/></svg>')).toContain('2 paths')
  })
})

describe('imagetracerjs library contract', () => {
  it('loads via default interop and traces synthetic pixels', async () => {
    const mod = await import('imagetracerjs')
    const tracer = (mod as unknown as { default?: unknown }).default ?? mod
    const run = (tracer as { imagedataToSVG?: unknown }).imagedataToSVG
    expect(typeof run).toBe('function')
    // Half black / half white 8x8: must yield at least one path.
    const data = new Uint8ClampedArray(8 * 8 * 4)
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i = (y * 8 + x) * 4
        const v = x < 4 ? 0 : 255
        data[i] = v
        data[i + 1] = v
        data[i + 2] = v
        data[i + 3] = 255
      }
    }
    const svg = (run as (img: unknown, opts: unknown) => string)(
      { width: 8, height: 8, data },
      { numberofcolors: 2, ltres: 1, qtres: 1, pathomit: 0 },
    )
    expect(svg).toContain('<svg')
    expect(countTracePaths(svg)).toBeGreaterThan(0)
  })
})
