<template>
  <div class="swatches-panel ai-panel">
    <div class="panel-section">
      <div class="sec-title">Swatches <span class="sec-hint">click = fill · Alt-click = stroke</span></div>
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
    <div class="hint">Fill/stroke apply live to the selection and to subsequently drawn shapes.</div>
  </div>
</template>

<script setup lang="ts">
import { inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')
const getEngine = () => engineRef?.value ?? null

const presets = [
  '#000000', '#ffffff', '#ff0000', '#ff8000', '#ffff00', '#80ff00',
  '#00ff00', '#00ff80', '#00ffff', '#0080ff', '#0000ff', '#8000ff',
  '#ff00ff', '#ff0080', '#808080', '#c0c0c0', '#804000', '#008040',
  '#004080', '#400080', '#4a90d9', '#2f6fbf',
]

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
</script>

<style scoped>
.ai-panel { background: #252526; color: #c9c9c9; font-size: 12px; display: flex; flex-direction: column; min-height: 100%; padding: 8px; gap: 10px; }
.panel-section { border-bottom: 1px solid #1e1e1e; padding-bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
.sec-title { font-size: 11px; color: #dcdcdc; font-weight: 600; letter-spacing: 0.5px; }
.sec-hint { color: #8a8a8a; font-weight: 400; }
.sw-grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
.sw { aspect-ratio: 1; border-radius: 3px; border: 1px solid #000; cursor: pointer; min-height: 20px; }
.sw:hover { outline: 1px solid #fff; }
.sw-none { display: flex; align-items: center; justify-content: center; background: #fff; color: #c00; font-weight: 700; }
.hint { font-size: 11px; color: #8a8a8a; line-height: 1.5; }
</style>
