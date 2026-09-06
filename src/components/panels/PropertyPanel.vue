<template>
  <div class="property-panel">
    <div class="panel-header">
      <span>Properties</span>
    </div>

    <div class="panel-body">
      <div v-if="isTextSelected" class="prop-section">
        <div class="prop-label">Text</div>
        <div class="prop-row">
          <el-select v-model="fontFamily" size="small" style="flex: 1" @change="onFontFamilyChange">
            <el-option v-for="f in fontFamilies" :key="f" :label="f" :value="f" />
          </el-select>
        </div>
        <div class="prop-row">
          <span class="prop-label-sm">Size</span>
          <el-input-number v-model="fontSize" :min="1" :max="400" size="small" @change="onFontSizeChange" />
          <el-button size="small" :type="isBold ? 'primary' : ''" @click="toggleBold">B</el-button>
          <el-button size="small" :type="isItalic ? 'primary' : ''" @click="toggleItalic">I</el-button>
        </div>
        <div class="prop-row">
          <span class="prop-label-sm">Align</span>
          <el-radio-group v-model="textAlign" size="small" @change="onAlignChange">
            <el-radio-button value="left">Left</el-radio-button>
            <el-radio-button value="center">Center</el-radio-button>
            <el-radio-button value="right">Right</el-radio-button>
          </el-radio-group>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-label">Fill</div>
        <div class="color-row">
          <el-color-picker v-model="fillColorValue" size="small" @change="onFillChange" />
          <el-button size="small" type="danger" plain @click="onClearFill">×</el-button>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-label">Stroke</div>
        <div class="color-row">
          <el-color-picker v-model="strokeColorValue" size="small" @change="onStrokeChange" />
          <el-button size="small" type="danger" plain @click="onClearStroke">×</el-button>
        </div>
        <div class="prop-row">
          <span class="prop-label-sm">Weight</span>
          <el-input-number v-model="strokeWidth" :min="0.1" :max="100" size="small" @change="onStyleChange" />
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-label">Opacity</div>
        <el-slider v-model="opacityValue" :min="0" :max="100" size="small" @change="onOpacityChange" />
      </div>

      <div class="prop-section">
        <div class="prop-label">Transform</div>
        <div class="prop-grid">
          <span class="prop-label-sm">X</span>
          <el-input-number v-model="posX" :precision="1" size="small" @change="onTransformChange" />
          <span class="prop-label-sm">Y</span>
          <el-input-number v-model="posY" :precision="1" size="small" @change="onTransformChange" />
          <span class="prop-label-sm">W</span>
          <el-input-number v-model="posW" :precision="1" size="small" @change="onTransformChange" />
          <span class="prop-label-sm">H</span>
          <el-input-number v-model="posH" :precision="1" size="small" @change="onTransformChange" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { TextAlign } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const fillColorValue = ref(store.style.fillColor || '#000000')
const strokeColorValue = ref(store.style.strokeColor || '#000000')
const strokeWidth = ref(store.style.strokeWidth)
const opacityValue = ref(Math.round(store.style.opacity * 100))

const posX = ref(0)
const posY = ref(0)
const posW = ref(0)
const posH = ref(0)

// ---- Text properties ----

const fontFamilies = [
  'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia',
  'Times New Roman', 'Courier New', 'Impact', 'sans-serif', 'serif', 'monospace',
]

const isTextSelected = ref(false)
const fontFamily = ref('Arial')
const fontSize = ref(12)
const isBold = ref(false)
const isItalic = ref(false)
const textAlign = ref<TextAlign>('left')

function getEngine() { return engineRef?.value || null }

/** First selected point text (annotation labels excluded), if any. */
function getSelectedText(): paper.PointText | null {
  const e = getEngine()
  if (!e) return null
  for (const item of e.getSelection()) {
    if (item instanceof e.scope.PointText && !(item as any).data?.annotation) {
      return item as paper.PointText
    }
  }
  return null
}

/** Read text styling from the first selected point text into the panel. */
function syncTextFromSelection() {
  const item = getSelectedText()
  isTextSelected.value = !!item
  if (!item) return
  fontFamily.value = (item.fontFamily as string) || 'Arial'
  fontSize.value = Number(item.fontSize) || 12
  isBold.value = String(item.fontWeight) === 'bold' || Number(item.fontWeight) >= 600
  isItalic.value = ((item as any).fontStyle as string) === 'italic'
  const j = (item as any).justification as string
  textAlign.value = j === 'center' || j === 'right' ? j : 'left'
}

/** Apply a style change to every selected point text and record history. */
function applyTextStyle(apply: (item: paper.PointText) => void, label: string) {
  const e = getEngine()
  if (!e) return
  e.getSelection().forEach((item) => {
    if (item instanceof e.scope.PointText) apply(item as paper.PointText)
  })
  e.scope.view.update()
  e.pushHistory(label)
}

function onFontFamilyChange(val: string) {
  store.updateCharStyle({ fontFamily: val })
  applyTextStyle((item) => { item.fontFamily = val }, 'Change Font')
}

