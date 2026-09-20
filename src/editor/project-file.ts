/**
 * Project file envelope parsing (runtime-dependency-free, unit-tested).
 * Validation lives here so the data-loss-sensitive open path is locked by
 * tests; the engine only applies already-validated envelopes.
 */
import type { ProjectFileData } from './types'

/** Reject opens above this size before JSON parsing burns memory. */
export const MAX_PROJECT_FILE_BYTES = 150 * 1024 * 1024

/**
 * Parse and validate a project file string. Returns the envelope on
 * success; throws an English Error naming the problem otherwise.
 * v1 envelopes carry the snapshot as a JSON string, v2+ as an object.
 */
export function parseProjectFile(fileText: string, maxVersion: number): ProjectFileData {
  if (fileText.length > MAX_PROJECT_FILE_BYTES) {
    throw new Error('Project file too large (over 150 MB)')
  }
  let parsed: ProjectFileData
  try {
    parsed = JSON.parse(fileText) as ProjectFileData
  } catch {
    throw new Error('Invalid project file: not valid JSON')
  }
  const rawSnapshot = (parsed as any)?.snapshot as unknown
  if (!parsed || typeof parsed !== 'object' || !looksLikeProjectSnapshot(rawSnapshot)) {
    throw new Error('Invalid project file: missing snapshot')
  }
  if (typeof parsed.version === 'number' && parsed.version > maxVersion) {
    throw new Error('Unsupported project file version')
  }
  return parsed
}

/**
 * A snapshot must actually describe a Paper project. Paper's native JSON
 * is an array of `["Class", {...}]` tuples (one per layer) — there is no
 * top-level `layers` key, so probing for one rejects every real file the
 * app itself writes (save→reopen and crash-recovery restore included).
 * Accept the native tuple array (v2 object, v1 as its JSON string) while
 * still rejecting empty or malformed payloads, which Paper sometimes
 * imports without throwing (wiping the open document with no way back,
 * since the engine's rollback only fires on a throw).
 */
function looksLikeProjectSnapshot(value: unknown): boolean {
  if (typeof value === 'string') {
    // Cheap probe instead of JSON.parse: the engine is about to hand this
    // (possibly 150 MB) string to Paper and parse it itself. A serialized
    // `["Class", {...}]` tuple survives stringification either way.
    return /\["[A-Za-z]+",/.test(value)
  }
  if (Array.isArray(value)) {
    // Paper's native project format: non-empty array of [class, props]
    // tuples, one per layer. Empty or malformed arrays must not pass:
    // Paper imports some of them without throwing, which used to wipe the
    // open document with no way back (the engine rollback only fires on a
    // throw) — same guard as the object branch below.
    return (
      value.length > 0 &&
      value.every((el) => Array.isArray(el) && el.length >= 2 && typeof el[0] === 'string')
    )
  }
  if (!value || typeof value !== 'object') return false
  const layers = (value as Record<string, unknown>).layers
  // A hand-made envelope may still carry the object shape; it must hold a
  // non-empty layer stack for the same no-silent-wipe reason.
  return Array.isArray(layers) && layers.length > 0
}
