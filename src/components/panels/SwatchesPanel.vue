<template>
  <div class="swatches-panel ai-panel">
    <div class="panel-section">
      <div class="sec-title">Swatches <span class="sec-hint">click = fill · Alt-click = stroke</span></div>
      <el-select v-model="library" size="small" class="lib-select">
        <el-option v-for="l in libraries" :key="l.name" :label="l.name" :value="l.name" />
      </el-select>
      <div class="sw-grid">
        <div v-for="c in presets" :key="c" class="sw" :style="{ background: c }" :title="c" @click="apply(c, $event)" />
        <div class="sw sw-none" title="No fill" @click="clearFill">×</div>
      </div>
    </div>
    <div class="panel-section">
      <div class="sec-title">Recent</div>
      <div class="sw-grid">
        <div v-if="store.recentColors.length === 0" class="hint">Paint something to build recents.</div>
        <div v-for="c in store.recentColors" :key="c" class="sw" :style="{ background: c }" :title="c" @click="apply(c, $event)" />
      </div>
    </div>
    <div class="panel-section">
      <div class="sec-title">Styles <span class="sec-hint">single-appearance presets</span></div>
      <div class="row">
        <el-input v-model="styleName" size="small" placeholder="Preset name" @keyup.enter="saveStyle" />
        <el-button size="small" @click="saveStyle">Save</el-button>
      </div>
      <div v-if="store.stylePresets.length === 0" class="hint">Save the current appearance, then click a preset to apply it.</div>
      <div v-for="p in store.stylePresets" :key="p.id" class="style-row" :title="`Apply ${p.name}`" @click="applyStyle(p.id)">
        <span class="style-chip" :style="{ background: styleChip(p.style) }"></span>
        <span class="style-name">{{ p.name }}</span>
        <el-button size="small" type="danger" plain @click.stop="removeStyle(p.id)">×</el-button>
      </div>
    </div>
    <div class="hint">Fill/stroke apply live to the selection and to subsequently drawn shapes.</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch, inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { StyleState } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')
const getEngine = () => engineRef?.value ?? null

const libraries = [
  { name: 'Default', colors: [
    '#000000', '#ffffff', '#ff0000', '#ff8000', '#ffff00', '#80ff00',
    '#00ff00', '#00ff80', '#00ffff', '#0080ff', '#0000ff', '#8000ff',
    '#ff00ff', '#ff0080', '#808080', '#c0c0c0', '#804000', '#008040',
    '#004080', '#400080', '#4a90d9', '#2f6fbf',
  ] },
  { name: 'Flat UI', colors: [
    '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#34495e', '#16a085',
    '#27ae60', '#2980b9', '#8e44ad', '#2c3e50', '#f1c40f', '#e67e22',
    '#e74c3c', '#ecf0f1', '#95a5a6', '#f39c12', '#d35400', '#c0392b',
    '#bdc3c7', '#7f8c8d', '#ffffff', '#000000',
  ] },
  { name: 'Material', colors: [
    '#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3',
    '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39',
    '#ffeb3b', '#ffc107', '#ff9800', '#ff5722', '#795548', '#9e9e9e',
    '#607d8b', '#000000', '#ffffff', '#eeeeee',
  ] },
  { name: 'Grays', colors: [
    '#000000', '#111111', '#222222', '#333333', '#444444', '#555555',
    '#666666', '#777777', '#888888', '#999999', '#aaaaaa', '#bbbbbb',
    '#cccccc', '#dddddd', '#eeeeee', '#f5f5f5', '#ffffff', '#4a90d9',
  ] },
]
const library = ref('Default')
const presets = computed(() => libraries.find((l) => l.name === library.value)?.colors ?? libraries[0].colors)

function apply(color: string, e: MouseEvent) {
  const engine = getEngine()
  store.pushRecentColor(color)
  if (!engine) {
    if (e.altKey) store.updateStyle({ strokeColor: color })
    else store.updateStyle({ fillColor: color, gradient: null })
    return
  }
  if (e.altKey) {
    store.updateStyle({ strokeColor: color })
    engine.getSelection().forEach((item: any) => { if (item.strokeColor !== undefined) item.strokeColor = color })
    engine.scope.view.update()
    if (store.hasSelection) engine.pushHistory('Change Stroke')
    else store.setStatusMessage(`Stroke default ${color} (Alt-click a swatch for stroke)`)
  } else {
    store.updateStyle({ fillColor: color, gradient: null })
    engine.getSelection().forEach((item: any) => { if (item.fillColor !== undefined) item.fillColor = color })
    engine.scope.view.update()
    if (store.hasSelection) engine.pushHistory('Change Fill')
  }
}

