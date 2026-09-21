/**
 * Export domain seed (C1: final thin slice out of engine.ts).
 *
 * Delegation target for selection SVG serialization: takes the engine as
 * an explicit first argument and otherwise runs the historical method
 * body unchanged. The EditorEngine import is type-only, so the runtime
 * dependency flows one way (engine → engine-export). Heavier exporters
 * (raster/PDF/N-up) stay on the engine: they reach private export
 * helpers and the clipboard-adjacent raster cache.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'

/** Serialize unlocked selected user items into a standalone SVG string. */
export function exportSelectionSVG(e: EditorEngine): string | null {
  const items = e.getSelection().filter(
    (item) => (item.data as any)?.isUserItem && !item.locked
  )
  if (items.length === 0) return null
  const bodies = items.map((item) => {
    const exported = item.exportSVG()
    return typeof exported === 'string'
      ? exported
      : new XMLSerializer().serializeToString(exported)
  })
  return `<svg xmlns="http://www.w3.org/2000/svg">${bodies.join('')}</svg>`
}
