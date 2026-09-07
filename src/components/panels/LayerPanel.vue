<template>
  <div class="layer-panel">
    <div class="panel-header">
      <span>Layers</span>
      <div class="header-actions">
        <el-icon size="14" class="action-btn" title="New Layer" @click="addLayer"><Plus /></el-icon>
        <el-icon size="14" class="action-btn" title="Delete Layer" @click="removeLayer"><Delete /></el-icon>
      </div>
    </div>

    <div class="panel-body">
      <div class="layer-item" v-for="(layer, displayIndex) in displayedLayers" :key="layer.id"
           :class="{ active: layer.id === store.activeLayerId, 'drop-before': dropIndex === displayIndex }"
           draggable="true"
           @click="selectLayer(layer.id)"
           @dragstart="onDragStart($event, layer.id)"
           @dragover.prevent="onDragOver($event, displayIndex)"
           @drop="onDrop($event, displayIndex)"
           @dragend="onDragEnd">
        <span class="layer-vis" @click.stop="toggleVisibility(layer)">
          <el-icon v-if="layer.visible" size="12"><View /></el-icon>
          <el-icon v-else size="12"><Hide /></el-icon>
        </span>
        <span class="layer-lock" @click.stop="toggleLock(layer)">
          <el-icon v-if="layer.locked" size="12"><Lock /></el-icon>
          <el-icon v-else size="12"><Unlock /></el-icon>
        </span>
        <span class="layer-name" @dblclick="startRename(layer)">
          <template v-if="renamingId === layer.id">
            <el-input v-model="renameValue" size="small" @blur="finishRename" @keyup.enter="finishRename" />
          </template>
          <template v-else>{{ layer.name }}</template>
        </span>
      </div>
      <div class="drop-end" :class="{ active: dropIndex === displayedLayers.length }"
           @dragover.prevent="onDragOver($event, displayedLayers.length)"
           @drop="onDrop($event, displayedLayers.length)"></div>
    </div>

    <div class="layer-footer" v-if="store.activeLayer">
      <span class="footer-label">Opacity</span>
      <el-slider v-model="layerOpacity" :min="0" :max="100" size="small" @change="onLayerOpacityChange" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, inject, type Ref } from 'vue'
import { Plus, Delete, View, Hide, Lock, Unlock } from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const renamingId = ref('')
const renameValue = ref('')
// Displayed top-first (Illustrator order); the store keeps bottom-first
// project order, so display indices map in reverse.
const displayedLayers = computed(() => [...store.layers].reverse())
// Insert-before display index while dragging (length means the bottom end).
const dropIndex = ref(-1)
const draggedId = ref('')
const layerOpacity = ref(100)

function getEngine() { return engineRef?.value || null }

function selectLayer(id: string) {
  store.setActiveLayer(id)
  const e = getEngine()
  if (e) {
    e.clearSelection()
    const layer = e.project.layers.find((l) => (l.data as any)?.layerId === id)
    if (layer) {
      layer.activate()
    }
  }
}

function toggleVisibility(layer: any) {
  const e = getEngine()
  if (!e) return
  layer.visible = !layer.visible
  store.updateLayer(layer.id, { visible: layer.visible })
  const pLayer = e.project.layers.find((l) => (l.data as any)?.layerId === layer.id)
  if (pLayer) {
    pLayer.visible = layer.visible
    e.scope.view.update()
  }
}

function toggleLock(layer: any) {
  const e = getEngine()
  if (!e) return
  layer.locked = !layer.locked
  store.updateLayer(layer.id, { locked: layer.locked })
  const pLayer = e.project.layers.find((l) => (l.data as any)?.layerId === layer.id)
  if (pLayer) {
    pLayer.locked = layer.locked
  }
}

function addLayer() {
  const e = getEngine()
  if (!e) return
  const layer = e.createLayer()
  const layerItem = {
    id: layer.data.layerId as string,
    name: layer.name || 'Layer',
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
    isUserLayer: true,
    expand: true,
  }
  store.addLayer(layerItem)
  e.syncLayersToStore()
}

function removeLayer() {
  const e = getEngine()
  if (!e) return
  if (store.layers.length <= 1) {
    store.setStatusMessage('At least one layer must be kept')
    return
  }
  const activeId = store.activeLayerId
  e.deleteLayer(activeId)
}

function startRename(layer: any) {
  renamingId.value = layer.id
  renameValue.value = layer.name
}

function finishRename() {
  if (renamingId.value) {
    const id = renamingId.value
    const newName = renameValue.value.trim() || 'Layer'
    store.updateLayer(id, { name: newName })
    const e = getEngine()
    if (e) {
      const pLayer = e.project.layers.find((l) => (l.data as any)?.layerId === id)
      if (pLayer) pLayer.name = newName
    }
  }
  renamingId.value = ''
}

function onDragStart(e: DragEvent, id: string) {
  draggedId.value = id
  dropIndex.value = -1
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
}

function onDragOver(e: DragEvent, displayIndex: number) {
  if (!draggedId.value) return
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropIndex.value = displayIndex
}

function onDrop(e: DragEvent, displayIndex: number) {
  e.preventDefault()
  const id = draggedId.value
  onDragEnd()
  if (!id) return
  // Work in bottom-first store order, then mirror to the paper project.
  const order = [...store.layers]
  const from = order.findIndex((l) => l.id === id)
  if (from < 0) return
  order.splice(from, 1)
  const to = Math.min(order.length, Math.max(0, order.length - displayIndex))
  if (to === from) return
  store.reorderLayer(from, to)
  getEngine()?.moveUserLayer(id, to)
}

function onDragEnd() {
  draggedId.value = ''
  dropIndex.value = -1
}

function syncOpacityFromStore() {
  const active = store.activeLayer
  layerOpacity.value = Math.round((active?.opacity ?? 1) * 100)
}

function onLayerOpacityChange(val: number) {
  getEngine()?.setActiveLayerOpacity(val / 100)
}

watch(() => store.activeLayerId, syncOpacityFromStore, { immediate: true })
watch(() => store.layers.map((l) => `${l.id}:${l.opacity}`).join(','), syncOpacityFromStore)
</script>

<style scoped>
.layer-panel {
  flex: 1;
  overflow-y: auto;
  min-height: 100px;
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
}

.layer-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  cursor: pointer;
  font-size: 13px;
  color: #ccc;
  border-bottom: 1px solid #2e2e2e;
}

.layer-item:hover {
  background: #333;
}

.layer-item.active {
  background: #3a5a8c;
  color: #fff;
}

.layer-item.drop-before {
  box-shadow: inset 0 2px 0 #4a90d9;
}

.drop-end {
  height: 8px;
}

.drop-end.active {
  box-shadow: inset 0 -2px 0 #4a90d9;
}

.layer-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid #3a3a3a;
}

.footer-label {
  font-size: 12px;
  color: #aaa;
  flex-shrink: 0;
}

.layer-vis,
.layer-lock {
  display: flex;
  align-items: center;
  cursor: pointer;
  color: #888;
  width: 18px;
  height: 18px;
  justify-content: center;
  border-radius: 3px;
}

.layer-vis:hover,
.layer-lock:hover {
  color: #fff;
  background: #444;
}

.layer-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
