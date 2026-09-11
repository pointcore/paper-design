/**
 * Text tool controller (point / area / path / vertical).
 *
 * Point and vertical texts anchor at a click; area text fills a dragged
 * frame with word-wrapped lines measured on a 2d canvas; path text lays
 * one rotated glyph per character along an existing path. Every mode edits
 * through an HTML textarea overlaid on the canvas so the browser supplies
 * caret, selection and IME handling. The overlay mirrors the text
 * typography (family, weight, style, size scaled by the current zoom,
 * color, line height and justification) so it lines up with how paper.js
 * renders the committed text.
 *
 * A session commits on Escape, on a click elsewhere on the canvas, or when
 * the active tool changes. Committing empty content discards a new text and
 * deletes an existing one. Committing path text whose path is gone falls
 * back to plain point text so no content is lost.
 */
import { EditorEngine } from '../engine'
import { SnapService } from '../snap/snap-service'
import { applyToolCursor } from '../cursors'
import type { TextAlign } from '../types'

/** Text creation / editing mode, resolved from the active text tool. */
type TextKind = 'point' | 'area' | 'path' | 'vertical'

/** Plain text frame rectangle persisted on area text items. */
interface TextFrame {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Distance from the overlay's top edge to the first text baseline, as a
 * fraction of the font size. Derived from line-height 1.2 and a ~0.8em
 * ascent: half-leading (0.1em) + ascent (0.8em).
 */
const TOP_TO_BASELINE = 0.9

/** Minimum drag span in document units that counts as an area frame. */
const MIN_FRAME_SPAN = 5

/** Maps the store's TextAlign onto paper.js justification values. */
const JUSTIFICATIONS: Record<TextAlign, 'left' | 'center' | 'right'> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'left',
}

export class TextController {
  engine: EditorEngine | null = null
  snapService: SnapService = new SnapService()

  /** Whether a text editing session is currently open. */
  private isEditing = false
  /** Mode of the open session. */
  private sessionKind: TextKind = 'point'
  /** Existing item being edited; null when placing brand-new text. */
  private editingItem: paper.PointText | null = null
  /** Existing path-text group being edited; null otherwise. */
  private editingGroup: paper.Group | null = null
  /** Document-space anchor point (baseline of the first line). */
  private anchor: paper.Point | null = null
  /** Area frame for the open session (commit target for area text). */
  private sessionFrame: TextFrame | null = null
  /** Path a path-text session attaches to (re-resolved on commit). */
  private sessionPath: paper.Path | null = null
  /** Document id of the attached path (survives undo/redo replacement). */
  private sessionPathId = ''
  /** Path offset where path-text layout starts. */
  private sessionStartOffset = 0
  /** Raw (unwrapped, unstacked) content when the session started. */
  private originalContent = ''
  /** Overlay textarea used as the editing surface. */
  private overlay: HTMLTextAreaElement | null = null
  /** Area frame drag start in document space (area tool only). */
  private frameStart: { x: number; y: number } | null = null
  /** Rubber-band preview of the dragged area frame. */
  private framePreview: paper.Path | null = null
  /** Shared 2d context for area-text line measurement. */
  private measureCtx: CanvasRenderingContext2D | null = null
  /** onViewChange hook chained while editing so the overlay follows zoom. */
  private chainedOnViewChange: (() => void) | null = null
  /** Detaches the store subscription installed in attachEngine. */
  private unsubscribeStore: (() => void) | null = null

  attachEngine(engine: EditorEngine) {
    this.engine = engine
    this.snapService.attachEngine(engine)
    // Commit any open session when the active tool changes (toolbar click,
    // shortcut, double-click on text with a select tool, ...).
    this.unsubscribeStore = engine.store.$subscribe((_mutation, state) => {
      if (
        state.tool !== 'type' &&
        state.tool !== 'area-type' &&
        state.tool !== 'type-on-path' &&
        state.tool !== 'vertical-type' &&
        this.isEditing
      ) {
        this.commit()
      }
    })
  }

  activate() {
    if (!this.engine) return
    // Safety: never carry an open session across controller activations.
    if (this.isEditing) this.commit()
    this.clearFrameDrag()
    this.setupTool()
    // AI: I-beam for horizontal text variants, vertical I-beam for vertical.
    applyToolCursor(this.engine.canvas, this.engine.store.tool)
  }

