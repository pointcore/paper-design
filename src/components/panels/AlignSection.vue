<template>
  <div class="align-section">
    <div class="btn-row">
      <el-radio-group v-model="alignTarget" size="small">
        <el-radio-button value="selection">Selection</el-radio-button>
        <el-radio-button value="board">Artboard</el-radio-button>
        <el-radio-button value="key">Key</el-radio-button>
      </el-radio-group>
    </div>
    <div class="btn-grid-3">
      <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onAlign('left', 'Align Left')">Left</el-button>
      <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onAlign('centerX', 'Align Center')">Center</el-button>
      <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onAlign('right', 'Align Right')">Right</el-button>
      <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onAlign('top', 'Align Top')">Top</el-button>
      <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onAlign('centerY', 'Align Middle')">Middle</el-button>
      <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onAlign('bottom', 'Align Bottom')">Bottom</el-button>
    </div>
    <div class="btn-grid-2">
      <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 3" @click="onDistribute('horizontal')">Distr H</el-button>
      <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 3" @click="onDistribute('vertical')">Distr V</el-button>
    </div>
    <div class="btn-grid-2">
      <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 3" @click="onDistributeGap('horizontal')">Gap H</el-button>
      <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 3" @click="onDistributeGap('vertical')">Gap V</el-button>
    </div>
    <div class="btn-grid-3">
      <el-button size="small" class="grid-btn" title="Average sub-selected anchors horizontally" @click="onAverage('horizontal')">Avg H</el-button>
      <el-button size="small" class="grid-btn" title="Average sub-selected anchors vertically" @click="onAverage('vertical')">Avg V</el-button>
      <el-button size="small" class="grid-btn" title="Average sub-selected anchors on both axes" @click="onAverage('both')">Avg Both</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * AlignSection (C2: panel slice out of PropertyPanel.vue).
 *
 * Align + distribute + anchor-average buttons. Stateless beyond the
 * align-target radio: every action reads the live selection through the
 * engine, so no parent sync is needed.
 */
import { ref, inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { AlignMode, DistributeAxis } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

// Align target: united selection, active artboard, or picked key object.
const alignTarget = ref<'selection' | 'board' | 'key'>('selection')

function getEngine() { return engineRef?.value || null }

function onAlign(mode: AlignMode, label: string) {
  const e = getEngine()
  if (!e) return
  const t = (alignTarget as any).value ?? 'selection'
  const target = t === 'board'
    ? e.getActiveArtboardRect() ?? undefined
    : t === 'key'
      ? (e as any).getKeyObjectBounds?.() ?? undefined
      : undefined
  // Direct-select sub-selection first (anchors); falls through to objects.
  const sc = e.getController('direct-select') as {
    alignSubselection?: (m: AlignMode, t?: paper.Rectangle | null) => boolean | null
  } | null
  const sub = sc?.alignSubselection?.(mode, target ?? null) ?? null
  if (sub === true) return
  if (sub === false) {
    store.setStatusMessage('Nothing to align in the sub-selection')
    return
  }
  if (e.alignSelection(mode, target)) {
    e.pushHistory(label)
  } else {
    store.setStatusMessage('Align needs 2+ objects, a board, or a key object')
  }
}

function onDistribute(axis: DistributeAxis) {
  const e = getEngine()
  if (!e) return
  const sc = e.getController('direct-select') as {
    distributeSubselection?: (a: DistributeAxis) => boolean | null
  } | null
  const sub = sc?.distributeSubselection?.(axis) ?? null
  if (sub === true) return
  if (sub === false) {
    store.setStatusMessage('Distribute needs 3+ sub-selected anchors')
    return
  }
  if (e.distributeSelection(axis)) {
    e.pushHistory(axis === 'horizontal' ? 'Distribute Horizontally' : 'Distribute Vertically')
  }
}

function onDistributeGap(axis: DistributeAxis) {
  const e = getEngine()
  if (!e) return
  const sc = e.getController('direct-select') as {
    distributeSubselection?: (a: DistributeAxis) => boolean | null
  } | null
  const sub = sc?.distributeSubselection?.(axis) ?? null
  if (sub === true) return
  if (sub === false) {
    store.setStatusMessage('Distribute needs 3+ sub-selected anchors')
    return
  }
  if (e.distributeSpacing(axis)) {
    e.pushHistory('Distribute Gaps')
  }
}

function onAverage(axis: 'horizontal' | 'vertical' | 'both') {
  const e = getEngine()
  if (!e) return
  const sc = e.getController('direct-select') as {
    averageSubselection?: (a: 'horizontal' | 'vertical' | 'both') => boolean | null
  } | null
  const sub = sc?.averageSubselection?.(axis) ?? null
  if (sub === true) return
  store.setStatusMessage('Average needs 2+ sub-selected anchors')
}
</script>

<style scoped>
/* Button primitives shared with the panel (duplicated: scoped CSS does not
   cross the component boundary). */
.btn-row {
  display: flex;
  gap: 4px;
  margin-top: 5px;
}

.btn-grid-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  margin-top: 5px;
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
</style>
