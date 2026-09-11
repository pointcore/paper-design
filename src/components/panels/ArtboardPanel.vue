<template>
  <div class="artboard-panel">
    <div class="panel-header">
      <span>Artboards</span>
      <div class="header-actions">
        <el-icon size="14" class="action-btn" title="New Artboard" @click="addBoard"><Plus /></el-icon>
        <el-icon size="14" class="action-btn" title="Duplicate active artboard (with artwork)" @click="duplicateBoard"><CopyDocument /></el-icon>
        <el-icon size="14" class="action-btn" title="Fit artboard to artwork" @click="fitBoard"><Expand /></el-icon>
        <el-icon size="14" class="action-btn" title="Arrange artboards in a row" @click="arrangeBoards"><Grid /></el-icon>
        <el-icon size="14" class="action-btn" title="Delete Artboard" @click="removeBoard"><Delete /></el-icon>
      </div>
    </div>

    <div class="panel-body">
      <div class="artboard-item" v-for="board in store.artboards" :key="board.id"
           :class="{ active: board.id === store.activeArtboardId }"
           @click="activateBoard(board.id)"
           @contextmenu.prevent="openCtx(board, $event)">
        <span class="artboard-name" @dblclick="startRename(board)">
          <template v-if="renamingId === board.id">
            <el-input v-model="renameValue" size="small" @blur="finishRename" @keyup.enter="finishRename" @keyup.esc="cancelRename" />
          </template>
          <template v-else>{{ board.name }}</template>
        </span>
        <span class="artboard-dims">{{ Math.round(board.width) }} x {{ Math.round(board.height) }}</span>
      </div>

      <div v-if="ctxMenu" class="board-ctx" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
        <div class="board-ctx-item" @click="ctxRename">Rename</div>
        <div class="board-ctx-item" @click="ctxDuplicate">Duplicate</div>
        <div class="board-ctx-item" @click="ctxFit">Fit to Artwork</div>
        <div class="board-ctx-item" :class="{ disabled: store.artboards.length <= 1 }" @click="ctxDelete">Delete</div>
      </div>

      <div v-if="store.activeArtboard" class="artboard-position">
        <span class="pos-label">X</span>
        <el-input-number v-model="posX" size="small" @change="onPositionChange" />
        <span class="pos-label">Y</span>
        <el-input-number v-model="posY" size="small" @change="onPositionChange" />
      </div>

      <div v-if="store.activeArtboard" class="artboard-position">
        <span class="pos-label">W</span>
        <el-input-number v-model="sizeW" :min="1" :max="16384" size="small" @change="onSizeChange" />
        <span class="pos-label">H</span>
        <el-input-number v-model="sizeH" :min="1" :max="16384" size="small" @change="onSizeChange" />
      </div>

      <div v-if="store.activeArtboard" class="artboard-follow">
        <el-checkbox v-model="moveArt" size="small">Move artwork with board</el-checkbox>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, inject, onMounted, onUnmounted, type Ref } from 'vue'
import { Plus, Delete, CopyDocument, Expand, Grid } from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

onMounted(() => {
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onCtxKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onCtxKeydown)
})

// Row context menu (per-board rename / duplicate / fit / delete).
const ctxMenu = ref<{ x: number; y: number; id: string } | null>(null)
function openCtx(board: { id: string }, e: MouseEvent) {
  ctxMenu.value = {
    x: Math.min(e.clientX, window.innerWidth - 180),
    y: Math.min(e.clientY, window.innerHeight - 170),
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
  const e = getEngine()
  const id = ctxMenu.value?.id
  closeCtx()
  if (!e || !id) return
  if (!e.duplicateArtboard(id)) store.setStatusMessage('Could not duplicate that artboard')
}
function ctxFit() {
  const e = getEngine()
  const id = ctxMenu.value?.id
  closeCtx()
  if (!e || !id) return
  if (!e.fitArtboardToArtwork(id)) store.setStatusMessage('No artwork on this artboard')
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
  const e = getEngine()
  if (e) {
    e.refreshArtboards()
    e.pushHistory('Delete Artboard')
  }
}
function onDocClick() {
  closeCtx()
}
function onCtxKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') closeCtx()
}

const renamingId = ref('')
const renameValue = ref('')
const posX = ref(0)
const posY = ref(0)
const sizeW = ref(0)
const sizeH = ref(0)
const moveArt = ref(false)

try {
  moveArt.value = localStorage.getItem('vve.moveArt') === '1'
} catch { /* private mode */ }

watch(moveArt, (v) => {
  try {
    localStorage.setItem('vve.moveArt', v ? '1' : '0')
  } catch { /* private mode */ }
})

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

function fitBoard() {
  const e = getEngine()
  const active = store.activeArtboard
  if (!active) return
  if (e) {
    if (!e.fitArtboardToArtwork(active.id)) {
      store.setStatusMessage('No artwork on this artboard')
    }
  } else {
    store.setStatusMessage('No engine')
  }
}

function arrangeBoards() {
  const e = getEngine()
  if (!e) return
  e.arrangeArtboards()
  store.setStatusMessage('Artboards arranged in a row')
}

function duplicateBoard() {  const e = getEngine()
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

function cancelRename() {
  renamingId.value = ''
}

function finishRename() {
  if (!renamingId.value) {
    renamingId.value = ''
    return
  }
  const id = renamingId.value
  const newName = renameValue.value.trim() || 'Artboard'
  const e = getEngine()
  // renameArtboard() returns false for a no-op (unchanged name, unknown id),
  // which is not a reason to leave the row stuck in edit mode.
  if (e) e.renameArtboard(id, newName)
  else store.updateArtboard(id, { name: newName })
  renamingId.value = ''
}

function syncPositionFromStore() {
  const board = store.activeArtboard
  if (!board) return
  posX.value = Math.round(board.x)
  posY.value = Math.round(board.y)
  sizeW.value = Math.round(board.width)
  sizeH.value = Math.round(board.height)
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
    if (e.moveArtboard(board.id, posX.value, posY.value, { withArtwork: moveArt.value })) syncPositionFromStore()
  } else {
    store.updateArtboard(board.id, { x: posX.value, y: posY.value })
  }
}

function onSizeChange() {
  const board = store.activeArtboard
  if (!board) return
  if (!Number.isFinite(sizeW.value) || !Number.isFinite(sizeH.value)) {
    syncPositionFromStore()
    return
  }
  const e = getEngine()
  if (e) {
    if (e.resizeArtboard(board.id, sizeW.value, sizeH.value)) syncPositionFromStore()
  } else {
    store.updateArtboard(board.id, { width: sizeW.value, height: sizeH.value })
  }
}

watch(() => store.activeArtboardId, syncPositionFromStore, { immediate: true })
</script>

<style scoped>
.board-ctx {
  position: fixed;
  z-index: 1000;
  background: #3c3c3c;
  border: 1px solid #555;
  border-radius: 4px;
  padding: 4px;
  min-width: 150px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
}
.board-ctx-item {
  padding: 6px 12px;
  color: #ddd;
  font-size: 12px;
  cursor: pointer;
  border-radius: 2px;
  white-space: nowrap;
}
.board-ctx-item:hover { background: #4a90d9; color: #fff; }
.board-ctx-item.disabled { opacity: 0.4; pointer-events: none; }
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

.artboard-follow {
  padding: 0 10px 8px;
  background: #1e1e1e;
  font-size: 11px;
  color: #9a9a9a;
}
</style>
