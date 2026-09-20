/**
 * Untyped third-party tracer (imagetracerjs ships no types and no ESM
 * entry; the CJS bundle assigns `module.exports = new ImageTracer()`).
 * Import it lazily (`await import('imagetracerjs')`) so the main bundle
 * never pays the 47KB; the default interop carries the singleton.
 */
declare module 'imagetracerjs' {
  export interface ImageTracerInstance {
    imagedataToSVG(
      imgd: { width: number; height: number; data: Uint8ClampedArray },
      options?: { [key: string]: unknown },
    ): string
    imagedataToTracedata(
      imgd: { width: number; height: number; data: Uint8ClampedArray },
      options?: { [key: string]: unknown },
    ): unknown
  }
  const instance: ImageTracerInstance
  export default instance
}
