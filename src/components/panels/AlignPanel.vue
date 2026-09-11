<template>
  <div class="align-panel ai-panel">
    <div class="panel-section">
      <div class="sec-title">Align To</div>
      <el-radio-group v-model="alignTarget" size="small" @change="onTargetChange">
        <el-radio-button value="selection">Selection</el-radio-button>
        <el-radio-button value="board">Artboard</el-radio-button>
        <el-radio-button value="key">Key</el-radio-button>
      </el-radio-group>
      <div class="row">
        <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" title="Use first selected object as the key (AI Alt-click parity)" @click="setKey">Set Key</el-button>
        <el-button size="small" class="grid-btn" :disabled="!store.keyObjectId" @click="clearKey">Clear Key</el-button>
      </div>
      <div v-if="keyName" class="hint">Key: {{ keyName }}</div>
    </div>

    <div class="panel-section">
      <div class="sec-title">Align</div>
      <div class="btn-grid-3">
        <el-button v-for="b in alignBtns" :key="b.mode" size="small" class="grid-btn" :disabled="!store.hasSelection" @click="doAlign(b.mode, b.label)">{{ b.text }}</el-button>
      </div>
    </div>

    <div class="panel-section">
      <div class="sec-title">Distribute</div>
      <div class="btn-grid-2">
        <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 3" @click="doDistribute('horizontal', false)">Center H</el-button>
        <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 3" @click="doDistribute('vertical', false)">Center V</el-button>
      </div>
      <div class="btn-grid-2">
        <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 3" @click="doDistribute('horizontal', true)">Gap H</el-button>
        <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 3" @click="doDistribute('vertical', true)">Gap V</el-button>
      </div>
      <div class="row">
        <span class="lbl">Gap</span>
        <el-input-number v-model="gap" :min="0" :max="2000" size="small" controls-position="right" @change="onGap" />
        <span class="unit">px</span>
      </div>
      <div class="btn-grid-3">
        <el-button size="small" class="grid-btn" title="Average sub-selected anchors horizontally" @click="doAverage('horizontal')">Avg H</el-button>
        <el-button size="small" class="grid-btn" title="Average sub-selected anchors vertically" @click="doAverage('vertical')">Avg V</el-button>
        <el-button size="small" class="grid-btn" title="Average sub-selected anchors on both axes" @click="doAverage('both')">Avg Both</el-button>
      </div>
      <div class="hint">Average needs 2+ sub-selected anchors (Direct Select).</div>
    </div>

    <div class="panel-section">
      <div class="sec-title">Same Size <span class="sec-hint">match the first selected</span></div>
      <div class="btn-grid-3">
        <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 2" @click="doMatchSize('width')">Width</el-button>
        <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 2" @click="doMatchSize('height')">Height</el-button>
        <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 2" @click="doMatchSize('both')">Both</el-button>
      </div>
    </div>

    <div class="panel-section">
      <div class="sec-title">Pathfinder</div>
      <div class="btn-grid-2">
        <el-button size="small" class="grid-btn" :disabled="operandCount < 2" @click="doBoolean('unite')">Unite</el-button>
        <el-button size="small" class="grid-btn" :disabled="operandCount < 2" @click="doBoolean('subtract')">Minus Front</el-button>
        <el-button size="small" class="grid-btn" :disabled="operandCount < 2" @click="doBoolean('intersect')">Intersect</el-button>
        <el-button size="small" class="grid-btn" :disabled="operandCount < 2" @click="doBoolean('exclude')">Exclude</el-button>
      </div>
      <div class="btn-grid-2">
        <el-button size="small" class="grid-btn" :disabled="operandCount < 2" @click="doExtended('minusBack')">Minus Back</el-button>
        <el-button size="small" class="grid-btn" :disabled="operandCount !== 2" title="Two paths only" @click="doExtended('divide')">Divide</el-button>
        <el-button size="small" class="grid-btn" :disabled="operandCount !== 2" title="Two paths only" @click="doExtended('trim')">Trim</el-button>
        <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="doExtended('outline')">Outline</el-button>
      </div>
      <div class="hint">Divide/Trim need exactly 2 paths. Outline expands strokes.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { AlignMode, AlignTarget, BooleanOperation, DistributeAxis } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')
const getEngine = () => engineRef?.value ?? null

const alignBtns: Array<{ mode: AlignMode; text: string; label: string }> = [
  { mode: 'left', text: 'Left', label: 'Align Left' },
  { mode: 'centerX', text: 'Center', label: 'Align Center' },
  { mode: 'right', text: 'Right', label: 'Align Right' },
  { mode: 'top', text: 'Top', label: 'Align Top' },
  { mode: 'centerY', text: 'Middle', label: 'Align Middle' },
  { mode: 'bottom', text: 'Bottom', label: 'Align Bottom' },
]

const alignTarget = ref(store.alignTarget ?? 'selection')
watch(() => store.alignTarget, (v) => { alignTarget.value = v })
function onTargetChange(v: AlignTarget) { store.setAlignTarget(v) }

const gap = ref(store.distributeGap ?? 10)
watch(() => store.distributeGap, (v) => { gap.value = v })
function onGap(v: number | undefined) { if (v !== undefined) store.setDistributeGap(v) }

