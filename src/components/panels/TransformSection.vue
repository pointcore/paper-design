<template>
  <div class="transform-section">
    <div class="tf-grid">
      <div class="ref-grid tf-ref">
        <div
          v-for="rp in refPoints"
          :key="rp"
          class="ref-cell"
          :class="{ active: store.referencePoint === rp }"
          @click="onReferencePointChange(rp)"
        />
      </div>
      <div class="tf-cell">
        <span>X</span>
        <el-input-number v-model="posX" :precision="1" size="small" controls-position="right" @change="onTransformChange" />
      </div>
      <div class="tf-cell">
        <span>W</span>
        <el-input-number v-model="posW" :precision="1" :min="0.1" size="small" controls-position="right" @change="onTransformChange" />
        <el-button size="small" class="icon-btn wh-link" :type="whLink ? 'primary' : ''" :title="whLink ? 'Aspect ratio locked' : 'Lock aspect ratio'" @click="whLink = !whLink">&#9935;</el-button>
      </div>
      <div class="tf-cell">
        <span>Y</span>
        <el-input-number v-model="posY" :precision="1" size="small" controls-position="right" @change="onTransformChange" />
      </div>
      <div class="tf-cell">
        <span>H</span>
        <el-input-number v-model="posH" :precision="1" :min="0.1" size="small" controls-position="right" @change="onTransformChange" />
      </div>
    </div>
    <div class="prop-row">
      <span class="prop-label-sm">Rotate</span>
      <el-input-number v-model="rotateBy" :precision="1" size="small" controls-position="right" placeholder="deg" @change="onRotateByChange" />
      <el-button size="small" class="icon-btn" title="Rotate a copy (keeps the original)" @click="onRotateCopy">⧉</el-button>
      <el-button size="small" class="icon-btn" :type="store.transform.flipH ? 'primary' : ''" title="Flip Horizontal" @click="onFlipH">⇔</el-button>
      <el-button size="small" class="icon-btn" :type="store.transform.flipV ? 'primary' : ''" title="Flip Vertical" @click="onFlipV">⇕</el-button>
    </div>
    <div class="prop-row">
      <span class="prop-label-sm">Skew</span>
      <el-input-number v-model="skewXBy" :precision="1" size="small" controls-position="right" placeholder="X deg" @change="onSkewChange" />
      <el-input-number v-model="skewYBy" :precision="1" size="small" controls-position="right" placeholder="Y deg" @change="onSkewChange" />
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * TransformSection (C2: panel slice out of PropertyPanel.vue).
 *
 * X/Y/W/H about the nine-point reference anchor, rotate/skew/flip. Same
 * section contract as the sibling editors: the parent calls syncFromStore()
 * on selection changes (plus on mount below); every edit reads the live
 * selection through the engine.
 */
