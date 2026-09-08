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
      <el-dropdown trigger="click" @command="onPanelMenu">
        <el-icon size="14" class="ly-menu" title="Panel options"><MoreFilled /></el-icon>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="new-layer">New Layer</el-dropdown-item>
            <el-dropdown-item command="new-sublayer">New Sublayer</el-dropdown-item>
            <el-dropdown-item command="duplicate" divided>Duplicate Layer</el-dropdown-item>
            <el-dropdown-item command="delete-layer">Delete Layer</el-dropdown-item>
            <el-dropdown-item command="collect" divided :disabled="!canCollect">Collect in New Layer</el-dropdown-item>
            <el-dropdown-item command="release" :disabled="!canRelease">Release to Layers</el-dropdown-item>
            <el-dropdown-item command="group" divided :disabled="!canGroup">Group</el-dropdown-item>
            <el-dropdown-item command="ungroup" :disabled="!canUngroup">Ungroup</el-dropdown-item>
            <el-dropdown-item command="expand-all" divided>Expand All</el-dropdown-item>
            <el-dropdown-item command="collapse-all">Collapse All</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <div class="panel-body">
      <div class="layer-group" v-for="(layer, displayIndex) in displayedLayers" :key="layer.id">
        <div class="layer-item"
             :class="{ active: layer.id === store.activeLayerId, 'drop-before': dropIndex === displayIndex, 'tree-drop': treeLayerDrop === layer.id }"
             draggable="true"
             @click="selectLayer(layer.id)"
             @contextmenu.prevent="onLayerMenu($event, layer)"
             @dragstart="onDragStart($event, layer.id)"
             @dragover="onLayerDragOver($event, layer, displayIndex)"
             @dragleave="onLayerDragLeave($event)"
             @drop="onLayerDrop($event, layer, displayIndex)"
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
          <span class="layer-indent"></span>
          <span class="layer-toggle" :class="{ open: layer.expand }" @click.stop="toggleExpand(layer)"></span>
          <span class="layer-icon">◫</span>
          <span class="layer-name" @dblclick.stop="startRename(layer)">
            <template v-if="renamingId === layer.id">
              <el-input v-model="renameValue" size="small" @blur="finishRename" @keyup.enter="finishRename" @keyup.esc="cancelRename" @click.stop />
            </template>
            <template v-else>{{ layer.name }}</template>
          </span>
          <span class="layer-target" :class="{ on: layer.id === store.activeLayerId }" title="Target" @click.stop="selectLayer(layer.id)"></span>
          <span class="layer-sel" :class="{ on: layersWithSelection.has(layer.id) }" :style="layersWithSelection.has(layer.id) ? { background: layerColor(layer.id) } : undefined"></span>
        </div>
        <div class="layer-children" v-if="layer.expand">
          <div v-for="entry in filteredLayerItems(layer.id)" :key="entry.id"
               class="tree-item"
               :class="treeRowClass(entry)"
               draggable="true"
               @click.stop="selectTreeItem(entry.id, $event)"
               @dblclick.stop="onItemDblclick(entry)"
               @contextmenu.prevent.stop="onItemMenu($event, entry)"
               @dragstart.stop="onTreeDragStart($event, entry)"
               @dragover.prevent.stop="onTreeDragOver($event, entry)"
               @dragleave.stop="onTreeDragLeave(entry)"
               @drop.prevent.stop="onTreeDrop($event, entry)"
               @dragend.stop="onTreeDragEnd">
            <span class="tree-vis" @click.stop="toggleTreeVisibility(entry)">
              <el-icon v-if="entry.visible" size="12"><View /></el-icon>
              <el-icon v-else size="12"><Hide /></el-icon>
            </span>
            <span class="tree-lock" :class="{ locked: entry.locked }" title="Lock object" @click.stop="toggleTreeLock(entry)">
              <el-icon v-if="entry.locked" size="11"><Lock /></el-icon>
              <el-icon v-else size="11"><Unlock /></el-icon>
            </span>
            <span class="tree-guide" :style="{ background: layerColor(layer.id) }"></span>
            <!-- Layer members always sit one level below the layer row itself (AI-style) -->
            <span class="tree-indent" :style="{ width: ((entry.depth + 1) * 14) + 'px' }"></span>
            <span v-if="isContainer(entry)" class="tree-toggle" :class="{ open: !entry.collapsed }"
                  title="Expand/collapse" @click.stop="toggleTreeCollapsed(entry)"></span>
            <span v-else class="tree-toggle-spacer"></span>
            <span class="tree-thumb" :class="'k-' + entry.kind">
              <img v-if="thumbOf(entry.id) !== ''" :src="thumbOf(entry.id)" alt="" draggable="false" />
              <template v-else>{{ entryIcon(entry) }}</template>
            </span>
            <span class="tree-name" @dblclick.stop="startItemRename(entry)">
              <template v-if="itemRenamingId === entry.id">
                <el-input v-model="itemRenameValue" size="small" @blur="finishItemRename" @keyup.enter="finishItemRename" @keyup.esc="cancelItemRename" @click.stop @dblclick.stop />
              </template>
              <template v-else>{{ entry.name }}</template>
            </span>
            <span class="tree-target" :class="{ on: store.selectedItemIds.includes(entry.id) }"></span>
            <span class="tree-sel"></span>
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
      <span class="ly-status">{{ statusText }}</span>
      <div class="ly-actions">
        <el-icon size="13" class="action-btn" title="New layer" @click="addLayer"><Plus /></el-icon>
        <el-icon size="13" class="action-btn" title="New sublayer" @click="addSublayer"><FolderAdd /></el-icon>
        <el-icon size="13" class="action-btn" :class="{ disabled: !canGroup }" title="Group (Ctrl+G)" @click="groupSelected"><Collection /></el-icon>
        <el-icon size="13" class="action-btn" :class="{ disabled: !canUngroup }" title="Ungroup (Ctrl+Shift+G)" @click="ungroupSelected"><FolderOpened /></el-icon>
        <el-icon size="13" class="action-btn" title="Duplicate layer" @click="duplicateLayer"><CopyDocument /></el-icon>
        <el-icon size="13" class="action-btn" title="Merge layer below" @click="mergeLayerBelow"><Files /></el-icon>
        <el-icon size="13" class="action-btn" title="Delete layer" @click="removeLayer"><Delete /></el-icon>
      </div>
    </div>

    <div v-if="ctxMenu" class="ly-ctx" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
      <template v-for="(item, i) in ctxItems" :key="i">
        <div v-if="item.sep" class="ly-ctx-sep"></div>
        <div v-else class="ly-ctx-item" :class="{ disabled: item.disabled }" @click="onCtxAction(item)">{{ item.label }}</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, inject, onMounted, onUnmounted, type Ref } from 'vue'
