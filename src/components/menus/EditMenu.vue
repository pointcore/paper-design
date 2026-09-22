<template>
  <div class="edit-menu">
    <el-dropdown trigger="click" @command="onEditCmd">
      <span class="menu-label">Edit</span>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="undo" :disabled="!store.canUndo">Undo</el-dropdown-item>
          <el-dropdown-item command="redo" :disabled="!store.canRedo">Redo</el-dropdown-item>
          <el-dropdown-item command="cut" divided :disabled="!store.hasSelection">Cut</el-dropdown-item>
          <el-dropdown-item command="copy" :disabled="!store.hasSelection">Copy</el-dropdown-item>
          <el-dropdown-item command="copySVG" :disabled="!store.hasSelection">Copy as SVG</el-dropdown-item>
          <el-dropdown-item command="copyPNG" :disabled="!store.hasSelection">Copy as PNG</el-dropdown-item>
          <el-dropdown-item command="paste">Paste</el-dropdown-item>
          <el-dropdown-item command="pasteFront">Paste in Front</el-dropdown-item>
          <el-dropdown-item command="pasteBack">Paste in Back</el-dropdown-item>
          <el-dropdown-item command="pasteBoards">Paste on All Artboards</el-dropdown-item>
          <el-dropdown-item command="duplicate">Duplicate In Place</el-dropdown-item>
          <el-dropdown-item command="transformAgain" :disabled="!store.hasSelection">Transform Again</el-dropdown-item>
          <el-dropdown-item command="delete" divided :disabled="!store.hasSelection">Delete</el-dropdown-item>
          <el-dropdown-item command="selectAll" divided>Select All</el-dropdown-item>
          <el-dropdown-item command="selectAllBoard" :disabled="store.artboards.length === 0">Select All on Active Board</el-dropdown-item>
          <el-dropdown-item command="deselect" :disabled="!store.hasSelection">Deselect</el-dropdown-item>
          <el-dropdown-item command="reselect" :disabled="store.lastSelection.length === 0">Reselect</el-dropdown-item>
          <el-dropdown-item command="invertSelection">Invert Selection</el-dropdown-item>
          <el-dropdown-item command="selectBelow" :disabled="!store.hasSelection">Select Next Below</el-dropdown-item>
          <el-dropdown-item command="selectAbove" :disabled="!store.hasSelection">Select Next Above</el-dropdown-item>
          <el-dropdown-item command="saveSelection" :disabled="!store.hasSelection">Save Selection...</el-dropdown-item>
          <el-dropdown-item command="findReplace" divided>Find &amp; Replace...</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <!-- Find & Replace Dialog (AI Find/Change parity + word count) -->
    <AppDialog
      v-model="findVisible"
      title="Find & Replace"
      :width="400"
      :show-footer="false"
    >
      <template #footer>
        <el-button size="small" @click="findVisible = false">Close</el-button>
      </template>
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Find</span>
          </div>
          <el-input v-model="findForm.find" size="small" placeholder="Text to find" @input="findIndex = -1" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Replace</span>
          </div>
          <el-input v-model="findForm.replace" size="small" placeholder="Replacement" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Match case</span>
          </div>
          <el-checkbox v-model="findForm.matchCase" />
          <el-checkbox v-model="findForm.wholeWord">Whole word</el-checkbox>
          <span class="setting-desc">{{ findCountText }}</span>
        </div>
        <div class="setting-row">
          <el-button size="small" :disabled="findMatches.length === 0" @click="findNext">Find Next</el-button>
          <el-button size="small" :disabled="!store.hasSelection || !findForm.find" @click="replaceOne">Replace</el-button>
          <el-button size="small" :disabled="findMatches.length === 0" @click="replaceAll">Replace All</el-button>
        </div>
        <div class="setting-desc">{{ wordCountText }}</div>
      </div>
    </AppDialog>

    <!-- Save Selection Dialog (named id-list selections, persisted) -->
    <AppDialog
      v-model="savedSelVisible"
      title="Saved Selections"
      :width="400"
      :show-footer="false"
    >
      <template #footer>
        <el-button size="small" @click="savedSelVisible = false">Close</el-button>
      </template>
      <div class="settings-body app-settings">
        <div class="setting-row">
          <el-input v-model="savedSelName" size="small" placeholder="Selection name" @keyup.enter="onSavedSelSave" />
          <el-button size="small" :disabled="!store.hasSelection" @click="onSavedSelSave">Save Current</el-button>
        </div>
        <div v-if="store.savedSelections.length === 0" class="setting-desc">No saved selections yet.</div>
        <div v-for="s in store.savedSelections" :key="s.id" class="setting-row">
          <div class="setting-label">
            <span class="setting-name">{{ s.name }}</span>
            <span class="setting-desc">{{ s.ids.length }} objects</span>
          </div>
          <el-button size="small" @click="onSavedSelLoad(s.id)">Load</el-button>
          <el-button size="small" title="Delete" @click="onSavedSelDelete(s.id)">×</el-button>
        </div>
      </div>
    </AppDialog>
  </div>
</template>

