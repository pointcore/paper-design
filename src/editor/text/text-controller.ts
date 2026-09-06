/**
 * Text tool controller.
 *
 * A click on empty canvas places a new point text; a click on an existing
 * point text (or a double-click with a select tool) re-enters editing.
 *
 * Editing runs in an HTML textarea overlaid on the canvas at the text's
 * anchor so the browser supplies caret, selection and IME handling. The
 * overlay mirrors the text's typography (family, weight, style, size scaled
 * by the current zoom, color, line height and justification) so it lines up
 * with how paper.js renders the committed text.
 *
 * A session commits on Escape, on a click elsewhere on the canvas, or when
 * the active tool changes. Committing empty content discards a new text and
 * deletes an existing one.
 */
import { EditorEngine } from '../engine'
import type { TextAlign } from '../types'

/**
 * Distance from the overlay's top edge to the first text baseline, as a
 * fraction of the font size. Derived from line-height 1.2 and a ~0.8em
 * ascent: half-leading (0.1em) + ascent (0.8em).
 */
const TOP_TO_BASELINE = 0.9

/** Maps the store's TextAlign onto paper.js justification values. */
const JUSTIFICATIONS: Record<TextAlign, 'left' | 'center' | 'right'> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'left',
}

export class TextController {
  engine: EditorEngine | null = null

