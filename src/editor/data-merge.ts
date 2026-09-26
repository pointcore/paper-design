/**
 * Data-driven merge (D5): CSV -> records -> one artboard per row.
 *
 * Pure parsing/template layer (no Vue / Paper.js): the engine consumes
 * records, ActionsPanel owns the textarea/file input and persistence of
 * the last template. Caps keep runaway CSVs from generating 10k boards.
 */

/** Hard cap on generated boards per merge (UI shows the truncation). */
export const MAX_MERGE_ROWS = 200

/** Hard cap on columns per row (extra cells are dropped). */
export const MAX_MERGE_COLS = 20

export interface ParsedCsv {
  headers: string[]
  rows: string[][]
}

/**
 * Parse RFC-4180-style CSV: comma separators, `"quoted"` fields,
 * `""` escapes, embedded commas/newlines inside quotes, CRLF or LF.
 * Returns trimmed headers; blank lines are skipped.
 */
export function parseCsv(text: string, maxRows = MAX_MERGE_ROWS, maxCols = MAX_MERGE_COLS): ParsedCsv {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  // Excel's "CSV UTF-8" always starts with a BOM; left in place it would
  // poison the first header key and silently blank every merged board.
  const src = (text || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  const pushField = () => {
    row.push(field)
    field = ''
  }
  const pushRow = () => {
    pushField()
    // Skip fully blank lines.
    if (!(row.length === 1 && row[0].trim() === '')) {
      rows.push(row.slice(0, Math.max(0, maxCols)))
    }
    row = []
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      // An opening quote only counts at a field start; mid-field quotes
      // are literal (lenient, spreadsheet-style).
      if (field === '') inQuotes = true
      else field += ch
    } else if (ch === ',') {
      pushField()
    } else if (ch === '\n') {
      pushRow()
      if (rows.length >= maxRows + 1) break
    } else {
      field += ch
    }
  }
  // Trailing field/row without a final newline.
  if (field !== '' || row.length > 0) pushRow()

  if (rows.length === 0) return { headers: [], rows: [] }
  const headers = rows[0].map((h) => h.trim())
  return { headers, rows: rows.slice(1, maxRows + 1) }
}

/** Map data rows onto header keys (missing cells become ''). */
export function recordsFromCsv(parsed: ParsedCsv): Array<Record<string, string>> {
  return parsed.rows.map((cells) => {
    const rec: Record<string, string> = {}
    for (let i = 0; i < parsed.headers.length; i++) {
      const key = parsed.headers[i]
      if (key) rec[key] = cells[i] ?? ''
    }
    return rec
  })
}

/**
 * Substitute `{{ field }}` placeholders (whitespace-tolerant).
 * Unknown fields render as '' so a typo never leaks template syntax.
 */
export function mergeTemplate(template: string, record: Record<string, string>): string {
  return (template || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, key: string) => {
    const v = record[key]
    return v === undefined || v === null ? '' : String(v)
  })
}

/** List `{{ field }}` names referenced by a template (for validation hints). */
export function templateFields(template: string): string[] {
  const out: string[] = []
  const re = /\{\{\s*([^}]+?)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template || '')) !== null) {
    const key = m[1].trim()
    if (key && !out.includes(key)) out.push(key)
  }
  return out
}
