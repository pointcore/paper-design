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
      <div class="layer-item" v-for="layer in store.layers" :key="layer.id"
           :class="{ active: layer.id === store.activeLayerId }"
           @click="selectLayer(layer.id)">
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
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, inject, type Ref } from 'vue'
import { Plus, Delete, View, Hide, Lock, Unlock } from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const renamingId = ref('')
const renameValue = ref('')

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
