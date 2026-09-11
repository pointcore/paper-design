<template>
  <div class="doc-tabs" title="Artboards (pages)">
    <div class="tabs-scroll">
      <button v-for="(b, i) in store.artboards" :key="b.id" class="doc-tab"
              :class="{ active: b.id === store.activeArtboardId }"
              @click="activate(b.id)" @dblclick="startRename(b)">
        <template v-if="renamingId === b.id">
          <input v-model="renameValue" class="rename-input" @blur="finishRename" @keyup.enter="finishRename" @keyup.esc="cancelRename" @click.stop />
        </template>
        <template v-else>{{ i + 1 }} · {{ b.name }}</template>
      </button>
      <button class="doc-tab doc-add" title="New Artboard" @click="addBoard">+</button>
    </div>
    <span class="doc-count" :class="{ dirty: store.hasUnsavedChanges }" :title="store.hasUnsavedChanges ? 'Unsaved changes (Ctrl+S)' : 'Saved'">{{ store.hasUnsavedChanges ? '• ' : '' }}{{ store.artboards.length }} boards</span>
  </div>
</template>

<script setup lang="ts">
import { ref, inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')
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
.rename-input { background: #111; border: 1px solid #4a90d9; color: #fff; font-size: 11px; width: 110px; border-radius: 2px; }
</style>
