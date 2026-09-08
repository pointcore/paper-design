/**
 * Eyedropper tool controller.
 *
 * Click artwork to pick its appearance into the store defaults (fill
 * including gradients, stroke, dash, opacity and blend; font styling for
 * text). When a selection exists the picked appearance is also painted
 * onto every unlocked non-group member in one history entry. Locked items
 * still share their appearance when clicked.
 */
import { EditorEngine } from '../engine'
import { applyToolCursor } from '../cursors'

export class EyedropperController {
  engine: EditorEngine | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
  }

  activate() {
    if (!this.engine) return
    this.setupTool()
    applyToolCursor(this.engine.canvas, 'eyedropper')
  }

  private setupTool() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    // Remove existing tool if any, then create a fresh tool.
    if (scope.tool) {
      scope.tool.remove()
    }
    // Creating a Tool automatically activates it on the scope.
    new scope.Tool()

    scope.tool.onMouseDown = (event: paper.ToolEvent) => {
      const native = (event as any).event as MouseEvent
      if (native.button !== 0) return
      const picked = this.pickTarget(event.point)
      if (!picked) return
      this.applyEyedropper(picked)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.view.update()
  }

  /** Topmost user artwork under a point (locked items still share). */
  private pickTarget(point: paper.Point): paper.Item | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    const hit = engine.project.hitTest(point, {
      fill: true,
      stroke: true,
      segments: false,
      tolerance: 3 / scope.view.zoom,
    })
    const item = hit?.item
    if (!item) return null
    const data = (item.data as any) ?? {}
    if (data.isChrome || data.isPreview || data.isGuide || data.annotation || data.isArtboard) return null
    if (!this.isUserArtwork(item)) return null
    return item
  }

  /** Whether an item lives under a user layer. */
  private isUserArtwork(item: paper.Item): boolean {
    const engine = this.engine
    if (!engine) return false
    let node: paper.Item | null = item
    while (node && !(node instanceof engine.scope.Layer)) node = node.parent
    return !!node && !!(node.data as any)?.isUserLayer
  }

  /** Load the picked appearance into the defaults and the selection. */
  private applyEyedropper(picked: paper.Item) {
    const engine = this.engine
    if (!engine) return
    const leaf = this.resolveLeaf(picked)
    if (!leaf) return
    const style = engine.getStyleFromItem(leaf)
    engine.store.updateStyle({ ...style })

    if (leaf instanceof engine.scope.PointText && !(leaf.data as any)?.annotation) {
      engine.store.updateCharStyle({
        fontFamily: (leaf.fontFamily as string) || 'Arial',
        fontSize: Number(leaf.fontSize) || 12,
        fontWeight: leaf.fontWeight as string,
        fontStyle: ((leaf as any).fontStyle as 'normal' | 'italic' | 'oblique') ?? 'normal',
      })
      const justification = ((leaf as any).justification as string) ?? 'left'
      engine.store.updateParagraphStyle({
        align: justification === 'center' ? 'center' : justification === 'right' ? 'right' : 'left',
      })
    }

    const scope = engine.scope
    // The engine selection is top-most (a selected group counts as one
    // unit), so descend into groups to reach the paintable leaves, exactly
    // as before when descendants arrived in the raw selection.
    const selection: paper.Item[] = []
    const collect = (item: paper.Item): void => {
      if (item.locked) return
      if (item instanceof scope.Group) {
        for (const child of item.children) collect(child as paper.Item)
        return
      }
      selection.push(item)
    }
    for (const item of engine.getSelection()) collect(item)
    for (const item of selection) {
      // Gradient paints stay on paths; text keeps its solid fill instead
      // of risking an unreadable gradient run.
      if (style.gradient && item instanceof scope.PointText) continue
      engine.applyStyleToItem(item, style)
    }
    if (selection.length > 0) engine.pushHistory('Eyedropper')
    engine.showStatus('Appearance picked')
  }

  /** First style-carrying leaf under an item (itself when it is one). */
  private resolveLeaf(item: paper.Item): paper.Item | null {
    const engine = this.engine
    if (!engine) return null
    const scope = engine.scope
    if (
      item instanceof scope.Path ||
      item instanceof scope.CompoundPath ||
      item instanceof scope.PointText
    ) {
      return item
    }
    const children = (item as any).children as paper.Item[] | undefined
    if (children) {
      for (const child of children) {
        const found = this.resolveLeaf(child)
        if (found) return found
      }
    }
    return null
  }
}
