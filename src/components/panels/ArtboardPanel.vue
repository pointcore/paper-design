<template>
  <div class="artboard-panel">
    <div class="panel-header">
      <span>Artboards</span>
      <div class="header-actions">
        <el-icon size="14" class="action-btn" title="New Artboard" @click="addBoard"><Plus /></el-icon>
        <el-icon size="14" class="action-btn" title="Duplicate active artboard (with artwork)" @click="duplicateBoard"><CopyDocument /></el-icon>
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
import { Plus, Delete, CopyDocument } from '@element-plus/icons-vue'
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
    e.pushHistory('New Artboard')
  }
}

function removeBoard() {
  const e = getEngine()
  if (store.artboards.length <= 1) {
    store.setStatusMessage('At least one artboard must be kept')
    return
  }
  store.removeArtboard(store.activeArtboardId)
  if (e) {
    e.refreshArtboards()
    e.pushHistory('Delete Artboard')
  }
}

function duplicateBoard() {
  const e = getEngine()
  const active = store.activeArtboard
  if (!active) return
  if (e) {
    if (!e.duplicateArtboard(active.id)) {
      store.setStatusMessage('Cannot duplicate that artboard')
      return
    }
    const board = store.activeArtboard
    if (board) {
      e.panViewTo(new e.scope.Point(board.x + board.width / 2, board.y + board.height / 2))
    }
  } else {
    // No engine (tests): duplicate the sheet without artwork.
    const names = new Set(store.artboards.map((b) => b.name))
    let name = `${active.name} copy`
    let n = 2
    while (names.has(name)) {
      name = `${active.name} copy ${n}`
      n++
    }
    store.addArtboard({
      id: `artboard-${Date.now()}`,
      name,
      x: active.x + active.width + 100,
      y: active.y,
      width: active.width,
      height: active.height,
    })
  }
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
    const e = getEngine()
    if (e && e.renameArtboard(id, newName)) {
      renamingId.value = ''
    } else if (!e) {
      store.updateArtboard(id, { name: newName })
      renamingId.value = ''
    }
  } else {
    renamingId.value = ''
  }
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
  const e = getEngine()
  if (e) {
    if (e.moveArtboard(board.id, posX.value, posY.value)) syncPositionFromStore()
  } else {
    store.updateArtboard(board.id, { x: posX.value, y: posY.value })
  }
}

watch(() => store.activeArtboardId, syncPositionFromStore, { immediate: true })
</script>

<style scoped>
.artboard-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: #252526;
  color: #c9c9c9;
  font-size: 12px;
  min-height: 80px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 10px 8px;
  background: #1e1e1e;
  border-bottom: 1px solid #161616;
  color: #d5d5d5;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.header-actions {
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

.panel-body {
  padding: 0;
  overflow-y: auto;
}

.artboard-item {
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

.artboard-item:hover {
  background: #333333;
}

.artboard-item.active {
  background: #2f6fbf;
  color: #fff;
}

.artboard-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artboard-name :deep(.el-input__wrapper) {
  background: #111;
  border: 1px solid #4a90d9;
  box-shadow: none !important;
  height: 22px;
}

.artboard-name :deep(.el-input__inner) {
  color: #fff;
  font-size: 12px;
}

.artboard-dims {
  font-size: 11px;
  color: #8a8a8a;
  flex-shrink: 0;
}

.artboard-item.active .artboard-dims {
  color: #dce9fa;
}

.artboard-position {
  display: grid;
  grid-template-columns: 20px 1fr 20px 1fr;
  gap: 6px;
  align-items: center;
  padding: 8px 10px;
  background: #1e1e1e;
}

.artboard-position :deep(.el-input__wrapper) {
  background: #111;
  border: 1px solid #3d3d3d;
  box-shadow: none !important;
  height: 26px;
  border-radius: 3px;
}

.artboard-position :deep(.el-input__inner) {
  color: #e6e6e6;
  font-size: 12px;
}

.pos-label {
  font-size: 11px;
  color: #9a9a9a;
}
</style>