const keyName = computed(() => {
  const id = store.keyObjectId
  if (!id) return ''
  const e = getEngine()
  const item = id && e ? e.getItemById(id) : null
  if (!item) return 'missing — pick again'
  return String((item as any).name || (item as any).data?.name || id.slice(0, 8))
})

const operandCount = computed(() => {
  const e = getEngine()
  if (!e) return 0
  return e.getSelection().filter(
    (item) => !item.locked && (item instanceof e.scope.Path || item instanceof e.scope.CompoundPath)
  ).length
})

function resolveTarget(): paper.Rectangle | undefined {
  const e = getEngine()
  if (!e) return undefined
  const t = store.alignTarget ?? 'selection'
  if (t === 'board') return e.getActiveArtboardRect() ?? undefined
  if (t === 'key') return e.getKeyObjectBounds() ?? undefined
  return undefined
}

function doAlign(mode: AlignMode, label: string) {
  const e = getEngine()
  if (!e) return
  const target = resolveTarget()
  const sc = e.getController('direct-select') as { alignSubselection?: (m: AlignMode, t?: any) => boolean | null } | null
  const sub = sc?.alignSubselection?.(mode, target ?? null) ?? null
  if (sub === true) return
  if (sub === false) { store.setStatusMessage('Nothing to align in the sub-selection'); return }
  if (e.alignSelection(mode, target)) e.pushHistory(label)
  else store.setStatusMessage('Align needs 2+ objects, a board, or a key object')
}

function doDistribute(axis: DistributeAxis, exactGap: boolean) {
  const e = getEngine()
  if (!e) return
  if (exactGap) {
    if (e.distributeSpacingExact(axis, Number(gap.value) || 0)) e.pushHistory('Distribute Gaps')
    else store.setStatusMessage('Distribute needs 3+ objects')
    return
  }
  if (axis === 'horizontal' || axis === 'vertical') {
    // Center distribute by default; gap-even lives on the Gap buttons.
    if (e.distributeSelection(axis)) e.pushHistory(axis === 'horizontal' ? 'Distribute Horizontally' : 'Distribute Vertically')
    else store.setStatusMessage('Distribute needs 3+ objects')
  }
}

function doBoolean(op: BooleanOperation) {
  const e = getEngine()
  if (!e) return
  if (!e.booleanOperation(op)) store.setStatusMessage('Boolean needs at least two unlocked paths')
}

function doExtended(op: 'minusBack' | 'divide' | 'trim' | 'outline') {
  const e = getEngine()
  if (!e) return
  if (!e.extendedBoolean(op)) {
    store.setStatusMessage(op === 'outline' ? 'Outline needs a path with a stroke' : 'Need two unlocked paths')
  }
}

function doAverage(axis: 'horizontal' | 'vertical' | 'both') {
  const e = getEngine()
  if (!e) return
  const sc = e.getController('direct-select') as {
    averageSubselection?: (a: 'horizontal' | 'vertical' | 'both') => boolean | null
  } | null
  const sub = sc?.averageSubselection?.(axis) ?? null
  if (sub === true) return
  store.setStatusMessage('Average needs 2+ sub-selected anchors')
}

function doMatchSize(mode: 'width' | 'height' | 'both') {
  const e = getEngine()
  if (!e) return
  if (e.matchSize(mode) === 0) {
    store.setStatusMessage('Same Size needs 2+ unlocked objects')
  }
}

function setKey() {
  const id = store.selectedItemIds[0]
  if (!id) return
  ;store.setKeyObject?.(id)
  ;store.setAlignTarget?.('key')
  store.setStatusMessage('Key object set (align target)')
}
function clearKey() {
  ;store.setKeyObject?.('')
  ;store.setAlignTarget?.('selection')
}
</script>

<style scoped>
.ai-panel { background: #252526; color: #c9c9c9; font-size: 12px; display: flex; flex-direction: column; min-height: 100%; padding: 8px; gap: 10px; }
.panel-section { border-bottom: 1px solid #1e1e1e; padding-bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
.panel-section:last-child { border-bottom: none; }
.sec-title { font-size: 11px; color: #dcdcdc; font-weight: 600; letter-spacing: 0.5px; }
.row { display: flex; align-items: center; gap: 6px; }
.lbl { font-size: 11px; color: #9a9a9a; }
.unit { font-size: 11px; color: #8a8a8a; }
.hint { font-size: 11px; color: #8a8a8a; line-height: 1.5; }
.sec-hint { color: #8a8a8a; font-weight: 400; }
.btn-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.btn-grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; }
.grid-btn { width: 100%; margin: 0 !important; }
.ai-panel :deep(.el-button--small) { background: #333; border: 1px solid #4a4a4a; color: #d5d5d5; border-radius: 3px; height: 24px; font-size: 11px; }
.ai-panel :deep(.el-radio-button__inner) { background: #1a1a1a; border-color: #3d3d3d; color: #b5b5b5; font-size: 11px; padding: 5px 8px; box-shadow: none; }
.ai-panel :deep(.el-radio-button__orig-radio:checked + .el-radio-button__inner) { background: #2f6fbf; border-color: #2f6fbf; color: #fff; }
.ai-panel :deep(.el-input-number) { flex: 1; min-width: 0; }
.ai-panel :deep(.el-input-number .el-input__wrapper) { background: #111; border: 1px solid #3d3d3d; box-shadow: none !important; height: 24px; }
.ai-panel :deep(.el-input__inner) { color: #e6e6e6; font-size: 12px; }
</style>
