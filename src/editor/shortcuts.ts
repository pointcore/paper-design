/**
 * Global tool-switch keyboard shortcuts.
 *
 * Key presses switch the active tool, matching the shortcuts documented on
 * the ToolRail tooltips / tool type comments. Only single-key accelerators
 * (optionally with Shift) are handled here; multi-key editing shortcuts are
 * owned by the individual tool controllers.
 *
 * The handler is attached once by CanvasHost to `window` so it works
 * regardless of where the canvas focus currently is, but it refuses to act
 * while the user is typing in a text input / textarea / contenteditable.
 */
import type { ToolName } from './types'
import type { EditorEngine } from './engine'
import type { EditorStore } from './store-types'
import type { SelectController } from './selection/select-controller'

/** A single shortcut binding. */
export interface ShortcutDef {
  /** Human readable description, shown in tooltips. */
  label: string
  /** Match predicate - whether the key event triggers this binding. */
  match: (e: KeyboardEvent) => boolean
}

/**
 * The canonical map: shortcut key (as documented on the toolbar) -> tool.
 *
 * A "tool" key is entered as the plain printable character; keys that require
 * Shift are entered as the shifted glyph (e.g. `~`, `C` handled via Shift).
 */
export const TOOL_SHORTCUTS: Record<ToolName, ShortcutDef | null> = {
  select:          { label: 'V',    match: (e) => key(e) === 'v' },
  'direct-select': { label: 'A',    match: (e) => key(e) === 'a' },
  lasso:           { label: 'Q',    match: (e) => key(e) === 'q' },
  pen:             { label: 'P',    match: (e) => key(e) === 'p' },
  curvature:       { label: 'Shift+~', match: (e) => !e.altKey && !e.ctrlKey && !e.metaKey && e.key === '~' },
  'add-anchor':    { label: '+',    match: (e) => !e.altKey && !e.ctrlKey && !e.metaKey && e.key === '+' },
  'delete-anchor': { label: '-',    match: (e) => !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && e.key === '-' },
  'convert-anchor':{ label: 'Shift+C', match: (e) => e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && key(e) === 'c' },
  type:            { label: 'T',    match: (e) => key(e) === 't' },
  'area-type':     null,
  'type-on-path':  null,
  'vertical-type': null,
  line:            { label: '\\',   match: (e) => !e.ctrlKey && !e.metaKey && !e.altKey && e.key === '\\' },
  rect:            { label: 'R',    match: (e) => key(e) === 'r' },
  'rounded-rect':  null,
  ellipse:         { label: 'L',    match: (e) => key(e) === 'l' },
  polygon:         null,
  arc:             null,
  spiral:          null,
  'rect-grid':     null,
  'polar-grid':    null,
  pencil:          { label: 'N',    match: (e) => key(e) === 'n' },
  'blob-brush':    { label: 'Shift+B', match: (e) => e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && key(e) === 'b' },
  brush:           { label: 'B',    match: (e) => !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && key(e) === 'b' },
  eraser:          { label: 'Shift+E', match: (e) => e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && key(e) === 'e' },
  gradient:        { label: 'G',    match: (e) => key(e) === 'g' },
  reshape:         null,
  spray:           null,
  wand:            { label: 'Y',    match: (e) => key(e) === 'y' },
  scissors:        { label: 'C',    match: (e) => !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && key(e) === 'c' },
  width:           { label: 'Shift+W', match: (e) => e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && key(e) === 'w' },
  rotate:          { label: 'Shift+R', match: (e) => e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && key(e) === 'r' },
  scale:           { label: 'Shift+S', match: (e) => e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && key(e) === 's' },
  mirror:          { label: 'Shift+O', match: (e) => e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && key(e) === 'o' },
  'free-transform': { label: 'Shift+F', match: (e) => e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && key(e) === 'f' },
  'view-hand':     { label: 'H',    match: (e) => key(e) === 'h' },
  zoom:            { label: 'Z',    match: (e) => key(e) === 'z' },
  measure:         null,
  callout:         null,
  'shape-builder': { label: 'Shift+M', match: (e) => e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && key(e) === 'm' },
  eyedropper:      { label: 'I',    match: (e) => key(e) === 'i' },
}

