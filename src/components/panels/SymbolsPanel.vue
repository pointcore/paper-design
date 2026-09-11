<template>
  <div class="symbols-panel">
    <div class="panel-header">
      <span>Symbols</span>
      <div class="header-actions">
        <el-icon size="14" class="action-btn" title="New Symbol from Selection" @click="makeSymbol"><Plus /></el-icon>
      </div>
    </div>

    <div class="panel-body">
      <div v-for="entry in symbols" :key="entry.id" class="symbol-item"
           :class="{ active: pickedId === entry.id }"
           @click="pickedId = entry.id">
        <span class="symbol-name" @dblclick="startRename(entry)">
          <template v-if="renamingId === entry.id">
            <el-input v-model="renameValue" size="small" @blur="finishRename" @keyup.enter="finishRename" />
          </template>
          <template v-else>{{ entry.name }}</template>
        </span>
        <span class="symbol-count" :title="`${entry.instances} placed`">x{{ entry.instances }}</span>
        <el-button size="small" @click.stop="placeSymbol(entry.id)">Place</el-button>
        <el-button size="small" type="danger" plain @click.stop="deleteSymbol(entry.id)">×</el-button>
      </div>
      <div v-if="symbols.length === 0" class="symbols-empty">No symbols yet</div>

      <div class="symbols-actions">
        <el-button size="small" :disabled="!store.hasSelection" @click="makeSymbol">New Symbol</el-button>
        <el-button size="small" :disabled="!hasSymbolSelection" @click="breakLinks">Break Link</el-button>
      </div>
      <div class="symbols-actions">
        <el-button size="small" :disabled="!pickedId || !hasSymbolSelection" title="Replace selected instances with the picked symbol" @click="swapInstances">Swap to Picked</el-button>
        <el-button size="small" :disabled="!pickedId" title="Select every placed instance of the picked symbol" @click="selectInstances">Select All</el-button>
      </div>
      <div v-if="pickedId" class="symbols-hint">Picked: {{ pickedName }} — select placed instances, then Swap.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, type Ref } from 'vue'
import { Plus } from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { SymbolEntry } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const renamingId = ref('')
const renameValue = ref('')
// Bumped by metadata-only ops (rename) so the list rebuilds without history.
const refreshTick = ref(0)

function getEngine() { return engineRef?.value || null }

// The library derives from keeper instances: any snapshot change (history)
// or local refresh rebuilds the list.
const symbols = computed<SymbolEntry[]>(() => {
  void store.historyIndex
  void store.selectedItemIds.join(',')
  void refreshTick.value
  return getEngine()?.listSymbols() ?? []
})

const hasSymbolSelection = computed(() => {
  void store.selectedItemIds.join(',')
  const e = getEngine()
  if (!e) return false
  return e.getSelection().some((item) => item instanceof e.scope.SymbolItem)
})

function makeSymbol() {
  const e = getEngine()
  if (!e) return
  if (!e.defineSymbolFromSelection()) {
    store.setStatusMessage('Select unlocked artwork to make a symbol')
  }
}

function placeSymbol(id: string) {
  if (!getEngine()?.placeSymbol(id)) {
    store.setStatusMessage('Cannot place that symbol')
  }
}
function deleteSymbol(id: string) {
  if (!getEngine()?.deleteSymbol(id)) {
    store.setStatusMessage('Cannot delete that symbol')
  }
}

function breakLinks() {
  const e = getEngine()
  if (!e) return
  if (!e.breakSymbolLinks()) {
    store.setStatusMessage('Select placed symbols to break')
  }
}

const pickedId = ref('')
const pickedName = computed(() => symbols.value.find((s) => s.id === pickedId.value)?.name ?? '')

function swapInstances() {
  const e = getEngine()
  if (!e || !pickedId.value) return
  const n = e.swapSymbolInstances(pickedId.value)
  if (n === 0) {
    store.setStatusMessage('Select placed instances to swap')
  } else {
    store.setStatusMessage(`Swapped ${n} instance${n === 1 ? '' : 's'}`)
    store.setSpraySymbol(pickedId.value)
  }
}

function selectInstances() {
  const e = getEngine()
  if (!e || !pickedId.value) return
  const n = e.selectSymbolInstances(pickedId.value)
  store.setStatusMessage(n > 0 ? `Selected ${n} instance${n === 1 ? '' : 's'}` : 'No placed instances')
}

function startRename(entry: SymbolEntry) {
  renamingId.value = entry.id
  renameValue.value = entry.name
}

function finishRename() {
  if (renamingId.value) {
    const name = renameValue.value.trim() || 'Symbol'
    getEngine()?.renameSymbol(renamingId.value, name)
    refreshTick.value++
  }
  renamingId.value = ''
}
</script>

<style scoped>
.symbols-panel {
  flex-shrink: 0;
  max-height: 30%;
  display: flex;
  flex-direction: column;
  border-top: 1px solid #3a3a3a;
  min-height: 80px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 10px;
  background: #333;
  color: #ddd;
  font-size: 12px;
  font-weight: bold;
  flex-shrink: 0;
}

.header-actions {
  display: flex;
  gap: 4px;
}

.action-btn {
  cursor: pointer;
  color: #888;
  padding: 2px;
  border-radius: 3px;
}

.action-btn:hover {
  color: #fff;
  background: #444;
}

.panel-body {
  padding: 4px 0;
  overflow-y: auto;
}

.symbol-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  font-size: 12px;
  color: #ccc;
  border-bottom: 1px solid #2e2e2e;
  cursor: pointer;
}

.symbol-item.active {
  background: #2f6fbf;
  color: #fff;
}

.symbol-item.active .symbol-count {
  color: #dce9fa;
}

.symbol-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.symbol-count {
  font-size: 11px;
  color: #888;
  flex-shrink: 0;
}

.symbols-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: #666;
  font-style: italic;
}

.symbols-actions {
  display: flex;
  gap: 6px;
  padding: 8px 10px 0;
}

.symbols-hint {
  padding: 6px 10px 0;
  font-size: 11px;
  color: #8a8a8a;
  line-height: 1.5;
}
</style>
