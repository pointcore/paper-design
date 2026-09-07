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
        <div class="prop-row">
          <el-radio-group v-model="fillKind" size="small" @change="onFillKindChange">
            <el-radio-button value="solid">Solid</el-radio-button>
            <el-radio-button value="gradient">Gradient</el-radio-button>
          </el-radio-group>
        </div>
        <div class="color-row" v-if="fillKind === 'solid'">
          <el-color-picker v-model="fillColorValue" size="small" show-alpha @change="onFillChange" />
          <el-button size="small" type="danger" plain @click="onClearFill">×</el-button>
        </div>
        <template v-if="fillKind === 'gradient'">
          <div class="prop-row">
            <el-radio-group v-model="gradientType" size="small" @change="onGradientChange">
              <el-radio-button value="linear">Linear</el-radio-button>
              <el-radio-button value="radial">Radial</el-radio-button>
            </el-radio-group>
          </div>
          <div class="prop-row" v-for="(stop, index) in gradientStops" :key="index">
            <el-color-picker v-model="stop.color" size="small" show-alpha @change="onGradientChange" />
            <el-input-number v-model="stop.offset" :min="0" :max="100" size="small" @change="onGradientChange" />
            <el-button size="small" type="danger" plain :disabled="gradientStops.length <= 2" @click="removeGradientStop(index)">×</el-button>
          </div>
          <div class="prop-row">
            <el-button size="small" plain @click="addGradientStop">Add Stop</el-button>
          </div>
        </template>
      </div>

      <div class="prop-section">
        <div class="prop-label">Stroke</div>
        <div class="color-row">
          <el-color-picker v-model="strokeColorValue" size="small" show-alpha @change="onStrokeChange" />
          <el-button size="small" type="danger" plain @click="onClearStroke">×</el-button>
        </div>
        <div class="prop-row">
          <span class="prop-label-sm">Weight</span>
          <el-input-number v-model="strokeWidth" :min="0.1" :max="100" size="small" @change="onStyleChange" />
        </div>
        <div class="prop-row">
          <span class="prop-label-sm">Cap</span>
          <el-select v-model="lineCap" size="small" style="flex: 1" @change="onStrokeAppearanceChange">
            <el-option v-for="c in lineCaps" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </div>
        <div class="prop-row">
          <span class="prop-label-sm">Join</span>
          <el-select v-model="lineJoin" size="small" style="flex: 1" @change="onStrokeAppearanceChange">
            <el-option v-for="j in lineJoins" :key="j.value" :label="j.label" :value="j.value" />
          </el-select>
        </div>
        <div class="prop-row" v-if="lineJoin === 'miter'">
          <span class="prop-label-sm">Miter</span>
          <el-input-number v-model="miterLimit" :min="1" :max="100" size="small" @change="onStrokeAppearanceChange" />
        </div>
        <div class="prop-row">
          <span class="prop-label-sm">Dash</span>
          <el-input v-model="dashPattern" size="small" placeholder="e.g. 4 2" @change="onDashChange" />
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-label">Blending</div>
        <div class="prop-row">
          <span class="prop-label-sm">Mode</span>
          <el-select v-model="blendMode" size="small" style="flex: 1" @change="onBlendChange">
            <el-option v-for="b in blendModes" :key="b.value" :label="b.label" :value="b.value" />
          </el-select>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-label">Opacity</div>
        <el-slider v-model="opacityValue" :min="0" :max="100" size="small" @change="onOpacityChange" />
      </div>

      <div class="prop-section">
        <div class="prop-label">Transform</div>
        <div class="prop-row">
          <span class="prop-label-sm">Ref</span>
          <div class="ref-grid">
            <div
              v-for="rp in refPoints"
              :key="rp"
              class="ref-cell"
              :class="{ active: store.referencePoint === rp }"
              @click="onReferencePointChange(rp)"
            />
          </div>
        </div>
        <div class="prop-grid">
          <span class="prop-label-sm">X</span>
          <el-input-number v-model="posX" :precision="1" size="small" @change="onTransformChange" />
          <span class="prop-label-sm">Y</span>
          <el-input-number v-model="posY" :precision="1" size="small" @change="onTransformChange" />
          <span class="prop-label-sm">W</span>
          <el-input-number v-model="posW" :precision="1" :min="0.1" size="small" @change="onTransformChange" />
          <span class="prop-label-sm">H</span>
          <el-input-number v-model="posH" :precision="1" :min="0.1" size="small" @change="onTransformChange" />
        </div>
        <div class="prop-row">
          <span class="prop-label-sm">Rotate</span>
          <el-input-number v-model="rotateBy" :precision="1" size="small" placeholder="deg" @change="onRotateByChange" />
          <el-button size="small" :type="store.transform.flipH ? 'primary' : ''" @click="onFlipH">Flip H</el-button>
          <el-button size="small" :type="store.transform.flipV ? 'primary' : ''" @click="onFlipV">Flip V</el-button>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-label">Align</div>
        <div class="align-row">
          <el-button size="small" :disabled="store.selectedItemIds.length < 2" @click="onAlign('left', 'Align Left')">Left</el-button>
          <el-button size="small" :disabled="store.selectedItemIds.length < 2" @click="onAlign('centerX', 'Align Center')">Center</el-button>
          <el-button size="small" :disabled="store.selectedItemIds.length < 2" @click="onAlign('right', 'Align Right')">Right</el-button>
          <el-button size="small" :disabled="store.selectedItemIds.length < 2" @click="onAlign('top', 'Align Top')">Top</el-button>
          <el-button size="small" :disabled="store.selectedItemIds.length < 2" @click="onAlign('centerY', 'Align Middle')">Middle</el-button>
          <el-button size="small" :disabled="store.selectedItemIds.length < 2" @click="onAlign('bottom', 'Align Bottom')">Bottom</el-button>
        </div>
        <div class="align-row">
          <el-button size="small" :disabled="store.selectedItemIds.length < 3" @click="onDistribute('horizontal')">Distribute H</el-button>
          <el-button size="small" :disabled="store.selectedItemIds.length < 3" @click="onDistribute('vertical')">Distribute V</el-button>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-label">Pathfinder</div>
        <div class="align-row">
          <el-button size="small" :disabled="booleanOperandCount() < 2" @click="onBoolean('unite')">Unite</el-button>
          <el-button size="small" :disabled="booleanOperandCount() < 2" @click="onBoolean('subtract')">Subtract</el-button>
          <el-button size="small" :disabled="booleanOperandCount() < 2" @click="onBoolean('intersect')">Intersect</el-button>
          <el-button size="small" :disabled="booleanOperandCount() < 2" @click="onBoolean('exclude')">Exclude</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { AlignMode, BooleanOperation, DistributeAxis, GradientState, LineCap, LineJoin, ReferencePoint, TextAlign } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const fillColorValue = ref(store.style.fillColor || '#000000')