/**
 * A flattened list of shortcuts that have a bound key, ordered so that the
 * first match wins. More specific (shifted) bindings are checked before plain
 * letters so e.g. "convert-anchor (Shift+C)" does not collide with a future
 * "c" binding.
 */
const SHORTCUT_ORDER: ToolName[] = [
  'curvature',
  'convert-anchor',
  'shape-builder',
  'width',
  'rotate',
  'scale',
  'mirror',
  'free-transform',
  'add-anchor',
  'delete-anchor',
  'line',
  'select',
  'direct-select',
  'lasso',
  'gradient',
  'wand',
  'pen',
  'pencil',
  'eraser',
  'eyedropper',
  'scissors',
  'blob-brush',
  'brush',
  'type',
  'rect',
  'ellipse',
  'view-hand',
  'zoom',
]

/**
 * Command (non-tool) shortcuts, listed in the Actions panel cheatsheet.
 * Kept here so the cheat sheet and the handlers share one home; the test
 * guards the list against duplicate labels drifting apart.
 */
export const COMMAND_SHORTCUTS: Array<{ label: string; desc: string }> = [
  { label: 'Ctrl+C / X / V', desc: 'Copy / Cut / Paste' },
  { label: 'Ctrl+Shift+C', desc: 'Copy as PNG' },
  { label: 'Ctrl+F / Ctrl+B', desc: 'Paste in Front / Back' },
  { label: 'Ctrl+D', desc: 'Duplicate in Place' },
  { label: 'Ctrl+Shift+D', desc: 'Transform Again' },
  { label: 'Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y', desc: 'Undo / Redo' },
  { label: 'Ctrl+S / Ctrl+Shift+S', desc: 'Save / Save As' },
  { label: 'Ctrl+0 / Ctrl+1', desc: 'Fit to Window / Actual Size' },
  { label: 'Ctrl+= / Ctrl+-', desc: 'Zoom In / Out' },
  { label: 'Ctrl+A', desc: 'Select All' },
  { label: 'Ctrl+Shift+A / Ctrl+6', desc: 'Deselect / Reselect' },
  { label: 'Ctrl+Shift+I', desc: 'Invert Selection' },
  { label: 'Ctrl+G / Ctrl+Shift+G', desc: 'Group / Ungroup' },
  { label: 'Ctrl+J', desc: 'Join Paths' },
  { label: 'Ctrl+2 / Alt+2', desc: 'Lock / Unlock All' },
  { label: 'Ctrl+3 / Alt+3', desc: 'Hide / Show All' },
  { label: '] / [ (+Shift)', desc: 'Forward / Backward (Shift: Front / Back)' },
  { label: 'Ctrl+PgUp / Ctrl+PgDn', desc: 'CDR Forward / Backward (Shift: Front / Back)' },
  { label: 'Ctrl+L / Ctrl+K', desc: 'Combine / Break Apart (CDR)' },
  { label: 'Shift+F2', desc: 'Zoom to Selection' },
  { label: 'F4 / Shift+F4', desc: 'Fit All / Fit Page (CDR)' },
  { label: 'Ctrl+R', desc: 'Toggle Rulers' },
  { label: 'Ctrl+; / Ctrl+"', desc: 'Toggle Guides / Grid' },
  { label: 'Ctrl+Shift+B', desc: 'Toggle Bounding Box' },
  { label: 'X / Shift+X', desc: 'Flip Paint Target / Swap Fill + Stroke' },
  { label: '[ / ] on brush tools', desc: 'Brush Footprint (Shift = x5)' },
  { label: 'Arrow Keys', desc: 'Nudge (Shift x10, Ctrl tenth)' },
  { label: 'Space (hold)', desc: 'Pan with the Hand Tool' },
  { label: 'Tab', desc: 'Presentation Mode' },
]

/** Normalize a key to lowercase so letter matches ignore the Shift/caps state. */
function key(e: KeyboardEvent): string {
  return e.key.toLowerCase()
}

