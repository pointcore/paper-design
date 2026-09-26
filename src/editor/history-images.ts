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

/**
 * Sidecar memory cap: the store holds each distinct image once, but a long
 * session can still accumulate hundreds of retired payloads. When over the
 * cap, oldest entries no longer referenced by any history snapshot are
 * dropped (see pruneHistoryImageStore).
 */
export const MAX_SIDECAR_BYTES = 64 * 1024 * 1024

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

/** Id chars emitted by hashImageSource plus the `~n` collision suffix. */
const TOKEN_ID_RE = /vve-img:([0-9a-z~\-]+)/g

/**
 * Replace long `data:` payloads with sidecar tokens (mutates and returns
 * the node). Non-image strings and short payloads pass through untouched.
 * A 53-bit hash collision between different payloads mints a `~n` suffixed
 * id instead of letting the first payload win — the token keeps pointing
 * at the right pixels.
 */
export function slimHistoryImages<T>(node: T, store: Map<string, string>): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (v.length > IMAGE_INLINE_LIMIT && v.startsWith('data:')) {
        let id = hashImageSource(v)
        if (store.has(id) && store.get(id) !== v) {
          let n = 1
          while (store.has(`${id}~${n}`) && store.get(`${id}~${n}`) !== v) n++
          id = `${id}~${n}`
        }
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
        v[key] = walk(v[key])
      }
      return v
    }
    return v
  }
  return walk(node) as T
}

/**
 * Drop oldest sidecar payloads until the store fits `maxBytes`, never
 * touching an id still tokenized in any current history snapshot (undo or
 * jump would otherwise inflate a missing token). Callers pass the live
 * snapshot strings; over-cap scans are rare, so the linear token sweep is
 * acceptable.
 */
export function pruneHistoryImageStore(
  store: Map<string, string>,
  snapshots: readonly string[],
  maxBytes: number = MAX_SIDECAR_BYTES,
): void {
  let total = 0
  for (const v of store.values()) total += v.length
  if (total <= maxBytes) return
  const live = new Set<string>()
  for (const s of snapshots) {
    if (typeof s !== 'string' || !s.includes(IMAGE_TOKEN_PREFIX)) continue
    TOKEN_ID_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = TOKEN_ID_RE.exec(s)) !== null) live.add(m[1])
  }
  for (const [id, v] of store) {
    if (total <= maxBytes) break
    if (live.has(id)) continue
    store.delete(id)
    total -= v.length
  }
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
