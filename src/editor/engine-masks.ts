/**
 * Opacity-mask domain (C1: slice out of engine.ts).
 *
 * Delegation target for luminance-mask state and preview: each function
 * takes the engine as an explicit first argument and otherwise runs the
 * historical method body unchanged. The EditorEngine import is
 * type-only, so the runtime dependency flows one way
 * (engine → engine-masks). The private preview/default helpers move
 * along as module functions since all of their callers live here.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import type { OpacityMaskState } from './types'
import { isClipGroup } from './engine-layers'
import { cssOrNull, releasePatternGroup } from './engine-patterns'

/** How a mask made of a given item composites on the canvas. */
type MaskComposite = 'shape' | 'shapes' | 'gradient' | 'pattern' | 'raster'

/**
 * The mask group an item belongs to, whether the caller hands over the group,
 * the content inside it, or nothing masked at all.
 */
export function opacityMaskGroup(e: EditorEngine, item: paper.Item | null): paper.Group | null {
  if (!item) return null
  if (item instanceof e.scope.Group && (item.data as any)?.isOpacityMaskGroup) {
    return item as paper.Group
  }
  const parent = item.parent
  if (parent instanceof e.scope.Group && (parent.data as any)?.isOpacityMaskGroup) {
    return parent as paper.Group
  }
  return null
}

/** The clip shape inside a mask group — the geometry the mask composites as. */
function maskShapeOf(group: paper.Group): paper.Item | null {
  return ((group.children ?? []) as paper.Item[])
    .find((k) => (k.data as any)?.isOpacityMaskShape) ?? null
}

/** The masked content inside a mask group. */
export function maskContentOf(group: paper.Group): paper.Item | null {
  return ((group.children ?? []) as paper.Item[])
    .find((k) => (k.data as any)?.isOpacityMaskContent) ?? null
}

export function getOpacityMask(e: EditorEngine, item: paper.Item): OpacityMaskState | null {
  const direct = ((item.data as any) ?? {}).opacityMask ?? null
  if (direct) return direct
  // The masked content carries the state, and a group selection resolves to
  // its content, so the panel does not have to know which one it holds.
  const group = opacityMaskGroup(e, item)
  if (!group) return null
  const content = maskContentOf(group)
  return (((content?.data as any) ?? {}).opacityMask ?? null)
}

/** Create a default opacity mask state. */
function createDefaultOpacityMask(): OpacityMaskState {
  return {
    enabled: true,
    invert: false,
    contentJson: null,
    bounds: null,
  }
}

export { createDefaultOpacityMask }

/**
 * Apply an opacity mask to an item.
 *
 * The mask source is *consumed*: it becomes the group's clip shape, exactly
 * as "Make Opacity Mask" consumes the top object in Illustrator and CorelDRAW.
 * Leaving the source in the document is not a cosmetic slip — it paints over
 * the content it is supposed to be masking.
 */
export function applyOpacityMask(e: EditorEngine, target: paper.Item, maskContent: paper.Item | null): void {
  const data = (target.data as any) ?? {}
  if (!maskContent) {
    // Remove mask.
    delete data.opacityMask
    target.data = data
    releaseOpacityMaskGroup(e, target)
    return
  }

  // Serialize the mask content for storage.
  const contentJson = maskContent.exportJSON({ asString: true })
  const bounds = maskContent.bounds ? {
    x: maskContent.bounds.x,
    y: maskContent.bounds.y,
    width: maskContent.bounds.width,
    height: maskContent.bounds.height,
  } : null

  const maskState: OpacityMaskState = {
    enabled: true,
    invert: false,
    contentJson,
    bounds,
  }
  data.opacityMask = maskState
  target.data = data

  // For live preview: wrap in a group with the mask applied via alpha.
  // Composite for real: the group is the mask, not a preview of one.
  applyOpacityMaskGroup(e, target, maskContent)
}

/**
 * Live composition of the opacity mask on the canvas.
 *
 * The arrangement is the one the clipping-mask feature already ships and
 * proves: a group whose first child is the mask shape with `clipMask = true`
 * and *no paint of its own*, followed by the masked content. Paper clips the
 * content to the mask's geometry, so:
 *
 * - the canvas composites for real instead of showing the old preview, which
 *   drew a translucent white copy of the mask *over* the artwork and
 *   therefore hid the very thing the mask was supposed to reveal;
 * - the mask's own paint is irrelevant, because the clip is geometric, so
 *   nothing veils the page around the masked content;
 * - canvas and export agree without any export-side rewriting: paper already
 *   emits the clip mask as an SVG `<clipPath>` and points the artwork at it.
 *
 * What this still is not: a *luminance* mask. Paper has no primitive that
 * composites an image's luminance into a path's alpha, so a mask made of a
 * gradient, a photo or several tones composites as its silhouette, in the
 * export as well. `maskCompositeNote` is what the panel says about it.
 */
