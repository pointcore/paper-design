<template>
  <div class="appearance-panel ai-panel">
    <div class="panel-section">
      <div class="sec-title">Appearance</div>
      <div v-if="!selectedItem" class="hint">Select an object to edit its appearance</div>
      <template v-else>
        <!-- Item opacity/blend -->
        <div class="row">
          <label class="field-label">Opacity</label>
          <el-slider v-model="itemOpacity" :min="0" :max="100" :step="1" size="small" style="flex:1" @change="onItemOpacityChange" />
          <span class="field-value">{{ itemOpacity }}%</span>
        </div>
        <div class="row">
          <label class="field-label">Blend</label>
          <el-select v-model="itemBlendMode" size="small" style="width: 120px" @change="onItemBlendChange">
            <el-option v-for="m in blendModes" :key="m" :value="m" :label="m" />
          </el-select>
        </div>

        <!-- Fills -->
        <div class="layer-header">
          <span>Fills</span>
          <el-icon size="14" class="add-btn" title="Add Fill" @click="addFill"><Plus /></el-icon>
        </div>
        <div class="layer-list">
          <div v-for="(fill, i) in fills" :key="fill.id" class="layer-row"
               :class="{ active: editingFillId === fill.id }" @click="selectFill(fill.id)">
            <el-icon size="12" class="visibility-icon" @click.stop="toggleFillVisible(fill)" :class="{ hidden: !fill.visible }">
              <View v-if="fill.visible" /><Hide v-else />
            </el-icon>
            <div class="color-swatch" :style="{ background: fillPreview(fill) }" @click.stop="openFillPicker(fill)" />
            <span class="layer-name">{{ fillLabel(fill, i) }}</span>
            <el-icon size="12" class="delete-icon" @click.stop="removeFill(fill.id)"><Delete /></el-icon>
          </div>
        </div>

        <!-- Strokes -->
        <div class="layer-header">
          <span>Strokes</span>
          <el-icon size="14" class="add-btn" title="Add Stroke" @click="addStroke"><Plus /></el-icon>
        </div>
        <div class="layer-list">
          <div v-for="(stroke, i) in strokes" :key="stroke.id" class="layer-row"
               :class="{ active: editingStrokeId === stroke.id }" @click="selectStroke(stroke.id)">
            <el-icon size="12" class="visibility-icon" @click.stop="toggleStrokeVisible(stroke)" :class="{ hidden: !stroke.visible }">
              <View v-if="stroke.visible" /><Hide v-else />
            </el-icon>
            <div class="color-swatch" :style="{ background: stroke.color || 'transparent', border: '1px solid #666' }" @click.stop="openStrokePicker(stroke)" />
            <span class="layer-name">{{ strokeLabel(stroke, i) }}</span>
            <el-icon size="12" class="delete-icon" @click.stop="removeStroke(stroke.id)"><Delete /></el-icon>
          </div>
        </div>

        <!-- Opacity Mask -->
        <div class="layer-header">
          <span>Opacity Mask</span>
          <el-icon v-if="!hasOpacityMask" size="14" class="add-btn" title="Create Opacity Mask" @click="createOpacityMask"><Plus /></el-icon>
          <el-icon v-else size="14" class="add-btn" title="Remove Opacity Mask" @click="removeOpacityMask"><Delete /></el-icon>
        </div>
        <div v-if="hasOpacityMask" class="mask-controls">
          <div class="row">
            <el-checkbox v-model="maskEnabled" size="small" @change="onMaskEnabledChange">Enabled</el-checkbox>
          </div>
          <div class="row">
            <el-checkbox v-model="maskInvert" size="small" @change="onMaskInvertChange">Invert</el-checkbox>
          </div>
          <div class="hint">Mask uses luminance to control alpha</div>
        </div>
        <div v-else class="hint">No opacity mask applied</div>

        <!-- Mesh Gradient -->
        <div class="layer-header">
          <span>Mesh Gradient</span>
          <el-icon v-if="!hasMeshGradient" size="14" class="add-btn" title="Apply Mesh Gradient" @click="applyMeshGradient"><Plus /></el-icon>
          <el-icon v-else size="14" class="add-btn" title="Remove Mesh Gradient" @click="removeMeshGradient"><Delete /></el-icon>
        </div>
        <div v-if="hasMeshGradient" class="mask-controls">
          <div class="row">
            <label class="field-label">Grid</label>
            <span class="field-value">{{ meshCols }}×{{ meshRows }}</span>
          </div>
          <!-- Vertex color grid -->
          <div class="mesh-vertex-grid" :style="{ gridTemplateColumns: `repeat(${meshCols}, 1fr)` }">
            <div v-for="(v, i) in meshVertices" :key="i" class="mesh-vertex-cell"
                 :class="{ active: selectedVertexIdx === i }" @click="selectVertex(i)">
              <div class="mesh-vertex-swatch" :style="{ background: v.color }" />
              <span class="mesh-vertex-label">{{ i }}</span>
            </div>
          </div>
          <div class="row" v-if="selectedVertexIdx >= 0">
            <label class="field-label">Color</label>
            <input type="color" :value="meshVertices[selectedVertexIdx]?.color ?? '#000000'"
                   class="mesh-color-input" @input="onVertexColorChange" />
            <span class="field-value">{{ meshVertices[selectedVertexIdx]?.color }}</span>
          </div>
          <div class="hint">Click a vertex to edit its color</div>
        </div>
        <div v-else class="hint">No mesh gradient applied</div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, inject, type Ref } from 'vue'
