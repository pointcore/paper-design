<template>
  <div class="history-panel ai-panel">
    <div class="hs-subheader">
      <span class="hs-title">History</span>
      <div class="hs-actions">
        <el-icon size="14" class="action-btn" :class="{ disabled: !store.canUndo }" title="Undo (Ctrl+Z)" @click="undo"><Back /></el-icon>
        <el-icon size="14" class="action-btn" :class="{ disabled: !store.canRedo }" title="Redo (Ctrl+Shift+Z)" @click="redo"><Right /></el-icon>
        <el-icon size="14" class="action-btn" title="Clear history" @click="clearHistory"><Delete /></el-icon>
      </div>
    </div>

    <div v-if="store.history.length > 0" class="hs-search">
      <input v-model="filterText" class="hs-search-input" placeholder="Filter history..." />
    </div>

    <div class="panel-body" ref="bodyRef">
      <div v-if="store.history.length === 0" class="history-empty">No history yet</div>
      <div v-else-if="filteredHistory.length === 0" class="history-empty">No matches</div>
      <div v-for="item in filteredHistory" :key="item.entry.timestamp + '-' + item.index"
           class="history-item"
           :class="{ active: item.index === store.historyIndex, future: item.index > store.historyIndex }"
           @click="jumpTo(item.index)">
        <el-icon size="14" class="history-icon"><Document /></el-icon>
        <span class="history-name">{{ item.entry.name }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, inject, type Ref } from 'vue'
import { Back, Delete, Document, Right } from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const bodyRef = ref<HTMLElement>()
const filterText = ref('')

const filteredHistory = computed(() => {
  const text = filterText.value.toLowerCase().trim()
  return store.history
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !text || entry.name.toLowerCase().includes(text))
})

function getEngine() { return engineRef?.value || null }

function jumpTo(index: number) {
  getEngine()?.jumpToHistory(index)
}

function undo() {
  if (store.canUndo) getEngine()?.undo()
}

function redo() {
  if (store.canRedo) getEngine()?.redo()
}

function clearHistory() {
  getEngine()?.clearHistory()
}

// Keep the current entry visible as history grows or jumps around.
watch(() => store.historyIndex, () => {
  requestAnimationFrame(() => {
    bodyRef.value?.querySelector('.history-item.active')?.scrollIntoView({ block: 'nearest' })
  })
})
</script>

<style scoped>
.ai-panel {
  background: #252526;
  color: #c9c9c9;
  font-size: 12px;
}

.history-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.hs-subheader {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 10px 8px;
  background: #1e1e1e;
  border-bottom: 1px solid #161616;
  flex-shrink: 0;
}

.hs-title {
  font-size: 12px;
  color: #d5d5d5;
  font-weight: 600;
}

.hs-actions {
  display: flex;
  gap: 6px;
}

.action-btn {
  cursor: pointer;
  color: #8a8a8a;
  padding: 2px;
  border-radius: 3px;
}

.action-btn:hover {
  color: #fff;
  background: #3d3d3d;
}

.action-btn.disabled {
  opacity: 0.35;
  pointer-events: none;
}

.hs-search {
  padding: 6px 10px;
  border-bottom: 1px solid #161616;
  flex-shrink: 0;
}

.hs-search-input {
  width: 100%;
  background: #333;
  border: 1px solid #4a4a4a;
  border-radius: 3px;
  padding: 4px 8px;
  font-size: 11px;
  color: #d5d5d5;
  outline: none;
}

.hs-search-input:focus {
  border-color: #2f6fbf;
}

.hs-search-input::placeholder {
  color: #666;
}

.panel-body {
  padding: 0;
  overflow-y: auto;
  flex: 1;
}

.panel-body::-webkit-scrollbar {
  width: 8px;
}
.panel-body::-webkit-scrollbar-thumb {
  background: #4a4a4a;
  border-radius: 4px;
  border: 2px solid #252526;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  cursor: pointer;
  font-size: 12px;
  color: #d5d5d5;
  border-bottom: 1px solid #1e1e1e;
  background: #2a2a2a;
}

.history-item:hover {
  background: #333333;
}

.history-item.active {
  background: #2f6fbf;
  color: #fff;
}

.history-item.active .history-icon {
  color: #fff;
}

.history-item.future {
  color: #7a7a7a;
}

.history-item.future.active {
  color: #fff;
}

.history-icon {
  color: #8a8a8a;
  flex-shrink: 0;
}

.history-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-empty {
  padding: 10px;
  font-size: 12px;
  color: #666;
  font-style: italic;
}
</style>
