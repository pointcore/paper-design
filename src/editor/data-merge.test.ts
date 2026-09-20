import { describe, expect, it } from 'vitest'
import {
  MAX_MERGE_COLS,
  MAX_MERGE_ROWS,
  mergeTemplate,
  parseCsv,
  recordsFromCsv,
  templateFields,
} from './data-merge'

describe('parseCsv', () => {
  it('parses a simple table', () => {
    const out = parseCsv('name,title\nAda,Engineer\nBob,Designer\n')
    expect(out.headers).toEqual(['name', 'title'])
    expect(out.rows).toEqual([['Ada', 'Engineer'], ['Bob', 'Designer']])
  })

  it('handles quoted commas, escaped quotes and CRLF', () => {
    const out = parseCsv('name,note\r\n"Doe, Jane","said ""hi"""\r\n')
    expect(out.headers).toEqual(['name', 'note'])
    expect(out.rows).toEqual([['Doe, Jane', 'said "hi"']])
  })

  it('handles newlines inside quoted fields', () => {
    const out = parseCsv('a,b\n"x\ny",2\n')
    expect(out.rows).toEqual([['x\ny', '2']])
  })

  it('skips blank lines and trims headers', () => {
    const out = parseCsv('\n  name , age \n\nAda,30\n\n')
    expect(out.headers).toEqual(['name', 'age'])
    expect(out.rows).toEqual([['Ada', '30']])
  })

  it('returns empty for empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] })
    expect(parseCsv('\n\n')).toEqual({ headers: [], rows: [] })
  })

  it('caps rows and columns', () => {
    const big = Array.from({ length: MAX_MERGE_ROWS + 50 }, (_, i) => `r${i},x`).join('\n')
    const out = parseCsv(`h1,h2\n${big}`)
    expect(out.rows.length).toBeLessThanOrEqual(MAX_MERGE_ROWS)
    const wide = parseCsv(`${Array.from({ length: MAX_MERGE_COLS + 5 }, (_, i) => `c${i}`).join(',')}\n1,2\n`)
    expect(wide.headers.length).toBeLessThanOrEqual(MAX_MERGE_COLS)
  })
})

describe('recordsFromCsv', () => {
  it('maps cells onto headers with empty-string defaults', () => {
    const recs = recordsFromCsv({ headers: ['a', 'b'], rows: [['1'], ['1', '2', '3']] })
    expect(recs).toEqual([{ a: '1', b: '' }, { a: '1', b: '2' }])
  })
})

describe('mergeTemplate', () => {
  const rec = { name: 'Ada', title: 'Engineer' }

  it('substitutes placeholders whitespace-tolerantly', () => {
    expect(mergeTemplate('{{name}} — {{ title }}', rec)).toBe('Ada — Engineer')
  })

  it('renders unknown fields as empty', () => {
    expect(mergeTemplate('Hi {{missing}}!', rec)).toBe('Hi !')
  })

  it('leaves plain text alone', () => {
    expect(mergeTemplate('no placeholders', rec)).toBe('no placeholders')
  })
})

describe('templateFields', () => {
  it('lists referenced fields without duplicates', () => {
    expect(templateFields('{{a}} {{ b }} {{a}}')).toEqual(['a', 'b'])
    expect(templateFields('plain')).toEqual([])
  })
})