<script setup lang="ts">
/**
 * EditMenu (C2: first menu slice out of TopBar.vue).
 *
 * The Edit dropdown with its dispatch plus the two dialogs it owns (Find
 * & Replace, Saved Selections). Dialog body styling comes from AppDialog's
 * shared global block; everything else here is self-contained (store +
 * engine only).
 */
import { ref, reactive, computed, inject, type Ref } from 'vue'
import AppDialog from '../ui/AppDialog.vue'
import { uniqueSelectionName, pruneSelectionIds } from '../../editor/selection/saved-selection'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

function blurMenuFocus() {
  const ae = document.activeElement as HTMLElement | null
  if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur()
}

const findVisible = ref(false)
const findForm = reactive({ find: '', replace: '', matchCase: false, wholeWord: false })
// -1 = nothing stepped to yet, so the first findNext() lands on matches[0]
// instead of skipping it (the old 0 start made the first click select #1).
const findIndex = ref(-1)
const findTick = ref(0)
const findMatches = computed(() => {
  void findTick.value
  void store.historyIndex
  void findVisible.value
  const e = engineRef?.value
  if (!e || !findForm.find) return []
  try {
    return e.findText(findForm.find, findForm.matchCase, findForm.wholeWord)
  } catch {
    return []
  }
})
const findCountText = computed(() => {
  if (!findForm.find) return 'Type to search the document'
  const n = findMatches.value.length
  return n === 0 ? 'No matches' : `${n} match${n === 1 ? '' : 'es'}`
})
const wordStats = computed(() => {
  void store.historyIndex
  void store.selectedItemIds.join(',')
  try {
    return engineRef?.value?.textStats() ?? { words: 0, chars: 0, runs: 0 }
  } catch {
    return { words: 0, chars: 0, runs: 0 }
  }
})
const wordCountText = computed(() => {
  const s = wordStats.value
  const scope = store.hasSelection ? 'selection' : 'document'
  return `${s.words} words · ${s.chars} chars · ${s.runs} runs (${scope})`
})
function openFind() {
  findTick.value++
  findIndex.value = -1
  findVisible.value = true
}

const savedSelVisible = ref(false)
const savedSelName = ref('')

function persistSavedSelections() {
  try {
    localStorage.setItem('vve.selections', JSON.stringify(store.savedSelections))
  } catch { /* private mode */ }
}

function restoreSavedSelections() {
  try {
    const raw = localStorage.getItem('vve.selections')
    if (!raw) return
    const list = JSON.parse(raw) as Array<{ id?: unknown; name?: unknown; ids?: unknown }>
    if (!Array.isArray(list)) return
    store.setSavedSelections(
      list
        .filter((s) => s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          ids: Array.isArray(s.ids) ? s.ids.filter((i: unknown): i is string => typeof i === 'string') : [],
        }))
    )
  } catch { /* corrupt storage: start empty */ }
}
let savedSelRestored = false

function openSavedSelections() {
  if (!savedSelRestored) {
    savedSelRestored = true
    restoreSavedSelections()
  }
  savedSelName.value = ''
  savedSelVisible.value = true
}

function onSavedSelSave() {
  if (!store.hasSelection) {
    store.setStatusMessage('Select objects first')
    return
  }
  const base = uniqueSelectionName(
    store.savedSelections.map((s) => s.name),
    (savedSelName.value || '').trim() || 'Selection'
  )
  store.addSavedSelection(base, [...store.selectedItemIds])
  savedSelName.value = ''
  persistSavedSelections()
  store.setStatusMessage(`Selection saved as "${base}"`)
}

function onSavedSelLoad(id: string) {
  const e = engineRef?.value
  if (!e) return
  const entry = store.savedSelections.find((s) => s.id === id)
  if (!entry) return
  const existing = new Set<string>()
  for (const itemId of entry.ids) {
    if ((e as any).getItemById?.(itemId)) existing.add(itemId)
  }
  const pruned = pruneSelectionIds(entry.ids, existing)
  if (pruned.length === 0) {
    store.setStatusMessage('Nothing left of that selection')
    return
  }
  const n = e.selectByIds(pruned)
  store.setStatusMessage(`Loaded "${entry.name}" (${n} objects)`)
}

function onSavedSelDelete(id: string) {
  store.removeSavedSelection(id)
  persistSavedSelections()
}

function findNext() {
  const e = engineRef?.value
  const matches = findMatches.value
  if (!e || matches.length === 0) return
  findIndex.value = (findIndex.value + 1) % matches.length
  const target = matches[findIndex.value]
  e.clearSelection()
  target.selected = true
  e.syncSelectionToStore()
}
function replaceOne() {
  const e = engineRef?.value
  if (!e || !findForm.find) return
  const n = e.replaceText(findForm.find, findForm.replace, findForm.matchCase, findForm.wholeWord)
  store.setStatusMessage(n > 0 ? `Replaced in ${n} run${n === 1 ? '' : 's'}` : 'No replacement in the selection')
  findTick.value++
}
function replaceAll() {
  const e = engineRef?.value
  if (!e || !findForm.find) return
  e.clearSelection()
  findMatches.value.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  const n = e.replaceText(findForm.find, findForm.replace, findForm.matchCase, findForm.wholeWord)
  store.setStatusMessage(n > 0 ? `Replaced in ${n} run${n === 1 ? '' : 's'}` : 'Nothing replaced')
  findTick.value++
}

