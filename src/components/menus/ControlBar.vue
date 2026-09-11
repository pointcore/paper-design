<template>
  <div v-if="store.ui.showControlBar" class="control-bar">
    <span class="cb-tool">{{ toolLabel }}</span>
    <span class="cb-hint">{{ toolHint }}</span>
    <div class="cb-sep" />

    <!-- Selection: quick align + arrange -->
    <template v-if="isSelectTool">
      <el-select v-model="alignTarget" size="small" class="cb-ctl" style="width: 110px" title="Align to">
        <el-option value="selection" label="Align: Selection" />
        <el-option value="board" label="Align: Artboard" />
        <el-option value="key" label="Align: Key Object" />
      </el-select>
      <div class="cb-group">
        <el-button v-for="b in alignBtns" :key="b.mode" size="small" class="cb-btn" :title="b.label" :disabled="!store.hasSelection" @click="doAlign(b.mode)">{{ b.text }}</el-button>
      </div>
      <el-button size="small" class="cb-btn" :disabled="!canSetKey" title="Use first selected object as the key (AI Alt-click parity)" @click="setKey">Set Key</el-button>
      <el-button v-if="store.keyObjectId" size="small" class="cb-btn" title="Clear key object" @click="clearKey">Key×</el-button>
      <div class="cb-sep" />
      <el-button size="small" class="cb-btn" :disabled="!store.hasSelection" @click="engineCmd('groupSelection', 'Group')">Group</el-button>
      <el-button size="small" class="cb-btn" :disabled="!store.hasSelection" @click="engineCmd('bringForward')">Fwd</el-button>
      <el-button size="small" class="cb-btn" :disabled="!store.hasSelection" @click="engineCmd('sendBackward')">Bwd</el-button>
    </template>

    <!-- Text tools: mode switch + font basics -->
    <template v-else-if="isTextTool">
      <div class="cb-group">
        <el-button v-for="m in textModes" :key="m.name" size="small" class="cb-btn" :type="store.tool === m.name ? 'primary' : ''" :title="m.tip" @click="setTool(m.name)">{{ m.text }}</el-button>
      </div>
      <el-select v-model="fontFamily" size="small" class="cb-ctl" style="width: 130px" filterable allow-create default-first-option @change="onFontFamily">
        <el-option v-for="f in fonts" :key="f" :label="f" :value="f" />
      </el-select>
      <el-input-number v-model="fontSize" :min="1" :max="400" size="small" style="width: 84px" title="Font size" @change="onFontSize" />
      <el-button size="small" class="cb-btn" :type="isBold ? 'primary' : ''" title="Bold" @click="toggleBold">B</el-button>
      <el-button size="small" class="cb-btn" :type="isItalic ? 'primary' : ''" title="Italic" @click="toggleItalic">I</el-button>
      <el-input-number v-model="pathOffset" size="small" style="width: 90px" title="Type on path: start offset" @change="onPathOffset" />
    </template>

    <!-- Shape tools: live options -->
    <template v-else-if="isShapeTool">
      <div class="cb-group">
        <el-button v-for="s in shapeTools" :key="s.name" size="small" class="cb-btn" :type="store.tool === s.name ? 'primary' : ''" :title="s.tip" @click="setTool(s.name)">{{ s.text }}</el-button>
      </div>
      <template v-if="store.tool === 'polygon'">
        <span class="cb-label">Sides</span>
        <el-input-number v-model="polygonSides" :min="3" :max="64" size="small" style="width: 84px" @change="onPolygonSides" />
        <el-button size="small" class="cb-btn" :type="polygonStar ? 'primary' : ''" title="Star (inner radius)" @click="toggleStar">Star</el-button>
        <el-input-number v-if="polygonStar" v-model="starRatio" :min="0.1" :max="0.9" :step="0.05" size="small" style="width: 76px" title="Inner radius ratio" @change="onStarRatio" />
      </template>
      <template v-if="store.tool === 'spiral'">
        <span class="cb-label">Turns</span>
        <el-input-number v-model="spiralTurns" :min="1" :max="12" size="small" style="width: 80px" @change="onSpiralTurns" />
      </template>
      <template v-if="store.tool === 'rounded-rect'">
        <span class="cb-label">Radius</span>
        <el-input-number v-model="roundedRadius" :min="0" :max="500" size="small" style="width: 88px" @change="onRoundedRadius" />
      </template>
      <template v-if="store.tool === 'rect-grid' || store.tool === 'polar-grid'">
        <span class="cb-label">Rows</span>
        <el-input-number v-model="gridRows" :min="1" :max="20" size="small" style="width: 76px" @change="onGridRows" />
        <span class="cb-label">Cols</span>
        <el-input-number v-model="gridCols" :min="1" :max="32" size="small" style="width: 76px" @change="onGridCols" />
      </template>
      <span class="cb-label">Stroke</span>
      <el-input-number v-model="strokeWidth" :min="0.1" :max="100" size="small" style="width: 80px" @change="onStrokeWidth" />
    </template>

    <!-- Transform tools -->
    <template v-else-if="isTransformTool">
      <span class="cb-label">Angle</span>
      <el-input-number v-model="rotateBy" size="small" style="width: 84px" placeholder="deg" @change="onRotateBy" />
      <el-button size="small" class="cb-btn" title="Flip Horizontal" @click="flip('horizontal')">⇔</el-button>
      <el-button size="small" class="cb-btn" title="Flip Vertical" @click="flip('vertical')">⇕</el-button>
      <span class="cb-label">Scale %</span>
      <el-input-number v-model="scalePct" :min="1" :max="1600" size="small" style="width: 88px" @change="onScalePct" />
    </template>

    <!-- Gradient tool: angle + type -->
    <template v-else-if="store.tool === 'gradient'">
      <span class="cb-label">Angle</span>
      <el-input-number v-model="gradientAngle" :min="0" :max="360" size="small" style="width: 88px" @change="onGradientAngle" />
      <el-radio-group v-model="gradientType" size="small" @change="onGradientType">
        <el-radio-button value="linear">Linear</el-radio-button>
        <el-radio-button value="radial">Radial</el-radio-button>
      </el-radio-group>
      <span class="cb-hint">Drag on canvas to set the angle</span>
    </template>

    <!-- Wand tool: fill tolerance -->
    <template v-else-if="store.tool === 'wand'">
      <span class="cb-label">Tolerance</span>
      <el-input-number v-model="wandTolerance" :min="0" :max="100" size="small" style="width: 80px" title="Fill color tolerance (0 = exact)" @change="onWandTolerance" />
      <span class="cb-hint">Click a fill · Shift-click adds</span>
    </template>

    <!-- Callout tool: leader + label style -->
    <template v-else-if="store.tool === 'callout'">
      <span class="cb-label">Line</span>
      <el-color-picker v-model="calloutColor" size="small" @change="onCalloutStyle" />
      <el-input-number v-model="calloutWidth" :min="0.5" :max="20" size="small" style="width: 76px" title="Leader width" @change="onCalloutStyle" />
      <span class="cb-label">Fill</span>
      <el-color-picker v-model="calloutFill" size="small" @change="onCalloutStyle" />
      <span class="cb-label">Text</span>
      <el-color-picker v-model="calloutText" size="small" @change="onCalloutStyle" />
      <el-input-number v-model="calloutSize" :min="6" :max="120" size="small" style="width: 76px" title="Label size" @change="onCalloutStyle" />
    </template>

    <!-- Paint tools: stroke width + opacity quick -->
    <template v-else-if="isPaintTool">
      <template v-if="isBrushTool">
        <span class="cb-label">Size</span>
        <el-input-number v-model="brushSize" :min="1" :max="200" size="small" style="width: 76px" title="Brush footprint ([ ] resize)" @change="onBrushSize" />
      </template>
      <template v-if="store.tool === 'brush'">
        <span class="cb-label">Nib</span>
        <el-input-number v-model="brushAngle" :min="0" :max="90" size="small" style="width: 72px" title="Nib angle" @change="onBrushAngle" />
      </template>
      <template v-if="store.tool === 'pencil'">
        <span class="cb-label">Smooth</span>
        <el-input-number v-model="pencilSmooth" :min="0.5" :max="10" :step="0.5" size="small" style="width: 76px" title="Simplify tolerance" @change="onPencilSmooth" />
      </template>
      <span class="cb-label">Stroke</span>
      <el-input-number v-model="strokeWidth" :min="0.1" :max="100" size="small" style="width: 80px" @change="onStrokeWidth" />
      <span class="cb-label">Opacity</span>
      <el-input-number v-model="opacityPct" :min="0" :max="100" size="small" style="width: 80px" @change="onOpacity" />
    </template>

    <!-- Path edit tools: snap quick toggles -->
    <template v-else>
      <el-button size="small" class="cb-btn" :type="store.snap.point ? 'primary' : ''" title="Snap to anchors" @click="toggleSnap('point')">Anchor</el-button>
      <el-button size="small" class="cb-btn" :type="store.snap.grid ? 'primary' : ''" title="Snap to grid" @click="toggleSnap('grid')">Grid</el-button>
      <el-button size="small" class="cb-btn" :type="store.snap.guides ? 'primary' : ''" title="Snap to guides" @click="toggleSnap('guides')">Guide</el-button>
      <el-button size="small" class="cb-btn" :type="store.snap.smartGuides ? 'primary' : ''" title="Smart guides" @click="toggleSnap('smartGuides')">Smart</el-button>
    </template>

    <div class="cb-spacer" />
    <el-button size="small" class="cb-btn" title="Zoom to fit (Ctrl+0)" @click="fitContent">{{ zoomLabel }}</el-button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { AlignMode, ToolName } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')
