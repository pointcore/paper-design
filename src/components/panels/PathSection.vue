<template>
  <div class="path-section">
    <div class="btn-grid-2">
      <el-button size="small" class="grid-btn" :disabled="booleanOperandCount() < 2" @click="onBoolean('unite')">Unite</el-button>
      <el-button size="small" class="grid-btn" :disabled="booleanOperandCount() < 2" @click="onBoolean('subtract')">Subtract</el-button>
      <el-button size="small" class="grid-btn" :disabled="booleanOperandCount() < 2" @click="onBoolean('intersect')">Intersect</el-button>
      <el-button size="small" class="grid-btn" :disabled="booleanOperandCount() < 2" @click="onBoolean('exclude')">Exclude</el-button>
    </div>
    <div class="prop-row">
      <span class="prop-label-sm">Offset</span>
      <el-input-number v-model="offsetDist" size="small" controls-position="right" title="Positive expands, negative insets" />
      <el-select v-model="offsetJoin" size="small" class="flex-ctl" title="Join">
        <el-option value="miter" label="Miter" />
        <el-option value="round" label="Round" />
        <el-option value="bevel" label="Bevel" />
      </el-select>
      <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onOffset">Apply</el-button>
    </div>
    <div class="btn-grid-2">
      <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" title="Add a midpoint anchor to every curve" @click="onAddAnchors">Add Anchors</el-button>
      <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" title="Reverse path direction" @click="onReverse">Reverse</el-button>
    </div>
    <div class="prop-row">
      <el-button size="small" plain class="wide-btn" title="Split paths at sub-selected anchors (Direct Select)" @click="onSplitAnchors">Split at Anchors</el-button>
    </div>
    <div class="prop-row">
      <span class="prop-label-sm">Fillet</span>
      <el-input-number v-model="filletRadius" :min="0.5" :max="500" size="small" controls-position="right" title="Round sharp corners" />
      <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onFillet">Apply</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * PathSection (C2: panel slice out of PropertyPanel.vue).
 *
 * Boolean ops, offset, anchor utilities and fillets. Stateless beyond
 * three option rows: every action reads the live selection through the
 * engine, so no parent sync is needed.
 */
import { ref, inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { BooleanOperation } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const offsetDist = ref(10)
const offsetJoin = ref<'miter' | 'round' | 'bevel'>('miter')
const filletRadius = ref(8)

function getEngine() { return engineRef?.value || null }

/** Number of selected unlocked paths usable as boolean operands. */
function booleanOperandCount(): number {
  const e = getEngine()
  if (!e) return 0
  return e.getSelection().filter(
    (item) =>
      !item.locked &&
      (item instanceof e.scope.Path || item instanceof e.scope.CompoundPath)
  ).length
}

function onBoolean(op: BooleanOperation) {
  const e = getEngine()
  if (!e) return
  if (!e.booleanOperation(op)) {
    store.setStatusMessage('Boolean needs at least two unlocked paths')
  }
}

function onOffset() {
  const e = getEngine()
  if (!e) return
  const d = Number(offsetDist.value)
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) {
    store.setStatusMessage('Offset needs a non-zero distance')
    return
  }
  if (e.offsetPaths(d, offsetJoin.value) === 0) {
    store.setStatusMessage('Offset needs a path selection')
  }
}

function onAddAnchors() {
  const e = getEngine()
  if (!e) return
  if (e.addAnchorPoints() === 0) {
    store.setStatusMessage('Add Anchors needs a path selection')
  }
}

function onReverse() {
  const e = getEngine()
  if (!e) return
  if (e.reversePaths() === 0) {
    store.setStatusMessage('Reverse needs a path selection')
  }
}

function onSplitAnchors() {
  const e = getEngine()
  if (!e) return
  const sc = e.getController('direct-select') as {
    splitAtSelectedAnchors?: () => boolean | null
  } | null
  const sub = sc?.splitAtSelectedAnchors?.() ?? null
  if (sub === true) return
  store.setStatusMessage('Split needs sub-selected anchors (Direct Select)')
}

function onFillet() {
  const e = getEngine()
  if (!e) return
  const sc = e.getController('direct-select') as {
    roundSelectedCorners?: (radius: number) => number
  } | null
  const n = sc?.roundSelectedCorners?.(Number(filletRadius.value) || 0) ?? 0
  if (n === 0) {
    store.setStatusMessage('Fillet needs sharp corners selected')
  }
}
</script>

<style scoped>
/* Row/button primitives shared with the panel (duplicated: scoped CSS does
   not cross the component boundary). */
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
</style>
