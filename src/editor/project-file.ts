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
  const snapshotOk =
    typeof rawSnapshot === 'string'
      ? rawSnapshot.length > 0
      : typeof rawSnapshot === 'object' && rawSnapshot !== null
  if (!parsed || typeof parsed !== 'object' || !snapshotOk) {
    throw new Error('Invalid project file: missing snapshot')
  }
  if (typeof parsed.version === 'number' && parsed.version > maxVersion) {
    throw new Error('Unsupported project file version')
  }
  return parsed
}