const getEngine = () => engineRef?.value ?? null

const toolLabel = computed(() => {
  const names: Record<string, string> = {
    select: 'Select', 'direct-select': 'Direct Select', lasso: 'Lasso', wand: 'Wand', reshape: 'Reshape', spray: 'Spray', pen: 'Pen', curvature: 'Curvature',
    'add-anchor': 'Add Anchor', 'delete-anchor': 'Delete Anchor', 'convert-anchor': 'Convert Anchor',
    type: 'Point Text', 'area-type': 'Area Text', 'type-on-path': 'Type on Path', 'vertical-type': 'Vertical Text',
    rect: 'Rectangle', 'rounded-rect': 'Rounded Rect', ellipse: 'Ellipse', polygon: 'Polygon',
    arc: 'Arc', spiral: 'Spiral', line: 'Line', 'rect-grid': 'Rect Grid', 'polar-grid': 'Polar Grid',
    pencil: 'Pencil', 'blob-brush': 'Blob Brush', brush: 'Brush', eraser: 'Eraser',
    scissors: 'Scissors', 'shape-builder': 'Shape Builder', width: 'Width', gradient: 'Gradient', eyedropper: 'Eyedropper',
    rotate: 'Rotate', scale: 'Scale', mirror: 'Mirror', 'free-transform': 'Free Transform',
    callout: 'Callout', measure: 'Measure', zoom: 'Zoom', 'view-hand': 'Hand',
  }
  return names[store.tool] ?? store.tool
})
const toolHint = computed(() => {
  switch (store.tool) {
    case 'lasso': return 'Drag a loop · Shift adds · Alt removes'
    case 'wand': return 'Click a fill · Shift-click adds'
    case 'reshape': return 'Drag to push anchors in a 120px radius'
    case 'spray': return 'Drag to scatter the spray symbol'
    case 'gradient': return 'Drag to set the angle · Shift = 45° snap'
    case 'rotate': return 'Drag to rotate · Shift = 45° snap'
    case 'scale': return 'Drag to scale · Shift = 10% snap'
    case 'mirror': return 'Click = flip H · Shift-click = flip V'
    case 'shape-builder': return 'Drag to unite · Alt-drag to subtract'
    case 'type-on-path': return 'Click a path · offset sets the start'
    case 'rect-grid': case 'polar-grid': return 'Rows/Cols set the grid density'
    default: return 'Shift constrains · Alt draws from center'
  }
})

