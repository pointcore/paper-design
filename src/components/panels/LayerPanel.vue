<template>
  <div class="layer-panel ai-panel">
    <div class="ly-search">
      <el-input
        v-model="searchText"
        placeholder="Search all layers & objects"
        size="small"
        :prefix-icon="Search"
        clearable
      />
      <el-icon size="14" class="ly-filter" title="Filter"><Filter /></el-icon>
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
          <span class="layer-vis" @click.stop="toggleVisibility(layer)">
            <el-icon v-if="layer.visible" size="12"><View /></el-icon>
            <el-icon v-else size="12"><Hide /></el-icon>
          </span>
          <span class="layer-lock" :class="{ locked: layer.locked }" title="Lock layer" @click.stop="toggleLock(layer)">
            <el-icon v-if="layer.locked" size="12"><Lock /></el-icon>
            <el-icon v-else size="12"><Unlock /></el-icon>
          </span>
          <span class="layer-color" :style="{ background: layerColor(layer.id) }"></span>
          <span class="layer-toggle" :class="{ open: layer.expand }" @click.stop="toggleExpand(layer)"></span>
          <span class="layer-name" @dblclick="startRename(layer)">
            <template v-if="renamingId === layer.id">
              <el-input v-model="renameValue" size="small" @blur="finishRename" @keyup.enter="finishRename" @click.stop />
            </template>
            <template v-else>{{ layer.name }}</template>
          </span>
          <span class="layer-target" :class="{ on: layer.id === store.activeLayerId }" title="Target" @click.stop="selectLayer(layer.id)"></span>
        </div>
        <div class="layer-children" v-if="layer.expand">
          <div v-for="entry in filteredLayerItems(layer.id)" :key="entry.id"
               class="tree-item" :class="{ active: store.selectedItemIds.includes(entry.id) }"
               @click.stop="selectTreeItem(entry.id, $event)">
            <span class="tree-vis" @click.stop="toggleTreeVisibility(entry)">
              <el-icon v-if="entry.visible" size="12"><View /></el-icon>
              <el-icon v-else size="12"><Hide /></el-icon>
            </span>
            <span class="tree-lock" :class="{ locked: entry.locked }" title="Lock object" @click.stop="toggleTreeLock(entry)">
              <el-icon v-if="entry.locked" size="11"><Lock /></el-icon>
              <el-icon v-else size="11"><Unlock /></el-icon>
            </span>
            <span class="tree-guide" :style="{ background: layerColor(layer.id) }"></span>
            <span v-if="entry.depth > 0" class="tree-indent" :style="{ width: (entry.depth * 12) + 'px' }"></span>
            <span class="tree-type">{{ entryIcon(entry) }}</span>
            <span class="tree-name">{{ entry.name }}</span>
            <span class="tree-target" :class="{ on: store.selectedItemIds.includes(entry.id) }"></span>
          </div>
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

    <div class="ly-bottombar">
      <span class="ly-status">{{ store.layers.length }} layer{{ store.layers.length === 1 ? '' : 's' }}</span>
      <div class="ly-actions">
        <el-icon size="13" class="action-btn" title="New layer" @click="addLayer"><Plus /></el-icon>
        <el-icon size="13" class="action-btn" title="Duplicate layer" @click="duplicateLayer"><CopyDocument /></el-icon>
        <el-icon size="13" class="action-btn" title="Delete layer" @click="removeLayer"><Delete /></el-icon>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, inject, type Ref } from 'vue'
import { Plus, CopyDocument, Delete, Search, Filter, View, Hide, Lock, Unlock } from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { LayerItemNode } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const renamingId = ref('')
const renameValue = ref('')
const searchText = ref('')
// Displayed top-first (Illustrator order); the store keeps bottom-first
// project order, so display indices map in reverse.
const displayedLayers = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  const all = [...store.layers].reverse()
  if (!q) return all
  return all.filter((l) => l.name.toLowerCase().includes(q))
})
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

/** Filtered object entries for AI-style search. */
function filteredLayerItems(id: string): LayerItemNode[] {
  const q = searchText.value.trim().toLowerCase()
  const items = layerItems(id)
  if (!q) return items
  return items.filter((it) => it.name.toLowerCase().includes(q))
}

/** Stable accent color per layer, mimicking AI's layer color strip. */
const LAYER_COLORS = ['#e04c4c', '#4a90d9', '#7ac943', '#e6a23c', '#9b59b6', '#1abc9c']
function layerColor(id: string): string {
  const idx = store.layers.findIndex((l) => l.id === id)
  return LAYER_COLORS[((idx % LAYER_COLORS.length) + LAYER_COLORS.length) % LAYER_COLORS.length]
}