function onFontSizeChange(val: number | undefined) {
  if (!val) return
  store.updateCharStyle({ fontSize: val, leading: val * 1.2 })
  applyTextStyle((item) => {
    item.fontSize = val
    item.leading = val * 1.2
  }, 'Change Font Size')
}

function toggleBold() {
  const next = !isBold.value
  isBold.value = next
  store.updateCharStyle({ fontWeight: next ? 'bold' : 'normal' })
  applyTextStyle((item) => { item.fontWeight = next ? 'bold' : 'normal' }, 'Change Font Weight')
}

function toggleItalic() {
  const next = !isItalic.value
  isItalic.value = next
  store.updateCharStyle({ fontStyle: next ? 'italic' : 'normal' })
  applyTextStyle((item) => { (item as any).fontStyle = next ? 'italic' : 'normal' }, 'Change Font Style')
}

function onAlignChange(val: TextAlign) {
  const justification = val === 'center' ? 'center' : val === 'right' ? 'right' : 'left'
  store.updateParagraphStyle({ align: val })
  applyTextStyle((item) => { (item as any).justification = justification }, 'Change Text Alignment')
}

function onFillChange(val: string) {
  const e = getEngine()
  if (!e) return
  store.updateStyle({ fillColor: val || null })
  e.getSelection().forEach((item: any) => {
    if (item.fillColor !== undefined) {
      item.fillColor = val || null
    }
  })
  e.scope.view.update()
  e.pushHistory('Change Fill')
}

function onClearFill() {
  const e = getEngine()
  if (!e) return
  store.updateStyle({ fillColor: null })
  e.getSelection().forEach((item: any) => {
    item.fillColor = null
  })
  fillColorValue.value = ''
  e.scope.view.update()
  e.pushHistory('Clear Fill')
}

function onStrokeChange(val: string) {
  const e = getEngine()
  if (!e) return
  store.updateStyle({ strokeColor: val || null })
  e.getSelection().forEach((item: any) => {
    if (item.strokeColor !== undefined) {
      item.strokeColor = val || null
    }
  })
  e.scope.view.update()
  e.pushHistory('Change Stroke')
}

function onClearStroke() {
  const e = getEngine()
  if (!e) return
  store.updateStyle({ strokeColor: null })
  e.getSelection().forEach((item: any) => {
    item.strokeColor = null
  })
  strokeColorValue.value = ''
  e.scope.view.update()
  e.pushHistory('Clear Stroke')
}

function onStyleChange() {
  const e = getEngine()
  if (!e) return
  store.updateStyle({
    strokeWidth: strokeWidth.value,
  })
  e.getSelection().forEach((item: any) => {
    if (item.strokeWidth !== undefined) item.strokeWidth = strokeWidth.value
  })
  e.scope.view.update()
  e.pushHistory('Change Stroke Style')
}

function onOpacityChange(val: number) {
  const e = getEngine()
  if (!e) return
  const opacity = val / 100
  store.updateStyle({ opacity })
  e.getSelection().forEach((item: any) => {
    item.opacity = opacity
  })
  e.scope.view.update()
}

function onTransformChange() {
  const e = getEngine()
  if (!e) return
  const items = e.getSelection()
  items.forEach((item: any) => {
    const b = item.bounds
    const scaleX = b.width !== 0 ? posW.value / b.width : 1
    const scaleY = b.height !== 0 ? posH.value / b.height : 1
    item.position = new e!.scope.Point(
      posX.value + posW.value / 2,
      posY.value + posH.value / 2
    )
    item.scale(scaleX, scaleY)
  })
  e.scope.view.update()
  e.pushHistory('Transform')
}

// `immediate` covers the panel mounting after a selection already exists
// (the panel is v-if'd on hasSelection, so its first selection change is
// missed without it).
watch(() => store.selectedItemIds, () => {
  const e = getEngine()
  if (!e || !store.hasSelection) return
  const items = e.getSelection()
  if (items.length === 0) return
  const item = items[0] as any
  const b = item.bounds
  posX.value = Math.round(b.x * 10) / 10
  posY.value = Math.round(b.y * 10) / 10
  posW.value = Math.round(b.width * 10) / 10
  posH.value = Math.round(b.height * 10) / 10
  syncTextFromSelection()
}, { immediate: true })
</script>

<style scoped>
.property-panel {
  flex-shrink: 0;
  border-bottom: 1px solid #3a3a3a;
  max-height: 50%;
  overflow-y: auto;
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

.panel-body {
  padding: 8px 10px;
  color: #ccc;
  font-size: 13px;
}

.prop-section {
  margin-bottom: 10px;
  padding-bottom: 8px;
  border-bottom: 1px solid #333;
}

.prop-section:last-child {
  border-bottom: none;
}

.prop-label {
  font-size: 12px;
  color: #aaa;
  margin-bottom: 4px;
  font-weight: 500;
}

.prop-label-sm {
  font-size: 12px;
  color: #888;
  width: 24px;
  flex-shrink: 0;
}

.color-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.prop-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.prop-grid {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 4px;
  align-items: center;
}
</style>
