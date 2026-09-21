/**
 * Text-run domain (C1: eleventh slice out of engine.ts).
 *
 * Delegation target for point-text ops (placeholder, case, threads,
 * find/replace, stats): each function takes the engine as an explicit
 * first argument and otherwise runs the historical method body
 * unchanged. The EditorEngine import is type-only, so the runtime
 * dependency flows one way (engine → engine-text). The private
 * `allTextRuns` helper moves along as a module function since all of
 * its callers live in this domain.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import { changeCaseText } from './text/text-case'

export function fillPlaceholder(e: EditorEngine): number {
  const scope = e.scope
  const sentence = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.'
  const passage =
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor ' +
    'incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud ' +
    'exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.'
  let changed = 0
  for (const item of e.getSelection()) {
    if ((item as any).locked || !(item instanceof scope.PointText)) continue
    if ((item as any).data?.annotation) continue
    const mode = (item as any).data?.textMode as string | undefined
    ;(item as any).content = mode && mode !== 'point' ? passage : sentence
    changed++
  }
  if (changed > 0) {
    e.pushHistory('Fill Placeholder Text')
    e.scope.view.update()
  }
  return changed
}

/**
 * UPPER / lower / Title Case selected point text (AI Change Case
 * parity, annotation labels excluded). Returns runs changed.
 */
export function changeCase(e: EditorEngine, mode: 'upper' | 'lower' | 'title'): number {
  const scope = e.scope
  let changed = 0
  for (const item of e.getSelection()) {
    if ((item as any).locked || !(item instanceof scope.PointText)) continue
    if ((item as any).data?.annotation) continue
    const before = String((item as any).content ?? '')
    const after = changeCaseText(before, mode)
    if (after !== before) {
      ;(item as any).content = after
      changed++
    }
  }
  if (changed > 0) {
    e.pushHistory('Change Case')
    e.scope.view.update()
  }
  return changed
}

/**
 * Break thread links on selected text frames (both directions): linked
 * siblings forget the frame, the frame forgets them. Content stays put.
 * Returns frames unlinked; one history entry.
 */
export function unlinkTextFrames(e: EditorEngine): number {
  const scope = e.scope
  let changed = 0
  for (const item of e.getSelection()) {
    if ((item as any).locked || !(item instanceof scope.PointText)) continue
    const data = (item as any).data ?? {}
    const links = [data.threadNext, data.threadPrev].filter(
      (id): id is string => typeof id === 'string' && id.length > 0
    )
    if (links.length === 0) continue
    for (const id of links) {
      const other = e.getItemById(id) as any
      if (!other?.data) continue
      if (other.data.threadNext === data.id) delete other.data.threadNext
      if (other.data.threadPrev === data.id) delete other.data.threadPrev
    }
    delete data.threadNext
    delete data.threadPrev
    changed++
  }
  if (changed > 0) {
    e.pushHistory('Unlink Text')
    e.scope.view.update()
  }
  return changed
}

/**
 * Thread selected area frames left-to-right (AI thread-text parity):
 * each frame links to the next, replacing existing links on the chain.
 * Needs 2+ unlocked area frames. One history entry.
 */
export function threadSelectedFrames(e: EditorEngine): number {
  const scope = e.scope
  const frames = e.getSelection().filter(
    (item) =>
      !(item as any).locked &&
      item.parent &&
      item instanceof scope.PointText &&
      (item as any).data?.textMode === 'area' &&
      !(item as any).data?.annotation
  ) as paper.PointText[]
  if (frames.length < 2) return 0
  const ordered = frames.slice().sort((a, b) => {
    const fa = (a as any).data?.frame
    const fb = (b as any).data?.frame
    const ax = Number(fa?.x) || 0
    const bx = Number(fb?.x) || 0
    if (ax !== bx) return ax - bx
    return (Number(fa?.y) || 0) - (Number(fb?.y) || 0)
  })
  // Detach the chain members first so no stale cross-links survive.
  for (const frame of ordered) {
    const data = (frame as any).data ?? ((frame as any).data = {})
    if (typeof data.id !== 'string' || !data.id) data.id = e.genId()
    for (const id of [data.threadNext, data.threadPrev]) {
      if (typeof id !== 'string' || !id) continue
      const other = e.getItemById(id) as any
      if (!other?.data) continue
      if (other.data.threadNext === data.id) delete other.data.threadNext
      if (other.data.threadPrev === data.id) delete other.data.threadPrev
    }
    delete data.threadNext
    delete data.threadPrev
  }
  for (let i = 0; i + 1 < ordered.length; i++) {
    const a = (ordered[i] as any).data
    const b = (ordered[i + 1] as any).data
    a.threadNext = b.id
    b.threadPrev = a.id
  }
  e.pushHistory('Thread Text')
  e.scope.view.update()
  return ordered.length
}