import { Plus, CopyDocument, Delete, Files, Search, Filter, MoreFilled, FolderAdd, Collection, FolderOpened, View, Hide, Lock, Unlock } from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { LayerItemNode } from '../../editor/types'
import { LAYER_COLORS } from '../../editor/selection/selection-style'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const renamingId = ref('')
const renameValue = ref('')
const itemRenamingId = ref('')
const itemRenameValue = ref('')
const searchText = ref('')
// Displayed top-first (Illustrator order); the store keeps bottom-first
// project order, so display indices map in reverse.
const displayedLayers = computed(() => {
  const q = searchText.value.trim().toLowerCase()
  const all = [...store.layers].reverse()
  if (!q) return all
  return all.filter((l) => l.name.toLowerCase().includes(q) || layerHasMatch(l.id, q))
})
// Object-tree entries per layer, rebuilt on any document or selection
// change (every mutation records history, so the history index is a
// sufficient document version) plus local tree ticks for metadata-only
// toggles such as folding.
const treeTick = ref(0)
const treeKey = computed(() =>
  [
    store.historyIndex,
    store.selectedItemIds.join(','),
    treeTick.value,
    store.layers
      .map((l) => `${l.id}:${l.name}:${l.visible}:${l.locked}:${l.opacity}:${l.expand}`)
      .join(','),
  ].join('|')
)
/** Nested AI-style trees per layer (collapse state kept on the nodes). */
const layerTree = computed(() => {
  void treeKey.value
  const map = new Map<string, LayerItemNode[]>()
  const e = getEngine()
  if (!e) return map
  for (const layer of store.layers) {
    map.set(layer.id, e.listLayerTree(layer.id))
  }
  return map
})
/** Depth-first flatten helper (optionally respecting fold state). */
function flattenNodes(nodes: LayerItemNode[], respectCollapse: boolean, out: LayerItemNode[]): LayerItemNode[] {
  for (const node of nodes) {
    out.push(node)
    if (respectCollapse && node.collapsible && node.collapsed) continue
    if (node.children.length > 0) flattenNodes(node.children, respectCollapse, out)
  }
  return out
}
function allNested(layerId: string): LayerItemNode[] {
  return flattenNodes(layerTree.value.get(layerId) ?? [], false, [])
}
function layerHasMatch(layerId: string, q: string): boolean {
  return allNested(layerId).some((n) => n.name.toLowerCase().includes(q))
}