const isSelectTool = computed(() => store.tool === 'select' || store.tool === 'direct-select' || store.tool === 'free-transform' || store.tool === 'lasso')
const isTextTool = computed(() => store.tool === 'type' || store.tool === 'area-type' || store.tool === 'type-on-path' || store.tool === 'vertical-type')
const isShapeTool = computed(() => ['rect', 'rounded-rect', 'ellipse', 'polygon', 'arc', 'spiral', 'line', 'rect-grid', 'polar-grid'].includes(store.tool))
const isTransformTool = computed(() => store.tool === 'rotate' || store.tool === 'scale' || store.tool === 'mirror')
const isPaintTool = computed(() => ['pencil', 'blob-brush', 'brush', 'eraser', 'width'].includes(store.tool))
const isBrushTool = computed(() => store.tool === 'blob-brush' || store.tool === 'brush' || store.tool === 'eraser')

const alignBtns: Array<{ mode: AlignMode; text: string; label: string }> = [
  { mode: 'left', text: '◀', label: 'Align Left' },
  { mode: 'centerX', text: '●', label: 'Align Center' },
  { mode: 'right', text: '▶', label: 'Align Right' },
  { mode: 'top', text: '▲', label: 'Align Top' },
  { mode: 'centerY', text: '●', label: 'Align Middle' },
  { mode: 'bottom', text: '▼', label: 'Align Bottom' },
]
const textModes: Array<{ name: ToolName; text: string; tip: string }> = [
  { name: 'type', text: 'T', tip: 'Point Text (T)' },
  { name: 'area-type', text: '▦', tip: 'Area Text (drag a frame)' },
  { name: 'type-on-path', text: '∿', tip: 'Type on Path (click a path)' },
  { name: 'vertical-type', text: '↓', tip: 'Vertical Text' },
]
const shapeTools: Array<{ name: ToolName; text: string; tip: string }> = [
  { name: 'rect', text: '▢', tip: 'Rectangle (R)' },
  { name: 'rounded-rect', text: '▣', tip: 'Rounded Rectangle' },
  { name: 'ellipse', text: '○', tip: 'Ellipse (L)' },
  { name: 'polygon', text: '⬠', tip: 'Polygon' },
  { name: 'arc', text: '◠', tip: 'Arc' },
  { name: 'line', text: '╲', tip: 'Line (\\)' },
  { name: 'spiral', text: '🌀', tip: 'Spiral' },
  { name: 'rect-grid', text: '#', tip: 'Rectangular Grid' },
  { name: 'polar-grid', text: '⊙', tip: 'Polar Grid' },
]