const strokeColorValue = ref(store.style.strokeColor || '#000000')
const strokeWidth = ref(store.style.strokeWidth)
const opacityValue = ref(Math.round(store.style.opacity * 100))

// Fill kind follows the store gradient (solid when none is set).
const fillKind = computed(() => (store.style.gradient ? 'gradient' : 'solid'))
const gradientType = ref<'linear' | 'radial'>('linear')
// Editable gradient stops (offsets in percent for the inputs).
const gradientStops = ref<Array<{ offset: number; color: string }>>([])

/** Mirror the store gradient into the editable stop list. */
function syncGradientFromStore() {
  const gradient = store.style.gradient
  gradientType.value = gradient?.type ?? 'linear'
  gradientStops.value = gradient
    ? gradient.stops.map((stop) => ({ offset: Math.round(stop.offset * 100), color: stop.color }))
    : []
}

const lineCap = ref<LineCap>(store.style.lineCap)
const lineJoin = ref<LineJoin>(store.style.lineJoin)
const miterLimit = ref(store.style.miterLimit)
const dashPattern = ref(store.style.dashArray.join(' '))
const blendMode = ref(store.style.blendMode)

const lineCaps: Array<{ value: LineCap; label: string }> = [
  { value: 'round', label: 'Round' },
  { value: 'butt', label: 'Butt' },
  { value: 'square', label: 'Square' },
]