/** Filtered object entries for AI-style search (search pierces folds). */
function filteredLayerItems(id: string): LayerItemNode[] {
  const q = searchText.value.trim().toLowerCase()
  const nodes = layerTree.value.get(id) ?? []
  if (!q) return flattenNodes(nodes, true, [])
  return flattenNodes(nodes, false, []).filter((it) => it.name.toLowerCase().includes(q))
}

/**
 * Thumbnail data URLs for the displayed rows. The engine caches per
 * document version, so selection-only rebuilds are plain map lookups;
 * unrenderable entries resolve to '' and show the type glyph instead.
 */
const thumbUrls = computed(() => {
  void treeKey.value
  const map = new Map<string, string>()
  const e = getEngine()
  if (!e) return map
  let budget = 150
  for (const layer of displayedLayers.value) {
    if (budget <= 0) break
    for (const entry of filteredLayerItems(layer.id)) {
      if (budget <= 0) break
      budget--
      map.set(entry.id, e.thumbnailForItem(entry.id) ?? '')
    }
  }
  return map
})

function thumbOf(id: string): string {
  return thumbUrls.value.get(id) ?? ''
}

/** Stable accent color per layer, mimicking AI's layer color strip. */
function layerColor(id: string): string {
  const idx = store.layers.findIndex((l) => l.id === id)
  return LAYER_COLORS[((idx % LAYER_COLORS.length) + LAYER_COLORS.length) % LAYER_COLORS.length]
}

/** Containers render with disclosure triangles and accept drops inside. */
function isContainer(entry: LayerItemNode): boolean {
  if (entry.collapsible) return true
  // Empty sublayers still accept drops so they can be filled.
  return entry.kind === 'sublayer'
}

