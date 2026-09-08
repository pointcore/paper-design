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
  scissors:        { label: 'C',    match: (e) => !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && key(e) === 'c' },
  rotate:          null,
  scale:           null,
  mirror:          null,
  'free-transform': null,
  'view-hand':     { label: 'H',    match: (e) => key(e) === 'h' },
  zoom:            { label: 'Z',    match: (e) => key(e) === 'z' },
  measure:         null,
  callout:         null,
  'shape-builder': null,
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
  'add-anchor',
  'delete-anchor',
  'line',
  'select',
  'direct-select',
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
 * - Clipboard, history, fit, select, arrange, group, lock, hide, save
 *   and invert shortcuts (Ctrl+C / X / V / F / B / A / G / Shift+G /
 *   Shift+I / S / 2 / Alt+2 / 3 / Alt+3 / Z / Shift+Z / Y / 0 / brackets). Copy also mirrors the selection to the OS clipboard
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
    if (key === 'c') {
      engine?.copySelectedToClipboard()
      engine?.copyToSystemClipboard()?.catch(() => undefined)
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
    } else if (key === 'a') {
      engine?.selectAllArtwork()
      e.preventDefault()
    } else if (key === 'g' && !e.shiftKey && !e.altKey) {
      // Group only claims the key with 2+ selected (browser find-again
      // keeps working otherwise, same conditional pattern as paste).
      if ((engine?.getSelection().length ?? 0) > 1 && engine?.groupSelection()) {
        e.preventDefault()
      }
    } else if (key === 'g' && e.shiftKey && !e.altKey) {
      if (engine?.ungroupSelection()) e.preventDefault()
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
    } else if (e.code === 'BracketRight' && !e.altKey && store.hasSelection) {
      // Physical key positions (layout-independent): ] forward, Shift+] front.
      if (e.shiftKey) engine?.bringSelectionToFront()
      else engine?.bringForward()
      e.preventDefault()
    } else if (e.code === 'BracketLeft' && !e.altKey && store.hasSelection) {
      if (e.shiftKey) engine?.sendSelectionToBack()
      else engine?.sendBackward()
      e.preventDefault()
    }
    return
  }
  if (e.altKey) return
  if (e.key.startsWith('Arrow')) {
    // Arrow-key nudge: move the unlocked selection by the keyboard
    // increment (Shift = x10). Repeats are allowed so holding the key
    // keeps nudging; rapid nudges share one history entry.
    const step = (store.nudgeStep > 0 ? store.nudgeStep : 1) * (e.shiftKey ? 10 : 1)
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
    if (engine?.nudgeSelection(dx, dy)) e.preventDefault()
    return
  }
  if (e.repeat) return

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
