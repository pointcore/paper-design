/**
 * Named version branches (D9).
 *
 * A version is a labelled project-file snapshot (`engine.exportProjectFile`
 * output) so a milestone can be restored later with `importProjectFile`.
 * This file is the pure data layer (no Vue / Paper.js / storage): validation,
 * list hygiene, summaries and a small JSON diff used by the replay preview.
 * Persistence lives in ActionsPanel (localStorage, best effort) like the
 * export-preset and data-merge features.
 */

/** One saved document milestone. */
export interface NamedVersion {
  id: string
  name: string
  /** Wall-clock ms when the snapshot was taken. */
  savedAt: number
  /** Serialized project file (engine.exportProjectFile output). */
  fileText: string
}

/** Hard cap on kept versions per document (UI shows the truncation). */
export const MAX_VERSIONS = 20

/** Version names are short labels; longer input is trimmed. */
export const MAX_VERSION_NAME_LEN = 40

/**
 * Upper bound on a single version payload. Named versions share one
 * localStorage slot, so this stays well below the recovery mirror cap;
 * oversized captures are rejected with a status message instead of
 * silently evicting the whole list on quota errors.
 */
export const MAX_VERSION_CHARS = 8 * 1024 * 1024

/** Max diff lines returned by diffProjectFiles (remainder folds into one). */
export const MAX_DIFF_LINES = 20

/** True when a value is a usable version entry. */
export function isValidNamedVersion(v: Partial<NamedVersion>): v is NamedVersion {
  if (!v || typeof v !== 'object') return false
  if (typeof v.id !== 'string' || v.id.length === 0 || v.id.length > 120) return false
  if (typeof v.name !== 'string' || v.name.trim().length === 0) return false
  if (typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt) || v.savedAt <= 0) return false
  if (typeof v.fileText !== 'string' || v.fileText.length === 0 || v.fileText.length > MAX_VERSION_CHARS) {
    return false
  }
  // Cheap probe that this is plausibly a project file — the same markers
  // the recovery validator looks for before handing data to the engine.
  if (!v.fileText.includes('"snapshot"') || !v.fileText.includes('"layers"')) return false
  return true
}

/**
 * Sanitize a loaded list (storage may be corrupt or from an older shape).
 * Keeps insertion order (newest first by convention), trims names, drops
 * invalid entries and caps the length.
 */
export function cleanVersions(list: unknown): NamedVersion[] {
  if (!Array.isArray(list)) return []
  const out: NamedVersion[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const v = raw as Partial<NamedVersion>
    if (!isValidNamedVersion(v)) continue
    out.push({
      id: v.id as string,
      name: (v.name as string).trim().slice(0, MAX_VERSION_NAME_LEN),
      savedAt: v.savedAt as number,
      fileText: v.fileText as string,
    })
    if (out.length >= MAX_VERSIONS) break
  }
  return out
}

/** Build a version entry (id defaults to a time + random suffix). */
export function createNamedVersion(
  name: string,
  fileText: string,
  now: number = Date.now(),
  id?: string,
): NamedVersion {
  const clean = (name || '').trim().slice(0, MAX_VERSION_NAME_LEN) || 'Version'
  const stamp = Number.isFinite(now) && now > 0 ? Math.floor(now) : Date.now()
  const suffix = (id || `${stamp.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`).slice(0, 120)
  return { id: `ver-${suffix}`, name: clean, savedAt: stamp, fileText }
}

/**
 * Rename one entry (returns a new list). Blank names and unknown ids
 * leave the list unchanged.
 */
export function renameNamedVersion(list: NamedVersion[], id: string, newName: string): NamedVersion[] {
  const clean = (newName || '').trim().slice(0, MAX_VERSION_NAME_LEN)
  if (!clean) return list
  let touched = false
  const out = list.map((v) => {
    if (v.id !== id) return v
    touched = true
    return v.name === clean ? v : { ...v, name: clean }
  })
  return touched ? out : list
}

export interface VersionSummary {
  boards: number
  page: string
  bleed: number
  bytes: number
  /** False when fileText is not parseable JSON. */
  readable: boolean
}