const alignTarget = computed({
  get: () => (store as any).alignTarget ?? 'selection',
  set: (v: string) => (store as any).setAlignTarget ? (store as any).setAlignTarget(v) : undefined,
})
const canSetKey = computed(() => store.selectedItemIds.length > 0)
const zoomLabel = computed(() => `${Math.round(store.view.zoom * 100)}%`)

const fonts = ['Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Impact', 'sans-serif', 'serif', 'monospace']
const fontFamily = ref(store.charStyle.fontFamily)
const fontSize = ref(store.charStyle.fontSize)
const isBold = ref(String(store.charStyle.fontWeight) === 'bold')
const isItalic = ref(store.charStyle.fontStyle === 'italic')
const pathOffset = ref((store as any).textPathOffset ?? 0)
const polygonSides = ref((store as any).polygonSides ?? 5)
const polygonStar = ref(!!(store as any).polygonStar)
const starRatio = ref((store as any).starRatio ?? 0.5)
const spiralTurns = ref((store as any).spiralTurns ?? 3)
const roundedRadius = ref((store as any).roundedRadius ?? 12)
const gridRows = ref((store as any).gridRows ?? 4)
const gridCols = ref((store as any).gridCols ?? 4)
const strokeWidth = ref(store.style.strokeWidth)
const opacityPct = ref(Math.round(store.style.opacity * 100))
const brushSize = ref(Number((store as any).brushSize ?? 20))
const brushAngle = ref(Number((store as any).brushAngle ?? 45))
const pencilSmooth = ref(Number((store as any).pencilSmooth ?? 2.5))
const wandTolerance = ref(Number((store as any).wandTolerance ?? 0))
const gradientAngle = ref(Math.round(store.style.gradient?.angle ?? 0))
const gradientType = ref<'linear' | 'radial'>(store.style.gradient?.type ?? 'linear')
const calloutColor = ref(store.calloutStyle.color)
const calloutWidth = ref(store.calloutStyle.lineWidth)
const calloutFill = ref(store.calloutStyle.fillColor)
const calloutText = ref(store.calloutStyle.textColor)
const calloutSize = ref(store.calloutStyle.fontSize)
const rotateBy = ref(0)
const scalePct = ref(100)

watch(() => store.charStyle.fontFamily, (v) => { fontFamily.value = v })
watch(() => store.charStyle.fontSize, (v) => { fontSize.value = v })
watch(() => store.style.strokeWidth, (v) => { strokeWidth.value = v })
watch(() => (store as any).brushSize, (v) => { brushSize.value = Number(v) || 20 })
watch(() => (store as any).brushAngle, (v) => { brushAngle.value = Number(v) ?? 45 })
watch(() => (store as any).pencilSmooth, (v) => { pencilSmooth.value = Number(v) || 2.5 })
watch(() => (store as any).wandTolerance, (v) => { wandTolerance.value = Number(v) || 0 })
watch(() => store.style.gradient?.angle, (v) => { gradientAngle.value = Math.round(v ?? 0) })
watch(() => store.style.gradient?.type, (v) => { gradientType.value = v ?? 'linear' })

