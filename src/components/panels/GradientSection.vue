<template>
  <div class="gradient-section">
    <div class="prop-row">
      <el-radio-group v-model="gradientType" size="small" class="seg-full" @change="onGradientChange">
        <el-radio-button value="linear">Linear</el-radio-button>
        <el-radio-button value="radial">Radial</el-radio-button>
      </el-radio-group>
    </div>
    <div v-if="gradientType === 'linear'" class="prop-row">
      <span class="prop-label-sm">Angle</span>
      <el-input-number v-model="gradientAngle" :min="0" :max="360" size="small" controls-position="right" @change="onGradientChange" />
      <el-button size="small" class="icon-btn" title="Reverse gradient direction" @click="onGradientReverse">⇄</el-button>
      <span class="unit">deg</span>
    </div>
    <div class="prop-row" v-for="(stop, index) in gradientStops" :key="index">
      <el-color-picker v-model="stop.color" size="small" show-alpha @change="onGradientChange" />
      <el-input-number v-model="stop.offset" :min="0" :max="100" size="small" controls-position="right" @change="onGradientChange" />
      <el-button size="small" class="icon-btn" type="danger" plain :disabled="gradientStops.length <= 2" @click="removeGradientStop(index)">×</el-button>
    </div>
    <div class="prop-row">
      <el-button size="small" plain class="wide-btn" @click="addGradientStop">Add Stop</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * GradientSection (C2: first template slice out of PropertyPanel.vue).
 *
 * The gradient stop editor: owns its editable rows and paints the
 * selection through the store + engine like the panel did. The parent
 * keeps the fill-kind switch and calls syncFromStore() on selection
 * changes (plus activate() on the solid→gradient switch); the section
 * also syncs on mount so it never shows stale rows.
 */
import { ref, inject, onMounted, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import { normalizeGradient } from '../../editor/property-helpers'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const gradientType = ref<'linear' | 'radial'>('linear')
const gradientAngle = ref(0)
// Editable gradient stops (offsets in percent for the inputs).
const gradientStops = ref<Array<{ offset: number; color: string }>>([])

function getEngine() {
  return engineRef?.value || null
}

/** Mirror the store gradient into the editable stop list. */
function syncFromStore() {
  const gradient = store.style.gradient
  gradientType.value = gradient?.type ?? 'linear'
  gradientAngle.value = Math.round(gradient?.angle ?? 0)
  gradientStops.value = gradient
    ? gradient.stops.map((stop) => ({ offset: Math.round(stop.offset * 100), color: stop.color }))
    : []
}

/** Build normalized gradient parameters from the editable stop list. */
function currentGradient() {
  return normalizeGradient(gradientStops.value, gradientType.value, gradientAngle.value)
}

/** Write the edited gradient to the store and repaint the selection. */
function applyGradient(label: string) {
  const e = getEngine()
  if (!e) return
  const gradient = currentGradient()
  if (gradient.stops.length === 0) return
  store.updateStyle({ gradient })
  syncFromStore()
  e.getSelection().forEach((item: any) => {
    e.applyStyleToItem(item, e.store.style)
  })
  e.scope.view.update()
  e.pushCoalescedHistory(label)
}

/**
 * Switch-to-gradient entry: seed a default when the store has none, then
 * sync and paint like any other edit (single history entry).
 */
function activate() {
  if (!store.style.gradient) {
    const from = store.style.fillColor || '#000000'
    store.updateStyle({
      gradient: { type: 'linear', stops: [{ offset: 0, color: from }, { offset: 1, color: '#ffffff' }] },
    })
  }
  syncFromStore()
  applyGradient('Change Gradient')
}

function onGradientChange() {
  applyGradient('Change Gradient')
}

function onGradientReverse() {
  gradientAngle.value = (Math.round(Number(gradientAngle.value) || 0) + 180) % 360
  applyGradient('Reverse Gradient')
}

function addGradientStop() {
  gradientStops.value.push({ offset: 50, color: '#808080' })
  applyGradient('Change Gradient')
}

function removeGradientStop(index: number) {
  if (gradientStops.value.length <= 2) return
  gradientStops.value.splice(index, 1)
  applyGradient('Change Gradient')
}

onMounted(() => {
  syncFromStore()
})

defineExpose({ syncFromStore, activate })
</script>

<style scoped>
/* Row primitives shared with the panel (duplicated: scoped CSS does not
   cross the component boundary). */
.prop-label-sm {
  font-size: 11px;
  color: #9a9a9a;
  width: 40px;
  flex-shrink: 0;
  line-height: 22px;
}

.unit {
  font-size: 11px;
  color: #8a8a8a;
  flex-shrink: 0;
}

.prop-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 5px;
  min-width: 0;
}

.prop-row > :not(.prop-label-sm):not(.fmt-btn):not(.icon-btn):not(.app-name):not(.unit) {
  min-width: 0;
}

.prop-row .el-button + .el-button {
  margin-left: 0;
}

.icon-btn {
  width: 24px;
  flex-shrink: 0;
  padding: 0 !important;
  margin: 0 !important;
}

.wide-btn {
  width: 100%;
  margin: 0 !important;
}

/* Full-width segmented control */
:deep(.el-radio-group.seg-full) {
  display: flex;
  width: 100%;
}

:deep(.el-radio-group.seg-full .el-radio-button) {
  flex: 1;
  min-width: 0;
}
</style>