function safeParseFile(fileText: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(fileText) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** Cheap human-readable shape of a version payload (never throws). */
export function summarizeVersion(fileText: string): VersionSummary {
  const bytes = typeof fileText === 'string' ? fileText.length : 0
  const parsed = typeof fileText === 'string' ? safeParseFile(fileText) : null
  if (!parsed) return { boards: 0, page: '?', bleed: 0, bytes, readable: false }
  const boards = Array.isArray(parsed.artboards) ? parsed.artboards.length : 0
  const page = parsed.pageSize as { width?: unknown; height?: unknown } | undefined
  const pageText =
    page && Number.isFinite(page.width) && Number.isFinite(page.height)
      ? `${page.width}x${page.height}`
      : '?'
  const bleed = Number.isFinite(parsed.bleed) ? Math.max(0, Number(parsed.bleed)) : 0
  return { boards, page: pageText, bleed, bytes, readable: true }
}

/** One-line label, e.g. `3 boards · 1920x1080 · 12 KB`. */
export function describeVersion(v: NamedVersion): string {
  const s = summarizeVersion(v.fileText)
  const kb = Math.max(1, Math.round(s.bytes / 1024))
  const boardText = `${s.boards} board${s.boards === 1 ? '' : 's'}`
  return `${boardText} · ${s.page} · ${kb} KB`
}

interface BoardLite {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

function liteBoards(value: unknown): BoardLite[] {
  if (!Array.isArray(value)) return []
  const out: BoardLite[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const b = raw as Record<string, unknown>
    out.push({
      id: typeof b.id === 'string' ? b.id : '',
      name: typeof b.name === 'string' ? b.name : '(unnamed)',
      x: Number.isFinite(b.x) ? Number(b.x) : 0,
      y: Number.isFinite(b.y) ? Number(b.y) : 0,
      width: Number.isFinite(b.width) ? Number(b.width) : 0,
      height: Number.isFinite(b.height) ? Number(b.height) : 0,
    })
  }
  return out
}

function snapshotFingerprint(value: unknown): string {
  if (typeof value === 'string') return `str:${value.length}:${hashShort(value)}`
  try {
    const text = JSON.stringify(value) ?? ''
    return `obj:${text.length}:${hashShort(text)}`
  } catch {
    return 'unreadable'
  }
}

/** Short non-crypto hash for change detection (not for identity). */
function hashShort(text: string): string {
  let h = 5381
  const n = Math.min(text.length, 20000)
  for (let i = 0; i < n; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

/**
 * Compare two project-file payloads and describe the differences as short
 * English lines for the replay preview. Returns [] when the payloads are
 * equivalent, or a single explanatory line when either side is unreadable.
 * Output is capped at MAX_DIFF_LINES (+1 overflow line).
 */
export function diffProjectFiles(beforeText: string, afterText: string, maxLines = MAX_DIFF_LINES): string[] {
  if (beforeText === afterText) return []
  const before = safeParseFile(beforeText)
  const after = safeParseFile(afterText)
  if (!before || !after) return ['Unreadable version data']
  const lines: string[] = []
  const cap = Number.isFinite(maxLines) && maxLines > 0 ? Math.floor(maxLines) : MAX_DIFF_LINES

  const push = (line: string) => {
    if (lines.length < cap + 1) lines.push(line)
  }

  if (before.version !== after.version) {
    push(`File version: ${String(before.version ?? '?')} → ${String(after.version ?? '?')}`)
  }

  const bp = (before.pageSize ?? {}) as { width?: unknown; height?: unknown }
  const ap = (after.pageSize ?? {}) as { width?: unknown; height?: unknown }
  if (bp.width !== ap.width || bp.height !== ap.height) {
    push(`Page: ${String(bp.width ?? '?')}x${String(bp.height ?? '?')} → ${String(ap.width ?? '?')}x${String(ap.height ?? '?')}`)
  }

  const bb = Number.isFinite(before.bleed) ? Number(before.bleed) : 0
  const ab = Number.isFinite(after.bleed) ? Number(after.bleed) : 0
  if (bb !== ab) push(`Bleed: ${bb} → ${ab}`)

  const beforeBoards = liteBoards(before.artboards)
  const afterBoards = liteBoards(after.artboards)
  const beforeById = new Map(beforeBoards.map((b) => [b.id, b]))
  const afterById = new Map(afterBoards.map((b) => [b.id, b]))
  for (const b of afterBoards) {
    if (!b.id || !beforeById.has(b.id)) {
      push(`+ Board "${b.name}" ${b.width}x${b.height}`)
    }
  }
  for (const b of beforeBoards) {
    if (!b.id || !afterById.has(b.id)) {
      push(`- Board "${b.name}"`)
    }
  }
  for (const b of afterBoards) {
    if (!b.id) continue
    const prev = beforeById.get(b.id)
    if (!prev) continue
    if (prev.name !== b.name) push(`Board renamed: "${prev.name}" → "${b.name}"`)
    if (prev.width !== b.width || prev.height !== b.height) {
      push(`Board "${b.name}" resized: ${prev.width}x${prev.height} → ${b.width}x${b.height}`)
    } else if (prev.x !== b.x || prev.y !== b.y) {
      push(`Board "${b.name}" moved to (${b.x}, ${b.y})`)
    }
  }

  if (before.activeArtboardId !== after.activeArtboardId) {
    push('Active board changed')
  }

  const beforeSnap = snapshotFingerprint((before as Record<string, unknown>).snapshot)
  const afterSnap = snapshotFingerprint((after as Record<string, unknown>).snapshot)
  if (beforeSnap !== afterSnap) push('Canvas artwork changed')

  if (lines.length > cap) {
    const extra = lines.length - cap
    return [...lines.slice(0, cap), `… and ${extra} more change${extra === 1 ? '' : 's'}`]
  }
  return lines
}