function clearFill() {
  const engine = getEngine()
  store.updateStyle({ fillColor: null })
  engine?.getSelection().forEach((item: any) => { item.fillColor = null })
  engine?.scope.view.update()
  if (store.hasSelection) engine?.pushHistory('Clear Fill')
}

const styleName = ref('')

function styleChip(style: StyleState): string {
  if (style.gradient) return 'linear-gradient(135deg,#000,#fff)'
  return style.fillColor ?? 'repeating-conic-gradient(#c9c9c9 0% 25%, #fff 0% 50%) 0 0 / 8px 8px'
}

function saveStyle() {
  store.addStylePreset(styleName.value, store.style)
  styleName.value = ''
  persistStyles()
  store.setStatusMessage('Style preset saved')
}

function applyStyle(id: string) {
  const preset = store.stylePresets.find((p) => p.id === id)
  if (!preset) return
  const snapshot = JSON.parse(JSON.stringify(preset.style)) as StyleState
  store.updateStyle({ ...snapshot })
  const engine = getEngine()
  if (!engine) return
  engine.getSelection().forEach((item: any) => {
    engine.applyStyleToItem(item, engine.store.style)
  })
  engine.scope.view.update()
  if (store.hasSelection) {
    engine.pushHistory('Apply Style')
  } else {
    store.setStatusMessage(`Style default "${preset.name}"`)
  }
}

function removeStyle(id: string) {
  store.removeStylePreset(id)
  persistStyles()
}

function persistStyles() {
  try {
    localStorage.setItem('vve.styles', JSON.stringify(store.stylePresets))
  } catch { /* private mode */ }
}

onMounted(() => {
  try {
    const raw = localStorage.getItem('vve.styles')
    if (!raw) return
    const list = JSON.parse(raw) as Array<{ id?: unknown; name?: unknown; style?: unknown }>
    if (!Array.isArray(list)) return
    const clean = list
      .filter((p) => p && typeof p === 'object' && typeof (p.style as any) === 'object' && (p.style as any) !== null)
      .slice(0, 24)
      .map((p, i) => ({
        id: typeof p.id === 'string' && p.id ? p.id : `style-restored-${i}`,
        name: typeof p.name === 'string' && p.name ? (p.name as string).slice(0, 40) : `Style ${i + 1}`,
        style: (p.style as StyleState),
      }))
    store.setStylePresets(clean)
  } catch { /* corrupt storage: defaults stand */ }
})

watch(
  () => store.stylePresets.length,
  () => persistStyles()
)
</script>

<style scoped>
.ai-panel { background: #252526; color: #c9c9c9; font-size: 12px; display: flex; flex-direction: column; min-height: 100%; padding: 8px; gap: 10px; }
.panel-section { border-bottom: 1px solid #1e1e1e; padding-bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
.sec-title { font-size: 11px; color: #dcdcdc; font-weight: 600; letter-spacing: 0.5px; }
.sec-hint { color: #8a8a8a; font-weight: 400; }
.lib-select { width: 100%; }
.sw-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
.sw { aspect-ratio: 1; border-radius: 3px; border: 1px solid #000; cursor: pointer; min-height: 20px; }
.sw:hover { outline: 1px solid #fff; }
.sw-none { display: flex; align-items: center; justify-content: center; background: #fff; color: #c00; font-weight: 700; }
.hint { font-size: 11px; color: #8a8a8a; line-height: 1.5; }
.row { display: flex; gap: 4px; }
.row :deep(.el-input) { flex: 1; min-width: 0; }
.style-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 6px; border-radius: 3px; cursor: pointer;
}
.style-row:hover { background: #333; }
.style-chip {
  width: 22px; height: 22px; border-radius: 3px; border: 1px solid #000; flex-shrink: 0;
}
.style-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-panel :deep(.el-button--small) { background: #333; border: 1px solid #4a4a4a; color: #d5d5d5; border-radius: 3px; height: 24px; font-size: 11px; }
.ai-panel :deep(.el-input__wrapper) { background: #111; border: 1px solid #3d3d3d; box-shadow: none !important; border-radius: 3px; }
.ai-panel :deep(.el-input__inner) { color: #e6e6e6; font-size: 12px; }
</style>
