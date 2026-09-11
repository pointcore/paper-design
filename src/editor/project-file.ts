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
 * A snapshot must actually describe a Paper project. Accepting any non-null
 * object let `{"version":2,"snapshot":{}}` through: Paper imports it without
 * throwing, so the open document was replaced by an empty scene and the
 * engine's rollback (which only fires on a throw) never ran.
 */
function looksLikeProjectSnapshot(value: unknown): boolean {
  if (typeof value === 'string') {
    // Cheap substring probe instead of JSON.parse: the engine is about to
    // hand this (possibly 150 MB) string to Paper and parse it itself.
    return value.includes('"layers"')
  }
  if (!value || typeof value !== 'object') return false
  const layers = (value as Record<string, unknown>).layers
  // The engine always keeps grid/user/overlay/annotation/guide layers, so a
  // legitimate export never carries an empty stack.
  return Array.isArray(layers) && layers.length > 0
}