/** Single-glyph type icon per entry kind (A = text, folders = containers). */
function entryIcon(entry: LayerItemNode): string {
  switch (entry.kind) {
    case 'sublayer': return '▤'
    case 'group': return '▣'
    case 'clip': return '◐'
    case 'compound': return '◈'
    case 'text': return 'A'
    case 'image': return '▦'
    case 'symbol': return '◆'
    case 'path': return '▢'
    default: return '●'
  }
}
/** Selected entry lookup across layers (button enable states). */
const selectedEntries = computed(() => {
  const ids = new Set(store.selectedItemIds)
  if (ids.size === 0) return [] as LayerItemNode[]
  const out: LayerItemNode[] = []
  for (const layer of store.layers) {
    for (const node of allNested(layer.id)) {
      if (ids.has(node.id)) out.push(node)
    }
  }
  return out
})
const canGroup = computed(() => store.selectedItemIds.length >= 2)
/** Layers containing artwork selection (AI's right-end selection square). */
const layersWithSelection = computed(() => new Set(selectedEntries.value.map((n) => n.layerId)))
const canUngroup = computed(() => selectedEntries.value.some((n) => n.collapsible || n.kind === 'sublayer' || n.kind === 'group'))
const canCollect = computed(() => store.selectedItemIds.length > 0)
const canRelease = computed(() => selectedEntries.value.some((n) => n.collapsible || n.kind === 'sublayer' || n.kind === 'group'))
const statusText = computed(() => {
  const layers = `${store.layers.length} layer${store.layers.length === 1 ? '' : 's'}`
  return store.selectedItemIds.length > 0
    ? `${layers} · ${store.selectedItemIds.length} selected`
    : layers
})
// Insert-before display index while dragging (length means the bottom end).
const dropIndex = ref(-1)
const draggedId = ref('')
// Tree-item drag state (HTML5 DnD across layers/groups).
const draggedTreeId = ref('')
const treeDropTarget = ref('')
const treeDropPos = ref<'before' | 'inside' | 'after'>('before')
const treeLayerDrop = ref('')
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

function toggleTreeCollapsed(entry: LayerItemNode) {
  getEngine()?.setTreeCollapsed(entry.id, !entry.collapsed)
  treeTick.value++
}

/** Double-click a row: containers isolate for focused editing. */
function onItemDblclick(entry: LayerItemNode) {
  if (itemRenamingId.value) return
  if (!entry.collapsible) return
  const e = getEngine()
  if (!e) return
  e.selectItemById(entry.id)
  const groups = e.getSelection().filter(
    (i) => i instanceof e.scope.Group && !(i.data as any)?.textMode
  )
  if (groups.length === 0 || !e.enterIsolation(groups[0] as paper.Group)) {
    store.setStatusMessage('Select a group to isolate')
  }
}

function addLayer() {
  const e = getEngine()
  if (!e) return
  // createLayer already syncs the store (no extra push: that would duplicate
  // the row); just point the active layer at the newborn.
  const layer = e.createLayer()
  const id = layer.data.layerId as string | undefined
  if (id) store.setActiveLayer(id)
}

function addSublayer() {
  const e = getEngine()
  if (!e) return
  if (!e.createSublayer()) {
    store.setStatusMessage('Cannot create sublayer here')
  }
}

function groupSelected() {
  const e = getEngine()
  if (!e) return
  if (!e.groupSelection()) {
    store.setStatusMessage('Select 2 or more objects to group')
  }
}

