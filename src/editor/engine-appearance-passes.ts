/**
 * Multi-appearance rendering: the paint passes behind a stacked item.
 *
 * An item carries an appearance stack (`data.appearance`: fills and strokes,
 * bottom first). Paper paints one item once, so a stack of three fills has
 * always rendered as whichever single fill reached paper last. This module
 * closes that gap without a render-pipeline takeover:
 *
 * - The **master** keeps painting the *top* visible fill and stroke, exactly
 *   as before. That matters: with opaque fills the top one hides the rest, so
 *   a stacked item that looks the same today still looks the same, and the
 *   difference only appears where a lower pass is genuinely visible (a
 *   transparent top fill, a blend mode, a missing top fill).
 * - Each **lower** visible fill and stroke becomes a real pass item: a clone
 *   of the master's geometry inserted directly below it, carrying that
 *   entry's own paint, opacity and blend mode.
 *
 * Passes are `locked` and carry no id, which is the editor's existing
 * convention for "not a thing the user can grab": selection, the tools, the
 * object tree and the transform code all skip locked items already. They are
 * *not* skipped by export, which is the point — a stacked item now exports
 * every pass.
 *
 * The sync is signature-driven and hooked into the view update, so a pass can
 * never be a frame behind its master: any geometry or appearance change
 * rebuilds the passes before the next paint.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import {
  fillAlphaOf,
  paperBlendMode,
  paperColorFor,
  gradientFillForItem,
  strokeAlphaOf,
  wantsSeparateStrokePass,
} from './engine-appearance'
import type { AppearanceFill, AppearanceState, AppearanceStroke, StyleState } from './types'

/** True for a generated pass item, so traversals can skip it by name. */
export function isAppearancePass(item: paper.Item | null | undefined): boolean {
  return !!(item && (item.data as any)?.isAppearancePass)
}

/** One master and the passes currently standing in for its lower stack. */
interface PassRecord {
  master: paper.Item
  passes: paper.Item[]
  signature: string
}

/** Registry state, hung off the engine so it survives nothing but the session. */
interface PassRegistry {
  records: Map<string, PassRecord>
  hooked: boolean
}

const REGISTRY = new WeakMap<EditorEngine, PassRegistry>()

function registryFor(e: EditorEngine): PassRegistry {
  let registry = REGISTRY.get(e)
  if (!registry) {
    registry = { records: new Map(), hooked: false }
    REGISTRY.set(e, registry)
  }
  return registry
}

/** The visible entries of a stack, bottom first, with holes dropped. */
function visibleFills(appearance: AppearanceState): AppearanceFill[] {
  return appearance.fills.filter((f) => f.visible)
}

function visibleStrokes(appearance: AppearanceState): AppearanceStroke[] {
  return appearance.strokes.filter((s) => s.visible)
}

/**
 * A cheap fingerprint of the geometry a pass has to copy: segment count plus
 * every point and handle, rounded. Rounding matters — the same drag can move
 * a point by a float epsilon, and rebuilding the passes on that would make
 * every frame pay for nothing.
 */
function geometrySignature(item: paper.Item): string {
  const anyItem = item as any
  if (anyItem.segments) {
    const parts: string[] = [String(anyItem.segments.length), anyItem.closed ? 'c' : 'o']
    for (const segment of anyItem.segments as Array<{ point: any; handleIn: any; handleOut: any }>) {
      parts.push(
        `${Math.round(segment.point.x * 100)},${Math.round(segment.point.y * 100)}`,
        `${Math.round(segment.handleIn.x * 100)},${Math.round(segment.handleIn.y * 100)}`,
        `${Math.round(segment.handleOut.x * 100)},${Math.round(segment.handleOut.y * 100)}`
      )
    }
    return parts.join(';')
  }
  if (anyItem.children) {
    // A group: the passes are only built for leaves today, but a future
    // stacked group still needs a signature that moves when it does.
    return anyItem.children.map((child: paper.Item) => geometrySignature(child)).join('|')
  }
  const bounds = anyItem.bounds
  return `b${Math.round(bounds.x * 100)},${Math.round(bounds.y * 100)},${Math.round(bounds.width * 100)},${Math.round(bounds.height * 100)}`
}

