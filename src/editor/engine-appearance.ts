/**
 * Appearance domain (C1: seventh slice out of engine.ts).
 *
 * Delegation target for multi-appearance, global colors and spot colors:
 * each function takes the engine as an explicit first argument and
 * otherwise runs the historical method body unchanged. The EditorEngine
 * import is type-only, so the runtime dependency flows one way
 * (engine → engine-appearance). The private `gradientFillForItem`
 * helper moves along as a module function since all of its callers live
 * here or call back through the engine facade.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import { createDefaultStyle } from './store'
import { linearGradientEndpoints, normalizeAngleDeg } from './geometry'
import type { AppearanceFill, AppearanceState, AppearanceStroke, StyleState } from './types'

/**
 * Coerce a stored paint for bulk `item.set()`: the bulk path stores color
 * values verbatim, and Paper later crashes clearing `_canvasStyle` on a
 * stale string (`old._canvasStyle = null` in paper-core fields/set) the
 * next time a different color is set. Direct `item.fillColor = str`
 * assignment converts safely, so only bulk sets need this guard.
 */
export function paperColorFor(scope: paper.PaperScope, paint: unknown): paper.Color | null {
  if (paint === null || paint === undefined) return null
  if (typeof paint !== 'string') return paint as paper.Color
  try {
    return new scope.Color(paint)
  } catch {
    return null
  }
}

export function createDefaultAppearance(e: EditorEngine): AppearanceState {
  return {
    fills: [{
      id: e.genId(),
      color: null,
      gradient: null,
      pattern: null,
      fillRule: 'nonzero',
      opacity: 1,
      blendMode: 'source-over',
      visible: true,
    }],
    strokes: [{
      id: e.genId(),
      color: '#000000',
      strokeWidth: 1,
      strokeAlign: 'center',
      lineCap: 'round',
      lineJoin: 'miter',
      miterLimit: 4,
      dashArray: [],
      dashOffset: 0,
      opacity: 1,
      blendMode: 'source-over',
      visible: true,
    }],
    opacity: 1,
    blendMode: 'source-over',
  }
}

/** Read appearance from an item (or create default). */
export function getAppearanceFromItem(e: EditorEngine, item: paper.Item): AppearanceState {
  const data = (item.data as any) ?? {}
  if (data.appearance) {
    return data.appearance as AppearanceState
  }
  // Legacy single-appearance: build from current item paint.
  const style = e.getStyleFromItem(item)
  return {
    fills: [{
      id: e.genId(),
      color: style.fillColor,
      gradient: style.gradient,
      pattern: style.pattern,
      fillRule: style.fillRule,
      opacity: 1,
      blendMode: 'source-over',
      visible: true,
    }],
    strokes: [{
      id: e.genId(),
      color: style.strokeColor,
      strokeWidth: style.strokeWidth,
      strokeAlign: style.strokeAlign,
      lineCap: style.lineCap,
      lineJoin: style.lineJoin,
      miterLimit: style.miterLimit,
      dashArray: style.dashArray,
      dashOffset: style.dashOffset,
      opacity: 1,
      blendMode: 'source-over',
      visible: true,
    }],
    opacity: style.opacity,
    blendMode: style.blendMode,
  }
}

/** Store appearance on an item and apply the bottom-most fill/stroke to Paper. */
export function setAppearanceOnItem(e: EditorEngine, item: paper.Item, appearance: AppearanceState) {
  const data = (item.data as any) ?? {}
  data.appearance = appearance
  item.data = data
  // Apply bottom-most visible fill and stroke to the Paper.js item.
  const fill = appearance.fills.filter((f) => f.visible).pop()
  const stroke = appearance.strokes.filter((s) => s.visible).pop()
  const paperStyle: any = {}
  if (fill) {
    if (fill.gradient) {
      const gf = gradientFillForItem(e, item, { gradient: fill.gradient } as StyleState)
      paperStyle.fillColor = gf ?? paperColorFor(e.scope, fill.color)
    } else if (fill.pattern) {
      // Pattern fills are handled by the pattern group; skip here.
    } else {
      paperStyle.fillColor = paperColorFor(e.scope, fill.color)
    }
    paperStyle.fillRule = fill.fillRule
  } else {
    paperStyle.fillColor = null
  }
  if (stroke && stroke.visible) {
    paperStyle.strokeColor = paperColorFor(e.scope, stroke.color)
    paperStyle.strokeWidth = stroke.strokeWidth
    paperStyle.strokeCap = stroke.lineCap
    paperStyle.strokeJoin = stroke.lineJoin
    paperStyle.miterLimit = stroke.miterLimit
    if (stroke.dashArray.length > 0) paperStyle.dashArray = stroke.dashArray
    paperStyle.dashOffset = stroke.dashOffset
  } else {
    paperStyle.strokeColor = null
  }
  paperStyle.opacity = appearance.opacity
  paperStyle.blendMode = appearance.blendMode
  item.set(paperStyle)
}

