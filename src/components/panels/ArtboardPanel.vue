<template>
  <div class="artboard-panel">
    <div class="panel-header">
      <span>Artboards</span>
      <div class="header-actions">
        <el-icon size="14" class="action-btn" title="New Artboard" @click="addBoard"><Plus /></el-icon>
        <el-icon size="14" class="action-btn" title="Delete Artboard" @click="removeBoard"><Delete /></el-icon>
      </div>
    </div>

    <div class="panel-body">
      <div class="artboard-item" v-for="board in store.artboards" :key="board.id"
           :class="{ active: board.id === store.activeArtboardId }"
           @click="activateBoard(board.id)">
        <span class="artboard-name" @dblclick="startRename(board)">
          <template v-if="renamingId === board.id">
            <el-input v-model="renameValue" size="small" @blur="finishRename" @keyup.enter="finishRename" />
          </template>
          <template v-else>{{ board.name }}</template>
        </span>
        <span class="artboard-dims">{{ Math.round(board.width) }} x {{ Math.round(board.height) }}</span>
      </div>

      <div v-if="store.activeArtboard" class="artboard-position">
        <span class="pos-label">X</span>
        <el-input-number v-model="posX" size="small" @change="onPositionChange" />
        <span class="pos-label">Y</span>
        <el-input-number v-model="posY" size="small" @change="onPositionChange" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, inject, type Ref } from 'vue'
import { Plus, Delete } from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const renamingId = ref('')
const renameValue = ref('')
const posX = ref(0)
const posY = ref(0)

function getEngine() { return engineRef?.value || null }

/** First unused "Artboard N" number. */
function firstFreeBoardNumber(): number {
  const names = new Set(store.artboards.map((b) => b.name))
  let n = store.artboards.length + 1
  while (names.has(`Artboard ${n}`)) n++
  return n
}

function addBoard() {
  const e = getEngine()
  const active = store.activeArtboard
  const board = {
    id: e ? e.genId() : `artboard-${Date.now()}`,
    name: `Artboard ${firstFreeBoardNumber()}`,
    x: active ? active.x + active.width + 100 : 0,
    y: active ? active.y : 0,
    width: active ? active.width : store.pageSize.width,
    height: active ? active.height : store.pageSize.height,
  }
  store.addArtboard(board)
  if (e) {
    e.refreshArtboards()
    e.panViewTo(new e.scope.Point(board.x + board.width / 2, board.y + board.height / 2))
  }
}

function removeBoard() {
  const e = getEngine()
  if (store.artboards.length <= 1) {
    store.setStatusMessage('At least one artboard must be kept')
    return
  }
  store.removeArtboard(store.activeArtboardId)
  e?.refreshArtboards()
}

function activateBoard(id: string) {
  const e = getEngine()
  store.setActiveArtboard(id)
  const board = store.activeArtboard
  if (!e || !board) return
  e.refreshArtboards()
  e.panViewTo(new e.scope.Point(board.x + board.width / 2, board.y + board.height / 2))
}

function startRename(board: any) {
  renamingId.value = board.id
  renameValue.value = board.name
}

function finishRename() {
  if (renamingId.value) {
    const id = renamingId.value
    const newName = renameValue.value.trim() || 'Artboard'
    store.updateArtboard(id, { name: newName })
    getEngine()?.refreshArtboards()
  }
  renamingId.value = ''
}

function syncPositionFromStore() {
  const board = store.activeArtboard
  if (!board) return
  posX.value = Math.round(board.x)
  posY.value = Math.round(board.y)
}

function onPositionChange() {
  const board = store.activeArtboard
  if (!board) return
  if (!Number.isFinite(posX.value) || !Number.isFinite(posY.value)) {
    syncPositionFromStore()
    return
  }
  store.updateArtboard(board.id, { x: posX.value, y: posY.value })
  getEngine()?.refreshArtboards()
}

watch(() => store.activeArtboardId, syncPositionFromStore, { immediate: true })
</script>

<style scoped>
.artboard-panel {
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

.artboard-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 13px;
  color: #ccc;
  border-bottom: 1px solid #2e2e2e;
}

.artboard-item:hover {
  background: #333;
}

.artboard-item.active {
  background: #3a5a8c;
  color: #fff;
}

.artboard-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artboard-dims {
  font-size: 11px;
  color: #888;
  flex-shrink: 0;
}

.artboard-item.active .artboard-dims {
  color: #cfe0f5;
}

.artboard-position {
  display: grid;
  grid-template-columns: 20px 1fr 20px 1fr;
  gap: 4px;
  align-items: center;
  padding: 8px 10px;
}

.pos-label {
  font-size: 12px;
  color: #888;
}
</style>
