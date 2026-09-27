/**
 * Clipboard domain (C1: slice out of engine.ts).
 *
 * Internal instant clipboard (paste-remembers-layers, offset stepping,
 * paste on all artboards) plus OS SVG exchange with external-copy
 * detection: each function takes the engine as an explicit first argument
 * and otherwise runs the historical method body unchanged. The EditorEngine
 * import is type-only, so the runtime dependency flows one way
 * (engine → engine-clipboard). The clipboard state fields live on the
 * engine as internal-public members (F4 slice pattern).
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'

/** OS clipboard handle, or null outside secure contexts. */
function systemClipboard(): Clipboard | null {
  if (typeof navigator === 'undefined') return null
  return navigator.clipboard ?? null
}

/** Restart paste-offset stepping (history restores land back at the source). */
export function resetPasteOffset(e: EditorEngine): void {
  e.pasteCount = 0
}

/**
 * Copy the current selection onto the internal clipboard as detached
 * clones. Returns how many items were copied. This stays synchronous for
 * instant in-app use; system clipboard exchange lives in
 * copyToSystemClipboard / pasteWithSystemFallback.
 */
export function copySelectedToClipboard(e: EditorEngine): number {
  const items = e.getSelection().filter((item) => (item.data as any)?.isUserItem)
  e.clipboardItems = items.map((item) => item.clone({ insert: false }))
  e.clipboardLayerIds = items.map((item) => e.getItemLayerId((item.data as any)?.id ?? ''))
  const board = e.store.activeArtboard
  e.clipboardBoard = board ? { x: board.x, y: board.y } : { x: 0, y: 0 }
  e.pasteCount = 0
  return e.clipboardItems.length
}

/** Cut = copy onto the clipboard, then delete the selection. */
export function cutSelectedToClipboard(e: EditorEngine): void {
  if (copySelectedToClipboard(e) === 0) return
  e.deleteSelected()
}

/**
 * Resolve the paste target for a clipboard entry: its source layer when
 * that layer still exists, is visible and unlocked (AI remembers layers),
 * else the active layer.
 */
function pasteTargetLayer(e: EditorEngine, layerId: string): paper.Layer {
  // AI Layers-panel option: off means every paste lands on the active
  // layer regardless of where the copy was taken from.
  if (!e.store.pasteRemembersLayers) return e.getActiveLayer()
  const found = e.project.layers.find(
    (l) => (l.data as any)?.isUserLayer && (l.data as any)?.layerId === layerId
  ) as paper.Layer | undefined
  if (found && found.visible && !found.locked) return found
  return e.getActiveLayer()
}

/**
 * Paste the internal clipboard in place (no offset), stacked at the very
 * front or back of each entry's layer. Returns false when it is empty.
 */
export function pasteInPlace(e: EditorEngine, where: 'front' | 'back'): boolean {
  if (e.clipboardItems.length === 0) return false
  const pasted: paper.Item[] = []
  for (let i = 0; i < e.clipboardItems.length; i++) {
    const source = e.clipboardItems[i]
    const layer = pasteTargetLayer(e, e.clipboardLayerIds[i] ?? '')
    const clone = source.clone({ insert: false })
    layer.addChild(clone)
    e.restampCloneTree(clone)
    clone.data.id = e.genId()
    clone.data.isUserItem = true
    if (where === 'front') clone.bringToFront()
    else clone.sendToBack()
    pasted.push(clone)
  }
  e.clearSelection()
  pasted.forEach((item) => (item.selected = true))
  e.syncSelectionToStore()
  e.pushHistory(where === 'front' ? 'Paste in Front' : 'Paste in Back')
  e.scope.view.update()
  return true
}

/**
 * Paste the clipboard clones into their source layers. Each paste is
 * offset by a small step so repeated pastes do not stack exactly on top
 * of the source, and the pasted items become the new selection.
 */
export function pasteClipboard(e: EditorEngine): void {
  if (e.clipboardItems.length === 0) return
  // Each paste steps one increment further from the source position.
  e.pasteCount++
  const offset = new e.scope.Point(10 * e.pasteCount, 10 * e.pasteCount)
  const pasted: paper.Item[] = []
  for (let i = 0; i < e.clipboardItems.length; i++) {
    const source = e.clipboardItems[i]
    const layer = pasteTargetLayer(e, e.clipboardLayerIds[i] ?? '')
    const clone = source.clone({ insert: false })
    layer.addChild(clone)
    e.restampCloneTree(clone)
    clone.data.id = e.genId()
    clone.data.isUserItem = true
    clone.position = (clone.position as paper.Point).add(offset)
    pasted.push(clone)
  }
  e.clearSelection()
  pasted.forEach((item) => (item.selected = true))
  e.syncSelectionToStore()
  e.pushHistory('Paste')
  e.scope.view.update()
}

