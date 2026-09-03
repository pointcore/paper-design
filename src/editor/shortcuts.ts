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
  pencil:          null,
  'blob-brush':    null,
  brush:           null,
  eraser:          null,
  scissors:        null,
  rotate:          null,
  scale:           null,
  mirror:          null,
  'free-transform': null,
  'view-hand':     { label: 'H',    match: (e) => key(e) === 'h' },
  zoom:            { label: 'Z',    match: (e) => key(e) === 'z' },
  measure:         null,
  callout:         null,
  'shape-builder': null,
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
 * Global keydown handler for tool switching.
 * Attach to `window`; returns early when typing in a text field or when a
 * modifier (Ctrl/Meta/Alt) that should be preserved is held.
 */
export function handleGlobalKeydown(
  e: KeyboardEvent,
  store: EditorStore,
  engine: EditorEngine | null
): void {
  if (isEditableTarget(e)) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.repeat) return

  const tool = resolveToolShortcut(e)
  if (!tool || tool === store.tool) return

  // Synchronize both the store and the engine exactly like ToolRail does.
  store.setTool(tool)
  if (engine) engine.setTool(tool)
  // The shortcut is consumed so it never leaks into tool-level key handlers.
  e.preventDefault()
}
