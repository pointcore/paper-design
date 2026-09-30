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
import { cssTextAlignFor, normalizeAlign, paperJustificationFor } from './text-align'
import { wrapParagraph, wrapText } from './line-break'
import {
  defaultParagraphSettings,
  layoutParagraphs,
  normalizeParagraphSettings,
  type ParagraphSettings,
} from './paragraphs'
import { flowTextThroughFrames, spliceThreadedText, type FlowWindow } from './thread-flow'
import { lineWidth, metricsForItem, metricsForStyle, type TextMetrics } from './metrics'
import { isPrimaryButton } from '../gestures'

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
      if (!isPrimaryButton(native)) return

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
    // Styled runs group (per-character styling): collapse back to a single
    // PointText for the editing session; runs are re-rendered on commit.
    if (
      root.node instanceof engine.scope.Group &&
      (root.node.data as any)?.textMode === 'point' &&
      Array.isArray((root.node.data as any)?.runs)
    ) {
      const group = root.node as paper.Group
      const runs = [...((group.data as any).runs as Array<{ start: number; end: number; style: Record<string, any> }>)]
      const raw = ((group.data as any).raw as string) ?? ''
      const anchor = group.bounds?.center?.clone() ?? new engine.scope.Point(0, 0)
      const runsId = (group.data as any)?.id as string | undefined
      // Remove the group; create a temporary single PointText for editing.
      group.remove()
      const tmp = new engine.scope.PointText({
        point: anchor,
        content: raw,
        fontSize: Number(engine.store.charStyle.fontSize) || 12,
        fillColor: engine.store.style.fillColor || '#000000',
      }) as paper.PointText
      tmp.data.id = runsId ?? engine.genId()
      tmp.data.isUserItem = true
      tmp.data.textMode = 'point'
      tmp.data.raw = raw
      tmp.data.runs = runs
      engine.getActiveLayer().addChild(tmp)
      engine.selectItem(tmp)
      this.beginSession({
        kind: 'point',
        editingItem: tmp,
        anchor,
        raw,
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
        ;(item.data as any).openType = { ...engine.store.charStyle.openType }
        // Render styled runs if the item has per-character styling.
        const runs = (item.data as any)?.runs
        if (Array.isArray(runs) && runs.length > 0) {
          const group = this.renderStyledRuns(item)
          engine.selectItem(group)
        } else {
          engine.selectItem(item)
        }
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
    // Paragraph settings live on the item; a new frame starts at the
    // defaults, an existing one keeps whatever it was laid out with.
    const settings = item ? this.paragraphSettings(item) : defaultParagraphSettings()

    if (item && item.parent) {
      if (this.isThreaded(item)) {
        // One text, several frames: the edit is spliced into the frame that
        // owns the text and the whole chain re-flows from there.
        if (raw.length === 0) {
          this.unthreadItem(item)
        } else if (this.commitThreadedText(item, raw)) {
          engine.pushHistory('Edit Text')
        }
        this.editingItem = null
        return
      }
    }

    // A frame in the middle of nothing: wrap the text for this frame alone.
    if (item && item.parent) {
      item.visible = true
      if (raw.length === 0) {
        item.remove()
        engine.clearSelection()
        engine.pushHistory('Delete Text')
      } else if (raw !== this.originalContent) {
          item.content = this.layoutFrame(raw, frame.width, settings, this.metricsFor(item)).content
        item.point = this.frameAnchor(frame)
        ;(item.data as any).raw = raw
        ;(item.data as any).frame = { ...frame }
        engine.selectItem(item)
        engine.pushHistory('Edit Text')
      }
    } else if (!item && raw.length > 0) {
        this.createTextItem(this.layoutFrame(raw, frame.width, settings, this.metricsFor()).content, this.frameAnchor(frame), {
        textMode: 'area',
        raw,
        frame: { ...frame },
        paragraphs: settings,
      }, 'Add Area Text')
    }
  }

  /**
   * Remove one frame from a thread, re-flowing the rest.
   *
   * Emptying a continuation frame is how a thread gets shorter: the text it
   * showed goes back to the frames before it, and the empty frame goes away.
   */
  private unthreadItem(item: paper.PointText): void {
    const engine = this.engine
    if (!engine) return
    const root = this.threadRoot(item)
    const frames = this.threadFrames(root)
    const index = frames.indexOf(item)
    if (index <= 0) {
      // The first frame is the text: emptying it empties the thread.
      root.data = { ...(root.data as any), raw: '' }
      for (const frame of frames) {
        if (frame === root || !frame.parent) continue
        ;(frame.data as any).threadPrev = ''
        ;(frame.data as any).threadNext = ''
        frame.remove()
      }
      ;(root.data as any).threadNext = ''
      root.remove()
      engine.clearSelection()
      engine.pushHistory('Delete Text')
      return
    }
    // Link the neighbours together and drop the emptied frame.
    const prev = frames[index - 1]
    const next = frames[index + 1] ?? null
    ;(prev.data as any).threadNext = next ? String((next.data as any)?.id ?? '') : ''
    if (next) (next.data as any).threadPrev = String((prev.data as any)?.id ?? '')
    item.remove()
    this.reflowThread(root)
    engine.pushHistory('Unthread Text')
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
    data: {
      textMode: TextKind
      raw: string
      frame?: TextFrame
      paragraphs?: ParagraphSettings
    },
    historyLabel: string,
    push = true
  ): paper.PointText {
    const engine = this.engine!
    const scope = engine.scope
    const charStyle = engine.store.charStyle
    const align = normalizeAlign(engine.store.paragraphStyle.align)
    const justification = paperJustificationFor(align)
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
    // True paragraph alignment, including justify (paper justification
    // above is only the canvas approximation). Serialized with the
    // document, so Save/Open round-trips the intent.
    text.data.align = align
    text.data.openType = { ...charStyle.openType }
    if (data.frame) text.data.frame = { ...data.frame }
    // Stored on every text item, not just frames: the Text panel shows the
    // same three fields whatever the mode, and a frame saved without the
    // field must still read back as the defaults.
    text.data.paragraphs = normalizeParagraphSettings(data.paragraphs)
    engine.getActiveLayer().addChild(text)
    // With "align to baseline grid" on, new type lands on the rhythm: the
    // first baseline goes onto a grid line and the leading carries the rest of
    // the block down the grid.
    if (data.textMode !== 'path') engine.alignTextToBaselineGrid(text as paper.PointText)

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
      // The glyphs below are created from the store's character style, so the
      // store's style is also the right thing to measure them with here.
      const advance = this.measureLineWidth(ch === '\t' ? ' ' : ch)
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
    // Justify anchors like left on canvas (see text-align.ts).
    const justification = paperJustificationFor(normalizeAlign(engine.store.paragraphStyle.align))
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

  /**
   * Paragraph settings stored on a text item, with the defaults filled in.
   * Read through here rather than off `item.data` at each call site: a frame
   * saved before paragraph settings existed has no field at all, and a
   * hand-edited project may have a nonsense one.
   */
  paragraphSettings(item: paper.PointText): ParagraphSettings {
    return normalizeParagraphSettings((item.data as any)?.paragraphs)
  }

  /**
   * Store paragraph settings on a text item and re-lay it out, so a panel
   * edit is visible immediately. Returns false when the item is gone.
   */
  setParagraphSettings(item: paper.PointText, settings: ParagraphSettings): boolean {
    const engine = this.engine
    if (!engine || !item.parent) return false
    const clean = normalizeParagraphSettings(settings)
    ;(item.data as any).paragraphs = clean
    const info = this.areaInfo(item)
    if (info) {
        const laid = this.layoutFrame(info.raw, info.frame.width, clean, this.metricsFor(item))
      item.content = laid.content
      // The measured line count includes the indent and the blank spacer
      // lines, so the overflow readout stays honest.
      ;(item.data as any).laidLines = laid.lineCount
    }
    engine.scope.view.update()
    return true
  }

  /** How many wrapped lines fit vs exist (overflow = threaded candidate). */
  areaOverflow(item: paper.PointText): { lines: number; fits: number; overflowChars: number } {
    const info = this.areaInfo(item)
    if (!info) return { lines: 0, fits: 0, overflowChars: 0 }
    // Counted after paragraph layout: the indent and the blank spacer lines
    // occupy the frame just like any other line.
      const laid = this.layoutFrame(
        info.raw,
        Math.max(info.frame.width, MIN_FRAME_SPAN),
        this.paragraphSettings(item),
        this.metricsFor(item)
      )
    const lines = laid.content === '' ? [] : laid.content.split('\n')
    const leading = this.effectiveLeading()
    const fits = Math.max(1, Math.floor(info.frame.height / (leading || 1)))
    if (lines.length <= fits) return { lines: lines.length, fits, overflowChars: 0 }
    const overflowChars = lines.slice(fits).join('').length
    return { lines: lines.length, fits, overflowChars }
  }

  /**
   * The frames of a thread, in flow order, starting from `item`.
   *
   * `threadNext` / `threadPrev` ids persist in Save/Open, so a thread survives
   * a round-trip; the walk is bounded and cycle-guarded because the ids are
   * document data and a hand-edited file (or a bug) could point a frame at
   * itself.
   */
  threadFrames(item: paper.PointText): paper.PointText[] {
    const engine = this.engine
    if (!engine || !item.parent) return [item]
    const chain: paper.PointText[] = [item]
    const seen = new Set<string>([String((item.data as any)?.id ?? '')])
    let cursor = item
    // 64 frames is far past any real document and keeps a corrupt chain from
    // hanging the editor.
    for (let hops = 0; hops < 64; hops++) {
      const nextId = (cursor.data as any)?.threadNext
      if (typeof nextId !== 'string' || !nextId || seen.has(nextId)) break
      const next = engine.getItemById(nextId)
      if (!(next instanceof engine.scope.PointText) || !next.parent) break
      chain.push(next as paper.PointText)
      seen.add(nextId)
      cursor = next as paper.PointText
    }
    return chain
  }

  /**
   * The first frame of the thread an item belongs to.
   *
   * A thread is one text spread over several frames, and the text lives in the
   * first frame; everything downstream is a window onto it. Walking back is
   * what lets a frame in the middle ask "who owns this text?".
   */
  threadRoot(item: paper.PointText): paper.PointText {
    const engine = this.engine
    if (!engine || !item.parent) return item
    const seen = new Set<string>([String((item.data as any)?.id ?? '')])
    let cursor = item
    for (let hops = 0; hops < 64; hops++) {
      const prevId = (cursor.data as any)?.threadPrev
      if (typeof prevId !== 'string' || !prevId || seen.has(prevId)) break
      const prev = engine.getItemById(prevId)
      if (!(prev instanceof engine.scope.PointText) || !prev.parent) break
      seen.add(prevId)
      cursor = prev as paper.PointText
    }
    return cursor
  }

  /** The author-visible text of a thread, which the first frame owns. */
  threadText(root: paper.PointText): string {
    const info = this.areaInfo(root)
    return info?.raw ?? ''
  }

  /**
   * Re-derive every frame of a thread from its text and the frame boxes.
   *
   * This is the two-way part: resizing, or editing, anywhere in the chain
   * re-flows all of it, because the frames hold a character range rather than
   * a copy of the text. Returns the per-frame windows, or an empty array when
   * the chain is gone.
   */
  reflowThread(root: paper.PointText): FlowWindow[] {
    const engine = this.engine
    if (!engine || !root.parent) return []
    const frames = this.threadFrames(root)
    const raw = this.threadText(root)
    const boxes = frames.map((frame) => {
      const info = this.areaInfo(frame)
      const width = Math.max(info?.frame.width ?? MIN_FRAME_SPAN, MIN_FRAME_SPAN)
      const height = Math.max(info?.frame.height ?? MIN_FRAME_SPAN, MIN_FRAME_SPAN)
      return { width, height }
    })
    const settings = this.paragraphSettings(frames[0])
    const windows = flowTextThroughFrames(raw, boxes, {
      leading: this.effectiveLeading(),
        measure: (line) => this.measureLineWidth(line, this.metricsFor(frames[0])),
      settings,
      minSpan: MIN_FRAME_SPAN,
    })
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i]
      const window = windows[i]
      if (!frame.parent || !window) continue
      if (frame.content !== window.content) frame.content = window.content
      // `raw` stays the author's text on the frame that owns it; the
      // continuation frames carry their window instead, so a stale copy can
      // never be mistaken for the source.
      if (i === 0) (frame.data as any).raw = raw
      else (frame.data as any).raw = raw.slice(window.start, window.end)
      ;(frame.data as any).threadStart = window.start
      ;(frame.data as any).threadEnd = window.end
      ;(frame.data as any).laidLines = window.lines
    }
    engine.scope.view.update()
    return windows
  }

  /**
   * Resize an area frame and re-wrap its text.
   *
   * When the frame is part of a thread the whole chain re-flows, which is the
   * difference from the one-way version: a taller *second* frame pulls text
   * back out of the first one instead of leaving both frames as they were.
   */
  resizeAreaItem(item: paper.PointText, width: number, height: number): boolean {
    const engine = this.engine
    if (!engine || !item.parent) return false
    if (!Number.isFinite(width) || !Number.isFinite(height)) return false
    if (width < MIN_FRAME_SPAN || height < MIN_FRAME_SPAN) return false
    const info = this.areaInfo(item)
    if (!info) return false
    const frame: TextFrame = { ...info.frame, width, height }
    // layoutFrame reserves the indent out of the width, so the first line of
    // every paragraph still fits the frame after the spaces go in front of it.
      const { content } = this.layoutFrame(
        this.threadText(this.threadRoot(item)),
        width,
        this.paragraphSettings(item),
        this.metricsFor(this.threadRoot(item))
      )
    item.content = content
    item.point = this.frameAnchor(frame)
    ;(item.data as any).frame = { ...frame }
    if (this.isThreaded(item)) {
      this.reflowThread(this.threadRoot(item))
    } else {
      ;(item.data as any).raw = this.threadText(item)
    }
    engine.scope.view.update()
    return true
  }

  /** Whether an item is one of the frames in a multi-frame thread. */
  isThreaded(item: paper.PointText): boolean {
    return !!(
      (item.data as any)?.threadNext ||
      (item.data as any)?.threadPrev ||
      this.threadFrames(item).length > 1
    )
  }

  /**
   * Commit an edit made in one frame of a thread.
   *
   * The frames share one text, so an edit in frame two is spliced into the
   * root at exactly the range frame two owns and the chain re-flows. Editing
   * the root replaces the whole text, as usual.
   */
  private commitThreadedText(item: paper.PointText, raw: string): boolean {
    const engine = this.engine
    if (!engine || !item.parent) return false
    const root = this.threadRoot(item)
    if (root === item) {
      root.data = { ...(root.data as any), raw }
      this.reflowThread(root)
      return true
    }
    const start = Number((item.data as any)?.threadStart)
    const previous = typeof (item.data as any)?.raw === 'string' ? ((item.data as any).raw as string) : ''
    const whole = this.threadText(root)
    const from = Number.isFinite(start) ? start : whole.length
    root.data = {
      ...(root.data as any),
      raw: spliceThreadedText(whole, from, from + previous.length, raw),
    }
    this.reflowThread(root)
    return true
  }

  /**
   * Flow an area item's overflow into a new linked frame placed to its right.
   *
   * The new frame is linked in both directions and the chain re-flows, so the
   * first frame keeps the author's *whole* text and only shows what fits. The
   * old version truncated the first frame's text to the lines it kept, so the
   * two frames were independent afterwards and a resize could not move text
   * between them.
   *
   * Returns false when there is nothing to flow.
   */
  flowOverflowToNewFrame(item: paper.PointText): boolean {
    const engine = this.engine
    if (!engine || !item.parent) return false
    const info = this.areaInfo(item)
    if (!info) return false
    // The overflow has to be counted after paragraph layout: blank spacer
    // lines and the indent occupy the frame like any other line, and a
    // paragraph that does not fit in this frame at all is the common case.
    const root = this.threadRoot(item)
    const settings = this.paragraphSettings(root)
    const width = Math.max(info.frame.width, MIN_FRAME_SPAN)
      const laid = this.layoutFrame(this.threadText(root), width, settings, this.metricsFor(root))
    const lines = laid.content === '' ? [] : laid.content.split('\n')
    const leading = this.effectiveLeading()
    const fits = Math.max(1, Math.floor(info.frame.height / (leading || 1)))
    if (lines.length <= fits) return false
    const gap = 16
    const nextFrame: TextFrame = {
      x: info.frame.x + info.frame.width + gap,
      y: info.frame.y,
      width: info.frame.width,
      height: info.frame.height,
    }
    // An empty continuation, linked to the frame it continues: the text comes
    // from the reflow, not from a copy made here.
    const created = this.createTextItem('', this.frameAnchor(nextFrame), {
      textMode: 'area',
      raw: '',
      frame: { ...nextFrame },
      paragraphs: settings,
    }, 'Thread Text', false)
    ;(created.data as any).threadPrev = (item.data as any)?.id ?? ''
    // The chain grows after the frame that was threaded, not after the root:
    // linking on the root would replace the link to an existing continuation
    // and strand it.
    ;(item.data as any).threadNext = (created.data as any)?.id ?? ''
    // The whole text stays on the root; the reflow hands each frame its slice.
    this.reflowThread(root)
    engine.selectItem(root)
    engine.pushHistory('Thread Text')
    return true
  }

  /**
   * Wrap raw text (explicit newlines kept) into frame-width lines.
   *
   * The breaking rules live in ./line-break so they can be unit tested
   * without a canvas; this only supplies the measurement probe.
   */
  private wrapLines(raw: string, maxWidth: number, metrics?: TextMetrics): string[] {
    return wrapText(raw, maxWidth, (line) => this.measureLineWidth(line, metrics))
  }

  /**
   * Wrap and then apply the item's paragraph settings: first-line indent and
   * the vertical spacing. Returns the content string plus how many lines it
   * occupies, because spacer lines and the indent change the count the frame
   * has to fit.
   *
   * The indent is reserved out of the frame before wrapping rather than
   * appended afterwards: a first line that would run past the frame edge has
   * to be re-wrapped narrower, and padding it after the fact would overflow.
   *
   * `metrics` is the item's own font. Without it the layout falls back to the
   * type tool's current style, which is wrong for every item that is not
   * exactly that style.
   */
  private layoutFrame(
    raw: string,
    maxWidth: number,
    settings: ParagraphSettings,
    metrics?: TextMetrics
  ): { content: string; lineCount: number } {
    const measure = (line: string) => this.measureLineWidth(line, metrics)
    const indent = normalizeParagraphSettings(settings).firstLineIndent
    const out: Array<{ text: string; paragraph: number }> = []
    raw.split('\n').forEach((paragraph, index) => {
      let lines = wrapParagraph(paragraph, maxWidth, measure)
      if (indent > 0 && lines.length > 0 && measure(lines[0]) + indent > maxWidth) {
        lines = wrapParagraph(paragraph, Math.max(1, maxWidth - indent), measure)
      }
      for (const text of lines) out.push({ text, paragraph: index })
    })
    const laid = layoutParagraphs(out, settings, measure)
    return { content: laid.map((line) => line.text).join('\n'), lineCount: laid.length }
  }

  /**
   * Metrics for a text item, falling back to the type tool's current style for
   * an item that has no font of its own (a legacy item, or a frame being laid
   * out before it exists).
   */
  private metricsFor(item?: paper.Item | null): TextMetrics {
    const charStyle = this.engine?.store.charStyle
    const fallback = {
      fontSize: Number(charStyle?.fontSize) || 12,
      fontFamily: charStyle?.fontFamily || 'sans-serif',
      fontWeight: charStyle?.fontWeight || 'normal',
      fontStyle: charStyle?.fontStyle || 'normal',
      tracking: Number(charStyle?.tracking) || 0,
    }
    return item ? metricsForItem(item, fallback) : metricsForStyle(fallback)
  }

  /** Canvas font string for a set of metrics. */
  private textMeasureFont(metrics?: TextMetrics): string {
    return (metrics ?? this.metricsFor()).font
  }

  /**
   * Width of one line in document units, tracking-aware.
   *
   * The probe measures with the browser's own kerning, which is what the
   * renderer does too, so a line that measures as fitting does fit.
   */
  private measureLineWidth(line: string, metrics?: TextMetrics): number {
    if (!this.measureCtx) {
      const canvas = document.createElement('canvas')
      this.measureCtx = canvas.getContext('2d')
    }
    const resolved = metrics ?? this.metricsFor()
    if (!this.measureCtx) {
      return lineWidth(line, resolved, (text) => text.length * (resolved.fontSize * 0.5))
    }
    this.measureCtx.font = this.textMeasureFont(resolved)
    return lineWidth(line, resolved, (text) => this.measureCtx!.measureText(text).width)
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
      const data = (item as any).data ?? {}
      const align = normalizeAlign(
        (data as { align?: unknown }).align ?? (item as any).justification
      )
      return {
        fontFamily: item.fontFamily || 'Arial',
        fontWeight: (item.fontWeight as string | number) ?? 'normal',
        fontStyle: ((item as any).fontStyle as string) ?? 'normal',
        fontSize: Number(item.fontSize) || 12,
        color: item.fillColor ? item.fillColor.toCSS(true) : '#000000',
        justification: paperJustificationFor(align),
        cssAlign: cssTextAlignFor(align),
      }
    }
    const charStyle = engine.store.charStyle
    const align = normalizeAlign(engine.store.paragraphStyle.align)
    return {
      fontFamily: charStyle.fontFamily,
      fontWeight: charStyle.fontWeight,
      fontStyle: charStyle.fontStyle,
      fontSize: charStyle.fontSize,
      color: engine.store.style.fillColor || '#000000',
      justification: paperJustificationFor(align),
      cssAlign: cssTextAlignFor(align),
    }
  }

  /** Get the OpenType features CSS string for the current session. */
  private sessionOpenType(): string {
    const ot = this.sessionCharStyle().openType
    if (!ot) return '"liga" 1'
    const parts: string[] = []
    if (ot.liga) parts.push('"liga" 1')
    if (ot.dlig) parts.push('"dlig" 1')
    if (ot.smallCaps) parts.push('"smcp" 1')
    if (ot.oldstyleNums) parts.push('"onum" 1')
    if (ot.tabularNums) parts.push('"tnum" 1')
    if (ot.fractions) parts.push('"frac" 1')
    if (ot.superscript) parts.push('"sups" 1')
    if (ot.subscript) parts.push('"subs" 1')
    return parts.length > 0 ? parts.join(', ') : 'normal'
  }

  /** Get the CharStyle for the current session (editing item or store default). */
  private sessionCharStyle() {
    const engine = this.engine!
    if (this.editingItem) {
      const data = (this.editingItem as any).data ?? {}
      return {
        openType: data.openType ?? engine.store.charStyle.openType,
      }
    }
    return engine.store.charStyle
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
    style.textAlign = type.cssAlign
    if (type.justification === 'center') {
      style.transform = 'translateX(-50%)'
    } else if (type.justification === 'right') {
      style.transform = 'translateX(-100%)'
    }
    // Apply OpenType feature settings
    const ot = this.sessionOpenType()
    style.fontFeatureSettings = ot
    style.fontVariantCaps = this.sessionCharStyle().openType?.smallCaps ? 'small-caps' : 'normal'

    overlay.addEventListener('input', () => this.autoSize())
    overlay.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        this.commit()
        return
      }
      // Point text is single-line (AI): Enter commits the session. Area,
      // path and vertical sessions keep Enter as a line break. The guard
      // keeps IME composition confirmation from committing early.
      if (
        e.key === 'Enter' &&
        !e.isComposing &&
        !e.ctrlKey && !e.metaKey && !e.altKey &&
        this.activeKind() === 'point'
      ) {
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

  // ------------------------------------------------------------------
  // Per-character styled runs rendering (AI/CDR parity)
  // ------------------------------------------------------------------

  /**
   * Replace a single PointText with a Group of PointTexts, one per styled
   * run. Each glyph run is positioned to match the original text layout.
   * Returns the new group (or the original item if no runs exist).
   */
  renderStyledRuns(item: paper.PointText): paper.Item {
    const engine = this.engine
    if (!engine) return item
    const runs = ((item.data as any)?.runs as Array<{ start: number; end: number; style: Record<string, any> }>) ?? []
    if (runs.length === 0) return item

    const scope = engine.scope
    const content = (item as any).raw as string | undefined ?? item.content
    if (!content || content.length === 0) return item

    // Build a canvas context for measuring character advances.
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')!
    const baseFontSize = Number(item.fontSize) || 12
    const baseFontFamily = (item.fontFamily as string) || 'Arial'
    const baseFontWeight = (item.fontWeight as string | number) ?? 'normal'
    const baseFontStyle = ((item as any).fontStyle as string) ?? 'normal'
    const justification = ((item as any).justification as string) ?? 'left'
    const baseLeading = Number((item as any).leading) || baseFontSize * 1.2

    // Measure full text width for justification offset.
    ctx.font = `${baseFontStyle} ${baseFontWeight} ${baseFontSize}px ${baseFontFamily}`
    const totalW = ctx.measureText(content).width

    const group = new scope.Group() as paper.Group
    group.data.id = (item.data as any)?.id ?? engine.genId()
    group.data.isUserItem = true
    group.data.textMode = (item.data as any)?.textMode ?? 'point'
    group.data.raw = (item as any).raw ?? content
    group.data.openType = { ...((item.data as any)?.openType ?? {}) }
    group.data.align = normalizeAlign((item.data as any)?.align)
    if ((item.data as any)?.frame) group.data.frame = { ...(item.data as any).frame }
    if ((item.data as any)?.annotation) group.data.annotation = true
    if ((item.data as any)?.isCallout) group.data.isCallout = true

    // Build a default style from the base item.
    const baseStyle: Record<string, any> = {
      fontFamily: baseFontFamily,
      fontSize: baseFontSize,
      fontWeight: baseFontWeight,
      fontStyle: baseFontStyle,
      fillColor: item.fillColor ? item.fillColor.toCSS(true) : '#000000',
      underline: !!(item.data as any)?.underline,
      strikethrough: !!(item.data as any)?.strikethrough,
    }

    let cursor = 0
    for (const run of runs) {
      const runContent = content.substring(run.start, run.end)
      if (runContent.length === 0) continue

      const runStyle = { ...baseStyle, ...run.style }
      const fontSize = Number(runStyle.fontSize) || baseFontSize
      const fontFamily = runStyle.fontFamily || baseFontFamily
      const fontWeight = runStyle.fontWeight ?? baseFontWeight
      const fontStyle = runStyle.fontStyle ?? baseFontStyle

      ctx.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
      const runW = ctx.measureText(runContent).width

      // Compute x position: advance from the start of the full text.
      const beforeW = ctx.measureText(content.substring(0, run.start)).width
      let x: number
      if (justification === 'center') {
        x = item.point.x - totalW / 2 + beforeW
      } else if (justification === 'right') {
        x = item.point.x - totalW + beforeW
      } else {
        x = item.point.x + beforeW
      }

      const leading = fontSize * 1.2
      const glyph = new scope.PointText({
        point: new scope.Point(x, item.point.y),
        content: runContent,
        fontFamily,
        fontWeight,
        fontStyle,
        fontSize,
        leading,
        fillColor: new scope.Color(runStyle.fillColor),
        justification: 'left',
      }) as paper.PointText

      if (runStyle.underline) (glyph.data as any).underline = true
      if (runStyle.strikethrough) (glyph.data as any).strikethrough = true

      group.addChild(glyph)
      cursor = run.end
    }

    // Replace the original item in the layer.
    const parent = item.parent
    const index = parent ? parent.children.indexOf(item) : -1
    item.remove()
    if (parent && index >= 0) {
      parent.insertChild(index, group)
    } else {
      engine.getActiveLayer().addChild(group)
    }

    return group
  }
}