  /** Resolve the active text tool to its editing mode. */
  private activeKind(): TextKind {
    const tool = this.engine?.store.tool
    if (tool === 'area-type') return 'area'
    if (tool === 'type-on-path') return 'path'
    if (tool === 'vertical-type') return 'vertical'
    return 'point'
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

      const kind = this.activeKind()
      if (kind === 'area') {
        const snapped = this.snapService.snapPoint(event.point)
        this.frameStart = { x: snapped.x, y: snapped.y }
        return
      }
      if (kind === 'path') {
        const existing = this.userTextAt(event.point)
        if (existing) {
          this.editItem(existing)
          return
        }
        const target = this.pathAt(event.point)
        if (target) {
          const snapped = this.snapService.snapPoint(event.point)
          const startOffset = target.getOffsetOf(snapped) ?? 0
          this.beginSession({
            kind: 'path',
            editingGroup: null,
            anchor: target.getPointAt(Math.min(startOffset, target.length)) ?? snapped,
            path: target,
            pathId: ((target.data as any)?.id as string) ?? '',
            startOffset,
            raw: '',
          })
        } else {
          engine.store.setStatusMessage('Click a path to attach text')
        }
        return
      }

      const existing = this.userTextAt(event.point)
      if (existing) {
        this.editItem(existing)
      } else {
        const snapped = this.snapService.snapPoint(event.point)
        this.startNew(snapped, kind)
      }
    }

    scope.tool.onMouseDrag = (event: paper.ToolEvent) => {
      if (this.activeKind() === 'area' && this.frameStart && !this.isEditing) {
        this.updateFramePreview(this.snapService.snapPoint(event.point))
      }
    }

