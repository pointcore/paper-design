/**
 * Command palette registry + fuzzy filter (D1).
 *
 * Pure data layer: no Vue / Paper.js imports so it stays unit-testable and
 * out of the main bundle's heavy path. The Vue dialog
 * (CommandPalette.vue, async chunk) builds PaletteItems from tools,
 * menu commands, artboards and layers, then filters with filterPalette().
 */

/** One searchable entry in the palette. */
export interface PaletteItem {
  /** Stable id, e.g. `tool:pen`, `cmd:save`, `board:<id>`, `layer:<id>`. */
  id: string
  /** Display title, e.g. `Pen Tool`. */
  title: string
  /** Group header: `Tool` / `Command` / `Artboard` / `Layer`. */
  category: string
  /** Optional hint shown right-aligned (shortcut or meta). */
  hint?: string
  /** Extra searchable keywords (lowercased at match time). */
  keywords?: string
}

/** Lowercase + trim + collapse whitespace for matching. */
export function normalizeQuery(q: string): string {
  return (q || '').toLowerCase().trim().replace(/\s+/g, ' ')
}

/**
 * Fuzzy subsequence match: every query char must appear in order in the
 * haystack (not necessarily contiguously). Empty query matches all.
 */
export function matchesQuery(haystack: string, query: string): boolean {
  const h = (haystack || '').toLowerCase()
  const q = normalizeQuery(query)
  if (!q) return true
  let hi = 0
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]
    if (ch === ' ') continue
    hi = h.indexOf(ch, hi)
    if (hi < 0) return false
    hi++
  }
  return true
}

/** Score a match: contiguous substring beats scattered subsequence. */
function scoreItem(item: PaletteItem, q: string): number {
  const hay = `${item.title} ${item.category} ${item.keywords ?? ''}`.toLowerCase()
  if (!q) return 0
  if (hay.includes(q)) return 100 - hay.indexOf(q)
  // Subsequence: prefer shorter titles (more specific first).
  return 10 - Math.min(9, item.title.length / 8)
}

/**
 * Filter + rank palette items by a free-text query.
 * Empty query returns all items (capped); non-empty returns matches only.
 */
export function filterPalette(items: PaletteItem[], query: string, cap = 50): PaletteItem[] {
  const q = normalizeQuery(query)
  const scored: Array<{ item: PaletteItem; score: number }> = []
  for (const item of items) {
    const hay = `${item.title} ${item.category} ${item.keywords ?? ''}`
    if (!matchesQuery(hay, q)) continue
    scored.push({ item, score: scoreItem(item, q) })
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, Math.max(1, cap)).map((s) => s.item)
}

/** Build static tool entries from a `id -> label` map. */
export function toolEntries(tools: Array<{ id: string; label: string; shortcut?: string }>): PaletteItem[] {
  return tools.map((t) => ({
    id: `tool:${t.id}`,
    title: t.label,
    category: 'Tool',
    hint: t.shortcut,
    keywords: `tool ${t.id}`,
  }))
}

/** Build static menu-command entries. */
export function commandEntries(cmds: Array<{ id: string; label: string; shortcut?: string }>): PaletteItem[] {
  return cmds.map((c) => ({
    id: `cmd:${c.id}`,
    title: c.label,
    category: 'Command',
    hint: c.shortcut,
    keywords: `command ${c.id}`,
  }))
}
