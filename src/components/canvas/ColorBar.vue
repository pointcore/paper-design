<template>
  <div class="color-bar" title="Click = apply to target · target toggles with F/X">
    <div class="fillstroke">
      <div class="fs-chip fs-stroke" :style="{ borderColor: '#555', background: strokePreview }" title="Stroke (Alt-click palette applies here)">
        <span>S</span>
      </div>
      <div class="fs-chip fs-fill" :style="{ background: fillPreview }" title="Fill (click palette applies here)">
        <span>F</span>
      </div>
      <el-button size="small" class="swap-btn" title="Swap fill and stroke" @click="swap">⇄</el-button>
    </div>
    <div class="target-toggle">
      <el-button size="small" :type="target === 'fill' ? 'primary' : ''" @click="target = 'fill'">Fill</el-button>
      <el-button size="small" :type="target === 'stroke' ? 'primary' : ''" @click="target = 'stroke'">Stroke</el-button>
    </div>
    <div class="palette">
      <div v-for="c in palette" :key="c" class="chip" :style="{ background: c }" :title="c + (target === 'fill' ? ' (fill)' : ' (stroke)')" @click="apply(c, false)" @contextmenu.prevent="apply(c, true)" />
      <div class="chip chip-none" title="None" @click="clear()">×</div>
    </div>
    <div class="recent">
      <div v-for="c in store.recentColors.slice(0, 8)" :key="'r' + c" class="chip chip-sm" :style="{ background: c }" :title="c" @click="apply(c, false)" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, type Ref, onMounted, onUnmounted } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')
const getEngine = () => engineRef?.value ?? null

const target = ref<'fill' | 'stroke'>('fill')
const palette = [
  '#000000', '#ffffff', '#ff0000', '#ff8000', '#ffff00', '#80ff00',
  '#00ff00', '#00ffff', '#0080ff', '#0000ff', '#8000ff', '#ff00ff',
  '#808080', '#c0c0c0', '#804000', '#4a90d9',
]

const fillPreview = computed(() => store.style.gradient ? 'linear-gradient(135deg,#000,#fff)' : (store.style.fillColor ?? 'repeating-conic-gradient(#c9c9c9 0% 25%, #fff 0% 50%) 0 0 / 8px 8px'))
const strokePreview = computed(() => store.style.strokeColor ?? 'repeating-conic-gradient(#c9c9c9 0% 25%, #fff 0% 50%) 0 0 / 8px 8px')

function apply(color: string, asStroke: boolean) {
  const toStroke = asStroke || target.value === 'stroke'
  const engine = getEngine()
  store.pushRecentColor(color)
  if (!engine) {
    if (toStroke) store.updateStyle({ strokeColor: color })
    else store.updateStyle({ fillColor: color, gradient: null })
    return
  }
  if (toStroke) {
    store.updateStyle({ strokeColor: color })
    engine.getSelection().forEach((item: any) => { if (item.strokeColor !== undefined) item.strokeColor = color })
    if (store.hasSelection) engine.pushHistory('Change Stroke')
  } else {
    store.updateStyle({ fillColor: color, gradient: null })
    engine.getSelection().forEach((item: any) => { if (item.fillColor !== undefined) item.fillColor = color })
    if (store.hasSelection) engine.pushHistory('Change Fill')
  }
  engine.scope.view.update()
}

function clear() {
  const engine = getEngine()
  if (target.value === 'stroke') {
    store.updateStyle({ strokeColor: null })
    engine?.getSelection().forEach((item: any) => { item.strokeColor = null })
    if (store.hasSelection) engine?.pushHistory('Clear Stroke')
  } else {
    store.updateStyle({ fillColor: null })
    engine?.getSelection().forEach((item: any) => { item.fillColor = null })
    if (store.hasSelection) engine?.pushHistory('Clear Fill')
  }
  engine?.scope.view.update()
}

function swap() {
  const f = store.style.fillColor
  const s = store.style.strokeColor
  store.updateStyle({ fillColor: s, strokeColor: f })
  const engine = getEngine()
  engine?.getSelection().forEach((item: any) => {
    const pf = item.fillColor
    item.fillColor = item.strokeColor ?? null
    if (item.strokeColor !== undefined) item.strokeColor = pf ?? null
  })
  engine?.scope.view.update()
  if (store.hasSelection) engine?.pushHistory('Swap Fill Stroke')
}

function onKey(e: KeyboardEvent) {
  const el = e.target as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.key.toLowerCase() === 'x') {
    target.value = target.value === 'fill' ? 'stroke' : 'fill'
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<style scoped>
.color-bar {
  display: flex; align-items: center; gap: 8px;
  min-height: 30px; padding: 3px 10px;
  background: #232323; border-top: 1px solid #161616;
  flex-shrink: 0; overflow-x: auto;
}
.fillstroke { display: flex; align-items: center; gap: 0; }
.fs-chip {
  width: 22px; height: 22px; border-radius: 3px; border: 1px solid #000;
  display: flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: #fff; text-shadow: 0 1px 2px #000;
}
.fs-stroke { margin-right: -6px; margin-bottom: -6px; z-index: 0; font-size: 9px; }
.fs-fill { z-index: 1; }
.swap-btn { margin-left: 8px; }
.target-toggle { display: flex; gap: 2px; }
.palette { display: flex; gap: 3px; align-items: center; }
.recent { display: flex; gap: 3px; align-items: center; border-left: 1px solid #3a3a3a; padding-left: 8px; }
.chip { width: 18px; height: 18px; border-radius: 2px; border: 1px solid #000; cursor: pointer; flex-shrink: 0; }
.chip-sm { width: 14px; height: 14px; }
.chip:hover { outline: 1px solid #fff; }
.chip-none { display: flex; align-items: center; justify-content: center; background: #fff; color: #c00; font-weight: 700; font-size: 12px; }
.color-bar :deep(.el-button--small) { background: #333; border: 1px solid #4a4a4a; color: #d5d5d5; height: 22px; padding: 0 8px; font-size: 11px; }
.color-bar :deep(.el-button--small.el-button--primary) { background: #2f6fbf; border-color: #2f6fbf; color: #fff; }
.color-bar::-webkit-scrollbar { height: 4px; }
.color-bar::-webkit-scrollbar-thumb { background: #4a4a4a; border-radius: 2px; }
</style>