function applyOpacityMaskGroup(e: EditorEngine, target: paper.Item, maskContent: paper.Item): void {
  const scope = e.scope
  const parent = target.parent ?? e.getActiveLayer()
  const at = parent.children.indexOf(target)

  const group = new scope.Group({ insert: false }) as paper.Group
  ;(group as any).data = {
    isOpacityMaskGroup: true,
    id: e.genId(),
    isUserItem: true,
    // What the mask composites as has to be decided here: the clip shape
    // loses its paint two lines down, and that paint (a gradient, a raster's
    // tones) is the only evidence of what the mask was made of.
    maskComposite: maskCompositeKind(scope, maskContent),
  }

  // The mask shape: geometry only. Its paint is dropped, which is what lets
  // the clip work without drawing anything of its own.
  const maskShape = maskContent.clone({ insert: false }) as paper.Item
  const maskAny = maskShape as any
  maskAny.data = {
    isOpacityMaskShape: true,
    // The clip shape is not artwork: it must stay out of the layer panel and
    // out of any artwork selection, or the user would grab the mask by
    // accident.
    isUserItem: false,
  }
  maskAny.selected = false
  if (maskAny.fillColor !== undefined) maskAny.fillColor = null
  if (maskAny.strokeColor !== undefined) maskAny.strokeColor = null
  ;(maskShape as any).clipMask = true

  // The masked content, cloned from the item the mask was applied to.
  const content = target.clone({ insert: false }) as paper.Item
  const contentAny = content as any
  contentAny.data = {
    ...(contentAny.data ?? {}),
    isOpacityMaskContent: true,
  }
  contentAny.selected = false

  // Mask first, then the content: paper clips the group's other children to
  // the clip mask.
  group.addChild(maskShape)
  group.addChild(content)

  parent.insertChild(Math.min(at, parent.children.length), group)
  target.remove()
  // The mask source is consumed: it is now the group's clip shape. Left in the
  // document it would paint over the content it is meant to mask.
  if (maskContent.parent && maskContent !== target) maskContent.remove()

  const groupData = (group as any).data
  groupData.maskedItemId = (content as any).data?.id

  // The masked item is a clone now: leave the selection on the live one, or
  // the panel would keep a reference to an item that is no longer in the
  // document.
  content.selected = true
  e.syncSelectionToStore()
  e.scope.view.update()
}

/**
 * Undo a mask group: the masked content comes back out, the clip shape goes.
 *
 * `item` may be the group itself or the content inside it, because the panel
 * hands over whatever the user selected.
 */
function releaseOpacityMaskGroup(e: EditorEngine, item: paper.Item): void {
  const group = opacityMaskGroup(e, item)
  if (!group) return
  const parent = group.parent ?? e.getActiveLayer()
  const at = parent.children.indexOf(group)
  const kids = group.children.slice() as paper.Item[]
  const content = maskContentOf(group)
  for (const child of kids) {
    // The clip shape is not artwork: it goes with the group.
    if (child === content) {
      parent.insertChild(Math.min(at, parent.children.length), child)
    }
  }
  group.remove()
  if (content) {
    // The item is artwork again: leaving the mask markers on it would let a
    // later lookup mistake it for a masked one.
    const data = (content.data as any) ?? {}
    delete data.isOpacityMaskContent
    delete data.opacityMask
    content.data = data
    content.selected = true
    e.syncSelectionToStore()
  }
}

/**
 * What the mask composites as, in words the panel can show.
 *
 * The distinction matters to anyone handing files to a print shop: a
 * silhouette mask composites identically on canvas and in SVG, a luminance
 * mask composites as its silhouette here and would need a raster pipeline to
 * composite for real.
 *
 * `null` when the item is not masked, so the panel can show no note at all
 * rather than a claim about nothing.
 */
export function maskCompositeNote(e: EditorEngine, item: paper.Item | null): string | null {
  const group = opacityMaskGroup(e, item)
  if (!group) return null
  const kind = ((group.data as any)?.maskComposite ?? 'shape') as MaskComposite
  if (kind === 'raster') {
    return 'Composites as the photo silhouette — tonal masks need a raster pipeline'
  }
  if (kind === 'gradient') {
    return 'Composites as the gradient silhouette — tonal masks need a raster pipeline'
  }
  if (kind === 'shapes') {
    return 'Composites as the union of the mask shapes — only the shape counts, not its tones'
  }
  return 'Composites as the shape silhouette'
}

/**
 * What a mask made of this item can composite as.
 *
 * A flat shape composites as its own outline, several shapes as their union,
 * and anything tonal (a gradient, a photo) as its outline too — the tones
 * cannot be composited without a raster pipeline, so the distinction has to be
 * recorded before the shape is reduced to geometry.
 */
function maskCompositeKind(scope: typeof paper, maskContent: paper.Item): MaskComposite {
  if (maskContent instanceof scope.Raster) return 'raster'
  if ((maskContent as any).fillColor?.gradient) return 'gradient'
  if ((maskContent as any).fillColor?.pattern) return 'pattern'
  const kids = (maskContent as any).children as paper.Item[] | undefined
  if (kids && kids.length > 1) return 'shapes'
  return 'shape'
}