function setTool(name: ToolName) {
  store.setTool(name)
  getEngine()?.setTool(name)
}
function engineCmd(method: string, history?: string) {
  const e = getEngine() as any
  if (!e || typeof e[method] !== 'function') return
  const ok = e[method]()
  if (history && ok === false) store.setStatusMessage('Nothing to do')
  else if (history && ok !== false) { /* engine methods push their own history where needed */ }
}
function resolveTarget(): paper.Rectangle | undefined {
  const e = getEngine()
  if (!e) return undefined
  const t = (store as any).alignTarget ?? 'selection'
  if (t === 'board') return e.getActiveArtboardRect() ?? undefined
  if (t === 'key') return (e as any).getKeyObjectBounds?.() ?? undefined
  return undefined
}
function doAlign(mode: AlignMode) {
  const e = getEngine()
  if (!e) return
  if (e.alignSelection(mode, resolveTarget())) e.pushHistory('Align')
  else store.setStatusMessage('Align needs 2+ objects, a board, or a key object')
}
function setKey() {
  const id = store.selectedItemIds[0]
  if (!id) return
  ;(store as any).setKeyObject?.(id)
  store.setStatusMessage('Key object set (align target)')
}
function clearKey() { (store as any).setKeyObject?.('') }
function fitContent() { getEngine()?.fitToContent() }
function toggleSnap(k: 'point' | 'grid' | 'guides' | 'smartGuides') {
  store.updateSnap({ [k]: !(store.snap as any)[k] } as any)
}
function onFontFamily(v: string) {
  store.updateCharStyle({ fontFamily: v })
  const e = getEngine()
  if (!e) return
  e.getSelection().forEach((item: paper.Item) => { if (item instanceof e.scope.PointText) (item as any).fontFamily = v })
  e.scope.view.update()
  if (store.hasSelection) e.pushHistory('Change Font')
}
function onFontSize(v: number | undefined) {
  if (!v) return
  store.updateCharStyle({ fontSize: v })
  const e = getEngine()
  if (!e) return
  e.getSelection().forEach((item: paper.Item) => { if (item instanceof e.scope.PointText) (item as any).fontSize = v })
  e.scope.view.update()
  if (store.hasSelection) e.pushHistory('Change Font Size')
}
function toggleBold() {
  const next = !isBold.value
  isBold.value = next
  store.updateCharStyle({ fontWeight: next ? 'bold' : 'normal' })
}
function toggleItalic() {
  const next = !isItalic.value
  isItalic.value = next
  store.updateCharStyle({ fontStyle: next ? 'italic' : 'normal' })
}
function onPathOffset(v: number | undefined) {
  if (v === undefined) return
  ;(store as any).setTextPathOffset?.(v)
}
function onPolygonSides(v: number | undefined) { if (v !== undefined) (store as any).setPolygonSides?.(v) }
function toggleStar() {
  polygonStar.value = !polygonStar.value
  ;(store as any).setPolygonStar?.(polygonStar.value)
}
function onStarRatio(v: number | undefined) { if (v !== undefined) (store as any).setStarRatio?.(v) }
function onSpiralTurns(v: number | undefined) { if (v !== undefined) (store as any).setSpiralTurns?.(v) }
function onRoundedRadius(v: number | undefined) { if (v !== undefined) (store as any).setRoundedRadius?.(v) }
function onGridRows(v: number | undefined) { if (v !== undefined) (store as any).setGridOptions?.(v, gridCols.value) }
function onGridCols(v: number | undefined) { if (v !== undefined) (store as any).setGridOptions?.(gridRows.value, v) }
function onStrokeWidth(v: number | undefined) {
  if (!v) return
  store.updateStyle({ strokeWidth: v })
  const e = getEngine()
  if (!e) return
  e.getSelection().forEach((item: any) => { if (item.strokeWidth !== undefined) item.strokeWidth = v })
  e.scope.view.update()
}
function onOpacity(v: number | undefined) {
  if (v === undefined) return
  const o = Math.min(100, Math.max(0, v)) / 100
  store.updateStyle({ opacity: o })
}
function onBrushSize(v: number | undefined) {
  if (v === undefined) return
  ;(store as any).setBrushSize?.(v)
  brushSize.value = Number((store as any).brushSize ?? 20)
  const e = getEngine()
  const ctrl = e?.getController(store.tool) as { refreshCursor?: () => void } | null
  try {
    ctrl?.refreshCursor?.()
  } catch { /* cursor repaint must never break panel edits */ }
}
function onBrushAngle(v: number | undefined) {
  if (v === undefined) return
  ;(store as any).setBrushAngle?.(v)
  brushAngle.value = Number((store as any).brushAngle ?? 45)
}
function onWandTolerance(v: number | undefined) {
  if (v === undefined) return
  ;(store as any).setWandTolerance?.(v)
  wandTolerance.value = Number((store as any).wandTolerance ?? 0)
}
function onPencilSmooth(v: number | undefined) {
  if (v === undefined) return
  ;(store as any).setPencilSmooth?.(v)
  pencilSmooth.value = Number((store as any).pencilSmooth ?? 2.5)
}
function applyGradientEdit(label: string) {
  const e = getEngine()
  if (!e) return
  const current = store.style.gradient
  const stops = current && current.stops.length > 0
    ? current.stops.map((s) => ({ ...s }))
    : [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffffff' }]
  const angle = ((Number(gradientAngle.value) || 0) % 360 + 360) % 360
  gradientAngle.value = angle
  store.updateStyle({ gradient: { type: gradientType.value, stops, angle } })
  e.getSelection().forEach((item: any) => {
    e.applyStyleToItem(item, e.store.style)
  })
  e.scope.view.update()
  if (store.hasSelection) e.pushHistory(label)
  else store.setStatusMessage('Gradient default updated')
}
function onGradientAngle() { applyGradientEdit('Change Gradient') }
function onGradientType() { applyGradientEdit('Change Gradient') }
function onCalloutStyle() {
  store.updateCalloutStyle({
    color: calloutColor.value,
    lineWidth: Number(calloutWidth.value) || 1.5,
    fillColor: calloutFill.value,
    textColor: calloutText.value,
    fontSize: Number(calloutSize.value) || 12,
  })
}
function onRotateBy(v: number | undefined) {
  const e = getEngine()
  if (!e || !v) { rotateBy.value = 0; return }
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) { rotateBy.value = 0; return }
  e.rotateSelection(v, pivot)
  e.pushHistory('Rotate')
  e.stampSelectionFrame()
  e.syncSelectionToStore()
  rotateBy.value = 0
}
function onScalePct(v: number | undefined) {
  const e = getEngine()
  if (!e || !v) { scalePct.value = 100; return }
  const f = v / 100
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) { scalePct.value = 100; return }
  e.scaleSelection(f, f, pivot)
  e.pushHistory('Scale')
  // scaleSelection has no frame counterpart — stamping would keep the
  // pre-scale frame; drop it so the next paint rebuilds from live bounds.
  e.dropSelectionFrame()
  e.syncSelectionToStore()
  scalePct.value = 100
}
function flip(dir: 'horizontal' | 'vertical') {
  const e = getEngine()
  if (!e) return
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) return
  e.flipSelection(dir, pivot)
  e.pushHistory(dir === 'horizontal' ? 'Flip Horizontal' : 'Flip Vertical')
  e.stampSelectionFrame()
  e.syncSelectionToStore()
}
</script>