/**
 * Jump the selection along a thread chain (prev/next frame). Needs a
 * single selected area frame with that link. No history (selection).
 */
export function selectThreadNeighbor(e: EditorEngine, direction: 'next' | 'prev'): boolean {
  const scope = e.scope
  const items = e.getSelection()
  if (items.length !== 1) return false
  const item = items[0]
  if (!(item instanceof scope.PointText) || (item as any).data?.textMode !== 'area') return false
  const id = (item as any).data?.[direction === 'next' ? 'threadNext' : 'threadPrev']
  if (typeof id !== 'string' || !id) return false
  const other = e.getItemById(id)
  if (!other) return false
  e.clearSelection()
  other.selected = true
  e.syncSelectionToStore()
  e.scope.view.update()
  return true
}

/** Every text run in the document (annotation labels excluded). */
function allTextRuns(e: EditorEngine): paper.PointText[] {
  const scope = e.scope
  const out: paper.PointText[] = []
  const walk = (node: paper.Item) => {
    const data = (node as any).data ?? {}
    if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard || data.annotation) return
    if (node instanceof scope.PointText) {
      out.push(node)
      return
    }
    const children = (node as any).children as paper.Item[] | undefined
    if (children) for (const child of children) walk(child)
  }
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer) continue
    for (const child of layer.children) walk(child as paper.Item)
  }
  return out
}

/**
 * Text runs whose content contains the query (AI Find parity).
 * Empty queries match nothing; matching is case-sensitive and
 * whole-word on demand.
 */
export function findText(e: EditorEngine, query: string, matchCase = false, wholeWord = false): paper.PointText[] {
  if (!query) return []
  const test = (content: string): boolean => {
    if (wholeWord) {
      const flags = matchCase ? 'g' : 'gi'
      try {
        return new RegExp(`\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, flags).test(content)
      } catch {
        return false
      }
    }
    const needle = matchCase ? query : query.toLowerCase()
    return matchCase ? content.includes(needle) : content.toLowerCase().includes(needle)
  }
  return allTextRuns(e).filter((item) => test(String((item as any).content ?? '')))
}

/**
 * Replace the query across selected text runs (AI Change/Change All
 * parity). Returns runs changed; one history entry.
 */
export function replaceText(e: EditorEngine, find: string, replace: string, matchCase = false, wholeWord = false): number {
  if (!find) return 0
  const scope = e.scope
  const pattern = wholeWord
    ? new RegExp(`\\b${find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, matchCase ? 'g' : 'gi')
    : null
  let changed = 0
  for (const item of e.getSelection()) {
    if ((item as any).locked || !(item instanceof scope.PointText)) continue
    if ((item as any).data?.annotation) continue
    const before = String((item as any).content ?? '')
    let after = before
    try {
      after = pattern
        ? before.replace(pattern, replace)
        : matchCase
          ? before.split(find).join(replace)
          : before.replace(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replace)
    } catch {
      continue
    }
    if (after !== before) {
      ;(item as any).content = after
      changed++
    }
  }
  if (changed > 0) {
    e.pushHistory('Replace Text')
    e.scope.view.update()
  }
  return changed
}

/** Word/character totals over the selection (else the document). */
export function textStats(e: EditorEngine): { words: number; chars: number; runs: number } {
  const scope = e.scope
  const sel = e.getSelection().filter(
    (item) => !(item as any).locked && item instanceof scope.PointText && !(item as any).data?.annotation
  ) as paper.PointText[]
  const runs = sel.length > 0 ? sel : allTextRuns(e)
  let words = 0
  let chars = 0
  for (const item of runs) {
    const content = String((item as any).content ?? '')
    chars += content.length
    words += content.trim().split(/\s+/).filter(Boolean).length
  }
  return { words, chars, runs: runs.length }
}