function onEditCmd(cmd: string) {
  blurMenuFocus()
  const e = engineRef?.value
  if (!e) return
  switch (cmd) {
    case 'undo':
      e.undo()
      break
    case 'redo':
      e.redo()
      break
    case 'deselect':
      e.clearSelection()
      break
    case 'selectAllBoard': {
      const n = e.selectAllOnActiveArtboard()
      if (n === 0) store.setStatusMessage('Nothing on the active artboard')
      break
    }
    case 'sameFontFamily':
    case 'sameFontSize': {
      const n = e.selectSameTextFont(cmd === 'sameFontFamily' ? 'family' : 'size')
      store.setStatusMessage(n === 0 ? 'Select a text object first' : `Selected ${n} matching text item${n === 1 ? '' : 's'}`)
      break
    }
    case 'selectBelow':
    case 'selectAbove': {
      const sel = e.getController('select') as {
        selectNextBelow?: () => boolean
        selectNextAbove?: () => boolean
      } | null
      const ok = cmd === 'selectBelow'
        ? sel?.selectNextBelow?.() ?? false
        : sel?.selectNextAbove?.() ?? false
      if (!ok) store.setStatusMessage('Nothing else is stacked at the selection')
      break
    }
    case 'cut':
      // Capture the OS copy before the cut deletes the selection.
      e.copyToSystemClipboard().catch(() => undefined)
      e.cutSelectedToClipboard()
      break
    case 'copy':
      e.copySelectedToClipboard()
      e.copyToSystemClipboard().catch(() => undefined)
      break
    case 'copySVG':
      void onCopySVG()
      break
    case 'copyPNG':
      void onCopyPNG()
      break
    case 'paste':
      e.pasteWithSystemFallback().catch(() => undefined)
      break
    case 'pasteFront':
      if (!e.pasteInPlace('front')) store.setStatusMessage('Clipboard is empty')
      break
    case 'pasteBack':
      if (!e.pasteInPlace('back')) store.setStatusMessage('Clipboard is empty')
      break
    case 'pasteBoards': {
      const n = e.pasteOnAllBoards()
      store.setStatusMessage(n > 0 ? `Pasted on all artboards (${n} items)` : 'Clipboard is empty')
      break
    }
    case 'duplicate':
      if (!e.duplicateInPlace()) store.setStatusMessage('Nothing to duplicate')
      break
    case 'transformAgain':
      if (!e.transformAgain()) store.setStatusMessage('No transform to repeat')
      break
    case 'delete': {
      // Direct-select sub-selections delete anchors/curves (keyboard
      // parity); otherwise whole objects go.
      const sc = e.getController('direct-select') as {
        deleteSubselection?: () => boolean
      } | null
      if (!sc?.deleteSubselection?.()) e.deleteSelected()
      break
    }
    case 'selectAll': {
      // Direct-select with a path selection takes every anchor (Ctrl+A
      // parity); otherwise the whole artwork is selected.
      const sc = e.getController('direct-select') as {
        selectAllSubselection?: () => boolean
      } | null
      if (!(sc?.selectAllSubselection?.() ?? false)) e.selectAllArtwork()
      break
    }
    case 'invertSelection':
      e.invertSelection()
      break
    case 'reselect': {
      const n = e.reselect()
      store.setStatusMessage(n > 0 ? `Reselected ${n} object${n === 1 ? '' : 's'}` : 'Nothing to reselect')
      break
    }
    case 'saveSelection':
      openSavedSelections()
      break
    case 'findReplace':
      openFind()
      break
  }
}

/** Copy the selection as SVG source text for use in code editors. */
async function onCopySVG() {
  const e = engineRef?.value
  if (!e) return
  const svg = e.exportSelectionSVG()
  if (!svg) {
    store.setStatusMessage('Nothing to copy')
    return
  }
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      store.setStatusMessage('Clipboard unavailable')
      return
    }
    await navigator.clipboard.writeText(svg)
    store.setStatusMessage('SVG copied to clipboard')
  } catch (err) {
    store.setStatusMessage('Copy failed')
  }
}

/** Copy the selection (else all artwork) as PNG pixels. */
async function onCopyPNG() {
  const e = engineRef?.value
  if (!e) return
  try {
    if (await e.copyRasterToClipboard(2)) {
      store.setStatusMessage('PNG copied to clipboard')
    } else {
      store.setStatusMessage('Copy as PNG failed')
    }
  } catch {
    store.setStatusMessage('Copy as PNG failed')
  }
}
</script>

<style scoped>
/* Menu trigger shared with the bar (duplicated: scoped CSS does not cross
   the component boundary). */
.menu-label {
  display: inline-block;
  padding: 4px 8px;
  font-size: 13px;
  cursor: pointer;
  border-radius: 3px;
  color: #ccc;
}

.menu-label:hover {
  background: #3a3a3a;
  color: #fff;
}
</style>
