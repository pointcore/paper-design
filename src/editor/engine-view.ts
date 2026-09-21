/**
 * View-transform domain (C1: ninth slice out of engine.ts).
 *
 * Delegation target for pan/zoom/navigation: each function takes the
 * engine as an explicit first argument and otherwise runs the historical
 * method body unchanged. The EditorEngine import is type-only, so the
 * runtime dependency flows one way (engine → engine-view). View
 * infrastructure that owns cached state (`syncViewBookkeeping`) stays on
 * the engine; everything here calls back through public members.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import * as arrange from './engine-arrange'

/** Center the view on a document point (artboard activation). */
export function panViewTo(e: EditorEngine, point: paper.Point): void {
  e.scope.view.center = point.clone()
  e.syncViewBookkeeping()
  e.refreshGrid()
  e.scope.view.update()
  e.emitViewChange()
}

export function panBy(e: EditorEngine, dx: number, dy: number) {
  // dx/dy arrive in document units (hand tool + middle-drag both diff
  // viewToProject points). The view center lives in the same space, so
  // shift it 1:1 — dividing by zoom again would shrink post-zoom pans
  // toward zero and feel like a freeze when zoomed in.
  const v = e.scope.view
  v.center = v.center.subtract(new e.scope.Point(dx, dy))
  e.syncViewBookkeeping()
  e.refreshGrid()
  e.emitViewChange()
}

/**
 * Zoom by a factor around the screen point (canvasX, canvasY) given in
 * canvas pixel coordinates. When no reference point is provided the view
 * zooms about its center. The resulting zoom is synced back to the store
 * so the status-bar percentage stays accurate.
 */
export function zoomAt(e: EditorEngine, scale: number, canvasX?: number, canvasY?: number) {
  const v = e.scope.view
  const oldZoom = v.zoom || 1
  const newZoom = Math.max(0.01, Math.min(64, oldZoom * scale))
  if (newZoom === oldZoom) return

  const W = e.canvas.width
  const H = e.canvas.height
  const zoomAtCenter = typeof canvasX !== 'number' || typeof canvasY !== 'number'

  // Document point that sits under the reference screen point (before zooming).
  let anchorX = v.center.x
  let anchorY = v.center.y
  if (!zoomAtCenter) {
    anchorX = v.center.x + (canvasX - W / 2) / oldZoom
    anchorY = v.center.y + (canvasY - H / 2) / oldZoom
  }

  v.zoom = newZoom
  if (!zoomAtCenter) {
    // Keep the anchor's document point fixed on screen while zooming.
    v.center = new e.scope.Point(
      anchorX - (canvasX - W / 2) / newZoom,
      anchorY - (canvasY - H / 2) / newZoom
    )
  }

  e.zoom = newZoom
  // Mirror the authoritative Paper transform (bounds are already in
  // document units — no extra division by zoom here).
  e.syncViewBookkeeping()

  v.update()
  e.refreshGrid()
  e.refreshGuideWidths()
  e.store.updateView({ zoom: newZoom })
  e.emitViewChange()
}

/**
 * CDR page navigation: activate the previous (-1) or next (+1) artboard
 * and pan its sheet to the center of the view. Returns false at the end
 * of the board list.
 */
export function navigateArtboards(e: EditorEngine, step: number): boolean {
  const boards = e.store.artboards
  if (boards.length === 0) return false
  const idx = boards.findIndex((b) => b.id === e.store.activeArtboardId)
  const next = (idx < 0 ? 0 : idx + step)
  if (next < 0 || next >= boards.length) return false
  const board = boards[next]
  e.store.setActiveArtboard(board.id)
  e.refreshArtboards()
  panViewTo(e, new e.scope.Point(board.x + board.width / 2, board.y + board.height / 2))
  return true
}

export function fitToContent(e: EditorEngine) {
  fitBounds(e, arrange.unitedBoundsOf(e.getUserItems()))
}

/** Fit the view to the current selection bounds (View menu). */
export function zoomToSelection(e: EditorEngine): void {
  fitBounds(e, arrange.getSelectionBounds(e))
}

/** Fit the view to the active artboard sheet (View menu). */
export function zoomToArtboard(e: EditorEngine): void {
  fitBounds(e, e.getActiveArtboardRect())
}

/** Reset the view zoom to 100% (View menu, Ctrl+1). */
export function zoomToActualSize(e: EditorEngine): void {
  e.zoom = 1
  e.scope.view.zoom = 1
  e.syncViewBookkeeping()
  e.store.updateView({ zoom: 1 })
  e.scope.view.update()
  e.refreshGrid()
  e.emitViewChange()
}

/** Zoom the view to frame bounds with padding (ignores empty bounds). */
function fitBounds(e: EditorEngine, bounds: paper.Rectangle | null): void {
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return
  const padding = 50
  const zoom = Math.min(
    (e.canvas.width - padding * 2) / bounds.width,
    (e.canvas.height - padding * 2) / bounds.height,
    100
  )
  const v = e.scope.view
  v.zoom = zoom
  v.center = bounds.center.clone()
  e.syncViewBookkeeping()
  v.update()
  e.refreshGrid()
  e.refreshGuideWidths()
  e.store.updateView({ zoom: e.zoom })
  e.emitViewChange()
}
