/**
 * Width profiles: applying and re-editing variable-width strokes.
 *
 * The profile is the source of truth and the outline is its rendering, so
 * every path into a variable width goes through here: the Width tool's commit,
 * the panel's "apply profile", and the "release" that turns an expanded
 * outline back into the stroked path it came from.
 *
 * An expanded item keeps two things in its data: the profile, and the source
 * path it was expanded from. Without the source there is nothing to re-expand
 * from, which is what made the old expand a one-way trip.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import {
  expandVariableWidth,
  makeProfile,
  normalizeProfile,
  profileMaxWidth,
  type WidthProfile,
} from './path-drawing/width-profile'

/** What an expanded stroke remembers about where it came from. */
export interface WidthSource {
  /** The stroked path, as paper JSON, so the stroke can come back. */
  pathJson: string
  strokeColor: string | null
  strokeWidth: number
  opacity: number
  blendMode?: string
}

/**
 * Items a width profile may be applied to: plain stroked paths.
 *
 * A path with no stroke is refused: expanding it would invent a filled shape
 * out of a line that was only ever a guide, which is not what "apply a width"
 * means.
 */
function profileTargets(e: EditorEngine): paper.Path[] {
  return e
    .getSelection()
    .filter(
      (item) =>
        !item.locked &&
        item.parent &&
        item instanceof e.scope.Path &&
        !(item instanceof e.scope.CompoundPath) &&
        !((item.data as any)?.textMode || (item.data as any)?.isPatternTile || (item.data as any)?.isPreview) &&
        !!(item as any).strokeColor &&
        (item as any).strokeWidth > 0
    ) as paper.Path[]
}

/** The profile stored on an item, if it is an expanded stroke. */
export function widthProfileOf(e: EditorEngine, item: paper.Item | null): WidthProfile | null {
  const data = (item?.data as any) ?? {}
  if (!data.widthProfile) return null
  return normalizeProfile(data.widthProfile, String(data.widthProfileId ?? ''), 'Profile')
}

/**
 * Expand one path with a profile, replacing it in place.
 *
 * The source path is kept on the new item, so the width can be released again
 * or re-expanded with a different profile without going back to the original
 * file. Returns the new outline, or null when the path has nothing to expand.
 */
export function expandWithProfile(
  e: EditorEngine,
  path: paper.Path,
  profile: WidthProfile,
  historyLabel = 'Apply Width Profile'
): paper.Path | null {
  const scope = e.scope
  const clean = normalizeProfile(profile)
  if (!(clean.baseWidth > 0) || !(path.length > 0)) return null
  const built = expandVariableWidth(scope, path, clean)
  if (!built) return null

  const source: WidthSource = {
    pathJson: path.exportJSON({ asString: true }) as unknown as string,
    strokeColor: (path as any).strokeColor?.toCSS?.() ?? null,
    strokeWidth: Number((path as any).strokeWidth) || clean.baseWidth,
    opacity: (path as any).opacity ?? 1,
    blendMode: (path as any).blendMode,
  }
  const parent = path.parent ?? e.getActiveLayer()
  const at = parent.children.indexOf(path)
  const id = ((path.data as any)?.id as string) || e.genId()
  path.remove()
  built.fillColor = source.strokeColor ? new scope.Color(source.strokeColor) : built.fillColor
  built.data = { ...((built.data as any) ?? {}), id, isUserItem: true }
  built.data.widthProfile = clean
  built.data.widthSource = source
  parent.insertChild(Math.min(Math.max(0, at), parent.children.length), built)
  e.selectItem(built)
  e.pushHistory(historyLabel)
  return built
}

/**
 * Apply a library profile to the selection.
 *
 * Refuses the same things the Width tool refuses (text, compound children,
 * pattern tiles) rather than half-expanding them, and reports what it did so
 * the panel can say so instead of silently doing nothing.
 */
