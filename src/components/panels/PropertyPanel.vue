<template>
  <div class="property-panel">
    <div class="panel-header">
      <span>Properties</span>
    </div>

    <div class="panel-body">
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

function getEngine() { return engineRef?.value || null }

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
})
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