import { Plus, Delete, View, Hide } from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { AppearanceFill, AppearanceStroke } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const selectedItem = computed(() => {
  const ids = store.selectedItemIds
  if (ids.length !== 1) return null
  const e = engineRef?.value
  if (!e) return null
  return e.getItemById(ids[0])
})

const appearance = ref<ReturnType<EditorEngine['createDefaultAppearance']> | null>(null)
const editingFillId = ref<string | null>(null)
const editingStrokeId = ref<string | null>(null)

const fills = computed(() => appearance.value?.fills ?? [])
const strokes = computed(() => appearance.value?.strokes ?? [])
const itemOpacity = ref(100)
const itemBlendMode = ref('source-over')

const blendModes = [
  'source-over', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference',
  'exclusion', 'hue', 'saturation', 'color', 'luminosity',
]

// Opacity mask state
const hasOpacityMask = ref(false)
const maskEnabled = ref(true)
const maskInvert = ref(false)

// Mesh gradient state
const hasMeshGradient = ref(false)
const meshCols = ref(2)
const meshRows = ref(2)
const meshVertices = ref<Array<{ x: number; y: number; color: string; opacity?: number }>>([])
const selectedVertexIdx = ref(-1)

function syncFromItem() {
  const item = selectedItem.value
  if (!item || !engineRef?.value) {
    appearance.value = null
    hasOpacityMask.value = false
    hasMeshGradient.value = false
    return
  }
  appearance.value = engineRef.value.getAppearanceFromItem(item)
  itemOpacity.value = Math.round((appearance.value.opacity ?? 1) * 100)
  itemBlendMode.value = appearance.value.blendMode ?? 'source-over'
  if (appearance.value.fills.length > 0 && !editingFillId.value) {
    editingFillId.value = appearance.value.fills[0].id
  }
  if (appearance.value.strokes.length > 0 && !editingStrokeId.value) {
    editingStrokeId.value = appearance.value.strokes[0].id
  }
  // Sync opacity mask state
  const mask = engineRef.value.getOpacityMask(item)
  hasOpacityMask.value = !!mask
  maskEnabled.value = mask?.enabled ?? true
  maskInvert.value = mask?.invert ?? false
  // Sync mesh gradient state
  const mesh = engineRef.value.getMeshGradient(item)
  hasMeshGradient.value = !!mesh
  meshCols.value = mesh?.cols ?? 2
  meshRows.value = mesh?.rows ?? 2
  meshVertices.value = mesh?.vertices ?? []
  selectedVertexIdx.value = -1
}

watch(() => store.selectedItemIds, syncFromItem, { immediate: true })

