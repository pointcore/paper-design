/**
 * Typed access to the parts of Paper.js the editor actually leans on.
 *
 * Paper.js ships runtime types that cover drawing, but the three surfaces
 * this editor puts to constant use are untyped or absent, so every call site
 * escaped them with a cast:
 *
 *   - `item.data` — our own metadata bag (ids, layer/user flags, transient
 *     markers). The bundled type is `any`, so a misspelled key silently reads
 *     `undefined`: `data.isUserlayer` is not a compile error and behaves
 *     exactly like "this is not a user layer".
 *   - `item.children` — exists on Layer/Group/CompoundPath, not on Item, yet
 *     almost every traversal wants it.
 *   - `locked` / `visible` — declared as plain booleans that are actually
 *     accessors, so writes through the type are unsound.
 *
 * This module is the single place those are named, so the invariants the
 * project already depends on (`.workbuddy-ai/memory/MEMORY.md`: user layers
 * are marked `data.isUserLayer`, items carry `data.id`) become checkable.
 *
 * It imports Paper.js as a type only, so it adds nothing to the bundle.
 */
import type paper from 'paper'

/**
 * Editor metadata carried on `item.data`.
 *
 * Known keys are declared so a typo is a compile error. The index signature
 * keeps the door open for the per-domain extras (appearance stacks, masks,
 * symbol links) that stay declared where they are owned rather than being
 * widened into this one interface.
 */
export interface EditorItemData {
  /** Stable identity used by selection, history and the layer tree. */
  id?: string
  /** Marks artwork the user created, as opposed to system layers/chrome. */
  isUserItem?: boolean
  /** Marks a layer the user manages; at least one must always survive. */
  isUserLayer?: boolean
  /** Layer identity, mirrored into the store's layer list. */
  layerId?: string
  /** Staged by a live gesture; swept instead of committed. */
  isPreview?: boolean
  /** Selection/decoration overlay; swept with the gesture that made it. */
  isChrome?: boolean
  /** Root of a tool-owned overlay layer, removed wholesale on teardown. */
  isChromeRoot?: boolean
  /** Which text tool owns this item. */
  textMode?: string
  [key: string]: unknown
}

/** Any paper item, plus the container surface (`children`) it may expose. */
type MaybeContainer = paper.Item & { children?: paper.Item[] }

/**
 * The item's metadata bag, always an object.
 *
 * Paper only materializes `data` once something writes to it, so reading
 * `.data` on a fresh item yields `undefined` and every `item.data.id` would
 * otherwise need a guard.
 */
export function dataOf(item: paper.Item | null | undefined): EditorItemData {
  if (!item) return {}
  const bag = (item as { data?: EditorItemData }).data
  return bag ?? {}
}

/** Merge into the item's metadata, creating the bag on first write. */
export function writeData(item: paper.Item, patch: EditorItemData): void {
  const target = item as { data?: EditorItemData }
  if (!target.data) target.data = {}
  Object.assign(target.data, patch)
}

/** Child items, or an empty list for leaves. Never throws on a detached item. */
export function childrenOf(item: paper.Item | null | undefined): paper.Item[] {
  if (!item) return []
  const kids = (item as MaybeContainer).children
  return Array.isArray(kids) ? kids : []
}

/** Narrow to something that owns children, for the few callers that need it. */
export function isContainer(item: paper.Item): item is paper.Item & { children: paper.Item[] } {
  return Array.isArray((item as MaybeContainer).children)
}

/** The editor's identity for an item, or '' when it has none. */
export function itemIdOf(item: paper.Item | null | undefined): string {
  const id = dataOf(item).id
  return typeof id === 'string' ? id : ''
}

/** True for artwork the user created (excludes system layers and chrome). */
export function isUserItem(item: paper.Item | null | undefined): boolean {
  return dataOf(item).isUserItem === true
}

/** True for layers the user manages, as opposed to grid/overlay/guides. */
export function isUserLayer(item: paper.Item | null | undefined): boolean {
  return dataOf(item).isUserLayer === true
}

/**
 * Read a boolean Paper property.
 *
 * Paper exposes `locked` and `visible` as getters over internal flags, so the
 * declared boolean is not the stored one; going through a function keeps the
 * read honest and gives one place to change if that ever moves.
 */
export function flagOf(item: paper.Item, flag: 'locked' | 'visible'): boolean {
  return (item as unknown as Record<string, unknown>)[flag] === true
}

/** Write a boolean Paper property. */
export function setFlag(item: paper.Item, flag: 'locked' | 'visible', value: boolean): void {
  ;(item as unknown as Record<string, unknown>)[flag] = value
}

/**
 * Whether an item is the clip mask for its parent.
 *
 * `clipMask` is a marker on the child, not a back-reference: the parent gets
 * `clipped = true` to enable clipping. Paper's getter returns `false` rather
 * than `undefined` when unset, which every call site was casting away to
 * re-ask the same boolean question.
 */
export function isClipMask(item: paper.Item | null | undefined): boolean {
  if (!item) return false
  return (item as { clipMask?: unknown }).clipMask === true
}
