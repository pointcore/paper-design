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

export function getOpacityMask(e: EditorEngine, item: paper.Item): OpacityMaskState | null {
  void e
  const data = (item.data as any) ?? {}
  return data.opacityMask ?? null
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
 * Apply an opacity mask to an item. The mask content is a Paper.js item
 * whose luminance controls the alpha channel. For live preview, we use
 * a simplified approach: the mask is stored and applied during export.
 */
export function applyOpacityMask(e: EditorEngine, target: paper.Item, maskContent: paper.Item | null): void {
  const data = (target.data as any) ?? {}
  if (!maskContent) {
    // Remove mask.
    delete data.opacityMask
    target.data = data
    // Remove mask group if it exists.
    if (target.parent instanceof e.scope.Group && (target.parent as any).data?.isOpacityMaskGroup) {
      const group = target.parent
      const parent = group.parent ?? e.getActiveLayer()
      const at = parent.children.indexOf(group)
      // Move target out of the group.
      for (const child of group.children.slice()) {
        if (child !== target) {
          parent.insertChild(Math.min(at, parent.children.length), child)
        }
      }
      group.remove()
      target.selected = true
    }
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
  // This is a simplified preview; full mask is applied during SVG export.
  applyOpacityMaskPreview(e, target, maskContent)
}

/**
 * Simplified live preview of opacity mask using Paper.js group compositing.
 * The full mask is applied during SVG/PDF export.
 */
function applyOpacityMaskPreview(e: EditorEngine, target: paper.Item, maskContent: paper.Item): void {
  const scope = e.scope
  const parent = target.parent ?? e.getActiveLayer()
  const at = parent.children.indexOf(target)

  // Create a group to hold the masked content.
  const group = new scope.Group({ insert: false }) as paper.Group
  ;(group as any).data = { isOpacityMaskGroup: true, id: e.genId(), isUserItem: true }

  // Clone the target for the masked version.
  const clone = target.clone({ insert: false }) as paper.Item
  clone.data = { ...clone.data, isOpacityMaskClone: true }

  // Create the mask shape (white fill = opaque, black = transparent).
  const maskClone = maskContent.clone({ insert: false }) as paper.Item
  maskClone.fillColor = new scope.Color(1, 1, 1) // White = opaque
  maskClone.opacity = 0.5 // Semi-transparent for preview
  ;(maskClone as any).data = { isOpacityMaskPreview: true }

  group.addChild(clone)
  group.addChild(maskClone)

  // Replace the original with the group.
  parent.insertChild(Math.min(at, parent.children.length), group)
  target.remove()

  // Store reference for cleanup.
  const groupData = (group as any).data
  groupData.maskedItemId = (clone as any).data?.id

  e.scope.view.update()
}

/** Remove opacity mask from an item. */
export function removeOpacityMask(e: EditorEngine, item: paper.Item): void {
  applyOpacityMask(e, item, null)
}

/** Toggle opacity mask enabled state. */
export function toggleOpacityMask(e: EditorEngine, item: paper.Item, enabled: boolean): void {
  const data = (item.data as any) ?? {}
  const mask = data.opacityMask as OpacityMaskState | undefined
  if (mask) {
    mask.enabled = enabled
    item.data = data
  }
}

/** Toggle opacity mask invert. */
export function toggleOpacityMaskInvert(e: EditorEngine, item: paper.Item, invert: boolean): void {
  const data = (item.data as any) ?? {}
  const mask = data.opacityMask as OpacityMaskState | undefined
  if (mask) {
    mask.invert = invert
    item.data = data
  }
}