/** True when the target is an editable text field. */
export function isEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return el.isContentEditable
}

/**
 * Shared arrow-key nudge (plain = x1, Shift = x10, Ctrl/Cmd = x0.1 CDR
 * micro nudge). In direct-select with a sub-selection the anchors move
 * instead of whole objects (AI). Repeats are allowed so holding the key
 * keeps nudging; rapid nudges share one history entry.
 */
function applyNudge(
  e: KeyboardEvent,
  store: EditorStore,
  engine: EditorEngine | null,
  factor: number
): void {
  const step = (store.nudgeStep > 0 ? store.nudgeStep : 1) * factor * (e.shiftKey ? 10 : 1)
  const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
  const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
  const direct = engine?.getController('direct-select') as SelectController | null
  if (direct && direct.nudgeSubselection(dx, dy)) {
    e.preventDefault()
    return
  }
  if (engine?.nudgeSelection(dx, dy)) {
    // Whole objects moved with no mouse movement: repaint the AI chrome
    // now or stale outlines linger until the next mousemove.
    direct?.refreshSelectionChrome()
    e.preventDefault()
  }
}

/**
 * Try to resolve the pressed key to a target tool.
 * Returns null when the key does not map to any tool switch.
 */
export function resolveToolShortcut(e: KeyboardEvent): ToolName | null {
  for (const name of SHORTCUT_ORDER) {
    const def = TOOL_SHORTCUTS[name]
    if (def && def.match(e)) return name
  }
  return null
}

/**
 * Global keydown handler for editor shortcuts.
 *
 * Three groups live here:
 * - Clipboard, history, fit, select, arrange, group, lock, hide, save,
 *   grid toggle and invert shortcuts (Ctrl+C / X / V / F / B / A / G /
 *   Shift+G / Shift+I / S / 2 / Alt+2 / 3 / Alt+3 / Z / Shift+Z / Y / 0 /
 *   brackets / Quote / J). Copy also mirrors the selection to the OS clipboard
 *   as SVG (best effort); paste prefers OS clipboard SVG and falls back to
 *   the internal clipboard. They work in every tool context, matching
 *   Illustrator; the text edit overlay is exempt via the editable-target
 *   guard so the browser's own textarea editing keeps working.
 * - Space-pan: holding Space parks the current tool and pans with the hand
 *   tool until release (see handleGlobalKeyUp).
 * - Arrow-key nudge: moves the unlocked selection by the keyboard
 *   increment (Shift = x10).
 * - Single-key tool switching (see resolveToolShortcut).
 */