import { ref, inject, onMounted, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { ReferencePoint } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const posX = ref(0)
const posY = ref(0)
const posW = ref(0)
const posH = ref(0)
// AI transform-panel aspect lock: when on, editing one dimension derives
// the other from the ratio the selection had before this edit.
const whLink = ref(false)
let lastPosW = 0
let lastPosH = 0
// Relative rotation in degrees applied on change, then reset to zero.
const rotateBy = ref(0)
// Relative skew in degrees applied on change, then reset to zero.
const skewXBy = ref(0)
const skewYBy = ref(0)

// Nine-point reference anchors in grid order.
const refPoints: ReferencePoint[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]

function getEngine() { return engineRef?.value || null }

/** Read the selection bounds (united for multi-selections) into the fields. */
function syncFromStore() {
  const e = getEngine()
  if (!e || !store.hasSelection) return
  const items = e.getSelection()
  if (items.length === 0) return
  const b = (items.length > 1 ? e.getSelectionBounds() : null) ?? (items[0] as any).bounds
  if (!b) return
  const anchor = e.referencePointForRect(b, store.referencePoint)
  posX.value = Math.round(anchor.x * 10) / 10
  posY.value = Math.round(anchor.y * 10) / 10
  posW.value = Math.round(b.width * 10) / 10
  posH.value = Math.round(b.height * 10) / 10
  lastPosW = posW.value
  lastPosH = posH.value
  rotateBy.value = 0
}

function onTransformChange() {
  const e = getEngine()
  if (!e) return
  if (!Number.isFinite(posW.value) || !Number.isFinite(posH.value)) return
  if (posW.value <= 0 || posH.value <= 0) return
  // Aspect lock: whichever dimension the user touched drives the other at
  // the pre-edit ratio (lastPos values are synced on every panel resync).
  if (whLink.value && lastPosW > 0 && lastPosH > 0) {
    const wMoved = Math.abs(posW.value - lastPosW) > 1e-9
    const hMoved = Math.abs(posH.value - lastPosH) > 1e-9
    if (wMoved && !hMoved) {
      posH.value = Math.max(0.1, Math.round(((posW.value * lastPosH) / lastPosW) * 10) / 10)
    } else if (hMoved && !wMoved) {
      posW.value = Math.max(0.1, Math.round(((posH.value * lastPosW) / lastPosH) * 10) / 10)
    }
  }
  // X/Y address the reference point; W/H scale about it so it stays fixed.
  // Multi-selections act on their united bounds (AI): every member keeps
  // its relative layout instead of being stretched to the same size.
  const ref = store.referencePoint
  const items = (e.getSelection() as any[]).filter((item) => {
    if (!item || item.locked) return false
    const b = item.bounds
    return !!b && b.width > 0 && b.height > 0
  })
  if (items.length === 0) return
  let united = items[0].bounds.clone()
  for (let i = 1; i < items.length; i++) {
    united = united.unite(items[i].bounds)
  }
  if (!united || united.width <= 0 || united.height <= 0) return
  const anchor = e.referencePointForRect(united, ref)
  const dx = posX.value - anchor.x
  const dy = posY.value - anchor.y
  const scaleX = posW.value / united.width
  const scaleY = posH.value / united.height
  const pivot = new e.scope.Point(posX.value, posY.value)
  items.forEach((item: any) => {
    if (dx !== 0 || dy !== 0) {
      item.position = item.position.add(new e!.scope.Point(dx, dy))
    }
    item.scale(scaleX, scaleY, pivot)
    e.refreshItemGradient(item)
  })
  e.reflowTextsForItems(items)
  e.scope.view.update()
  e.pushCoalescedHistory('Transform')
  lastPosW = posW.value
  lastPosH = posH.value
}

function onReferencePointChange(point: ReferencePoint) {
  store.setReferencePoint(point)
  // X/Y display follows the reference point, so resync the panel.
  syncFromStore()
}

function onRotateByChange(val: number | undefined) {
  const e = getEngine()
  if (!e || !val) {
    rotateBy.value = 0
    return
  }
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) {
    rotateBy.value = 0
    return
  }
  e.rotateSelection(val, pivot)
  e.pushHistory('Rotate')
  e.stampSelectionFrame()
  rotateBy.value = 0
}

function onRotateCopy() {
  const e = getEngine()
  const val = Number(rotateBy.value)
  if (!e || !val) {
    rotateBy.value = 0
    store.setStatusMessage('Enter degrees, then Rotate Copy')
    return
  }
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) {
    rotateBy.value = 0
    return
  }
  if (!e.rotateCopy(val, pivot)) {
    store.setStatusMessage('Rotate Copy needs unlocked artwork')
  }
  e.stampSelectionFrame()
  rotateBy.value = 0
}

function onSkewChange() {
  const e = getEngine()
  const skewX = skewXBy.value || 0
  const skewY = skewYBy.value || 0
  skewXBy.value = 0
  skewYBy.value = 0
  if (!e || (skewX === 0 && skewY === 0)) return
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) return
  e.skewSelection(skewX, skewY, pivot)
  e.pushHistory('Skew')
  e.stampSelectionFrame()
}

function onFlipH() {
  const e = getEngine()
  if (!e) return
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) return
  e.flipSelection('horizontal', pivot)
  e.pushHistory('Flip Horizontal')
  e.stampSelectionFrame()
}

function onFlipV() {
  const e = getEngine()
  if (!e) return
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) return
  e.flipSelection('vertical', pivot)
  e.pushHistory('Flip Vertical')
  e.stampSelectionFrame()
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

.icon-btn {
  width: 24px;
  flex-shrink: 0;
  padding: 0 !important;
  margin: 0 !important;
}

/* Transform X/W/Y/H grid with the ref-point block on the left (AI-style) */
.tf-grid {
  display: grid;
  grid-template-columns: auto 1fr 1fr;
  gap: 5px 6px;
  align-items: center;
  margin-top: 5px;
}

.tf-ref {
  grid-row: span 2;
}

.tf-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.tf-cell > span {
  width: 10px;
  flex-shrink: 0;
  font-size: 11px;
  color: #9a9a9a;
}

.ref-grid {
  display: grid;
  grid-template-columns: repeat(3, 12px);
  grid-template-rows: repeat(3, 12px);
  gap: 2px;
}

.ref-cell {
  width: 12px;
  height: 12px;
  border: 1px solid #555;
  border-radius: 2px;
  cursor: pointer;
  background: #1a1a1a;
}

.ref-cell:hover {
  border-color: #fff;
}

.ref-cell.active {
  background: #4a90d9;
  border-color: #4a90d9;
}
</style>
