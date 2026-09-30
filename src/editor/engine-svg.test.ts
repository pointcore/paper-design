/**
 * File > Open on an SVG.
 *
 * The behavior worth pinning is the ordering, not the paper.js plumbing: a
 * file that is not an SVG must leave the open document completely alone, and
 * a successful open must replace rather than merge. Both are invisible in the
 * UI until the user's unsaved work is gone.
 */
import { describe, expect, it } from 'vitest'
import { openSvgText } from './engine-svg'
import type { EditorEngine } from './engine'

function makeEngine(importResult = true) {
  const calls: string[] = []
  const imported: string[] = []
  let documentName = ''
  const e = {
    store: { activeArtboardId: 'board-1' },
    newDocument: (w: number, h: number) => calls.push(`newDocument ${w}x${h}`),
    importSVGText: (text: string, label: string) => {
      calls.push(`importSVGText ${label}`)
      imported.push(text)
      return importResult
    },
    fitArtboardToArtwork: (id: string, padding: number) => calls.push(`fit ${id} ${padding}`),
    zoomToArtboard: () => calls.push('zoomToArtboard'),
  } as unknown as EditorEngine
  // setDocumentName lives on the store, which the stub shares with the
  // engine; keep one object so the call is observable.
  ;(e.store as unknown as { setDocumentName: (n: string) => void }).setDocumentName = (n) => {
    documentName = n
  }
  return { e, calls, imported, name: () => documentName }
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>'

describe('openSvgText', () => {
  it('replaces the document and fits the page to the imported art', () => {
    const { e, calls, imported, name } = makeEngine()
    expect(openSvgText(e, SVG, 'drawing.svg')).toBe(true)
    // Order matters: the old document goes before the art lands in it.
    expect(calls).toEqual([
      'newDocument 1920x1080',
      'importSVGText Open SVG',
      'fit board-1 0',
      'zoomToArtboard',
    ])
    expect(imported).toEqual([SVG])
    expect(name()).toBe('drawing')
  })

  it('leaves the document alone for a file that is not an SVG', () => {
    const { e, calls } = makeEngine()
    expect(openSvgText(e, '{"layers":[]}', 'project.vec.json')).toBe(false)
    expect(calls).toEqual([])
  })

  it('reports failure when the SVG carries no drawable artwork', () => {
    const { e, calls } = makeEngine(false)
    expect(openSvgText(e, '<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(false)
    // The page was already reset by then, but nothing was framed or named:
    // the caller surfaces this as an error rather than a successful open.
    expect(calls).toEqual(['newDocument 1920x1080', 'importSVGText Open SVG'])
  })

  it('keeps the name inside the 80-character budget and never empty', () => {
    const { e, name } = makeEngine()
    openSvgText(e, SVG, 'x'.repeat(200))
    expect(name()).toHaveLength(80)
    const second = makeEngine()
    openSvgText(second.e, SVG, '.svg')
    expect(second.name()).toBe('SVG')
  })
})