<style scoped>
.control-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  padding: 3px 10px;
  background: #232323;
  border-bottom: 1px solid #161616;
  color: #ccc;
  font-size: 12px;
  overflow-x: auto;
  flex-shrink: 0;
}
.cb-tool { font-weight: 700; color: #fff; white-space: nowrap; }
.cb-hint { color: #8a8a8a; font-size: 11px; white-space: nowrap; }
.cb-sep { width: 1px; align-self: stretch; background: #3a3a3a; margin: 2px 4px; flex-shrink: 0; }
.cb-group { display: flex; gap: 2px; }
.cb-label { color: #9a9a9a; font-size: 11px; white-space: nowrap; }
.cb-btn { flex-shrink: 0; }
.cb-ctl { flex-shrink: 0; }
.cb-spacer { flex: 1; }
.control-bar :deep(.el-button--small) {
  background: #333; border: 1px solid #4a4a4a; color: #d5d5d5;
  border-radius: 3px; height: 24px; padding: 0 8px; font-size: 11px;
}
.control-bar :deep(.el-button--small.el-button--primary) { background: #2f6fbf; border-color: #2f6fbf; color: #fff; }
.control-bar::-webkit-scrollbar { height: 4px; }
.control-bar::-webkit-scrollbar-thumb { background: #4a4a4a; border-radius: 2px; }
</style>