export function gradientFillForItem(e: EditorEngine, item: paper.Item, style: StyleState): paper.Color | null {
  const gradient = style.gradient
  if (!gradient || gradient.stops.length === 0) return null
  const scope = e.scope
  const bounds = (item as any).bounds as paper.Rectangle | undefined
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null
  const stops = gradient.stops.map(
    (stop) => new scope.GradientStop(new scope.Color(stop.color), stop.offset)
  )
  // The bundled typings omit the Gradient constructor overloads, so the
  // gradient is assembled through its declared properties instead.
  const paperGradient = new scope.Gradient()
  paperGradient.stops = stops
  paperGradient.radial = gradient.type === 'radial'
  if (gradient.type === 'radial') {
    const center = bounds.center
    const radius = Math.max(bounds.width, bounds.height) / 2
    const edge = new scope.Point(center.x + radius, center.y)
    return new scope.Color(paperGradient, center, edge, center.clone()) as paper.Color
  }
  const angle = normalizeAngleDeg(gradient.angle ?? 0)
  const ends = linearGradientEndpoints(bounds.center.x, bounds.center.y, bounds.width, bounds.height, angle)
  const origin = new scope.Point(ends.x1, ends.y1)
  const destination = new scope.Point(ends.x2, ends.y2)
  return new scope.Color(paperGradient, origin, destination) as paper.Color
}

/** Add a fill layer to an item's appearance. */
export function addAppearanceFill(e: EditorEngine, item: paper.Item, fill?: Partial<AppearanceFill>): AppearanceFill {
  const app = getAppearanceFromItem(e, item)
  const newFill: AppearanceFill = {
    id: e.genId(),
    color: '#ff0000',
    gradient: null,
    pattern: null,
    fillRule: 'nonzero',
    opacity: 1,
    blendMode: 'source-over',
    visible: true,
    ...fill,
  }
  app.fills.push(newFill)
  setAppearanceOnItem(e, item, app)
  return newFill
}

/** Add a stroke layer to an item's appearance. */
export function addAppearanceStroke(e: EditorEngine, item: paper.Item, stroke?: Partial<AppearanceStroke>): AppearanceStroke {
  const app = getAppearanceFromItem(e, item)
  const newStroke: AppearanceStroke = {
    id: e.genId(),
    color: '#000000',
    strokeWidth: 1,
    strokeAlign: 'center',
    lineCap: 'round',
    lineJoin: 'miter',
    miterLimit: 4,
    dashArray: [],
    dashOffset: 0,
    opacity: 1,
    blendMode: 'source-over',
    visible: true,
    ...stroke,
  }
  app.strokes.push(newStroke)
  setAppearanceOnItem(e, item, app)
  return newStroke
}

/** Remove a fill layer by id. */
export function removeAppearanceFill(e: EditorEngine, item: paper.Item, fillId: string) {
  const app = getAppearanceFromItem(e, item)
  app.fills = app.fills.filter((f) => f.id !== fillId)
  if (app.fills.length === 0) {
    app.fills.push({ id: e.genId(), color: null, gradient: null, pattern: null, fillRule: 'nonzero', opacity: 1, blendMode: 'source-over', visible: true })
  }
  setAppearanceOnItem(e, item, app)
}

/** Remove a stroke layer by id. */
export function removeAppearanceStroke(e: EditorEngine, item: paper.Item, strokeId: string) {
  const app = getAppearanceFromItem(e, item)
  app.strokes = app.strokes.filter((s) => s.id !== strokeId)
  if (app.strokes.length === 0) {
    app.strokes.push({ id: e.genId(), color: null, strokeWidth: 1, strokeAlign: 'center', lineCap: 'round', lineJoin: 'miter', miterLimit: 4, dashArray: [], dashOffset: 0, opacity: 1, blendMode: 'source-over', visible: true })
  }
  setAppearanceOnItem(e, item, app)
}

