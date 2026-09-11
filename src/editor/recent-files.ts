/**
 * Recently saved project files (File > Recent).
 *
 * Save downloads a .vec.json; the same payload is mirrored to IndexedDB so
 * the File menu can reopen recent documents without the OS file picker.
 * Entries are keyed by file name (saving again refreshes the entry),
 * newest first, capped. A localStorage fallback covers broken IndexedDB.
 */

export interface RecentFileMeta {
  id: string
  name: string
  savedAt: number
  /** Serialized project file (engine.exportProjectFile output). */
  fileText: string
}

const DB_NAME = 'vve-recent'
const DB_VERSION = 1
const STORE_NAME = 'files'
const LIST_KEY = 'list'
const LS_KEY = 'vve.recentFiles'

/** Keep at most this many recent documents. */
export const MAX_RECENT_FILES = 8
const MAX_NAME_CHARS = 80

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
 * Normalize a stored list: valid entries only (real name, sane timestamp,
 * text that plausibly is a project file), deduped by name keeping the
 * newest save, newest first, capped. Stored data is hand-forgeable and
 * survives across builds, so nothing is trusted blindly.
 */
export function normalizeRecentList(
  value: unknown,
  max: number = MAX_RECENT_FILES
): RecentFileMeta[] {
  if (!Array.isArray(value)) return []
  const byName = new Map<string, RecentFileMeta>()
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const rec = raw as Record<string, unknown>
    const name = typeof rec.name === 'string' ? rec.name.trim().slice(0, MAX_NAME_CHARS) : ''
    const savedAt = rec.savedAt
    const fileText = rec.fileText
    if (!name) continue
    if (typeof savedAt !== 'number' || !Number.isFinite(savedAt) || savedAt <= 0) continue
    if (
      typeof fileText !== 'string' ||
      fileText.length === 0 ||
      !fileText.includes('"snapshot"') ||
      !fileText.includes('"layers"')
    ) {
      continue
    }
    const id = typeof rec.id === 'string' && rec.id ? rec.id : `recent-${name}`
    const prev = byName.get(name)
    if (!prev || prev.savedAt < savedAt) byName.set(name, { id, name, savedAt, fileText })
  }
  return [...byName.values()].sort((a, b) => b.savedAt - a.savedAt).slice(0, max)
}

async function readList(): Promise<unknown> {
  try {
    const db = await openDb()
    let value: unknown = null
    try {
      value = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly')
        const req = tx.objectStore(STORE_NAME).get(LIST_KEY)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error ?? new Error('recent read failed'))
      })
    } finally {
      db.close()
    }
    if (value !== null && value !== undefined) return value
  } catch { /* fall through to localStorage */ }
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

async function writeList(list: RecentFileMeta[]): Promise<void> {
  try {
    const db = await openDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).put(list, LIST_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('recent write failed'))
        tx.onabort = () => reject(tx.error ?? new Error('recent write aborted'))
      })
    } finally {
      db.close()
    }
  } catch {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(list))
    } catch { /* best effort */ }
  }
}

/** Drop the whole recent list (File > Clear Recent). */
export async function clearRecentProjects(): Promise<void> {
  try {
    localStorage.removeItem(LS_KEY)
  } catch { /* ignore */ }
  try {
    const db = await openDb()
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite')
        tx.objectStore(STORE_NAME).delete(LIST_KEY)
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error ?? new Error('recent clear failed'))
        tx.onabort = () => reject(tx.error ?? new Error('recent clear aborted'))
      })
    } finally {
      db.close()
    }
  } catch { /* nothing to clear then */ }
}

/** Record a just-saved document under its file name (newest wins). */
export async function recordRecentProject(name: string, fileText: string): Promise<void> {
  const clean = (name || '').trim().slice(0, MAX_NAME_CHARS) || 'Untitled'
  const previous = normalizeRecentList(await readList()).filter((e) => e.name !== clean)
  const next = normalizeRecentList([
    { id: `recent-${clean}`, name: clean, savedAt: Date.now(), fileText },
    ...previous,
  ])
  await writeList(next)
}

/** Menu payload: recent entries without their file text. */
export async function listRecentProjects(): Promise<
  Array<{ id: string; name: string; savedAt: number }>
> {
  return normalizeRecentList(await readList()).map(({ id, name, savedAt }) => ({ id, name, savedAt }))
}

/** Full payload for one recent entry; null when the id is unknown. */
export async function loadRecentProjectText(id: string): Promise<string | null> {
  const hit = normalizeRecentList(await readList()).find((e) => e.id === id)
  return hit?.fileText ?? null
}