/**
 * Paste the clipboard onto every artboard (AI Paste on All Artboards
 * parity): each board gets the copies shifted by its origin delta from
 * the copy-time board. All pastes become the selection; one history.
 * Returns pastes made.
 */
export function pasteOnAllBoards(e: EditorEngine): number {
  if (e.clipboardItems.length === 0) return 0
  const boards = e.store.artboards.filter((b) => b.width > 0 && b.height > 0)
  if (boards.length === 0) return 0
  const pasted: paper.Item[] = []
  for (const board of boards) {
    const delta = new e.scope.Point(board.x - e.clipboardBoard.x, board.y - e.clipboardBoard.y)
    for (let i = 0; i < e.clipboardItems.length; i++) {
      const layer = pasteTargetLayer(e, e.clipboardLayerIds[i] ?? '')
      const clone = e.clipboardItems[i].clone({ insert: false })
      layer.addChild(clone)
      e.restampCloneTree(clone)
      clone.data.id = e.genId()
      clone.data.isUserItem = true
      clone.position = (clone.position as paper.Point).add(delta)
      pasted.push(clone)
    }
  }
  if (pasted.length === 0) return 0
  e.clearSelection()
  pasted.forEach((item) => (item.selected = true))
  e.syncSelectionToStore()
  e.pushHistory('Paste on All Artboards')
  e.scope.view.update()
  return pasted.length
}

/**
 * Best-effort copy of the current selection to the OS clipboard as SVG so
 * artwork can move to other applications. Falls back from the SVG MIME
 * type to plain text. Resolves false when nothing is selected, the API is
 * unavailable or the write is denied.
 */
export async function copyToSystemClipboard(e: EditorEngine): Promise<boolean> {
  const svg = e.exportSelectionSVG()
  if (!svg) return false
  // Remember our own payload so pastes can tell external SVG copies
  // apart from the echo of our last in-app copy.
  e.lastSystemWrite = svg
  const clipboard = systemClipboard()
  if (!clipboard) return false
  try {
    if (typeof ClipboardItem !== 'undefined' && clipboard.write) {
      const clipboardItem = new ClipboardItem({
        'image/svg+xml': new Blob([svg], { type: 'image/svg+xml' }),
        'text/plain': new Blob([svg], { type: 'text/plain' }),
      })
      await clipboard.write([clipboardItem])
      return true
    }
  } catch {
    // Fall through to the plain-text write below.
  }
  try {
    await clipboard.writeText(svg)
    return true
  } catch {
    return false
  }
}

/**
 * Paste SVG artwork from the OS clipboard. Returns false when the
 * clipboard is unavailable, holds no SVG or the payload is unusable, in
 * which case callers fall back to the internal clipboard.
 */
export async function pasteFromSystemClipboard(e: EditorEngine): Promise<boolean> {
  const clipboard = systemClipboard()
  if (!clipboard || !clipboard.readText) return false
  const text = await clipboard.readText()
  if (!text || !/<svg[\s>]/i.test(text.trim().slice(0, 4096))) return false
  try {
    return e.importSVGText(text, 'Paste')
  } catch {
    return false
  }
}

/**
 * Paste entry point: the lossless internal clipboard first (OS
 * round-tripping through SVG drops Paper-only state like pattern fills
 * and thread links), OS clipboard SVG for cross-app pastes, nothing when
 * both are empty. An OS SVG payload we never wrote shadows stale
 * internal content (copied in-app, then copied elsewhere). Denied OS
 * access silently falls through.
 */
export async function pasteWithSystemFallback(e: EditorEngine): Promise<void> {
  if (e.clipboardItems.length > 0) {
    try {
      const clipboard = systemClipboard()
      if (clipboard?.readText) {
        const text = await clipboard.readText()
        if (
          text &&
          /<svg[\s>]/i.test(text.trim().slice(0, 4096)) &&
          text !== e.lastSystemWrite &&
          (await pasteFromSystemClipboard(e))
        ) {
          return
        }
      }
    } catch {
      // Denied or unavailable OS access -> internal paste below.
    }
    pasteClipboard(e)
    return
  }
  try {
    if (await pasteFromSystemClipboard(e)) return
  } catch {
    // Denied or unavailable OS access -> nothing to paste below.
  }
}