/** Update a fill layer. */
export function updateAppearanceFill(e: EditorEngine, item: paper.Item, fillId: string, patch: Partial<AppearanceFill>) {
  const app = getAppearanceFromItem(e, item)
  const fill = app.fills.find((f) => f.id === fillId)
  if (fill) {
    Object.assign(fill, patch)
    setAppearanceOnItem(e, item, app)
  }
}

/** Update a stroke layer. */
export function updateAppearanceStroke(e: EditorEngine, item: paper.Item, strokeId: string, patch: Partial<AppearanceStroke>) {
  const app = getAppearanceFromItem(e, item)
  const stroke = app.strokes.find((s) => s.id === strokeId)
  if (stroke) {
    Object.assign(stroke, patch)
    setAppearanceOnItem(e, item, app)
  }
}

/** Reorder fill layers (drag-and-drop). */
export function reorderAppearanceFills(e: EditorEngine, item: paper.Item, fromIndex: number, toIndex: number) {
  const app = getAppearanceFromItem(e, item)
  const [moved] = app.fills.splice(fromIndex, 1)
  if (moved) {
    app.fills.splice(toIndex, 0, moved)
    setAppearanceOnItem(e, item, app)
  }
}

/** Reorder stroke layers (drag-and-drop). */
export function reorderAppearanceStrokes(e: EditorEngine, item: paper.Item, fromIndex: number, toIndex: number) {
  const app = getAppearanceFromItem(e, item)
  const [moved] = app.strokes.splice(fromIndex, 1)
  if (moved) {
    app.strokes.splice(toIndex, 0, moved)
    setAppearanceOnItem(e, item, app)
  }
}

/** Paint the unlocked selection with a global color. Returns touched items. */
export function applyGlobalColorToSelection(e: EditorEngine, color: string, toStroke: boolean): number {
  let n = 0
  for (const item of e.getSelection() as any[]) {
    if (item.locked) continue
    if (toStroke) {
      if (item.strokeColor !== undefined) {
        item.strokeColor = color
        n++
      }
    } else if (item.fillColor !== undefined) {
      item.fillColor = color
      n++
    }
  }
  if (n > 0) e.scope.view.update()
  return n
}

/**
 * Reset the unlocked selection to the default appearance. Returns
 * items reset; one history entry.
 */
export function clearAppearance(e: EditorEngine): number {
  const items = e.getSelection().filter((item) => !item.locked && item.parent)
  if (items.length === 0) return 0
  const defaults = createDefaultStyle()
  for (const item of items) {
    e.applyStyleToItem(item, defaults)
    e.refreshItemGradient(item)
  }
  e.pushHistory('Clear Appearance')
  e.scope.view.update()
  return items.length
}

/**
 * Spot-color placeholder names on the selection (first item wins on read;
 * empty strings clear). Names ride on `item.data` so they persist in
 * project JSON; paints still render/export with their RGB preview.
 */
export function getSpotFromSelection(e: EditorEngine): { fill: string | null; stroke: string | null } {
  const first = e.getSelection()[0] as any
  if (!first) return { fill: null, stroke: null }
  const data = (first.data as any) ?? {}
  const clean = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 60) : null
  return { fill: clean(data.spotFill), stroke: clean(data.spotStroke) }
}

/** Stamp spot names onto every selected top-level item (one history entry). */
export function setSpotForSelection(e: EditorEngine, fill: string | null, stroke: string | null): void {
  const items = e.getSelection().filter((i) => !i.locked && i.parent)
  if (items.length === 0) return
  const clean = (v: string | null): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 60) : null
  const nextFill = clean(fill)
  const nextStroke = clean(stroke)
  for (const item of items) {
    const data = (item.data as any) ?? ((item.data as any) = {})
    if (nextFill) data.spotFill = nextFill
    else delete data.spotFill
    if (nextStroke) data.spotStroke = nextStroke
    else delete data.spotStroke
  }
  e.pushHistory('Spot Color')
  e.scope.view.update()
}

/**
 * Load the first selected item's appearance into the store defaults
 * (future shapes; the document is untouched, so no history). Returns
 * false with an empty selection.
 */
export function setDefaultsFromSelection(e: EditorEngine): boolean {
  const first = e.getSelection()[0]
  if (!first) return false
  e.store.updateStyle({ ...e.getStyleFromItem(first) })
  e.showStatus('Defaults loaded from selection')
  return true
}
