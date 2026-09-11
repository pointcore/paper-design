<template>
  <div class="doc-tabs" title="Artboards (pages)">
    <div ref="tabsScrollRef" class="tabs-scroll" @wheel.prevent="onTabsWheel">
      <button v-for="(b, i) in store.artboards" :key="b.id" class="doc-tab"
              :class="{ active: b.id === store.activeArtboardId }"
              @click="activate(b.id)" @dblclick="startRename(b)"
              @contextmenu.prevent="openCtx(b, $event)">
        <template v-if="renamingId === b.id">
          <input v-model="renameValue" class="rename-input" @blur="finishRename" @keyup.enter="finishRename" @keyup.esc="cancelRename" @click.stop />
        </template>
        <template v-else>{{ i + 1 }} · {{ b.name }}</template>
      </button>
      <button class="doc-tab doc-add" title="New Artboard" @click="addBoard">+</button>
    </div>
    <span class="doc-count" :class="{ dirty: store.hasUnsavedChanges }" :title="docTooltip">{{ store.hasUnsavedChanges ? '• ' : '' }}{{ store.artboards.length }} boards</span>
    <div v-if="ctxMenu" class="tab-ctx" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
      <div class="tab-ctx-item" @click="ctxRename">Rename</div>
      <div class="tab-ctx-item" @click="ctxDuplicate">Duplicate</div>
      <div class="tab-ctx-item" :class="{ disabled: store.artboards.length <= 1 }" @click="ctxDelete">Delete</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, watch, nextTick, onMounted, onUnmounted, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

// Tab context menu (rename / duplicate / delete, CDR page-tab parity).
const ctxMenu = ref<{ x: number; y: number; id: string } | null>(null)
function openCtx(board: { id: string }, e: MouseEvent) {
  ctxMenu.value = {
    x: Math.min(e.clientX, window.innerWidth - 160),
    y: Math.min(e.clientY, window.innerHeight - 130),
    id: board.id,
  }
}
function closeCtx() {
  ctxMenu.value = null
}
function ctxRename() {
  const board = store.artboards.find((b) => b.id === ctxMenu.value?.id)
  closeCtx()
  if (board) startRename(board)
}
function ctxDuplicate() {
  const e = engineRef?.value
  const id = ctxMenu.value?.id
  closeCtx()
  if (!e || !id) return
  if (!e.duplicateArtboard(id)) {
    store.setStatusMessage('Could not duplicate that artboard')
    return
  }
  const active = store.activeArtboard
  if (active) {
    e.panViewTo(new e.scope.Point(active.x + active.width / 2, active.y + active.height / 2))
  }
}
function ctxDelete() {
  const id = ctxMenu.value?.id
  closeCtx()
  if (!id) return
  if (store.artboards.length <= 1) {
    store.setStatusMessage('At least one artboard must be kept')
    return
  }
  store.removeArtboard(id)
  const e = engineRef?.value
  if (e) {
    e.refreshArtboards()
    e.pushHistory('Delete Artboard')
  }
}
// Keep the active tab inside the strip: PgUp/PgDn navigation can activate
// boards whose tab is scrolled out of view.
watch(() => store.activeArtboardId, () => {
  void nextTick(() => {
    document.querySelector('.doc-tab.active')?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  })
})

function onDocClick() {
  closeCtx()
}
function onCtxKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeCtx()
}
onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onCtxKeydown)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onCtxKeydown)
})
/** Dirty tooltip: mention the auto-mirror age so recovery is visible. */
const docTooltip = computed(() => {
  if (!store.hasUnsavedChanges) return 'Saved'
  const ago = Math.max(0, Math.round((Date.now() - store.lastRecoveryAt) / 1000))
  const mirrored = store.lastRecoveryAt > 0 ? ` · auto-mirrored ${ago}s ago` : ''
  return `Unsaved changes${mirrored} (Ctrl+S)`
})

const tabsScrollRef = ref<HTMLElement | null>(null)
function onTabsWheel(e: WheelEvent) {
  const el = tabsScrollRef.value
  if (!el) return
  el.scrollLeft += e.deltaY
}

const renamingId = ref('')
const renameValue = ref('')

function activate(id: string) {
  const e = engineRef?.value
  store.setActiveArtboard(id)
  const board = store.activeArtboard
  if (!e || !board) return
  e.refreshArtboards()
  e.panViewTo(new e.scope.Point(board.x + board.width / 2, board.y + board.height / 2))
}

function addBoard() {
  const e = engineRef?.value
  const active = store.activeArtboard
  const names = new Set(store.artboards.map((b) => b.name))
  let n = store.artboards.length + 1
  while (names.has(`Artboard ${n}`)) n++
  const board = {
    id: e ? e.genId() : `artboard-${Date.now()}`,
    name: `Artboard ${n}`,
    x: active ? active.x + active.width + 100 : 0,
    y: active ? active.y : 0,
    width: active ? active.width : store.pageSize.width,
    height: active ? active.height : store.pageSize.height,
  }
  store.addArtboard(board)
  if (e) {
    e.refreshArtboards()
    e.panViewTo(new e.scope.Point(board.x + board.width / 2, board.y + board.height / 2))
    e.pushHistory('New Artboard')
  }
}

function startRename(board: any) {
  renamingId.value = board.id
  renameValue.value = board.name
}
function cancelRename() { renamingId.value = '' }
function finishRename() {
  if (!renamingId.value) return
  const id = renamingId.value
  const name = renameValue.value.trim() || 'Artboard'
  const e = engineRef?.value
  if (e && !e.renameArtboard(id, name)) store.updateArtboard(id, { name })
  else if (!e) store.updateArtboard(id, { name })
  renamingId.value = ''
}
</script>

<style scoped>
.doc-tabs {
  display: flex; align-items: center; gap: 8px;
  min-height: 28px; padding: 2px 8px;
  background: #1e1e1e; border-bottom: 1px solid #161616;
  flex-shrink: 0;
}
.tabs-scroll { display: flex; gap: 4px; overflow-x: auto; flex: 1; }
.tabs-scroll::-webkit-scrollbar { height: 4px; }
.tabs-scroll::-webkit-scrollbar-thumb { background: #4a4a4a; border-radius: 2px; }
.doc-tab {
  background: #2a2a2a; border: 1px solid #3a3a3a; color: #bbb; font-size: 11px;
  border-radius: 4px 4px 0 0; padding: 3px 10px; cursor: pointer; white-space: nowrap;
}
.doc-tab:hover { color: #fff; background: #333; }
.doc-tab.active { background: #2f6fbf; border-color: #2f6fbf; color: #fff; }
.doc-add { font-weight: 700; }
.doc-count { color: #666; font-size: 11px; white-space: nowrap; }
.doc-count.dirty { color: #e5a13d; }
.tab-ctx {
  position: fixed;
  z-index: 1000;
  background: #3c3c3c;
  border: 1px solid #555;
  border-radius: 4px;
  padding: 4px;
  min-width: 140px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
}
.tab-ctx-item {
  padding: 6px 12px;
  color: #ddd;
  font-size: 12px;
  cursor: pointer;
  border-radius: 2px;
  white-space: nowrap;
}
.tab-ctx-item:hover { background: #4a90d9; color: #fff; }
.tab-ctx-item.disabled { opacity: 0.4; pointer-events: none; }
.rename-input { background: #111; border: 1px solid #4a90d9; color: #fff; font-size: 11px; width: 110px; border-radius: 2px; }
</style>