function ungroupSelected() {
  const e = getEngine()
  if (!e) return
  if (!e.ungroupSelection()) {
    store.setStatusMessage('Select a group to ungroup')
  }
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

function mergeLayerBelow() {
  const e = getEngine()
  if (!e) return
  if (!e.mergeLayerBelow()) {
    store.setStatusMessage('No layer below to merge')
  }
}

function startRename(layer: any) {
  renamingId.value = layer.id
  renameValue.value = layer.name
}

function cancelRename() {
  renamingId.value = ''
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

function startItemRename(entry: LayerItemNode) {
  itemRenamingId.value = entry.id
  // Strip the auto-appended kind suffix so it never doubles up.
  itemRenameValue.value = entry.name.replace(/\s*\((Sublayer|Group|Clipping Mask|Compound Path|Closed Path|Path|Path Text|Area Text|Vertical Text|Text|Image|Symbol|Object)\)\s*$/i, '').trim()
}

function cancelItemRename() {
  itemRenamingId.value = ''
}

function finishItemRename() {
  if (itemRenamingId.value) {
    const ok = getEngine()?.renameTreeItem(itemRenamingId.value, itemRenameValue.value)
    if (!ok) store.setStatusMessage('Rename failed')
  }
  itemRenamingId.value = ''
}

// ===== Tree drag-drop (reorder + reparent, AI-style) =====

function treeDragActive(ev: DragEvent): boolean {
  const types = ev.dataTransfer?.types
  if (!types) return draggedTreeId.value !== ''
  for (let i = 0; i < types.length; i++) {
    if (types[i] === 'application/x-tree-item') return true
  }
  return false
}

function siblingsOf(layerId: string, parentId: string): LayerItemNode[] {
  const roots = layerTree.value.get(layerId) ?? []
  if (!parentId) return roots
  const find = (nodes: LayerItemNode[]): LayerItemNode | null => {
    for (const n of nodes) {
      if (n.id === parentId) return n
      const hit = find(n.children)
      if (hit) return hit
    }
    return null
  }
  return find(roots)?.children ?? []
}

function onTreeDragStart(ev: DragEvent, entry: LayerItemNode) {
  if (searchText.value.trim()) return
  draggedTreeId.value = entry.id
  treeDropTarget.value = ''
  if (ev.dataTransfer) {
    ev.dataTransfer.effectAllowed = 'move'
    ev.dataTransfer.setData('application/x-tree-item', entry.id)
  }
}

function onTreeDragOver(ev: DragEvent, entry: LayerItemNode) {
  if (!draggedTreeId.value || draggedTreeId.value === entry.id) return
  if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move'
  const el = ev.currentTarget as HTMLElement | null
  let pos: 'before' | 'inside' | 'after' = 'after'
  if (el) {
    const rect = el.getBoundingClientRect()
    const y = ev.clientY - rect.top
    if (!isContainer(entry)) {
      pos = y < rect.height / 2 ? 'before' : 'after'
    } else {
      pos = y < rect.height * 0.33 ? 'before' : y > rect.height * 0.67 ? 'after' : 'inside'
    }
  }
  treeDropTarget.value = entry.id
  treeDropPos.value = pos
}

function onTreeDragLeave(entry: LayerItemNode) {
  if (treeDropTarget.value === entry.id) treeDropTarget.value = ''
}

function onTreeDrop(ev: DragEvent, entry: LayerItemNode) {
  const id = draggedTreeId.value
  const pos = treeDropPos.value
  clearTreeDrag()
  if (!id || id === entry.id) return
  const e = getEngine()
  if (!e) return
  if (pos === 'inside') {
    const moved = e.moveTreeItem(id, entry.id, entry.layerId)
    if (!moved) {
      store.setStatusMessage('Cannot move there')
    } else if (entry.collapsed) {
      // Reveal the drop so the moved item does not vanish into a fold.
      e.setTreeCollapsed(entry.id, false)
      treeTick.value++
    }
    return
  }
  const siblings = siblingsOf(entry.layerId, entry.parentId)
  let k = siblings.findIndex((s) => s.id === entry.id)
  if (k < 0) return
  if (pos === 'after') k++
  // Display order is top-first; paper insertion counts bottom-first.
  const paperIndex = siblings.length - k
  if (!e.moveTreeItem(id, entry.parentId, entry.layerId, paperIndex)) {
    store.setStatusMessage('Cannot move there')
  }
}

function onTreeDragEnd() {
  clearTreeDrag()
}

function clearTreeDrag() {
  draggedTreeId.value = ''
  treeDropTarget.value = ''
  treeLayerDrop.value = ''
}

function treeRowClass(entry: LayerItemNode): Record<string, boolean> {
  const targeted = treeDropTarget.value === entry.id
  return {
    active: store.selectedItemIds.includes(entry.id),
    'is-sublayer': entry.kind === 'sublayer',
    'is-clip': entry.kind === 'clip',
    'drop-before': targeted && treeDropPos.value === 'before',
    'drop-after': targeted && treeDropPos.value === 'after',
    'drop-inside': targeted && treeDropPos.value === 'inside',
  }
}

// ===== Layer drag (existing reorder) + tree drops onto layers =====

function onDragStart(e: DragEvent, id: string) {
  if (draggedTreeId.value) return
  draggedId.value = id
  dropIndex.value = -1
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-layer', id)
  }
}

function onLayerDragOver(e: DragEvent, layer: any, displayIndex: number) {
  if (draggedTreeId.value || treeDragActive(e)) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    treeLayerDrop.value = layer.id
    return
  }
  if (!draggedId.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
  dropIndex.value = displayIndex
}

function onLayerDragLeave(e: DragEvent) {
  const to = e.relatedTarget as HTMLElement | null
  if (!to || !(to.closest && to.closest('.layer-item'))) {
    treeLayerDrop.value = ''
  }
}

function onLayerDrop(e: DragEvent, layer: any, _displayIndex: number) {
  if (draggedTreeId.value || treeDragActive(e)) {
    e.preventDefault()
    const id = draggedTreeId.value
    clearTreeDrag()
    if (!id) return
    // Dropping onto a layer appends on top of its stack (AI behavior).
    if (!getEngine()?.moveTreeItem(id, '', layer.id)) {
      store.setStatusMessage('Cannot move there')
    } else if (!layer.expand) {
      store.updateLayer(layer.id, { expand: true })
    }
    return
  }
  onDrop(e, _displayIndex)
}

function onDragOver(e: DragEvent, displayIndex: number) {
  if (draggedTreeId.value) return
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
  clearTreeDrag()
}

// ===== Panel menu + context menu (AI-style layer options) =====

interface CtxItem { label?: string; cmd?: string; disabled?: boolean; sep?: boolean }
interface CtxState { x: number; y: number; layerId: string; itemId: string }
const ctxMenu = ref<CtxState | null>(null)

function onPanelMenu(cmd: string) {
  runPanelCommand(cmd)
}

function onLayerMenu(e: MouseEvent, layer: any) {
  // Right-click activates the layer without touching the object selection,
  // so Collect/Group commands stay available from the menu.
  store.setActiveLayer(layer.id)
  const engine = getEngine()
  if (engine) {
    const pLayer = engine.project.layers.find((l) => (l.data as any)?.layerId === layer.id)
    if (pLayer) pLayer.activate()
  }
  ctxMenu.value = { x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 320), layerId: layer.id, itemId: '' }
}