/** Remove opacity mask from an item. */
export function removeOpacityMask(e: EditorEngine, item: paper.Item): void {
  applyOpacityMask(e, item, null)
}

/**
 * Enable or disable the mask.
 *
 * Turning the mask off is turning the clip off: the shape has no paint of its
 * own, so with `clipMask` cleared the group draws the content unmasked and the
 * shape draws nothing. That is why the toggle has to touch the group and not
 * only the stored flag.
 */
export function toggleOpacityMask(e: EditorEngine, item: paper.Item, enabled: boolean): void {
  const group = opacityMaskGroup(e, item)
  const shape = group ? maskShapeOf(group) : null
  if (shape) (shape as any).clipMask = enabled
  for (const holder of [item, group ? maskContentOf(group) : null]) {
    if (!holder) continue
    const data = (holder.data as any) ?? {}
    const mask = data.opacityMask as OpacityMaskState | undefined
    if (mask) {
      mask.enabled = enabled
      holder.data = data
    }
  }
  e.scope.view.update()
}

/**
 * Invert the mask.
 *
 * There is nothing to invert: the mask composites as geometry, and
 * "everything except this shape" is not expressible as a clip. The flag is
 * kept for file round-trips, so a mask that arrives inverted from an AI or
 * CDR file keeps its intent instead of silently rendering as the opposite of
 * what it says.
 */
export function toggleOpacityMaskInvert(e: EditorEngine, item: paper.Item, invert: boolean): void {
  const data = (item.data as any) ?? {}
  const mask = data.opacityMask as OpacityMaskState | undefined
  if (mask) {
    mask.invert = invert
    item.data = data
  }
}

export function makeClippingMask(e: EditorEngine): boolean {
  const scope = e.scope
  const items = e.getSelection().filter((item) => !item.locked && item.parent)
  if (items.length < 2) return false
  const ordered = items
    .slice()
    .sort((a, b) => (a.isBelow(b) ? -1 : a.isAbove(b) ? 1 : 0))
  const mask = ordered[ordered.length - 1] as paper.PathItem
  if (!(mask instanceof scope.Path) && !(mask instanceof scope.CompoundPath)) return false
  const content = ordered.slice(0, -1)
  const parent = mask.parent ?? e.getActiveLayer()
  const rawAt = parent.children.indexOf(mask)
  const at = rawAt < 0 ? parent.children.length : rawAt

  const maskAny = mask as any
  maskAny.data.maskPaint = {
    fill: cssOrNull(maskAny.fillColor),
    stroke: cssOrNull(maskAny.strokeColor),
    width: Number(maskAny.strokeWidth) || 0,
  }

  const group = new scope.Group({ insert: false }) as paper.Group
  group.addChild(mask)
  for (const node of content) group.addChild(node)
  // The flag only takes on grouped paths: set it after inserting.
  mask.clipMask = true
  if (maskAny.fillColor !== undefined) maskAny.fillColor = null
  if (maskAny.strokeColor !== undefined) maskAny.strokeColor = null
  parent.insertChild(Math.min(at, parent.children.length), group)
  group.data.id = e.genId()
  group.data.isUserItem = true
  e.clearSelection()
  group.selected = true
  e.syncSelectionToStore()
  e.pushHistory('Make Clipping Mask')
  e.scope.view.update()
  return true
}

/**
 * Release selected clipping groups: mask paints restore, children keep
 * their stacking slots and the group dissolves. Pattern-fill groups take
 * the pattern path instead (tiles are dropped, the base path restores).
 */
export function releaseClippingMask(e: EditorEngine): boolean {
  const scope = e.scope
  const groups = e.getSelection().filter(
    (item) =>
      !item.locked && item.parent && item instanceof scope.Group && isClipGroup(item)
  ) as paper.Group[]
  if (groups.length === 0) return false
  const released: paper.Item[] = []
  let releasedPattern = false
  for (const group of groups) {
    if (e.isPatternGroup(group)) {
      const base = releasePatternGroup(e, group)
      if (base) released.push(base)
      releasedPattern = true
      continue
    }
    const parent = group.parent ?? e.getActiveLayer()
    let at = parent.children.indexOf(group)
    if (at < 0) at = parent.children.length
    for (const child of group.children.slice()) {
      const node = child as any
      if (node.clipMask) {
        node.clipMask = false
        const paint = node.data?.maskPaint as
          | { fill: string | null; stroke: string | null; width: number }
          | undefined
        if (paint) {
          if (node.fillColor !== undefined) node.fillColor = paint.fill
          if (node.strokeColor !== undefined) node.strokeColor = paint.stroke
          if (node.strokeWidth !== undefined && Number.isFinite(paint.width)) {
            node.strokeWidth = paint.width
          }
        }
        if (node.data) delete node.data.maskPaint
      }
      parent.insertChild(Math.min(at, parent.children.length), node)
      at++
      released.push(node)
    }
    group.remove()
  }
  e.clearSelection()
  released.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  if (releasedPattern) e.store.updateStyle({ pattern: null })
  e.pushHistory('Release Clipping Mask')
  e.scope.view.update()
  return true
}