function commit() {
  const item = selectedItem.value
  if (!item || !appearance.value || !engineRef?.value) return
  engineRef.value.setAppearanceOnItem(item, appearance.value)
  engineRef.value.pushHistory('Change Appearance')
}

function addFill() {
  const item = selectedItem.value
  if (!item || !engineRef?.value) return
  const fill = engineRef.value.addAppearanceFill(item)
  editingFillId.value = fill.id
  syncFromItem()
  commit()
}

function addStroke() {
  const item = selectedItem.value
  if (!item || !engineRef?.value) return
  const stroke = engineRef.value.addAppearanceStroke(item)
  editingStrokeId.value = stroke.id
  syncFromItem()
  commit()
}

function removeFill(id: string) {
  const item = selectedItem.value
  if (!item || !engineRef?.value || !appearance.value) return
  engineRef.value.removeAppearanceFill(item, id)
  syncFromItem()
  commit()
}

function removeStroke(id: string) {
  const item = selectedItem.value
  if (!item || !engineRef?.value || !appearance.value) return
  engineRef.value.removeAppearanceStroke(item, id)
  syncFromItem()
  commit()
}

function selectFill(id: string) { editingFillId.value = id }
function selectStroke(id: string) { editingStrokeId.value = id }

function toggleFillVisible(fill: AppearanceFill) {
  fill.visible = !fill.visible
  commit()
}

function toggleStrokeVisible(stroke: AppearanceStroke) {
  stroke.visible = !stroke.visible
  commit()
}

function fillPreview(fill: AppearanceFill): string {
  if (fill.gradient) {
    const stops = fill.gradient.stops.map((s) => `${s.color} ${s.offset * 100}%`).join(', ')
    return fill.gradient.type === 'radial'
      ? `radial-gradient(circle, ${stops})`
      : `linear-gradient(${fill.gradient.angle ?? 0}deg, ${stops})`
  }
  return fill.color || 'transparent'
}

function fillLabel(fill: AppearanceFill, index: number): string {
  if (fill.gradient) return `Fill ${index + 1} (Gradient)`
  return fill.color ? `Fill ${index + 1}` : `Fill ${index + 1} (None)`
}

function strokeLabel(stroke: AppearanceStroke, index: number): string {
  const w = stroke.strokeWidth
  return stroke.color ? `Stroke ${index + 1} (${w}pt)` : `Stroke ${index + 1} (None)`
}

function openFillPicker(fill: AppearanceFill) {
  editingFillId.value = fill.id
}

function openStrokePicker(stroke: AppearanceStroke) {
  editingStrokeId.value = stroke.id
}

function onItemOpacityChange(val: number) {
  if (!appearance.value) return
  appearance.value.opacity = val / 100
  commit()
}

function onItemBlendChange(val: string) {
  if (!appearance.value) return
  appearance.value.blendMode = val
  commit()
}

// Opacity mask functions
function createOpacityMask() {
  const item = selectedItem.value
  if (!item || !engineRef?.value) return
  const scope = engineRef.value.scope
  const bounds = item.bounds
  if (!bounds) return
  const maskRect = new scope.Path.Rectangle({
    rectangle: bounds,
    fillColor: new scope.Color(1),
    insert: false,
  })
  maskRect.data = { id: engineRef.value.genId(), isUserItem: true, isOpacityMask: true }
  engineRef.value.applyOpacityMask(item, maskRect)
  engineRef.value.pushHistory('Apply Opacity Mask')
  syncFromItem()
}

function removeOpacityMask() {
  const item = selectedItem.value
  if (!item || !engineRef?.value) return
  engineRef.value.removeOpacityMask(item)
  engineRef.value.pushHistory('Remove Opacity Mask')
  syncFromItem()
}

function onMaskEnabledChange(val: boolean) {
  const item = selectedItem.value
  if (!item || !engineRef?.value) return
  engineRef.value.toggleOpacityMask(item, val)
  engineRef.value.pushHistory('Toggle Opacity Mask')
}

function onMaskInvertChange(val: boolean) {
  const item = selectedItem.value
  if (!item || !engineRef?.value) return
  engineRef.value.toggleOpacityMaskInvert(item, val)
  engineRef.value.pushHistory('Invert Opacity Mask')
}