function onItemMenu(e: MouseEvent, entry: LayerItemNode) {
  if (!store.selectedItemIds.includes(entry.id)) {
    getEngine()?.selectItemById(entry.id)
  }
  ctxMenu.value = { x: Math.min(e.clientX, window.innerWidth - 210), y: Math.min(e.clientY, window.innerHeight - 360), layerId: entry.layerId, itemId: entry.id }
}

function closeCtx() {
  ctxMenu.value = null
}

const ctxItems = computed<CtxItem[]>(() => {
  const ctx = ctxMenu.value
  if (!ctx) return []
  if (!ctx.itemId) {
    return [
      { label: 'New Layer', cmd: 'new-layer' },
      { label: 'New Sublayer', cmd: 'new-sublayer' },
      { sep: true },
      { label: 'Duplicate Layer', cmd: 'duplicate' },
      { label: 'Delete Layer', cmd: 'delete-layer' },
      { sep: true },
      { label: 'Collect in New Layer', cmd: 'collect', disabled: !canCollect.value },
      { sep: true },
      { label: 'Expand All', cmd: 'expand-all' },
      { label: 'Collapse All', cmd: 'collapse-all' },
    ]
  }
  return [
    { label: 'New Sublayer', cmd: 'new-sublayer' },
    { sep: true },
    { label: 'Group', cmd: 'group', disabled: !canGroup.value },
    { label: 'Ungroup', cmd: 'ungroup', disabled: !canUngroup.value },
    { sep: true },
    { label: 'Collect in New Layer', cmd: 'collect', disabled: !canCollect.value },
    { label: 'Release to Layers', cmd: 'release', disabled: !canRelease.value },
    { sep: true },
    { label: 'Rename', cmd: 'rename-item' },
    { label: 'Isolate', cmd: 'isolate-item' },
    { label: 'Delete', cmd: 'delete-item' },
    { sep: true },
    { label: 'Expand All', cmd: 'expand-all' },
    { label: 'Collapse All', cmd: 'collapse-all' },
  ]
})

