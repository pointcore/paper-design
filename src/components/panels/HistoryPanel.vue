<template>
  <div class="history-panel">
    <div class="panel-header">
      <span>History</span>
      <div class="header-actions">
        <el-icon size="14" class="action-btn" title="Clear History" @click="clearHistory"><Delete /></el-icon>
      </div>
    </div>

    <div class="panel-body" ref="bodyRef">
      <div v-if="store.history.length === 0" class="history-empty">No history yet</div>
      <div v-for="(entry, index) in store.history" :key="entry.timestamp + '-' + index"
           class="history-item"
           :class="{ active: index === store.historyIndex, future: index > store.historyIndex }"
           @click="jumpTo(index)">
        <span class="history-name">{{ entry.name }}</span>
        <span class="history-time">{{ formatTime(entry.timestamp) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, inject, type Ref } from 'vue'
import { Delete } from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const bodyRef = ref<HTMLElement>()

function getEngine() { return engineRef?.value || null }

function jumpTo(index: number) {
  getEngine()?.jumpToHistory(index)
}

function clearHistory() {
  getEngine()?.clearHistory()
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

// Keep the current entry visible as history grows or jumps around.
watch(() => store.historyIndex, () => {
  requestAnimationFrame(() => {
    bodyRef.value?.querySelector('.history-item.active')?.scrollIntoView({ block: 'nearest' })
  })
})
</script>

<style scoped>
.history-panel {
  flex-shrink: 0;
  max-height: 32%;
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

.history-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 10px;
  cursor: pointer;
  font-size: 12px;
  color: #ccc;
  border-bottom: 1px solid #2e2e2e;
}

.history-item:hover {
  background: #333;
}

.history-item.active {
  background: #3a5a8c;
  color: #fff;
}

.history-item.future {
  color: #777;
}

.history-item.future.active {
  color: #fff;
}

.history-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-time {
  color: #888;
  font-size: 11px;
  flex-shrink: 0;
}

.history-item.active .history-time {
  color: #cfe0f5;
}

.history-empty {
  padding: 8px 10px;
  font-size: 12px;
  color: #666;
  font-style: italic;
}
</style>