    scope.tool.onMouseUp = (event: paper.ToolEvent) => {
      if (this.activeKind() === 'area' && this.frameStart && !this.isEditing) {
        this.finishFrameDrag(this.snapService.snapPoint(event.point))
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

  /** Start an empty editing session for brand-new text at `point`. */
  private startNew(point: paper.Point, kind: TextKind) {
    const engine = this.engine
    if (!engine) return
    if (kind === 'vertical') {
      this.beginSession({ kind, anchor: point, raw: '' })
    } else {
      this.beginSession({ kind: 'point', anchor: point, raw: '' })
    }
  }

  /**
   * Start editing an existing text. Used both by text-tool clicks and by
   * the double-click shortcut on the select tool. Path-text glyphs resolve
   * to their owning group so the whole run re-lays out on commit.
   */
  editItem(item: paper.PointText) {
    const engine = this.engine
    if (!engine) return
    if (this.isEditing) this.commit()
    const root = this.resolveTextRoot(item)
    if (root.kind === 'path') {
      const group = root.node as paper.Group
      const info = ((group.data as any) ?? {}) as {
        pathId?: string
        startOffset?: number
        raw?: string
      }
      const path =
        (info.pathId ? (this.findItemById(info.pathId) as paper.Path | null) : null) ??
        null
      this.beginSession({
        kind: 'path',
        editingGroup: group,
        anchor: group.bounds?.center?.clone() ?? null,
        path,
        pathId: info.pathId ?? '',
        startOffset: info.startOffset ?? 0,
        raw: info.raw ?? '',
      })
      return
    }
    const node = root.node as paper.PointText
    const info = ((node.data as any) ?? {}) as { raw?: string; frame?: TextFrame }
    const kind = root.kind
    this.beginSession({
      kind,
      editingItem: node,
      anchor: node.point.clone(),
      // Only area text is pinned to a frame. Passing one for point/vertical
      // made the overlay take the fixed-size area branch (no autoSize), so
      // re-editing a point text clipped anything wider than the old bounds.
      frame:
        kind === 'area' ? (info.frame ? { ...info.frame } : this.frameFromBounds(node)) : null,
      raw: info.raw ?? (kind === 'vertical' ? node.content.split('\n').join('') : node.content),
    })
  }

  private beginSession(options: {
    kind: TextKind
    editingItem?: paper.PointText | null
    editingGroup?: paper.Group | null
    anchor?: paper.Point | null
    frame?: TextFrame | null
    path?: paper.Path | null
    pathId?: string
    startOffset?: number
    raw: string
  }) {
    const engine = this.engine
    if (!engine) return
    this.isEditing = true
    this.sessionKind = options.kind
    this.editingItem = options.editingItem ?? null
    this.editingGroup = options.editingGroup ?? null
    this.anchor = options.anchor ? options.anchor.clone() : null
    this.sessionFrame = options.frame ? { ...options.frame } : null
    this.sessionPath = options.path ?? null
    this.sessionPathId = options.pathId ?? ''
    this.sessionStartOffset = options.startOffset ?? 0
    this.originalContent = options.raw

    if (this.editingItem) {
      // Hide the rendered item while the overlay mirrors it.
      this.editingItem.visible = false
    }
    if (this.editingGroup) {
      this.editingGroup.visible = false
    }

    this.buildOverlay(options.raw)
    // Follow view changes (zoom via menu/buttons) while the session is open.
    this.chainedOnViewChange = engine.onViewChange
    engine.onViewChange = () => {
      this.chainedOnViewChange?.()
      this.syncOverlayPosition()
    }

    engine.scope.view.update()
  }

  /**
   * Close the editing session and write the overlay content back.
   * Empty content discards a new text / removes the existing one.
   */
  commit() {
    const engine = this.engine
    if (!engine || !this.isEditing) return

    const raw = this.overlay ? this.overlay.value : ''
    switch (this.sessionKind) {
      case 'path':
        this.commitPathText(raw)
        break
      case 'area':
        this.commitAreaText(raw)
        break
      case 'vertical':
        this.commitVerticalText(raw)
        break
      default:
        this.commitPointText(raw)
        break
    }

    this.teardownOverlay()
  }

  /** Commit a point-text session (existing behavior, raw equals content). */
  private commitPointText(raw: string) {
    const engine = this.engine
    if (!engine) return
    const item = this.editingItem

    if (item && item.parent) {
      item.visible = true
      if (raw.length === 0) {
        item.remove()
        engine.clearSelection()
        engine.pushHistory('Delete Text')
      } else if (raw !== this.originalContent) {
        item.content = raw
        engine.selectItem(item)
        engine.pushHistory('Edit Text')
      }
    } else if (!item && raw.length > 0) {
      this.createTextItem(raw, this.anchor ?? new engine.scope.Point(0, 0), {
        textMode: 'point',
        raw,
      }, 'Add Text')
    }
  }

  /** Commit a vertical-text session (one stacked glyph per line). */
  private commitVerticalText(raw: string) {
    const engine = this.engine
    if (!engine) return
    // Multi-line vertical runs (columns) are out of scope: newlines drop.
    const stripped = raw.replace(/\n/g, '')
    const stacked = [...stripped].join('\n')
    const item = this.editingItem

    if (item && item.parent) {
      item.visible = true
      if (stripped.length === 0) {
        item.remove()
        engine.clearSelection()
        engine.pushHistory('Delete Text')
      } else if (stripped !== this.originalContent) {
        item.content = stacked
        ;(item.data as any).raw = stripped
        engine.selectItem(item)
        engine.pushHistory('Edit Text')
      }
    } else if (!item && stripped.length > 0) {
      this.createTextItem(stacked, this.anchor ?? new engine.scope.Point(0, 0), {
        textMode: 'vertical',
        raw: stripped,
      }, 'Add Vertical Text')
    }
  }

  /** Commit an area-text session (word-wrap the raw text into the frame). */
  private commitAreaText(raw: string) {
    const engine = this.engine
    if (!engine) return
    const frame = this.sessionFrame
    if (!frame) {
      // No frame (legacy item): fall back to plain point text.
      this.commitPointText(raw)
      return
    }
    const item = this.editingItem
    const content = this.wrapText(raw, frame.width).join('\n')

    if (item && item.parent) {
      item.visible = true
      if (raw.length === 0) {
        item.remove()
        engine.clearSelection()
        engine.pushHistory('Delete Text')
      } else if (raw !== this.originalContent) {
        item.content = content
        item.point = this.frameAnchor(frame)
        ;(item.data as any).raw = raw
        ;(item.data as any).frame = { ...frame }
        engine.selectItem(item)
        engine.pushHistory('Edit Text')
      }
    } else if (!item && raw.length > 0) {
      this.createTextItem(content, this.frameAnchor(frame), {
        textMode: 'area',
        raw,
        frame: { ...frame },
      }, 'Add Area Text')
    }
  }

  /** Commit a path-text session (lay glyphs along the attached path). */
  private commitPathText(raw: string) {
    const engine = this.engine
    if (!engine) return
    // Newlines have no meaning along a path: they drop.
    const stripped = raw.replace(/\n/g, '')
    const group = this.editingGroup
    const path =
      this.sessionPath && this.sessionPath.parent
        ? this.sessionPath
        : this.findItemById(this.sessionPathId)

    if (stripped.length === 0) {
      if (group && group.parent) {
        group.remove()
        engine.clearSelection()
        engine.pushHistory('Delete Text')
      }
      return
    }

    if (!path || !(path instanceof engine.scope.Path)) {
      // The path is gone: keep the content as plain point text instead.
      const at =
        group?.bounds?.center?.clone() ??
        this.anchor?.clone() ??
        new engine.scope.Point(0, 0)
      group?.remove()
      this.createTextItem(stripped, at, { textMode: 'point', raw: stripped }, 'Add Text')
      return
    }

    const hadGroup = !!group && !!group.parent
    const target = hadGroup ? (group as paper.Group) : this.createPathGroup()
    // Re-layout from scratch so edits and path changes both apply.
    target.removeChildren()
    this.layoutPathText(target, path, stripped, this.sessionStartOffset)
    if (target.children.length === 0) {
      // Nothing fits (degenerate path): drop the run instead of keeping
      // an empty group behind.
      target.remove()
      engine.clearSelection()
      engine.pushHistory(hadGroup ? 'Edit Text' : 'Add Path Text')
      return
    }
    ;(target.data as any).raw = stripped
    ;(target.data as any).pathId = (path.data as any)?.id ?? ''
    ;(target.data as any).startOffset = this.sessionStartOffset
    target.visible = true
    engine.selectItem(target)
    engine.pushHistory(hadGroup ? 'Edit Text' : 'Add Path Text')
  }

  /** Build the committed PointText for point / vertical / area text. */
  private createTextItem(
    content: string,
    point: paper.Point,
    data: { textMode: TextKind; raw: string; frame?: TextFrame },
    historyLabel: string,
    push = true
  ): paper.PointText {
    const engine = this.engine!
    const scope = engine.scope
    const charStyle = engine.store.charStyle
    const justification = JUSTIFICATIONS[engine.store.paragraphStyle.align] ?? 'left'
    const fillColor = engine.store.style.fillColor || '#000000'

    const text = new scope.PointText({
      point,
      content,
      fontFamily: charStyle.fontFamily,
      fontWeight: charStyle.fontWeight,
      fontStyle: charStyle.fontStyle,
      fontSize: charStyle.fontSize,
      leading: this.effectiveLeading(),
      justification,
      fillColor,
    }) as paper.PointText

    text.data.id = engine.genId()
    text.data.isUserItem = true
    text.data.textMode = data.textMode
    text.data.raw = data.raw
    if (data.frame) text.data.frame = { ...data.frame }
    engine.getActiveLayer().addChild(text)

    if (push) {
      engine.selectItem(text)
      engine.pushHistory(historyLabel)
    }
    return text
  }

  /** Create the group that owns one path-text run. */
  private createPathGroup(): paper.Group {
    const engine = this.engine!
    const group = new engine.scope.Group() as paper.Group
    group.data.id = engine.genId()
    group.data.isUserItem = true
    group.data.textMode = 'path'
    engine.getActiveLayer().addChild(group)
    return group
  }

  /**
   * Re-layout every path-text run attached to one of the given items
   * (AI: text follows its path through moves, reshapes and transforms).
   * Piggybacks the caller's history entry; skips runs being edited and
   * paths that are gone. Runs that no longer fit are dropped like at
   * commit time.
   */
  reflowPathTextsForPaths(items: paper.Item[]): void {
    const engine = this.engine
    if (!engine) return
    const scope = engine.scope
    const ids = new Set<string>()
    const collectPaths = (item: paper.Item): void => {
      if (
        item instanceof scope.Path &&
        !(item instanceof scope.CompoundPath) &&
        typeof (item.data as any)?.id === 'string'
      ) {
        ids.add((item.data as any).id as string)
      }
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) collectPaths(child as paper.Item)
      }
    }
    for (const item of items) {
      if (item) collectPaths(item)
    }
    if (ids.size === 0) return
    const groups: paper.Group[] = []
    const collectGroups = (item: paper.Item): void => {
      if (
        item instanceof scope.Group &&
        (item.data as any)?.textMode === 'path' &&
        typeof (item.data as any)?.pathId === 'string' &&
        ids.has((item.data as any).pathId as string)
      ) {
        groups.push(item as paper.Group)
        return
      }
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) collectGroups(child as paper.Item)
      }
    }
    for (const layer of engine.project.layers) {
      if (!(layer.data as any)?.isUserLayer) continue
      for (const child of layer.children) collectGroups(child as paper.Item)
    }
    if (groups.length === 0) return
    for (const group of groups) {
      if (this.editingGroup === group) continue
      const info = (group.data as any) as {
        pathId?: string
        startOffset?: number
        raw?: string
      }
      const path = (info.pathId ? this.findItemById(info.pathId) : null) as paper.Path | null
      if (!path || !(path instanceof scope.Path) || !path.parent) continue
      const raw = typeof info.raw === 'string' ? info.raw : ''
      if (raw.length === 0) continue
      // Clamp a stale start offset into the reshaped path instead of
      // laying out past its end (which would empty the run).
      const start = Math.min(Math.max(0, Number(info.startOffset) || 0), Math.max(0, path.length))
      group.removeChildren()
      this.layoutPathText(group, path, raw, start)
      if (group.children.length === 0) group.remove()
    }
    engine.scope.view.update()
  }

  /**
   * Lay one centered, path-tangent-rotated glyph per character along `path
   * starting at `startOffset`. Glyphs that run past the path end are cut.
   */
  private layoutPathText(
    group: paper.Group,
    path: paper.Path,
    raw: string,
    startOffset: number
  ) {
    const engine = this.engine!
    const scope = engine.scope
    const charStyle = engine.store.charStyle
    const fillColor = engine.store.style.fillColor || '#000000'
    const leading = this.effectiveLeading()
    const tracking = (Number(charStyle.tracking) || 0) / 1000 * (Number(charStyle.fontSize) || 12)
    const total = path.length
    let cursor = Math.max(0, startOffset)

    for (const ch of raw) {
      const advance = this.measureLineWidth(ch === '\t' ? ' ' : ch) + tracking * 0
      const mid = cursor + advance / 2
      if (mid > total) break
      if (advance > 0) {
        const pt = path.getPointAt(mid)
        const tangent = path.getTangentAt(mid)
        const angle = (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI
        const glyph = new scope.PointText({
          point: pt,
          content: ch,
          justification: 'center',
          fontFamily: charStyle.fontFamily,
          fontWeight: charStyle.fontWeight,
          fontStyle: charStyle.fontStyle,
          fontSize: charStyle.fontSize,
          leading,
          fillColor,
        }) as paper.PointText
        glyph.rotate(angle, pt)
        group.addChild(glyph)
      }
      cursor += advance + tracking
    }
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
    this.sessionKind = 'point'
    this.editingItem = null
    this.editingGroup = null
    this.anchor = null
    this.sessionFrame = null
    this.sessionPath = null
    this.sessionPathId = ''
    this.sessionStartOffset = 0
    this.originalContent = ''
    engine?.scope.view.update()
  }

  // ------------------------------------------------------------------
  // Area frames
  // ------------------------------------------------------------------

  /** Remove a half-dragged area frame (tool switch or tiny drag). */
  private clearFrameDrag() {
    if (this.framePreview) {
      this.framePreview.remove()
      this.framePreview = null
    }
    this.frameStart = null
  }

  /** Rubber-band preview of the dragged area frame. */
  private updateFramePreview(point: paper.Point) {
    const engine = this.engine
    if (!engine || !this.frameStart) return
    const scope = engine.scope
    if (this.framePreview) {
      this.framePreview.remove()
      this.framePreview = null
    }
    const rect = new scope.Rectangle(
      Math.min(this.frameStart.x, point.x),
      Math.min(this.frameStart.y, point.y),
      Math.abs(point.x - this.frameStart.x),
      Math.abs(point.y - this.frameStart.y)
    )
    const preview = new scope.Path.Rectangle({
      from: [rect.x, rect.y],
      to: [rect.x + rect.width, rect.y + rect.height],
      strokeColor: '#4a90d9',
      strokeWidth: 1 / scope.view.zoom,
      dashArray: [4 / scope.view.zoom, 2 / scope.view.zoom],
    }) as paper.Path
    preview.data.isPreview = true
    engine.getOverlayLayer().addChild(preview)
    this.framePreview = preview
    scope.view.update()
  }

  /** Finish an area frame drag: open a session or discard a tiny frame. */
  private finishFrameDrag(point: paper.Point) {
    const engine = this.engine
    const start = this.frameStart
    this.clearFrameDrag()
    if (!engine || !start) return
    const frame: TextFrame = {
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    }
    if (frame.width < MIN_FRAME_SPAN || frame.height < MIN_FRAME_SPAN) {
      engine.store.setStatusMessage('Drag to define a text frame')
      engine.scope.view.update()
      return
    }
    this.beginSession({ kind: 'area', frame, raw: '' })
  }

  /** Anchor a frame edge from the paragraph justification. */
  private frameAnchor(frame: TextFrame): paper.Point {
    const engine = this.engine!
    const scope = engine.scope
    const justification = JUSTIFICATIONS[engine.store.paragraphStyle.align] ?? 'left'
    const x =
      justification === 'center'
        ? frame.x + frame.width / 2
        : justification === 'right'
          ? frame.x + frame.width
          : frame.x
    return new scope.Point(x, frame.y)
  }

  /** Fallback frame from an item bounds (legacy items without one). */
  private frameFromBounds(item: paper.PointText): TextFrame | null {
    const b = item.bounds
    if (!b) return null
    return {
      x: b.x,
      y: b.y,
      width: Math.max(b.width, MIN_FRAME_SPAN),
      height: Math.max(b.height, MIN_FRAME_SPAN),
    }
  }

  // ------------------------------------------------------------------
  // Area rewrap + threading v1 (public: panels and menus call these)
  // ------------------------------------------------------------------

  /** Area-text root under the selection, if exactly one is selected. */
  selectedAreaItem(): paper.PointText | null {
    const engine = this.engine
    if (!engine) return null
    const items = engine.getSelection()
    if (items.length !== 1) return null
    const item = items[0]
    if (item instanceof engine.scope.PointText && (item.data as any)?.textMode === 'area') {
      return item as paper.PointText
    }
    return null
  }

  /** Stored frame + raw content for an area item (bounds fallback). */
  areaInfo(item: paper.PointText): { frame: TextFrame; raw: string } | null {
    const data = (item.data as any) ?? {}
    const frame = data.frame ? { ...(data.frame as TextFrame) } : this.frameFromBounds(item)
    if (!frame) return null
    const raw = typeof data.raw === 'string' ? data.raw : item.content
    return { frame, raw }
  }

  /** How many wrapped lines fit vs exist (overflow = threaded candidate). */
  areaOverflow(item: paper.PointText): { lines: number; fits: number; overflowChars: number } {
    const info = this.areaInfo(item)
    if (!info) return { lines: 0, fits: 0, overflowChars: 0 }
    const lines = this.wrapText(info.raw, Math.max(info.frame.width, MIN_FRAME_SPAN))
    const leading = this.effectiveLeading()
    const fits = Math.max(1, Math.floor(info.frame.height / (leading || 1)))
    if (lines.length <= fits) return { lines: lines.length, fits, overflowChars: 0 }
    const overflowChars = lines.slice(fits).join('\n').length
    return { lines: lines.length, fits, overflowChars }
  }

  /**
   * Resize an area frame and re-wrap its raw content in place.
   * Returns false when the item is gone or the size is invalid.
   */
  resizeAreaItem(item: paper.PointText, width: number, height: number): boolean {
    const engine = this.engine
    if (!engine || !item.parent) return false
    if (!Number.isFinite(width) || !Number.isFinite(height)) return false
    if (width < MIN_FRAME_SPAN || height < MIN_FRAME_SPAN) return false
    const info = this.areaInfo(item)
    if (!info) return false
    const frame: TextFrame = { ...info.frame, width, height }
    item.content = this.wrapText(info.raw, width).join('\n')
    item.point = this.frameAnchor(frame)
    ;(item.data as any).frame = { ...frame }
    engine.scope.view.update()
    return true
  }

  /**
   * Flow an area item's overflow into a new linked frame placed to its
   * right (one-way v1: `threadNext`/`threadPrev` ids persist in Save/Open;
   * live reflow across frames is out of scope). Returns false with nothing
   * to flow.
   */
  flowOverflowToNewFrame(item: paper.PointText): boolean {
    const engine = this.engine
    if (!engine || !item.parent) return false
    const info = this.areaInfo(item)
    if (!info) return false
    const lines = this.wrapText(info.raw, Math.max(info.frame.width, MIN_FRAME_SPAN))
    const leading = this.effectiveLeading()
    const fits = Math.max(1, Math.floor(info.frame.height / (leading || 1)))
    if (lines.length <= fits) return false
    const kept = lines.slice(0, fits).join('\n')
    const overflowRaw = lines.slice(fits).join('\n')
    // Wrapped lines already fit the frame width, so re-wrapping them is
    // stable: keep the visible prefix as the new raw (explicit breaks kept).
    item.content = kept
    ;(item.data as any).raw = kept
    const gap = 16
    const nextFrame: TextFrame = {
      x: info.frame.x + info.frame.width + gap,
      y: info.frame.y,
      width: info.frame.width,
      height: info.frame.height,
    }
    const overflowContent = this.wrapText(overflowRaw, nextFrame.width).join('\n')
    // Links must land before the history snapshot, or undo loses them.
    const created = this.createTextItem(overflowContent, this.frameAnchor(nextFrame), {
      textMode: 'area',
      raw: overflowRaw,
      frame: { ...nextFrame },
    }, 'Thread Text', false)
    ;(created.data as any).threadPrev = (item.data as any)?.id ?? ''
    ;(item.data as any).threadNext = (created.data as any)?.id ?? ''
    engine.selectItem(item)
    engine.pushHistory('Thread Text')
    return true
  }

  /** Wrap raw text (explicit newlines kept) into frame-width lines. */
  private wrapText(raw: string, maxWidth: number): string[] {
    const out: string[] = []
    for (const paragraph of raw.split('\n')) {
      out.push(...this.wrapParagraph(paragraph, maxWidth))
    }
    return out
  }

  /**
   * Greedy single-paragraph wrap: breaks at the last space when possible
   * (CJK text without spaces breaks per character) and drops the space
   * that caused the break.
   */
  private wrapParagraph(paragraph: string, maxWidth: number): string[] {
    const lines: string[] = []
    let line = ''
    let breakAt = -1
    for (const ch of paragraph) {
      if (this.measureLineWidth(line + ch) <= maxWidth || line.length === 0) {
        line += ch
        if (ch === ' ' || ch === '\t') breakAt = line.length
      } else if (breakAt > 0) {
        lines.push(line.slice(0, breakAt).replace(/\s+$/, ''))
        line = line.slice(breakAt).replace(/^\s+/, '') + ch
        breakAt = -1
      } else {
        lines.push(line)
        line = ch === ' ' ? '' : ch
        breakAt = -1
      }
    }
    lines.push(line)
    return lines
  }

  /** Canvas font string matching the current character style. */
  private textMeasureFont(): string {
    const charStyle = this.engine!.store.charStyle
    return `${charStyle.fontStyle} ${charStyle.fontWeight} ${charStyle.fontSize}px ${charStyle.fontFamily}`
  }

  /** Width of one line in document units under the current style (tracking-aware). */
  private measureLineWidth(line: string): number {
    if (!this.measureCtx) {
      const canvas = document.createElement('canvas')
      this.measureCtx = canvas.getContext('2d')
    }
    const charStyle = this.engine!.store.charStyle
    const tracking = (Number(charStyle.tracking) || 0) / 1000 * (Number(charStyle.fontSize) || 12)
    if (!this.measureCtx) return line.length * (6 + tracking)
    this.measureCtx.font = this.textMeasureFont()
    const base = this.measureCtx.measureText(line).width
    // Tracking adds per-character advance (no trailing space after last glyph).
    return base + Math.max(0, line.length - 1) * tracking
  }

  /** Effective leading for new/updated text (auto = 1.2x). */
  effectiveLeading(): number {
    const charStyle = this.engine!.store.charStyle
    if (charStyle.autoLeading) return (Number(charStyle.fontSize) || 12) * 1.2
    return Number(charStyle.leading) || (Number(charStyle.fontSize) || 12) * 1.2
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
        return
      }
      // AI Ctrl+Shift+> / <: step the font size of the text being edited.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && (e.code === 'Period' || e.code === 'Comma')) {
        e.preventDefault()
        e.stopPropagation()
        this.stepSessionFontSize(e.code === 'Period' ? 2 : -2)
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

  /**
   * Ctrl+Shift+> / < while editing: resize the live text (the hidden item
   * plus its overlay mirror), then re-measure the overlay. Area frames
   * re-wrap from the frame at commit, matching panel-driven size changes.
   */
  private stepSessionFontSize(delta: number) {
    const item = this.editingItem
    if (!item || (item as any).locked) return
    const next = Math.min(400, Math.max(1, Math.round((Number(item.fontSize) || 12) + delta)))
    if (next === (Number(item.fontSize) || 12)) return
    item.fontSize = next
    const overlay = this.overlay
    if (overlay) {
      const zoom = this.engine?.zoom || 1
      overlay.style.fontSize = `${next * zoom}px`
    }
    this.syncOverlayPosition()
    this.autoSize()
  }

  /** Recompute the overlay position / scale from the current view. */
  private syncOverlayPosition() {
    const engine = this.engine
    const overlay = this.overlay
    if (!engine || !overlay) return

    // Area sessions pin the overlay to the text frame; other modes grow
    // the overlay from the anchor point.
    if (this.sessionFrame) {
      const frame = this.sessionFrame
      const viewTopLeft = engine.scope.view.projectToView(
        new engine.scope.Point(frame.x, frame.y)
      )
      const canvas = engine.canvas
      const zoom = engine.zoom || 1
      const fontSizePx = Number(this.sessionTypography().fontSize) * zoom
      overlay.style.fontSize = fontSizePx + 'px'
      overlay.style.left = viewTopLeft.x + canvas.offsetLeft + 'px'
      overlay.style.top = viewTopLeft.y + canvas.offsetTop + 'px'
      overlay.style.width = Math.max(frame.width * zoom, 24) + 'px'
      overlay.style.height = Math.max(frame.height * zoom, fontSizePx * 1.2) + 'px'
      overlay.style.whiteSpace = 'pre-wrap'
      overlay.style.transform = ''
      return
    }

    const anchor = this.anchor
    if (!anchor) return
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
    if (!overlay || this.sessionFrame) return
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
    if ((item as any)?.locked) return null
    if ((item as any)?.data?.isArtboard) return null
    if (item instanceof scope.PointText && !(item as any).data?.annotation) {
      return item as paper.PointText
    }
    return null
  }

  /** Find a drawable user path under `point`, or null. */
  private pathAt(point: paper.Point): paper.Path | null {
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
    if (!item || (item.data as any)?.annotation) return null
    if ((item.data as any)?.isChrome || (item.data as any)?.isPreview) return null
    if ((item.data as any)?.isArtboard) return null
    if (item instanceof scope.Path) return item as paper.Path
    return null
  }

  /**
   * Resolve a hit glyph to the text root that owns it: a path-text group
   * for glyph runs, otherwise the item itself (legacy point texts without
   * a marker resolve as point text).
   */
  private resolveTextRoot(item: paper.PointText): { kind: TextKind; node: paper.Item } {
    const engine = this.engine
    let cursor: paper.Item | null = item
    while (cursor && engine) {
      const mode = (cursor.data as any)?.textMode
      if (mode === 'point' || mode === 'area' || mode === 'vertical' || mode === 'path') {
        return { kind: mode, node: cursor }
      }
      const parent = cursor.parent
      if (parent && parent instanceof engine.scope.Group) cursor = parent as paper.Item
      else break
    }
    return { kind: 'point', node: item }
  }

  /** Find any item by its document id (used to re-resolve text paths). */
  private findItemById(id: string): paper.Item | null {
    const engine = this.engine
    if (!engine || !id) return null
    const walk = (item: paper.Item): paper.Item | null => {
      if ((item.data as any)?.id === id) return item
      const children = (item as any).children as paper.Item[] | undefined
      if (children) {
        for (const child of children) {
          const found = walk(child)
          if (found) return found
        }
      }
      return null
    }
    for (const layer of engine.project.layers) {
      for (const child of layer.children) {
        const found = walk(child as paper.Item)
        if (found) return found
      }
    }
    return null
  }
}