function findEntry(layerId: string, itemId: string): LayerItemNode | null {
  const walk = (nodes: LayerItemNode[]): LayerItemNode | null => {
    for (const n of nodes) {
      if (n.id === itemId) return n
      const hit = walk(n.children)
      if (hit) return hit
    }
    return null
  }
  return walk(layerTree.value.get(layerId) ?? [])
}

function runPanelCommand(cmd: string) {
  const e = getEngine()
  switch (cmd) {
    case 'new-layer': addLayer(); break
    case 'new-sublayer': addSublayer(); break
    case 'duplicate': duplicateLayer(); break
    case 'delete-layer': removeLayer(); break
    case 'collect':
      if (e && !e.collectInNewLayer()) store.setStatusMessage('Nothing to collect')
      break
    case 'release':
      if (e && !e.releaseToLayers()) store.setStatusMessage('Select a group to release')
      break
    case 'group': groupSelected(); break
    case 'ungroup': ungroupSelected(); break
    case 'expand-all':
      e?.setAllTreeCollapsed(false)
      treeTick.value++
      break
    case 'collapse-all':
      e?.setAllTreeCollapsed(true)
      treeTick.value++
      break
  }
}

function onCtxAction(item: CtxItem) {
  if (item.disabled || !item.cmd) return
  const ctx = ctxMenu.value
  closeCtx()
  const e = getEngine()
  if (!e) return
  switch (item.cmd) {
    case 'rename-item':
      if (ctx && ctx.itemId) {
        const entry = findEntry(ctx.layerId, ctx.itemId)
        if (entry) startItemRename(entry)
      }
      break
    case 'isolate-item':
      if (ctx && ctx.itemId) {
        const entry = findEntry(ctx.layerId, ctx.itemId)
        if (entry) onItemDblclick(entry)
      }
      break
    case 'delete-item':
      e.deleteSelected()
      break
    default:
      runPanelCommand(item.cmd)
      break
  }
}

function onGlobalClick() {
  closeCtx()
}

function onGlobalKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    closeCtx()
    cancelItemRename()
  }
}

onMounted(() => {
  window.addEventListener('click', onGlobalClick)
  window.addEventListener('keydown', onGlobalKey)
})

onUnmounted(() => {
  window.removeEventListener('click', onGlobalClick)
  window.removeEventListener('keydown', onGlobalKey)
})

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

.ly-menu {
  color: #8a8a8a;
  cursor: pointer;
  flex-shrink: 0;
  padding: 2px;
  border-radius: 3px;
}