/** A fingerprint of the stack itself, so a paint change rebuilds the passes. */
function appearanceSignature(appearance: AppearanceState): string {
  return visibleFills(appearance)
    .map((f) => `f${f.id}:${f.color ?? ''}:${f.gradient ? JSON.stringify(f.gradient) : ''}:${f.fillRule}:${f.opacity}:${f.blendMode}`)
    .join(',') +
    '|' +
    visibleStrokes(appearance)
      .map(
        (s) =>
          `s${s.id}:${s.color ?? ''}:${s.strokeWidth}:${s.opacity}:${s.blendMode}:${s.lineCap}:${s.lineJoin}:${s.dashArray.join('.')}`
      )
      .join(',')
}

/** Does this item need passes at all? */
function needsPasses(appearance: AppearanceState | null | undefined): boolean {
  if (!appearance) return false
  return visibleFills(appearance).length > 1 || visibleStrokes(appearance).length > 1
}

/** Remove the passes belonging to one master (or to every master). */
export function dropAppearancePasses(e: EditorEngine, masterId?: string): void {
  const registry = registryFor(e)
  const ids = masterId ? [masterId] : [...registry.records.keys()]
  for (const id of ids) {
    const record = registry.records.get(id)
    if (!record) continue
    for (const pass of record.passes) {
      try {
        pass.remove()
      } catch {
        // Already gone with a layer or a document restore.
      }
    }
    registry.records.delete(id)
  }
  e.scope.view.update()
}

/**
 * Rebuild every pass that is out of date.
 *
 * Safe to call as often as the view updates: a master whose geometry and
 * appearance both match its record is skipped, so the steady-state cost is a
 * fingerprint per stacked item and nothing at all for a document with no
 * stacks. Deliberately does *not* call `view.update()`: this runs from inside
 * the view-update hook, and repainting from there would recurse.
 */
export function syncAppearancePasses(e: EditorEngine): void {
  const registry = registryFor(e)
  const seen = new Set<string>()

  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer) continue
    for (const child of [...layer.children] as paper.Item[]) {
      const appearance = (child.data as any)?.appearance as AppearanceState | undefined
      const id = String((child.data as any)?.id ?? '')
      if (!id || !needsPasses(appearance)) {
        // A stack that shrank back to one paint has nothing to stand in for.
        if (id && registry.records.has(id)) {
          const record = registry.records.get(id)!
          for (const pass of record.passes) {
            try {
              pass.remove()
            } catch {
              /* already gone */
            }
          }
          registry.records.delete(id)
        }
        continue
      }
      seen.add(id)
      const signature = `${geometrySignature(child)}#${appearanceSignature(appearance!)}`
      const existing = registry.records.get(id)
      if (
        existing &&
        existing.signature === signature &&
        // A history restore replaces the paper objects: the record then points
        // at detached items, and the passes in the tree are orphans. Comparing
        // the master object identity catches that without the history module
        // having to know anything about this registry.
        existing.master === child &&
        existing.passes.every((pass) => !!pass.parent)
      ) {
        continue
      }
      if (existing) {
        for (const pass of existing.passes) {
          try {
            pass.remove()
          } catch {
            /* already gone */
          }
        }
      }
      registry.records.set(id, {
        master: child,
        passes: buildPasses(e, child, appearance!),
        signature,
      })
    }
  }

  // Records whose master is no longer stacked, or no longer on the tree at
  // all. The passes are removed either way: a deleted master would otherwise
  // leave its lower fills behind on the canvas as an orphan nobody owns.
  for (const [id, record] of [...registry.records.entries()]) {
    if (seen.has(id)) continue
    for (const pass of record.passes) {
      try {
        pass.remove()
      } catch {
        /* already gone with a layer or a document restore */
      }
    }
    registry.records.delete(id)
  }
}

/** How many pass items are currently generated (for tests and diagnostics). */
export function appearancePassCount(e: EditorEngine): number {
  let total = 0
  for (const record of registryFor(e).records.values()) total += record.passes.length
  return total
}

/**
 * Build the pass items for one master, ordered bottom first, and insert each
 * directly below the master so the paint order is fills then strokes.
 */