export function applyWidthProfileToSelection(e: EditorEngine, profile: WidthProfile): number {
  const paths = profileTargets(e)
  if (paths.length === 0) {
    e.showStatus('Width profile needs a selected stroked path')
    return 0
  }
  let done = 0
  for (const path of paths) {
    // The panel's stroke width wins: a profile is a shape, not a width.
    const base = Number((path as any).strokeWidth) || profile.baseWidth
    const merged = makeProfile(profile.id, profile.name, base, profile.stops)
    if (expandWithProfile(e, path, merged)) done += 1
  }
  if (done === 0) e.showStatus('Width profile needs a selected stroked path')
  return done
}

/**
 * Change the profile of an already expanded stroke and re-expand it.
 *
 * This is the non-destructive part: the item keeps its identity and its z-order
 * while the shape changes, which an outline could never do.
 */
export function updateItemWidthProfile(e: EditorEngine, item: paper.Item, profile: WidthProfile): boolean {
  const source = (item.data as any)?.widthSource as WidthSource | undefined
  if (!source) return false
  const scope = e.scope
  let path: paper.Path | null = null
  try {
    path = scope.project.importJSON(source.pathJson) as paper.Path
  } catch {
    return false
  }
  if (!path || !(path instanceof scope.Path)) return false
  const parent = item.parent ?? e.getActiveLayer()
  const at = parent.children.indexOf(item)
  const built = expandVariableWidth(scope, path, normalizeProfile(profile))
  path.remove()
  if (!built) return false
  built.data = { ...((item.data as any) ?? {}), id: (item.data as any)?.id ?? e.genId() }
  built.data.widthProfile = normalizeProfile(profile)
  item.remove()
  parent.insertChild(Math.min(Math.max(0, at), parent.children.length), built)
  e.selectItem(built)
  e.pushHistory('Edit Width Profile')
  return true
}

/**
 * Release a width profile: the outline goes back to the stroked path.
 *
 * The path comes back with the same id, name, fill and z-order it had, so
 * releasing a width is as undoable-in-spirit as any other edit: the object is
 * still the object the user made.
 */
export function releaseWidthProfile(e: EditorEngine, item: paper.Item): boolean {
  const source = (item.data as any)?.widthSource as WidthSource | undefined
  if (!source) return false
  const scope = e.scope
  let path: paper.Path | null = null
  try {
    path = scope.project.importJSON(source.pathJson) as paper.Path
  } catch {
    return false
  }
  if (!path || !(path instanceof scope.Path)) return false
  const parent = item.parent ?? e.getActiveLayer()
  const at = parent.children.indexOf(item)
  const data = (item.data as any) ?? {}
  path.data = {
    ...data,
    strokeWidth: source.strokeWidth,
    opacity: source.opacity,
  }
  delete data.widthProfile
  delete data.widthSource
  delete data.widthProfileId
  path.data = data
  ;(path as any).strokeColor = source.strokeColor ? new scope.Color(source.strokeColor) : null
  ;(path as any).strokeWidth = source.strokeWidth
  ;(path as any).opacity = source.opacity
  if (source.blendMode !== undefined) (path as any).blendMode = source.blendMode
  item.remove()
  parent.insertChild(Math.min(Math.max(0, at), parent.children.length), path)
  e.selectItem(path)
  e.pushHistory('Release Width Profile')
  return true
}

/** Save the profile of an item into the library, under a name. */
export function saveItemWidthProfile(e: EditorEngine, item: paper.Item, name: string): string | null {
  const profile = widthProfileOf(e, item)
  if (!profile) {
    e.showStatus('No width profile on this object')
    return null
  }
  const clean = name.trim().slice(0, 40) || profile.name
  const id = e.store.addWidthProfile({ ...profile, id: '', name: clean })
  const next = { ...profile, id, name: clean }
  ;(item.data as any).widthProfile = next
  ;(item.data as any).widthProfileId = id
  e.showStatus(`Saved width profile "${clean}" (max ${Math.round(profileMaxWidth(next) * 100) / 100} pt)`)
  return id
}
