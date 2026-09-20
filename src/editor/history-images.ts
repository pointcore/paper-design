/**
 * History-snapshot image diet (C5).
 *
 * Paper.js `exportJSON` inlines every Raster's pixels as a dataURL string.
 * Without dieting, 100 history snapshots of one image store the same
 * megabytes 100 times and hit the 150MB project guard.
 *
 * The engine therefore snapshots through here: long `data:` payloads are
 * replaced by `vve-img:<hash>` tokens and the payload lives once in a
 * session sidecar (`Map<hash, dataURL>`); restore inflates tokens back.
 * Project files stay self-contained (full dataURLs, no tokens).
 *
 * Pure functions with an injected store so they unit-test without Paper.js.
 */

/** Token prefix marking an extracted image payload. */
export const IMAGE_TOKEN_PREFIX = 'vve-img:'

/** Payloads at or below this length stay inline (icons, tiny thumbs). */
export const IMAGE_INLINE_LIMIT = 256

/** Property names dropped from snapshots (pre-edit pixel copies). */
const STRIPPED_KEYS = new Set(['originalSource', 'originalData'])

/**
 * 53-bit content hash (cyrb53) prefixed with payload length: distinct
 * images share one sidecar entry, identical images share the token.
 */
export function hashImageSource(url: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < url.length; i++) {
    const ch = url.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return `${url.length.toString(36)}-${(h2 >>> 0).toString(36)}${(h1 >>> 0).toString(36)}`
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

/**
 * Replace long `data:` payloads with sidecar tokens (mutates and returns
 * the node). Non-image strings and short payloads pass through untouched.
 */
export function slimHistoryImages<T>(node: T, store: Map<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (v.length > IMAGE_INLINE_LIMIT && v.startsWith('data:')) {
        const id = hashImageSource(v)
        if (!store.has(id)) store.set(id, v)
        return `${IMAGE_TOKEN_PREFIX}${id}`
      }
      return v
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = walk(v[i])
      return v
    }
    if (isPlainObject(v)) {
      for (const key of Object.keys(v)) {
        if (STRIPPED_KEYS.has(key)) {
          delete v[key]
          continue
        }
        v[key] = walk(v[key])
      }
      return v
    }
    return v
  }
  return walk(node) as T
}

/**
 * Restore sidecar payloads behind tokens (mutates and returns the node).
 * Unknown tokens are left intact so import degrades to a broken image
 * instead of a crash (only reachable with hand-crafted input: the engine
 * never prunes the sidecar within a session).
 */
export function inflateHistoryImages<T>(node: T, store: Map<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (v.startsWith(IMAGE_TOKEN_PREFIX)) {
        return store.get(v.slice(IMAGE_TOKEN_PREFIX.length)) ?? v
      }
      return v
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = walk(v[i])
      return v
    }
    if (isPlainObject(v)) {
      for (const key of Object.keys(v)) v[key] = walk(v[key])
      return v
    }
    return v
  }
  return walk(node) as T
}
