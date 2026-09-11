/**
 * Callout annotation controller
 */
import { EditorEngine } from '../engine'
import { isEditableTarget } from '../shortcuts'
import { applyToolCursor } from '../cursors'
import { SnapService } from '../snap/snap-service'

export class CalloutController {
  engine: EditorEngine | null = null
  snapService: SnapService = new SnapService()
  private isDrawing = false
  private currentPath: paper.Path | null = null
  private points: paper.Point[] = []
  /** Label item under edit (hidden while the overlay mirrors it). */
  private editingItem: paper.PointText | null = null
  private overlay: HTMLTextAreaElement | null = null
  private unsubscribeStore: (() => void) | null = null
  /** Tool that was active when the current label edit began. */
  private editTool: string | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
    this.snapService.attachEngine(engine)
    // Commit an open label edit on a real tool switch. The guard used to be
    // `state.tool !== 'callout'`, which is always true when the edit was
    // started from a select tool — so the first store write (a mouse-move
    // cursor update) committed the label immediately.
    this.unsubscribeStore = engine.store.$subscribe((_mutation, state) => {
      if (this.editingItem && this.editTool !== null && state.tool !== this.editTool) {
        this.commitLabel()
      }
    })
  }

  activate() {
    if (!this.engine) return
    // Commit an in-progress draft on real tool switches (transient
    // space-pan / zoom returns keep drafting).
    const lastTool = this.engine.store.lastTool
    if (this.isDrawing && lastTool !== 'view-hand' && lastTool !== 'zoom') {
      this.finishCallout()
    }
    applyToolCursor(this.engine.canvas, 'callout')
    this.setupTool()
  }

  /**
   * Tool switch: an in-progress multi-click draft never reaches its
   * commit, so remove the fragment instead of leaving stray geometry on
   * the annotation layer (label edits commit via the store subscription).
   */
  deactivate() {
    if (!this.isDrawing) return
    this.currentPath?.remove()
    this.isDrawing = false
    this.points = []
    this.currentPath = null
    this.engine?.store.setDragging(false)
    this.engine?.scope.view.update()
  }

  private getNativeEvent(event: paper.ToolEvent): MouseEvent {
    return (event as any).event as MouseEvent
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
      const native = this.getNativeEvent(event)
      if (native.button !== 0) return

      const point = this.snapService.snapPoint(event.point)

      if (!this.isDrawing) {
        this.isDrawing = true
        this.points = [point]

        const annotationLayer = engine.getAnnotationLayer()
        const style = engine.store.calloutStyle
        this.currentPath = new scope.Path() as paper.Path
        this.currentPath.strokeColor = new scope.Color(style.color)
        this.currentPath.strokeWidth = style.lineWidth
        this.currentPath.strokeCap = 'round' as any
        annotationLayer.addChild(this.currentPath)
        this.currentPath.add(new scope.Segment(point))
      } else {
        this.points.push(point)
        this.currentPath?.add(new scope.Segment(point))
      }
      engine.store.setDragging(true)
    }

    scope.tool.onMouseMove = (event: paper.ToolEvent) => {
      engine.store.setCursorPos(event.point.x, event.point.y)
    }

    scope.tool.onKeyDown = (event: paper.KeyEvent) => {
      // Never steal keystrokes typed into panel inputs or dialogs.
      if (isEditableTarget((event as any).event as KeyboardEvent)) return
      if (event.key === 'enter' || event.key === 'escape') {
        this.finishCallout()
      }
    }

    scope.tool.onMouseUp = () => {
      engine.store.setDragging(false)
    }

    scope.view.update()
  }

  private finishCallout() {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope

    if (!this.currentPath || this.points.length < 2) {
      if (this.currentPath) this.currentPath.remove()
      this.isDrawing = false
      this.points = []
      this.currentPath = null
      return
    }

    // Save
    const path = this.currentPath
    path.data.id = engine.genId()
    path.data.isUserItem = true
    path.data.annotation = true

    // Add the text label
    const lastPoint = this.points[this.points.length - 1]
    const style = engine.store.calloutStyle
    const text = new scope.PointText({
      point: new scope.Point(lastPoint.x + style.offset, lastPoint.y),
      content: 'Label',
      fontSize: style.fontSize,
      fillColor: style.textColor,
      fontFamily: style.fontFamily,
    }) as paper.PointText
    text.data.id = engine.genId()
    text.data.isUserItem = true
    text.data.annotation = true

    const annotationLayer = engine.getAnnotationLayer()
    annotationLayer.addChild(text)

    engine.pushHistory('Callout')
    this.isDrawing = false
    this.points = []
    this.currentPath = null
    scope.view.update()
  }

  // ------------------------------------------------------------------
  // Label editing (double-click a callout label with a select tool)
  // ------------------------------------------------------------------

  /**
   * Edit a callout label through a multi-line overlay, mirroring the text
   * tool conventions: Enter adds a line, Escape or a click elsewhere
   * commits (blank input keeps the old text), tool switches commit.
   */
  editLabel(item: paper.PointText) {
    const engine = this.engine
    if (!engine || !item.parent || (item as any).locked) return
    if (!((item.data as any)?.annotation)) return
    if (this.editingItem) this.commitLabel()
    this.editingItem = item
    this.editTool = engine.store.tool
    item.visible = false
    engine.scope.view.update()

    const container = engine.canvas.parentElement
    if (!container) {
      item.visible = true
      this.editingItem = null
      return
    }
    const overlay = document.createElement('textarea')
    overlay.value = item.content
    overlay.spellcheck = false
    overlay.rows = 1
    const style = overlay.style
    style.position = 'absolute'
    style.margin = '0'
    style.padding = '0 2px'
    style.border = 'none'
    style.outline = '1px dashed rgba(74, 144, 217, 0.8)'
    style.background = 'transparent'
    style.resize = 'none'
    style.overflow = 'hidden'
    style.whiteSpace = 'pre'
    style.lineHeight = '1.2'
    style.zIndex = '20'
    style.fontFamily = (item.fontFamily as string) || 'Arial'
    style.fontWeight = String(item.fontWeight ?? 'normal')
    style.fontStyle = ((item as any).fontStyle as string) ?? 'normal'
    const color = item.fillColor ? item.fillColor.toCSS(true) : '#000000'
    style.color = color
    style.caretColor = color
    const viewPt = engine.scope.view.projectToView(item.point)
    const zoom = engine.zoom || 1
    const fontPx = (Number(item.fontSize) || 12) * zoom
    style.fontSize = `${fontPx}px`
    style.left = `${viewPt.x + engine.canvas.offsetLeft}px`
    // Align the input top with the text baseline like the text overlay.
    style.top = `${viewPt.y + engine.canvas.offsetTop - fontPx * 0.9}px`
    const fit = () => {
      // Wide enough for the longest line, tall enough for every line.
      const lines = overlay.value.split('\n')
      const longest = lines.reduce((n, line) => Math.max(n, line.length), 0)
      overlay.style.width = `${Math.max(60, longest * fontPx * 0.62 + 12)}px`
      overlay.style.height = '0px'
      overlay.style.height = `${overlay.scrollHeight}px`
    }
    overlay.addEventListener('input', fit)
    overlay.addEventListener('keydown', (e: KeyboardEvent) => {
      // Enter adds a line (text-tool convention); Escape commits.
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.commitLabel()
      }
    })
    // Clicking elsewhere commits (capture so canvas tools never see it).
    overlay.addEventListener(
      'blur',
      () => {
        if (this.editingItem) this.commitLabel()
      },
      { capture: true }
    )
    container.appendChild(overlay)
    this.overlay = overlay
    fit()
    overlay.focus()
    overlay.select()
  }

  /** Write the overlay value back (unchanged or empty keeps old text). */
  private commitLabel() {
    const engine = this.engine
    const item = this.editingItem
    const overlay = this.overlay
    this.editingItem = null
    this.overlay = null
    this.editTool = null
    if (overlay) overlay.remove()
    if (!engine || !item || !item.parent) {
      engine?.scope.view.update()
      return
    }
    item.visible = true
    // Trailing whitespace trimmed; blank input keeps the old text.
    const next = (overlay?.value ?? '').replace(/\s+$/, '')
    if (next.length > 0 && next !== item.content) {
      item.content = next
      engine.pushHistory('Edit Callout')
    }
    engine.scope.view.update()
  }
}