/** Single-letter type glyph for the object row (A = text, ▢ = shape). */
function entryIcon(entry: LayerItemNode): string {
  const n = entry.name.toLowerCase()
  if (n.includes('text') || n.startsWith('a ') || n === 'a') return 'A'
  return '▢'
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

function duplicateLayer() {
  getEngine()?.duplicateLayer(store.activeLayerId)
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
.ai-panel {
  background: #252526;
  color: #c9c9c9;
  font-size: 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.layer-panel {
  flex: 1;
  min-height: 100px;
}

/* Search row, like AI */
.ly-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 6px;
  background: #1e1e1e;
}

.ly-search :deep(.el-input) {
  flex: 1;
}

.ly-search :deep(.el-input__wrapper) {
  background: #111111;
  border: 1px solid #3d3d3d;
  box-shadow: none !important;
  border-radius: 3px;
  height: 26px;
}

.ly-search :deep(.el-input__inner) {
  color: #e6e6e6;
  font-size: 12px;
}

.ly-search :deep(.el-input__inner::placeholder) {
  color: #6f6f6f;
}

.ly-search :deep(.el-input__prefix) {
  color: #8a8a8a;
}

.ly-filter {
  color: #8a8a8a;
  cursor: pointer;
  flex-shrink: 0;
}

.ly-filter:hover {
  color: #fff;
}

/* Bottom status + action bar, like AI */
.ly-bottombar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  background: #1e1e1e;
  border-top: 1px solid #161616;
  flex-shrink: 0;
}

.ly-status {
  font-size: 11px;
  color: #8a8a8a;
}

.ly-actions {
  display: flex;
  gap: 8px;
}

.action-btn {
  cursor: pointer;
  color: #9a9a9a;
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

.layer-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 10px;
  height: 30px;
  cursor: pointer;
  font-size: 12px;
  color: #d5d5d5;
  border-bottom: 1px solid #1e1e1e;
  background: #2a2a2a;
}

.layer-item:hover {
  background: #333333;
}

.layer-item.active {
  background: #2f6fbf;
  color: #fff;
}

.layer-item.active .layer-vis,
.layer-item.active .layer-lock,
.layer-item.active .layer-toggle::before {
  color: #fff;
  border-left-color: #fff;
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
  border-left: 5px solid #8a8a8a;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 0.12s;
}

.layer-toggle.open::before {
  transform: rotate(90deg);
}

.layer-color {
  width: 3px;
  align-self: stretch;
  flex-shrink: 0;
  border-radius: 1px;
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px 0 10px;
  cursor: pointer;
  font-size: 12px;
  color: #bcbcbc;
  border-bottom: 1px solid #222222;
  background: #252526;
  position: relative;
}

.tree-item:hover {
  background: #333333;
}

.tree-item.active {
  background: #2f6fbf;
  color: #fff;
}

.tree-item.active .tree-vis,
.tree-item.active .tree-type {
  color: #fff;
}

.tree-guide {
  width: 3px;
  align-self: stretch;
  flex-shrink: 0;
  opacity: 0.9;
}

.tree-indent {
  flex-shrink: 0;
}

.tree-type {
  width: 14px;
  flex-shrink: 0;
  text-align: center;
  font-size: 11px;
  color: #8a8a8a;
}

.tree-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drop-end {
  height: 10px;
}

.drop-end.active {
  box-shadow: inset 0 -2px 0 #4a90d9;
}

.layer-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-top: 1px solid #161616;
  background: #1e1e1e;
}

.layer-footer :deep(.el-slider__runway) {
  background: #3d3d3d;
  height: 4px;
}

.layer-footer :deep(.el-slider__bar) {
  background: #4a90d9;
  height: 4px;
}

.layer-footer :deep(.el-slider__button) {
  width: 12px;
  height: 12px;
  border: 2px solid #4a90d9;
  background: #fff;
}

.footer-label {
  font-size: 11px;
  color: #9a9a9a;
  flex-shrink: 0;
}

.layer-vis,
.layer-lock {
  display: flex;
  align-items: center;
  cursor: pointer;
  color: #8a8a8a;
  width: 20px;
  height: 20px;
  justify-content: center;
  border-radius: 3px;
  flex-shrink: 0;
}

.layer-vis:hover,
.layer-lock:hover {
  color: #fff;
  background: #444;
}

/* AI-style: lock affordance stays hidden until hover, unless locked */
.layer-lock {
  opacity: 0;
  transition: opacity 0.12s;
}

.layer-item:hover .layer-lock,
.layer-lock.locked {
  opacity: 1;
}

.tree-vis {
  display: flex;
  align-items: center;
  cursor: pointer;
  color: #7a7a7a;
  width: 20px;
  height: 20px;
  justify-content: center;
  border-radius: 3px;
  flex-shrink: 0;
}

.tree-vis:hover {
  color: #fff;
  background: #444;
}

.tree-lock {
  display: flex;
  align-items: center;
  cursor: pointer;
  color: #8a8a8a;
  width: 20px;
  height: 18px;
  justify-content: center;
  border-radius: 3px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.12s;
}

.tree-item:hover .tree-lock,
.tree-lock.locked {
  opacity: 1;
}

.tree-lock:hover {
  color: #fff;
  background: #444;
}

.tree-item.active .tree-lock {
  color: #fff;
}

/* Target circle column, like AI */
.layer-target,
.tree-target {
  width: 12px;
  height: 12px;
  border: 1px solid #6a6a6a;
  border-radius: 50%;
  flex-shrink: 0;
  cursor: pointer;
  margin-left: auto;
}

.layer-item.active .layer-target,
.tree-item.active .tree-target {
  border-color: #fff;
}

.layer-target.on,
.tree-target.on {
  position: relative;
}

.layer-target.on::after,
.tree-target.on::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: currentColor;
}

.layer-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layer-name :deep(.el-input__wrapper) {
  background: #111;
  border: 1px solid #4a90d9;
  box-shadow: none !important;
  height: 22px;
}

.layer-name :deep(.el-input__inner) {
  color: #fff;
  font-size: 12px;
}
</style>
