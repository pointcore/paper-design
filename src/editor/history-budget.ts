/**
 * History memory budget (Batch 1).
 *
 * History entries are whole-project JSON snapshots. The entry-count cap
 * (store.historyLimit, default 100) alone cannot bound memory: one large
 * document can weigh megabytes per snapshot. This module is the pure
 * eviction policy; the engine owns the snapshot arrays and only asks how
 * many oldest entries to drop.
 */

/** In-memory snapshot budget across the whole undo stack. */
export const MAX_HISTORY_BYTES = 30 * 1024 * 1024

/** Never shrink the stack below this many entries for budget reasons. */
export const MIN_HISTORY_ENTRIES = 20

/**
 * How many oldest entries to evict so `sizes` fits both the entry-count
 * cap and the byte budget. The count cap always applies; the byte budget
 * only evicts down to `minEntries` so a single huge document still keeps
 * a usable undo window.
 */
export function evictCountForBudget(
  sizes: number[],
  maxBytes: number = MAX_HISTORY_BYTES,
  maxCount = 100,
  minEntries: number = MIN_HISTORY_ENTRIES,
): number {
  if (!Array.isArray(sizes) || sizes.length === 0) return 0
  const cap = Math.max(1, Math.floor(maxCount))
  const floor = Math.max(1, Math.floor(minEntries))
  let evict = 0
  let total = 0
  for (const s of sizes) total += Number.isFinite(s) && s > 0 ? s : 0
  while (sizes.length - evict > cap) evict++
  while (
    sizes.length - evict > floor &&
    total - prefixSum(sizes, evict) > maxBytes
  ) {
    evict++
  }
  return Math.min(evict, Math.max(0, sizes.length - 1))
}

function prefixSum(sizes: number[], n: number): number {
  let sum = 0
  for (let i = 0; i < n && i < sizes.length; i++) {
    const s = sizes[i]
    if (Number.isFinite(s) && s > 0) sum += s
  }
  return sum
}