.ly-menu:hover {
  color: #fff;
  background: #3d3d3d;
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.action-btn.disabled {
  opacity: 0.3;
  cursor: default;
}

.action-btn.disabled:hover {
  color: #9a9a9a;
  background: transparent;
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
.layer-item.active .layer-icon,
.layer-item.active .layer-toggle::before {
  color: #fff;
  border-left-color: #fff;
}

.layer-item.drop-before {
  box-shadow: inset 0 2px 0 #4a90d9;
}

.layer-item.tree-drop {
  box-shadow: inset 0 0 0 1px #4a90d9;
  background: #2f4a6b;
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

/* Zero-width spacer: keeps the post-color columns pixel-aligned with the
   object rows below (AI keeps eye/lock/color fixed while content indents). */
.layer-indent {
  width: 0;
  flex-shrink: 0;
}

.layer-icon {
  width: 14px;
  flex-shrink: 0;
  text-align: center;
  font-size: 11px;
  color: #8a8a8a;
}

/* AI's right-end selection square: layer color while the layer holds artwork
   selection, invisible placeholder otherwise (keeps the target column aligned). */
.layer-sel {
  width: 8px;
  height: 8px;
  border-radius: 1px;
  flex-shrink: 0;
  visibility: hidden;
}

.layer-sel.on {
  visibility: visible;
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
  background: #252526;
  position: relative;
}

.tree-toggle {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  cursor: pointer;
  position: relative;
}

.tree-toggle::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 3px;
  border-left: 5px solid #888;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  transition: transform 0.12s;
}

.tree-toggle.open::before {
  transform: rotate(90deg);
}

.tree-toggle-spacer {
  width: 14px;
  flex-shrink: 0;
}

.tree-item:hover {
  background: #333333;
}

.tree-item.active {
  background: #2f6fbf;
  color: #fff;
}

.tree-item.active .tree-vis,
.tree-item.active .tree-thumb {
  color: #fff;
}

.tree-item.is-sublayer {
  background: #2b2b2b;
  color: #d5d5d5;
}

.tree-item.is-sublayer:hover {
  background: #363636;
}

.tree-item.is-sublayer.active {
  background: #2f6fbf;
  color: #fff;
}

.tree-item.is-clip .tree-thumb {
  color: #e6a23c;
}

.tree-item.drop-before {
  box-shadow: inset 0 2px 0 #4a90d9;
}

.tree-item.drop-after {
  box-shadow: inset 0 -2px 0 #4a90d9;
}

.tree-item.drop-inside {
  background: #2f4a6b;
  box-shadow: inset 0 0 0 1px #4a90d9;
}

.tree-guide {
  width: 3px;
  align-self: stretch;
  flex-shrink: 0;
  opacity: 0.9;
}

/* Depth indent AFTER the color strip: eye/lock/color stay fixed on the
   left edge for every row (AI-style), only the toggle/icon/name shift. */
.tree-indent {
  flex-shrink: 0;
}

/* AI-style preview chip: live SVG thumbnail on a transparency checker;
   falls back to a type glyph when the entry is not renderable. */
.tree-thumb {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 3px;
  font-size: 11px;
  color: #8a8a8a;
  background: repeating-conic-gradient(#c9c9c9 0% 25%, #f2f2f2 0% 50%) 0 0 / 8px 8px;
}

.tree-thumb img {
  max-width: 100%;
  max-height: 100%;
  display: block;
  pointer-events: none;
}

.tree-thumb.k-text {
  font-weight: 700;
}

.tree-thumb.k-sublayer {
  color: #9ab8dd;
}

.tree-item.active .tree-thumb.k-sublayer,
.tree-item.active .tree-thumb.k-clip {
  color: #fff;
}

.tree-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-name :deep(.el-input__wrapper) {
  background: #111;
  border: 1px solid #4a90d9;
  box-shadow: none !important;
  height: 22px;
}

.tree-name :deep(.el-input__inner) {
  color: #fff;
  font-size: 12px;
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

/* Invisible placeholder mirroring .layer-sel so object rows share the
   exact right-edge column geometry as layer rows. */
.tree-sel {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  visibility: hidden;
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
  font-weight: 600;
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

/* Floating context menu, like AI panel options */
.ly-ctx {
  position: fixed;
  z-index: 3000;
  min-width: 180px;
  background: #1e1e1e;
  border: 1px solid #3d3d3d;
  border-radius: 4px;
  padding: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
}

.ly-ctx-item {
  padding: 6px 10px;
  font-size: 12px;
  color: #d5d5d5;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
}

.ly-ctx-item:hover {
  background: #2f6fbf;
  color: #fff;
}

.ly-ctx-item.disabled {
  opacity: 0.35;
  cursor: default;
}

.ly-ctx-item.disabled:hover {
  background: transparent;
  color: #d5d5d5;
}

.ly-ctx-sep {
  height: 1px;
  background: #3d3d3d;
  margin: 4px 6px;
}
</style>
