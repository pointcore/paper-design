<template>
  <div class="pattern-section">
    <div class="prop-row">
      <el-select v-model="patternKind" size="small" class="flex-ctl" title="Pattern preset">
        <el-option v-for="p in patternPresets" :key="p.value" :label="p.label" :value="p.value" />
      </el-select>
      <el-color-picker v-model="patternColor" size="small" show-alpha title="Motif color" />
    </div>
    <div class="prop-row">
      <span class="prop-label-sm">Back</span>
      <el-color-picker v-model="patternBackground" size="small" show-alpha title="Background" :disabled="patternTransparent" />
      <el-button size="small" class="grid-btn" :type="patternTransparent ? 'primary' : ''" title="Transparent background" @click="patternTransparent = !patternTransparent">None</el-button>
    </div>
    <div class="prop-row">
      <span class="prop-label-sm">Scale</span>
      <el-input-number v-model="patternScale" :min="0.25" :max="4" :step="0.25" :precision="2" size="small" controls-position="right" />
      <span class="prop-label-sm">Angle</span>
      <el-input-number v-model="patternAngle" :min="0" :max="180" :step="15" size="small" controls-position="right" />
    </div>
    <div class="btn-grid-2">
      <el-button size="small" class="grid-btn" :disabled="!canApplyPattern" @click="onApplyPattern">Apply</el-button>
      <el-button size="small" class="grid-btn" :disabled="!isPatternSelected" @click="onRemovePattern">Remove</el-button>
    </div>
    <div v-if="patternHint" class="ai-desc">{{ patternHint }}</div>
  </div>
</template>

<script setup lang="ts">
/**
 * PatternSection (C2: second template slice out of PropertyPanel.vue).
 *
 * Procedural pattern presets rendered as clipped tiles. Same section
 * contract as GradientSection: the parent keeps the collapsible shell
 * and calls syncFromStore() on selection changes; the section syncs on
 * mount as well so it never shows stale rows.
 */
import { ref, inject, onMounted, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { PatternFillState } from '../../editor/types'
import { normalizePatternFill } from '../../editor/property-helpers'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const patternPresets: Array<{ value: PatternFillState['kind']; label: string }> = [
  { value: 'dots', label: 'Dots' },
  { value: 'stripes', label: 'Stripes' },
  { value: 'grid', label: 'Grid' },
  { value: 'crosshatch', label: 'Crosshatch' },
]

const patternKind = ref<PatternFillState['kind']>('dots')
const patternColor = ref('#000000')
const patternBackground = ref('#ffffff')
const patternTransparent = ref(false)
const patternScale = ref(1)
const patternAngle = ref(45)
const isPatternSelected = ref(false)
const canApplyPattern = ref(false)
const patternHint = ref('')

function getEngine() {
  return engineRef?.value || null
}

/** Read pattern state from the current selection into the panel. */
function syncFromStore() {
  const e = getEngine()
  isPatternSelected.value = false
  canApplyPattern.value = false
  patternHint.value = ''
  if (!e || !store.hasSelection) return
  const items = e.getSelection()
  if (items.length === 0) return
  const first = items[0] as any
  const found = e.getPatternFromItem(first)
  if (found) {
    isPatternSelected.value = true
    patternKind.value = found.kind
    patternColor.value = found.color || '#000000'
    patternTransparent.value = !found.background
    patternBackground.value = found.background || '#ffffff'
    patternScale.value = found.scale || 1
    patternAngle.value = found.angle || 0
  } else if (store.style.pattern) {
    const p = store.style.pattern
    patternKind.value = p.kind
    patternColor.value = p.color
    patternTransparent.value = !p.background
    patternBackground.value = p.background || '#ffffff'
    patternScale.value = p.scale
    patternAngle.value = p.angle
  }
  canApplyPattern.value = items.some((item: any) => {
    if (e.isPatternGroup(item)) return true
    const name = String(item?.className ?? item?.constructor?.name ?? '')
    return /path/i.test(name)
  })
  if (!canApplyPattern.value) {
    patternHint.value = 'Select a path to apply a pattern.'
  } else if (isPatternSelected.value) {
    patternHint.value = 'Pattern moves/scales with its shape. Remove before boolean ops.'
  }
}

function currentPattern(): PatternFillState {
  return normalizePatternFill({
    kind: patternKind.value,
    color: patternColor.value,
    background: patternBackground.value,
    transparent: patternTransparent.value,
    scale: patternScale.value,
    angle: patternAngle.value,
  })
}

function onApplyPattern() {
  const e = getEngine()
  if (!e) return
  const applied = e.applyPatternFill(currentPattern())
  syncFromStore()
  if (applied === 0) {
    store.setStatusMessage('Pattern needs a path selection')
  }
}

function onRemovePattern() {
  const e = getEngine()
  if (!e) return
  if (e.removePatternFill() === 0) {
    // Also covers Release Clipping Mask on a pattern group.
    if (!e.releaseClippingMask()) {
      store.setStatusMessage('Select a pattern to remove')
    }
  }
  syncFromStore()
}

onMounted(() => {
  syncFromStore()
})

defineExpose({ syncFromStore })
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

.flex-ctl {
  flex: 1;
  min-width: 0;
  width: 100%;
}

.btn-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  margin-top: 4px;
}

.grid-btn {
  width: 100%;
  margin: 0 !important;
}

.ai-desc {
  padding: 10px;
  color: #8a8a8a;
  font-size: 11px;
  line-height: 1.6;
  border-bottom: 1px solid #1b1b1b;
}
</style>