  /** Whether a text editing session is currently open. */
  private isEditing = false
  /** Existing item being edited; null when placing a brand-new text. */
  private editingItem: paper.PointText | null = null
  /** Document-space anchor point (baseline of the first line). */
  private anchor: paper.Point | null = null
  /** Item content captured when the editing session started. */
  private originalContent = ''
  /** Overlay textarea used as the editing surface. */
  private overlay: HTMLTextAreaElement | null = null
  /** onViewChange hook chained while editing so the overlay follows zoom. */
  private chainedOnViewChange: (() => void) | null = null
  /** Detaches the store subscription installed in attachEngine. */
  private unsubscribeStore: (() => void) | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
    // Commit any open session when the active tool changes (toolbar click,
    // shortcut, double-click on text with a select tool, ...).
    this.unsubscribeStore = engine.store.$subscribe((_mutation, state) => {
      if (state.tool !== 'type' && this.isEditing) this.commit()
    })
  }

  activate() {
    if (!this.engine) return
    // Safety: never carry an open session across controller activations.
    if (this.isEditing) this.commit()
    this.setupTool()
    this.engine.canvas.style.cursor = 'text'
  }

  // ------------------------------------------------------------------
  // Tool event wiring
  // ------------------------------------------------------------------

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

      // A click outside the overlay ends the current session; the same
      // click does not start a new one.
      if (this.isEditing) {
        this.commit()
        return
      }

      const existing = this.userTextAt(event.point)
      if (existing) {
        this.editItem(existing)
      } else {
        this.startNew(event.point)
      }
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.view.update()
  }

  // ------------------------------------------------------------------
  // Editing sessions
  // ------------------------------------------------------------------

  /** Start an empty editing session for a brand-new text at `point`. */
  private startNew(point: paper.Point) {
    const engine = this.engine
    if (!engine) return
    this.beginSession(null, point, '')
  }

  /**
   * Start editing an existing point text. Used both by a type-tool click
   * and by the double-click shortcut on the select tool.
   */
  editItem(item: paper.PointText) {
    const engine = this.engine
    if (!engine) return
    if (this.isEditing) this.commit()
    this.beginSession(item, item.point.clone(), item.content)
  }

  private beginSession(item: paper.PointText | null, anchor: paper.Point, content: string) {
    const engine = this.engine
    if (!engine) return
    this.isEditing = true
    this.editingItem = item
    this.anchor = anchor
    this.originalContent = content

    if (item) {
      // Hide the rendered item while the overlay mirrors it.
      item.visible = false
    }

    this.buildOverlay(content)
    // Follow view changes (zoom via menu/buttons) while the session is open.
    this.chainedOnViewChange = engine.onViewChange
    engine.onViewChange = () => {
      this.chainedOnViewChange?.()
      this.syncOverlayPosition()
    }

    engine.scope.view.update()
  }

  /**
   * Close the editing session and write the overlay content back into a
   * paper.PointText. Empty content discards a new text / removes the
   * existing one.
   */
  commit() {
    const engine = this.engine
    if (!engine || !this.isEditing) return

    const content = this.overlay ? this.overlay.value : ''
    const item = this.editingItem

    if (item && item.parent) {
      item.visible = true
      if (content.length === 0) {
        item.remove()
        engine.clearSelection()
        engine.pushHistory('Delete Text')
      } else if (content !== this.originalContent) {
        item.content = content
        engine.selectItem(item)
        engine.pushHistory('Edit Text')
      }
    } else if (!item && content.length > 0) {
      this.createTextItem(content)
    }

    this.teardownOverlay()
  }

  /** Build the committed PointText for a brand-new text. */
  private createTextItem(content: string) {
    const engine = this.engine!
    const scope = engine.scope
    const anchor = this.anchor ?? new scope.Point(0, 0)
    const charStyle = engine.store.charStyle
    const justification = JUSTIFICATIONS[engine.store.paragraphStyle.align] ?? 'left'
    const fillColor = engine.store.style.fillColor || '#000000'

    const text = new scope.PointText({
      point: anchor,
      content,
      fontFamily: charStyle.fontFamily,
      fontWeight: charStyle.fontWeight,
      fontStyle: charStyle.fontStyle,
      fontSize: charStyle.fontSize,
      leading: charStyle.fontSize * 1.2,
      justification,
      fillColor,
    }) as paper.PointText

    text.data.id = engine.genId()
    text.data.isUserItem = true
    engine.getActiveLayer().addChild(text)

    engine.selectItem(text)
    engine.pushHistory('Add Text')
  }

  private teardownOverlay() {
    const engine = this.engine
    if (engine && this.chainedOnViewChange) {
      engine.onViewChange = this.chainedOnViewChange
      this.chainedOnViewChange = null
    }
    if (this.overlay) {
      this.overlay.remove()
      this.overlay = null
    }
    this.isEditing = false
    this.editingItem = null
    this.anchor = null
    this.originalContent = ''
    engine?.scope.view.update()
  }

  // ------------------------------------------------------------------
  // Overlay textarea
  // ------------------------------------------------------------------

  /** Typography of the text currently being edited. */
  private sessionTypography() {
    const engine = this.engine!
    if (this.editingItem) {
      const item = this.editingItem
      return {
        fontFamily: item.fontFamily || 'Arial',
        fontWeight: (item.fontWeight as string | number) ?? 'normal',
        fontStyle: ((item as any).fontStyle as string) ?? 'normal',
        fontSize: Number(item.fontSize) || 12,
        color: item.fillColor ? item.fillColor.toCSS(true) : '#000000',
        justification: ((item as any).justification as 'left' | 'center' | 'right') ?? 'left',
      }
    }
    const charStyle = engine.store.charStyle
    return {
      fontFamily: charStyle.fontFamily,
      fontWeight: charStyle.fontWeight,
      fontStyle: charStyle.fontStyle,
      fontSize: charStyle.fontSize,
      color: engine.store.style.fillColor || '#000000',
      justification: JUSTIFICATIONS[engine.store.paragraphStyle.align] ?? 'left',
    }
  }

  private buildOverlay(content: string) {
    const engine = this.engine!
    const container = engine.canvas.parentElement
    if (!container) return

    const overlay = document.createElement('textarea')
    overlay.value = content
    overlay.spellcheck = false
    overlay.setAttribute('wrap', 'off')

    const style = overlay.style
    style.position = 'absolute'
    style.margin = '0'
    style.padding = '0'
    style.border = 'none'
    style.outline = '1px dashed rgba(74, 144, 217, 0.8)'
    style.background = 'transparent'
    style.resize = 'none'
    style.overflow = 'hidden'
    style.whiteSpace = 'pre'
    style.lineHeight = '1.2'
    style.zIndex = '20'
    style.boxShadow = 'none'
    style.minWidth = '24px'

    const type = this.sessionTypography()
    style.fontFamily = typeof type.fontFamily === 'number' ? 'Arial' : type.fontFamily
    style.fontWeight = String(type.fontWeight)
    style.fontStyle = type.fontStyle
    style.color = type.color
    style.caretColor = type.color
    // Keep the text growing from the anchor edge that paper.js will anchor
    // the committed PointText to.
    style.textAlign = type.justification
    if (type.justification === 'center') {
      style.transform = 'translateX(-50%)'
    } else if (type.justification === 'right') {
      style.transform = 'translateX(-100%)'
    }

    overlay.addEventListener('input', () => this.autoSize())
    overlay.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.commit()
      }
    })

    container.appendChild(overlay)
    this.overlay = overlay

    this.syncOverlayPosition()
    overlay.focus()
    // Put the caret at the end so typing appends when re-editing.
    const len = overlay.value.length
    overlay.setSelectionRange(len, len)
  }

  /** Recompute the overlay position / scale from the current view. */
  private syncOverlayPosition() {
    const engine = this.engine
    const anchor = this.anchor
    const overlay = this.overlay
    if (!engine || !anchor || !overlay) return

    const viewPt = engine.scope.view.projectToView(anchor)
    const canvas = engine.canvas
    const fontSizePx = Number(this.sessionTypography().fontSize) * (engine.zoom || 1)

    overlay.style.fontSize = fontSizePx + 'px'
    overlay.style.left = viewPt.x + canvas.offsetLeft + 'px'
    overlay.style.top = viewPt.y + canvas.offsetTop - fontSizePx * TOP_TO_BASELINE + 'px'
    this.autoSize()
  }

  /** Grow the overlay so the whole content stays visible without scrollbars. */
  private autoSize() {
    const overlay = this.overlay
    if (!overlay) return
    overlay.style.width = '0px'
    overlay.style.height = '0px'
    overlay.style.width = Math.max(overlay.scrollWidth + 2, 24) + 'px'
    overlay.style.height = overlay.scrollHeight + 'px'
  }

  // ------------------------------------------------------------------
  // Hit testing
  // ------------------------------------------------------------------

  /** Find a user point text under `point`, or null. */
  private userTextAt(point: paper.Point): paper.PointText | null {
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
    if (item instanceof scope.PointText && !(item as any).data?.annotation) {
      return item as paper.PointText
    }
    return null
  }
}