const lineJoins: Array<{ value: LineJoin; label: string }> = [
  { value: 'miter', label: 'Miter' },
  { value: 'round', label: 'Round' },
  { value: 'bevel', label: 'Bevel' },
]

const blendModes = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
]

const posX = ref(0)
const posY = ref(0)
const posW = ref(0)
const posH = ref(0)
// Relative rotation in degrees applied on change, then reset to zero.
const rotateBy = ref(0)

// Nine-point reference anchors in grid order.
const refPoints: ReferencePoint[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]

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

/** Build normalized gradient parameters from the editable stop list. */
function currentGradient(): GradientState {
  const stops = gradientStops.value
    .map((stop) => ({
      offset: Math.min(1, Math.max(0, (Number(stop.offset) || 0) / 100)),
      color: stop.color || '#000000',
    }))
    .sort((a, b) => a.offset - b.offset)
  return { type: gradientType.value, stops }
}

/** Write the edited gradient to the store and repaint the selection. */
function applyGradientToSelection(label: string) {
  const e = getEngine()
  if (!e) return
  const gradient = currentGradient()
  if (gradient.stops.length === 0) return
  store.updateStyle({ gradient })
  syncGradientFromStore()
  e.getSelection().forEach((item: any) => {
    e.applyStyleToItem(item, e.store.style)
  })
  e.scope.view.update()
  e.pushHistory(label)
}

function onFillKindChange(kind: 'solid' | 'gradient') {
  const e = getEngine()
  if (!e) return
  if (kind === 'gradient') {
    if (!store.style.gradient) {
      const from = store.style.fillColor || '#000000'
      store.updateStyle({
        gradient: { type: 'linear', stops: [{ offset: 0, color: from }, { offset: 1, color: '#ffffff' }] },
      })
    }
    syncGradientFromStore()
    applyGradientToSelection('Change Gradient')
  } else {
    store.updateStyle({ gradient: null })
    e.getSelection().forEach((item: any) => {
      e.applyStyleToItem(item, e.store.style)
    })
    e.scope.view.update()
    e.pushHistory('Change Fill')
  }
}

function onGradientChange() {
  applyGradientToSelection('Change Gradient')
}

function addGradientStop() {
  gradientStops.value.push({ offset: 50, color: '#808080' })
  applyGradientToSelection('Change Gradient')
}

function removeGradientStop(index: number) {
  if (gradientStops.value.length <= 2) return
  gradientStops.value.splice(index, 1)
  applyGradientToSelection('Change Gradient')
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

function onStrokeAppearanceChange() {
  const e = getEngine()
  if (!e) return
  // A cleared miter field falls back instead of blocking cap/join edits.
  const miter =
    Number.isFinite(miterLimit.value) && (miterLimit.value as number) >= 1
      ? miterLimit.value
      : store.style.miterLimit
  miterLimit.value = miter
  store.updateStyle({
    lineCap: lineCap.value,
    lineJoin: lineJoin.value,
    miterLimit: miter,
  })
  e.getSelection().forEach((item: any) => {
    if (item.strokeCap !== undefined) item.strokeCap = lineCap.value
    if (item.strokeJoin !== undefined) item.strokeJoin = lineJoin.value
    if (item.miterLimit !== undefined) item.miterLimit = miter
  })
  e.scope.view.update()
  e.pushHistory('Change Stroke Style')
}

/** Parse a dash pattern like "4 2" into lengths (empty means solid). */
function parseDashPattern(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n) && n >= 0)
}

