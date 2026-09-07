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
      <div class="layer-group" v-for="(layer, displayIndex) in displayedLayers" :key="layer.id">
        <div class="layer-item"
             :class="{ active: layer.id === store.activeLayerId, 'drop-before': dropIndex === displayIndex }"
             draggable="true"
             @click="selectLayer(layer.id)"
             @dragstart="onDragStart($event, layer.id)"
             @dragover.prevent="onDragOver($event, displayIndex)"
             @drop="onDrop($event, displayIndex)"
             @dragend="onDragEnd">
          <span class="layer-toggle" :class="{ open: layer.expand }" @click.stop="toggleExpand(layer)"></span>
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
        <div class="layer-children" v-if="layer.expand">
          <div v-for="entry in layerItems(layer.id)" :key="entry.id"
               class="tree-item" :class="{ active: store.selectedItemIds.includes(entry.id) }"
               :style="{ paddingLeft: (10 + entry.depth * 12) + 'px' }"
               @click.stop="selectTreeItem(entry.id, $event)">
            <span class="tree-vis" @click.stop="toggleTreeVisibility(entry)">
              <el-icon v-if="entry.visible" size="12"><View /></el-icon>
              <el-icon v-else size="12"><Hide /></el-icon>
            </span>
            <span class="tree-lock" @click.stop="toggleTreeLock(entry)">
              <el-icon v-if="entry.locked" size="12"><Lock /></el-icon>
              <el-icon v-else size="12"><Unlock /></el-icon>
            </span>
            <span class="tree-name">{{ entry.name }}</span>
          </div>
          <div v-if="layerItems(layer.id).length === 0" class="tree-empty">No objects</div>
        </div>
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
import type { LayerItemNode } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const renamingId = ref('')
const renameValue = ref('')
// Displayed top-first (Illustrator order); the store keeps bottom-first
// project order, so display indices map in reverse.
const displayedLayers = computed(() => [...store.layers].reverse())
// Object-tree entries per layer, rebuilt on any document or selection
// change (every mutation records history, so the history index is a
// sufficient document version).
const treeKey = computed(() =>
  [
    store.historyIndex,
    store.selectedItemIds.join(','),
    store.layers
      .map((l) => `${l.id}:${l.name}:${l.visible}:${l.locked}:${l.opacity}:${l.expand}`)
      .join(','),
  ].join('|')
)
const layerTree = computed(() => {
  void treeKey.value
  const map = new Map<string, LayerItemNode[]>()
  const e = getEngine()
  if (!e) return map
  for (const layer of store.layers) {
    map.set(layer.id, e.listLayerItems(layer.id))
  }
  return map
})
function layerItems(id: string): LayerItemNode[] {
  return layerTree.value.get(id) ?? []
}
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

function toggleExpand(layer: any) {
  store.updateLayer(layer.id, { expand: !layer.expand })
}

function selectTreeItem(id: string, e: MouseEvent) {
  getEngine()?.selectItemById(id, e.shiftKey)
}

function toggleTreeVisibility(entry: LayerItemNode) {
  getEngine()?.setItemVisible(entry.id, !entry.visible)
}

function toggleTreeLock(entry: LayerItemNode) {
  getEngine()?.setItemLocked(entry.id, !entry.locked)
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

.layer-toggle {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  cursor: pointer;
  position: relative;
}

.layer-toggle::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 3px;
  border-left: 5px solid #888;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 0.12s;
}

.layer-toggle.open::before {
  transform: rotate(90deg);
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 5px;
  padding-bottom: 5px;
  padding-right: 10px;
  cursor: pointer;
  font-size: 12px;
  color: #bbb;
  border-bottom: 1px solid #2a2a2a;
}

.tree-item:hover {
  background: #333;
}

.tree-item.active {
  background: #3a5a8c;
  color: #fff;
}

.tree-vis,
.tree-lock {
  display: flex;
  align-items: center;
  cursor: pointer;
  color: #777;
  width: 18px;
  height: 18px;
  justify-content: center;
  border-radius: 3px;
  flex-shrink: 0;
}

.tree-vis:hover,
.tree-lock:hover {
  color: #fff;
  background: #444;
}

.tree-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-empty {
  padding: 4px 10px 4px 28px;
  font-size: 11px;
  color: #666;
  font-style: italic;
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
