/**
 * Crash-recovery persistence for the open document.
 *
 * While the document is dirty it is periodically mirrored (debounced, best
 * effort) to IndexedDB, so a crashed or killed tab can offer the work back
 * on the next start. Saving manually / New / Open makes the document clean,
 * which clears the mirror. A localStorage fallback covers profiles where
 * IndexedDB is unavailable or broken (private-mode quirks).
 */

export interface RecoveryPayload {
  /** Wall-clock ms when the snapshot was written. */
  savedAt: number
  /** Serialized project file (engine.exportProjectFile output). */
  fileText: string
}

const DB_NAME = 'vve-recovery'
const DB_VERSION = 1
const STORE_NAME = 'slots'
const SLOT_KEY = 'document'
const LS_KEY = 'vve.recovery'

/** Reject oversized payloads before they burn storage (mirrors the open cap). */
const MAX_RECOVERY_CHARS = 150 * 1024 * 1024

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

/**
 * Validate an unknown stored value; null when it is not a usable payload.
 * Stored data is hand-forgeable and survives across builds, so every field
 * is re-checked instead of trusting the slot's shape.
 */
export function validateRecoveryPayload(value: unknown): RecoveryPayload | null {
  if (!value || typeof value !== 'object') return null
  const savedAt = (value as { savedAt?: unknown }).savedAt
  const fileText = (value as { fileText?: unknown }).fileText
  if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || savedAt <= 0) return null
  if (typeof fileText !== 'string' || fileText.length === 0 || fileText.length > MAX_RECOVERY_CHARS) {
    return null
  }
  // Cheap probe that this is plausibly a project file — the same markers the
  // project-file parser looks for before handing data to Paper.
  if (!fileText.includes('"snapshot"') || !fileText.includes('"layers"')) return null
  return { savedAt, fileText }
}

export async function saveRecoverySnapshot(fileText: string): Promise<void> {
  const payload: RecoveryPayload = { savedAt: Date.now(), fileText }
  try {
    const db = await openDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).put(payload, SLOT_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('recovery write failed'))
        tx.onabort = () => reject(tx.error ?? new Error('recovery write aborted'))
      })
    } finally {
      db.close()
    }
  } catch {
    // Fallback: best-effort localStorage (quota errors are swallowed).
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(payload))
    } catch { /* ignore */ }
  }
}

export async function loadRecoverySnapshot(): Promise<RecoveryPayload | null> {
  try {
    const db = await openDb()
    let fromDb: unknown = null
    try {
      fromDb = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const req = tx.objectStore(STORE_NAME).get(SLOT_KEY)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('recovery read failed'))
      })
    } finally {
      db.close()
    }
    const payload = validateRecoveryPayload(fromDb)
    if (payload) return payload
  } catch { /* fall through to localStorage */ }
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return null
    return validateRecoveryPayload(JSON.parse(raw))
  } catch {
    return null
  }
}

export async function clearRecoverySnapshot(): Promise<void> {
  try {
    localStorage.removeItem(LS_KEY)
  } catch { /* ignore */ }
  try {
    const db = await openDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).delete(SLOT_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('recovery clear failed'))
        tx.onabort = () => reject(tx.error ?? new Error('recovery clear aborted'))
      })
    } finally {
      db.close()
    }
  } catch { /* nothing to clear then */ }
}
