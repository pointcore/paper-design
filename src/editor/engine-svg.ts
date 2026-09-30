/**
 * SVG document import domain (File > Open on an .svg).
 *
 * Split out of engine.ts like the other engine-* domains: the function takes
 * the engine as an explicit first argument so the runtime dependency flows
 * one way (engine → engine-svg), which also makes it testable against a stub.
 */
import type { EditorEngine } from './engine'

/**
 * Open an SVG file as a new document, replacing the current one.
 *
 * Distinct from importSVGText, which drops artwork into the document that is
 * already open: File > Open is the user saying "this is the file now", so
 * the page starts empty and the imported art is the whole story. The page is
 * fitted to the artwork afterwards rather than read from the file's
 * width/height, because plenty of exporters write only a viewBox and art
 * that declared no page would otherwise arrive marooned in a corner of a
 * 1920x1080 sheet.
 *
 * Returns false (leaving the current document untouched) when the text is
 * not an SVG or carries no drawable artwork.
 */
export function openSvgText(e: EditorEngine, svgText: string, fileName = 'SVG'): boolean {
  // Validate before touching the document: a file that is not an SVG at all
  // must not replace the open document with an empty page.
  if (!/<svg[\s>]/i.test(svgText.slice(0, 4096))) return false

  e.newDocument(1920, 1080)
  if (!e.importSVGText(svgText, 'Open SVG')) return false
  // Padding 0: the artboard becomes exactly the artwork, which is what a
  // drawing that declared no page wants to see.
  e.fitArtboardToArtwork(e.store.activeArtboardId, 0)
  e.store.setDocumentName((fileName || 'SVG').replace(/\.svg$/i, '').slice(0, 80) || 'SVG')
  e.zoomToArtboard()
  return true
}