/** Tool parked while Space-pan holds the hand tool, or null. */
let spacePanPreviousTool: ToolName | null = null
export function handleGlobalKeydown(
  e: KeyboardEvent,
  store: EditorStore,
  engine: EditorEngine | null
): void {
  if (isEditableTarget(e)) return

  if (e.ctrlKey || e.metaKey) {
    const key = e.key.toLowerCase()
    if (e.key.startsWith('Arrow')) {
      // CDR micro nudge: Ctrl/Cmd+Arrow moves a tenth of the increment
      // (Shift still scales it up).
      applyNudge(e, store, engine, 0.1)
      return
    }
    if (key === 'c' && e.shiftKey) {
      // Copy as PNG (raster) instead of the default SVG copy.
      engine?.copyRasterToClipboard(2).then((ok) => {
        if (engine) {
          store.setStatusMessage(ok ? 'PNG copied to clipboard' : 'Copy as PNG failed')
        }
      }).catch(() => undefined)
      e.preventDefault()
    } else if (key === 'c') {
      engine?.copySelectedToClipboard()
      engine?.copyToSystemClipboard()?.catch(() => undefined)
      e.preventDefault()
    } else if (key === 'd' && e.shiftKey) {
      // AI Transform Again. Ctrl+D is duplicate-in-place here (CDR parity),
      // so the repeat-transform lives on Ctrl+Shift+D.
      if (engine && !engine.transformAgain()) {
        store.setStatusMessage('No transform to repeat')
      }
      e.preventDefault()
    } else if (key === 'd') {
      // Duplicate in place claims Ctrl+D (CDR parity); the browser bookmark
      // shortcut never fires from the canvas, like the Ctrl+J download tab.
      if (engine && !engine.duplicateInPlace()) {
        store.setStatusMessage('Nothing to duplicate')
      }
      e.preventDefault()
    } else if (key === 'x') {
      // Capture the OS copy before the cut deletes the selection.
      engine?.copyToSystemClipboard()?.catch(() => undefined)
      engine?.cutSelectedToClipboard()
      e.preventDefault()
    } else if (key === 'v') {
      engine?.pasteWithSystemFallback()?.catch(() => undefined)
      e.preventDefault()
    } else if (key === 'f') {
      // Paste in front only claims the key when it pastes something, so
      // browser find keeps working with an empty internal clipboard.
      if (engine?.pasteInPlace('front')) e.preventDefault()
    } else if (key === 'b' && e.shiftKey) {
      // AI Ctrl+Shift+B: hide/show the selection bounding box (the browser's
      // bookmarks-bar toggle is interceptable; the View menu always works).
      store.updateView({ showBoundingBox: !store.view.showBoundingBox })
      const select = engine?.getController('select') as { dropFrame?: () => void; refreshSelectionChrome?: () => void } | null
      select?.dropFrame?.()
      try {
        select?.refreshSelectionChrome?.()
      } catch { /* chrome repaint must never break shortcuts */ }
      e.preventDefault()
    } else if (key === 'b') {
      if (engine?.pasteInPlace('back')) e.preventDefault()
    } else if (key === 'z' && !e.shiftKey) {
      engine?.undo()
      e.preventDefault()
    } else if ((key === 'z' && e.shiftKey) || key === 'y') {
      engine?.redo()
      e.preventDefault()
    } else if (key === '0') {
      engine?.fitToContent()
      e.preventDefault()
    } else if (key === '1') {
      engine?.zoomToActualSize()
      e.preventDefault()
    } else if (key === '=' || key === '+') {
      // AI-style step zoom (browser zoom is interceptable on these keys);
      // anchors at the view center like the menu presets.
      engine?.zoomAt(1.2)
      e.preventDefault()
    } else if (key === '-') {
      engine?.zoomAt(1 / 1.2)
      e.preventDefault()
    } else if (key === 'r' && !e.shiftKey) {
      // AI/CDR Ctrl+R: toggle rulers (Canvas Settings re-syncs on open;
      // browsers allow this reload shortcut to be intercepted).
      store.updateView({ rulersVisible: !store.view.rulersVisible })
      e.preventDefault()
    } else if (key === 's' && e.shiftKey) {
      // Desktop parity: Ctrl+S downloads, Ctrl+Shift+S opens Save As
      // (the filename dialog is store-shared with the TopBar).
      store.setSaveDialogOpen(true)
      e.preventDefault()
    } else if (key === 's') {
      try {
        engine?.downloadProjectFile()
      } catch {
        store.setStatusMessage('Project save failed')
      }
      e.preventDefault()
    } else if (key === 'i' && e.shiftKey) {
      // Browsers may reserve this for devtools; the menu always works.
      engine?.invertSelection()
      e.preventDefault()
    } else if (key === '6') {
      // AI Ctrl+6: reselect the stashed selection.
      const n = engine?.reselect() ?? 0
      if (engine && n === 0) store.setStatusMessage('Nothing to reselect')
      e.preventDefault()
    } else if (key === 'a' && e.shiftKey) {
      // AI Ctrl+Shift+A: deselect everything (reselect moved to Ctrl+6).
      engine?.clearSelection()
      e.preventDefault()
    } else if (key === 'a') {
      // Direct-select with a path selection takes every anchor (AI Ctrl+A);
      // otherwise the whole artwork is selected.
      const direct = engine?.getController('direct-select') as SelectController | null
      if (!(direct && direct.selectAllSubselection())) {
        engine?.selectAllArtwork()
      }
      e.preventDefault()
    } else if (key === 'g' && !e.shiftKey && !e.altKey) {
      // Group claims the key whenever anything is selected (failing still
      // blocks the browser's find-next, which would otherwise pop up when
      // fewer than two top-level items are selected).
      if ((engine?.getSelection().length ?? 0) > 0) {
        if (!engine?.groupSelection()) {
          store.setStatusMessage('Select 2 or more objects to group')
        }
        e.preventDefault()
      }
    } else if (key === 'g' && e.shiftKey && !e.altKey) {
      if ((engine?.getSelection().length ?? 0) > 0) {
        if (!engine?.ungroupSelection()) {
          store.setStatusMessage('Select a group to ungroup')
        }
        e.preventDefault()
      }
    } else if (key === 'l' && !e.shiftKey && !e.altKey) {
      // CDR Ctrl+L: combine into a compound path (the browser address-bar
      // shortcut is interceptable; the Object menu always works).
      if ((engine?.getSelection().length ?? 0) > 0) {
        if (!engine?.makeCompoundPath()) {
          store.setStatusMessage('Compound needs at least two unlocked paths')
        }
        e.preventDefault()
      }
    } else if (key === 'k' && !e.shiftKey && !e.altKey) {
      // CDR Ctrl+K: break a compound path apart.
      if ((engine?.getSelection().length ?? 0) > 0) {
        if (!engine?.releaseCompoundPath()) {
          store.setStatusMessage('Select a compound path to break apart')
        }
        e.preventDefault()
      }
    } else if (key === '2' && !e.shiftKey && !e.altKey) {
      if ((engine?.getSelection().length ?? 0) > 0) {
        engine?.setSelectedLocked(true)
        e.preventDefault()
      }
    } else if (key === '2' && e.altKey) {
      engine?.unlockAll()
      e.preventDefault()
    } else if (key === '3' && !e.shiftKey && !e.altKey) {
      if ((engine?.getSelection().length ?? 0) > 0) {
        engine?.setSelectedVisible(false)
        e.preventDefault()
      }
    } else if (key === '3' && e.altKey) {
      engine?.showAll()
      e.preventDefault()
    } else if (key === 'j') {
      // AI Ctrl+J: sub-selected endpoints first, then object join.
      // Always consumed so the browser downloads tab never opens.
      const sc = engine?.getController('direct-select') as {
        joinEndpointsFromSubselection?: () => boolean | null
      } | null
      const sub = sc?.joinEndpointsFromSubselection?.() ?? null
      if (sub === false) {
        store.setStatusMessage('Join needs two selected open endpoints')
      } else if (sub !== true && engine && !engine.joinPaths()) {
        store.setStatusMessage('Join needs exactly two unlocked open paths')
      }
      e.preventDefault()
    } else if (e.code === 'BracketRight' && !e.altKey && store.hasSelection) {
      // Physical key positions (layout-independent): ] forward, Shift+] front.
      if (e.shiftKey) engine?.bringSelectionToFront()
      else engine?.bringForward()
      e.preventDefault()
    } else if (e.code === 'BracketLeft' && !e.altKey && store.hasSelection) {
      if (e.shiftKey) engine?.sendSelectionToBack()
      else engine?.sendBackward()
      e.preventDefault()
    } else if (e.key === 'PageUp' && !e.altKey && store.hasSelection) {
      // CDR z-order keys alongside the AI brackets: Ctrl+PgUp forward one,
      // Shift+Ctrl+PgUp all the way to the front.
      if (e.shiftKey) engine?.bringSelectionToFront()
      else engine?.bringForward()
      e.preventDefault()
    } else if (e.key === 'PageDown' && !e.altKey && store.hasSelection) {
      if (e.shiftKey) engine?.sendSelectionToBack()
      else engine?.sendBackward()
      e.preventDefault()
    } else if (e.code === 'Semicolon' && !e.altKey) {
      // AI Ctrl+; : toggle guides (the grid lives on Ctrl+"). CanvasHost
      // watches the flag and refreshes the guide layer.
      store.updateView({ showGuides: !store.view.showGuides })
      e.preventDefault()
    } else if (e.code === 'Quote' && !e.altKey) {
      // AI-style grid toggle (Ctrl+" / Ctrl+': physical key, any shift).
      store.updateView({ showGrid: !store.view.showGrid })
      engine?.refreshGrid()
      e.preventDefault()
    }
    return
  }
  if (e.altKey) return
  // CDR page navigation: plain PgUp/PgDn move between artboards (the Ctrl
  // variants above own z-order; the canvas never scrolls, so consuming the
  // browser default loses nothing).
  if (e.key === 'PageUp' && !e.shiftKey) {
    if (!engine?.navigateArtboards(-1)) {
      store.setStatusMessage('Already on the first artboard')
    }
    e.preventDefault()
    return
  }
  if (e.key === 'PageDown' && !e.shiftKey) {
    if (!engine?.navigateArtboards(1)) {
      store.setStatusMessage('Already on the last artboard')
    }
    e.preventDefault()
    return
  }
  if (e.key.startsWith('Arrow')) {
    applyNudge(e, store, engine, 1)
    return
  }
  if (e.repeat) return

  // Brush footprint [ ] (AI): shrink/grow blob, brush and eraser.
  // Repeats allowed so holding the bracket keeps resizing.
  if ((e.code === 'BracketLeft' || e.code === 'BracketRight') && !e.altKey) {
    if (store.tool === 'blob-brush' || store.tool === 'brush' || store.tool === 'eraser') {
      const delta = (e.code === 'BracketRight' ? 2 : -2) * (e.shiftKey ? 5 : 1)
      const next = Math.min(200, Math.max(1, Math.round(Number(store.brushSize ?? 20) + delta)))
      store.setBrushSize(next)
      const ctrl = engine?.getController(store.tool) as { refreshCursor?: () => void } | null
      try {
        ctrl?.refreshCursor?.()
      } catch { /* cursor repaint must never break shortcuts */ }
      e.preventDefault()
      return
    }
  }

  if (e.repeat) return

  // Zoom to selection (CDR Shift+F2 parity; the View menu owns the command).
  if (e.key === 'F2' && e.shiftKey && !e.altKey) {
    if (store.hasSelection) engine?.zoomToSelection()
    else store.setStatusMessage('Nothing selected to zoom to')
    e.preventDefault()
    return
  }

  // CDR zoom keys: F4 frames all artwork, Shift+F4 frames the active page.
  if (e.key === 'F4' && !e.altKey) {
    if (e.shiftKey) engine?.zoomToArtboard()
    else engine?.fitToContent()
    e.preventDefault()
    return
  }

  // Fill/stroke target (AI X / Shift+X parity): plain X flips the paint
  // target, Shift+X swaps the paints everywhere.
  if (key(e) === 'x') {
    if (e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      engine?.swapFillStroke()
    } else if (!e.shiftKey && !e.altKey) {
      store.togglePaintTarget()
    }
    e.preventDefault()
    return
  }

  // Presentation mode: Tab hides every panel and bar (AI Tab parity).
  if (e.key === 'Tab') {
    store.setZenMode(!store.ui.zenMode)
    e.preventDefault()
    return
  }

  // Hold Space to pan with the hand tool from any other tool.
  if (e.key === ' ' && !spacePanPreviousTool && store.tool !== 'view-hand') {
    spacePanPreviousTool = store.tool
    store.setTool('view-hand')
    engine?.setTool('view-hand')
    e.preventDefault()
    return
  }

  const tool = resolveToolShortcut(e)
  if (!tool || tool === store.tool) return

  // Synchronize both the store and the engine exactly like ToolRail does.
  store.setTool(tool)
  if (engine) engine.setTool(tool)
  // The shortcut is consumed so it never leaks into tool-level key handlers.
  e.preventDefault()
}

/**
 * Global keyup handler: releasing Space restores the tool parked by
 * Space-pan. Preventing default also stops a focused button from
 * re-triggering on the same keystroke.
 */
export function handleGlobalKeyUp(
  e: KeyboardEvent,
  store: EditorStore,
  engine: EditorEngine | null
): void {
  if (e.key !== ' ' || !spacePanPreviousTool) return
  const previous = spacePanPreviousTool
  spacePanPreviousTool = null
  store.setTool(previous)
  engine?.setTool(previous)
  e.preventDefault()
}
