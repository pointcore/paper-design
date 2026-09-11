/**
 * Saved-selection helpers (AI Select > Save Selection parity). Pure
 * functions over id lists so they stay unit-testable under plain Node —
 * run with `vitest run`.
 */

/** First unused "Selection" / "Selection N" name. */
export function uniqueSelectionName(existing: string[], base = 'Selection'): string {
  const names = new Set(existing)
  if (!names.has(base)) return base
  let n = 2
  while (names.has(`${base} ${n}`)) n++
  return `${base} ${n}`
}

/** Drop ids that no longer exist in the document (keeps order, dedupes). */
export function pruneSelectionIds(ids: string[], existing: Set<string> | string[]): string[] {
  const set = Array.isArray(existing) ? new Set(existing) : existing
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    seen.add(id)
    if (set.has(id)) out.push(id)
  }
  return out
}