function onDashChange() {
  const e = getEngine()
  if (!e) return
  const dashArray = parseDashPattern(dashPattern.value)
  store.updateStyle({ dashArray })
  e.getSelection().forEach((item: any) => {
    if (item.dashArray !== undefined) item.dashArray = [...dashArray]
  })
  e.scope.view.update()
  e.pushHistory('Change Dash Pattern')
}

function onBlendChange() {
  const e = getEngine()
  if (!e) return
  store.updateStyle({ blendMode: blendMode.value })
  e.getSelection().forEach((item: any) => {
    item.blendMode = blendMode.value
  })
  e.scope.view.update()
  e.pushHistory('Change Blend Mode')
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
  if (!Number.isFinite(posW.value) || !Number.isFinite(posH.value)) return
  if (posW.value <= 0 || posH.value <= 0) return
  // X/Y address the reference point; W/H scale about it so it stays fixed.
  const ref = store.referencePoint
  const items = e.getSelection()
  items.forEach((item: any) => {
    if (item.locked) return
    const b = item.bounds
    if (!b || b.width <= 0 || b.height <= 0) return
    const anchor = e.referencePointForRect(b, ref)
    const dx = posX.value - anchor.x
    const dy = posY.value - anchor.y
    if (dx !== 0 || dy !== 0) {
      item.position = item.position.add(new e!.scope.Point(dx, dy))
    }
    const current = item.bounds
    const scaleX = current.width !== 0 ? posW.value / current.width : 1
    const scaleY = current.height !== 0 ? posH.value / current.height : 1
    item.scale(scaleX, scaleY, new e!.scope.Point(posX.value, posY.value))
  })
  e.scope.view.update()
  e.pushHistory('Transform')
}

function onReferencePointChange(point: ReferencePoint) {
  store.setReferencePoint(point)
  // X/Y display follows the reference point, so resync the panel.
  syncTransformFromSelection()
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
  rotateBy.value = 0
}

function onFlipH() {
  const e = getEngine()
  if (!e) return
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) return
  e.flipSelection('horizontal', pivot)
  e.pushHistory('Flip Horizontal')
}

function onFlipV() {
  const e = getEngine()
  if (!e) return
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) return
  e.flipSelection('vertical', pivot)
  e.pushHistory('Flip Vertical')
}

function onAlign(mode: AlignMode, label: string) {
  const e = getEngine()
  if (!e) return
  e.alignSelection(mode)
  e.pushHistory(label)
}

function onDistribute(axis: DistributeAxis) {
  const e = getEngine()
  if (!e) return
  e.distributeSelection(axis)
  e.pushHistory(axis === 'horizontal' ? 'Distribute Horizontally' : 'Distribute Vertically')
}

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

/** Read the first selected item bounds into the transform fields. */
function syncTransformFromSelection() {
  const e = getEngine()
  if (!e || !store.hasSelection) return
  const items = e.getSelection()
  if (items.length === 0) return
  const item = items[0] as any
  const b = item.bounds
  if (!b) return
  const anchor = e.referencePointForRect(b, store.referencePoint)
  posX.value = Math.round(anchor.x * 10) / 10
  posY.value = Math.round(anchor.y * 10) / 10
  posW.value = Math.round(b.width * 10) / 10
  posH.value = Math.round(b.height * 10) / 10
  rotateBy.value = 0
}

// `immediate` covers the panel mounting after a selection already exists
// (the panel is v-if'd on hasSelection, so its first selection change is
// missed without it).
watch(() => store.selectedItemIds, () => {
  syncTransformFromSelection()
  syncGradientFromStore()
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

.ref-grid {
  display: grid;
  grid-template-columns: repeat(3, 14px);
  grid-template-rows: repeat(3, 14px);
  gap: 2px;
}

.ref-cell {
  width: 14px;
  height: 14px;
  border: 1px solid #555;
  border-radius: 2px;
  cursor: pointer;
}

.ref-cell:hover {
  border-color: #fff;
}

.ref-cell.active {
  background: #4a90d9;
  border-color: #4a90d9;
}

.align-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}
</style>