// Mesh gradient functions
function applyMeshGradient() {
  const item = selectedItem.value
  if (!item || !engineRef?.value) return
  const mesh = engineRef.value.createDefaultMeshGradient(item)
  engineRef.value.applyMeshGradient(item, mesh)
  engineRef.value.pushHistory('Apply Mesh Gradient')
  syncFromItem()
}

function removeMeshGradient() {
  const item = selectedItem.value
  if (!item || !engineRef?.value) return
  engineRef.value.removeMeshGradient(item)
  engineRef.value.pushHistory('Remove Mesh Gradient')
  syncFromItem()
}

function selectVertex(idx: number) {
  selectedVertexIdx.value = idx
}

function onVertexColorChange(e: Event) {
  const item = selectedItem.value
  if (!item || !engineRef?.value || selectedVertexIdx.value < 0) return
  const color = (e.target as HTMLInputElement).value
  const mesh = engineRef.value.getMeshGradient(item)
  if (!mesh) return
  mesh.vertices[selectedVertexIdx.value].color = color
  engineRef.value.applyMeshGradient(item, mesh)
  meshVertices.value = [...mesh.vertices]
  engineRef.value.pushHistory('Change Mesh Vertex Color')
}
</script>

<style scoped>
.appearance-panel {
  background: #252526;
  color: #c9c9c9;
  font-size: 12px;
}
.panel-section {
  padding: 8px;
}
.sec-title {
  font-size: 11px;
  color: #dcdcdc;
  font-weight: 600;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}
.hint {
  color: #8a8a8a;
  font-size: 11px;
}
.row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.field-label {
  width: 50px;
  font-size: 11px;
  color: #8a8a8a;
  flex-shrink: 0;
}
.field-value {
  width: 35px;
  text-align: right;
  font-size: 11px;
  color: #8a8a8a;
}
.layer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 10px;
  margin-bottom: 4px;
  font-size: 11px;
  color: #dcdcdc;
  font-weight: 600;
}
.add-btn {
  cursor: pointer;
  color: #8a8a8a;
}
.add-btn:hover {
  color: #fff;
}
.layer-list {
  border: 1px solid #333;
  border-radius: 3px;
  overflow: hidden;
}
.layer-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-bottom: 1px solid #333;
  cursor: pointer;
}
.layer-row:last-child {
  border-bottom: none;
}
.layer-row:hover {
  background: #2a2a2a;
}
.layer-row.active {
  background: #2f6fbf;
  color: #fff;
}
.visibility-icon {
  cursor: pointer;
  color: #8a8a8a;
  flex-shrink: 0;
}
.visibility-icon.hidden {
  opacity: 0.3;
}
.visibility-icon:hover {
  color: #fff;
}
.color-swatch {
  width: 16px;
  height: 16px;
  border-radius: 2px;
  flex-shrink: 0;
  cursor: pointer;
}
.layer-name {
  flex: 1;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.delete-icon {
  cursor: pointer;
  color: #8a8a8a;
  opacity: 0;
}
.layer-row:hover .delete-icon {
  opacity: 1;
}
.delete-icon:hover {
  color: #e5484d;
}
.mask-controls {
  padding: 6px;
  border: 1px solid #333;
  border-radius: 3px;
  margin-top: 4px;
}
.mesh-vertex-grid {
  display: grid;
  gap: 4px;
  margin: 6px 0;
}
.mesh-vertex-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 3px;
  border: 1px solid #333;
  border-radius: 3px;
  cursor: pointer;
}
.mesh-vertex-cell:hover {
  border-color: #666;
}
.mesh-vertex-cell.active {
  border-color: #2f6fbf;
  background: rgba(47, 111, 191, 0.2);
}
.mesh-vertex-swatch {
  width: 100%;
  height: 16px;
  border-radius: 2px;
  border: 1px solid #555;
}
.mesh-vertex-label {
  font-size: 9px;
  color: #8a8a8a;
}
.mesh-color-input {
  width: 24px;
  height: 20px;
  padding: 0;
  border: 1px solid #555;
  border-radius: 2px;
  cursor: pointer;
  background: transparent;
}
</style>