function buildPasses(e: EditorEngine, master: paper.Item, appearance: AppearanceState): paper.Item[] {
  const parent = master.parent as { insertChild?: (index: number, child: paper.Item) => void; children: paper.Item[] } | null
  if (!parent || !parent.insertChild || !parent.children) return []

  const masterId = String((master.data as any)?.id ?? '')
  const fills = visibleFills(appearance)
  const strokes = visibleStrokes(appearance)
  const appearanceAlpha = Number.isFinite(appearance.opacity) ? appearance.opacity : 1
  // The master paints the top fill, and the top stroke too unless the two
  // want different alphas (one item carries one alpha).
  const strokePushedDown = wantsSeparateStrokePass(appearance)

  // Everything the master does not paint: the lower fills, then the strokes
  // it could not carry.
  const specs: Array<{ kind: 'fill' | 'stroke'; entry: AppearanceFill | AppearanceStroke }> = [
    ...fills.slice(0, -1).map((entry) => ({ kind: 'fill' as const, entry })),
    ...strokes
      .filter((_, i) => i < strokes.length - 1 || strokePushedDown)
      .map((entry) => ({ kind: 'stroke' as const, entry })),
  ]
  if (specs.length === 0) return []

  const index = parent.children.indexOf(master as paper.Item)
  if (index < 0) return []

  const created: paper.Item[] = []
  // Inserting at the master's own index pushes the master up, so building the
  // stack from the *top* entry down leaves the bottom entry lowest.
  for (let i = specs.length - 1; i >= 0; i--) {
    const spec = specs[i]
    const pass = (master as any).clone({ insert: false }) as paper.Item
    const anyPass = pass as any
    anyPass.data = {
      isAppearancePass: masterId,
      // No id: identity belongs to the master, and an id here would let the
      // pass be selected, styled and snapshotted as its own object.
      isUserItem: false,
    }
    anyPass.selected = false
    // Locked is the editor's existing "the user cannot grab this" marker, and
    // it is what selection, the tools and the object tree already skip.
    anyPass.locked = true
    anyPass.fillColor = null
    anyPass.strokeColor = null
    anyPass.blendMode = 'normal'
    // Item opacity, not fillOpacity/strokeOpacity: paper's canvas renderer
    // ignores the per-paint ones, and the SVG exporter writes this same
    // attribute, so one mechanism covers canvas and export.
    anyPass.opacity = 1
    if (spec.kind === 'fill') {
      const fill = spec.entry as AppearanceFill
      if (fill.gradient) {
        anyPass.fillColor = gradientFillForItem(e, pass, { gradient: fill.gradient } as StyleState)
      } else if (fill.pattern) {
        // Pattern fills own a clipped tile group; a pass cannot reproduce one,
        // so the lower pattern fill is left out rather than faked.
        anyPass.remove()
        continue
      } else {
        anyPass.fillColor = paperColorFor(e.scope, fill.color)
      }
      anyPass.fillRule = fill.fillRule
      anyPass.opacity = appearanceAlpha * fillAlphaOf(fill)
      anyPass.blendMode = paperBlendMode(fill.blendMode)
    } else {
      const stroke = spec.entry as AppearanceStroke
      anyPass.strokeColor = paperColorFor(e.scope, stroke.color)
      anyPass.strokeWidth = stroke.strokeWidth
      anyPass.strokeCap = stroke.lineCap
      anyPass.strokeJoin = stroke.lineJoin
      anyPass.miterLimit = stroke.miterLimit
      if (stroke.dashArray.length > 0) anyPass.dashArray = [...stroke.dashArray]
      anyPass.dashOffset = stroke.dashOffset
      anyPass.opacity = appearanceAlpha * strokeAlphaOf(stroke)
      anyPass.blendMode = paperBlendMode(stroke.blendMode)
      // A stroke pass is a stroke only: without this it would repaint the
      // fill under the stroke, which changes the composite.
      anyPass.fillColor = null
    }
    parent.insertChild(index, pass)
    created.unshift(pass)
  }
  return created
}

/**
 * Hook the sync into the view's update, once per engine.
 *
 * Every mutation in this editor ends in a `view.update()` (that is what makes
 * the canvas repaint), so hooking there is the one place that guarantees a
 * pass is never painted a frame behind its master — including during a live
 * drag, which pushes no history until the gesture ends. The sync runs
 * *before* the draw so the passes are in the very frame the master changed.
 */
export function installAppearancePassHook(e: EditorEngine): void {
  const registry = registryFor(e)
  if (registry.hooked) return
  const view = e.scope.view as unknown as { update: () => void }
  if (!view || typeof view.update !== 'function') return
  const original = view.update.bind(view)
  view.update = () => {
    try {
      syncAppearancePasses(e)
    } catch {
      // A pass that cannot be built must not take the canvas down with it;
      // the item simply renders as its top paint, which is the old behavior.
    }
    original()
  }
  registry.hooked = true
}
