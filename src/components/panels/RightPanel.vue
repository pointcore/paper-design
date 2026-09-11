<template>
  <div class="right-panel" :style="panelStyle">
    <div
      class="rp-resizer"
      title="Drag to resize · double-click to reset"
      @pointerdown="onResizeStart"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
      @pointercancel="onResizeEnd"
      @dblclick="resetWidth"
    ></div>
    <div class="rp-tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="rp-tab"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.label }}
      </button>
    </div>
    <div class="rp-body">
      <div v-show="activeTab === 'property'" class="rp-pane">
        <PropertyPanel />
      </div>
      <div v-show="activeTab === 'align'" class="rp-pane">
        <AlignPanel />
      </div>
      <div v-show="activeTab === 'layer'" class="rp-pane rp-pane-layer">
        <LayerPanel />
      </div>
      <div v-show="activeTab === 'artboards'" class="rp-pane">
        <ArtboardPanel />
      </div>
      <div v-show="activeTab === 'swatches'" class="rp-pane">
        <SwatchesPanel />
      </div>
      <div v-show="activeTab === 'symbols'" class="rp-pane">
        <SymbolsPanel />
      </div>
      <div v-show="activeTab === 'history'" class="rp-pane">
        <HistoryPanel />
      </div>
      <div v-show="activeTab === 'actions'" class="rp-pane">
        <ActionsPanel />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { RightPanelTab } from '../../editor/types'
import PropertyPanel from './PropertyPanel.vue'
import AlignPanel from './AlignPanel.vue'
import LayerPanel from './LayerPanel.vue'
import ArtboardPanel from './ArtboardPanel.vue'
import SwatchesPanel from './SwatchesPanel.vue'
import HistoryPanel from './HistoryPanel.vue'
import SymbolsPanel from './SymbolsPanel.vue'
import ActionsPanel from './ActionsPanel.vue'

const store = useEditorStore()

// Draggable panel width (persisted with the other dock prefs). Dragging
// computes from the window's right edge, which is where the panel sits.
const DEFAULT_PANEL_WIDTH = 264
const panelStyle = computed(() => {
  const w = `${store.ui.panelWidth}px`
  return { width: w, minWidth: w, maxWidth: w }
})
const resizerRef = ref<HTMLElement | null>(null)
let resizing = false

function onResizeStart(e: PointerEvent) {
  if (e.button !== 0) return
  resizing = true
  // Capture so fast drags that leave the strip keep delivering moves here.
  resizerRef.value?.setPointerCapture?.(e.pointerId)
  e.preventDefault()
}
function onResizeMove(e: PointerEvent) {
  if (!resizing) return
  store.setPanelWidth(window.innerWidth - e.clientX)
}
function onResizeEnd(e: PointerEvent) {
  if (!resizing) return
  resizing = false
  resizerRef.value?.releasePointerCapture?.(e.pointerId)
  persistPanelWidth()
}
function resetWidth() {
  store.setPanelWidth(DEFAULT_PANEL_WIDTH)
  persistPanelWidth()
}

function persistPanelWidth() {
  try {
    let prefs: Record<string, unknown> = {}
    const raw = localStorage.getItem('vve.ui')
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        prefs = parsed as Record<string, unknown>
      }
    }
    prefs.panelWidth = store.ui.panelWidth
    localStorage.setItem('vve.ui', JSON.stringify(prefs))
  } catch { /* private mode: session-only width */ }
}

const tabs = [
  { key: 'property', label: 'Props' },
  { key: 'align', label: 'Align' },
  { key: 'layer', label: 'Layers' },
  { key: 'artboards', label: 'Boards' },
  { key: 'swatches', label: 'Swatch' },
  { key: 'symbols', label: 'Symbol' },
  { key: 'history', label: 'Hist' },
  { key: 'actions', label: 'Action' },
] as const

// Shared tab state so other panels (e.g. "Edit Artboards") can jump here.
const activeTab = computed<RightPanelTab>({
  get: () => store.ui.rightTab,
  set: (v) => store.setRightTab(v),
})

// Auto-switch to Properties on new selection, matching AI behavior
// (only when going from empty to non-empty to avoid interrupting layer work)
watch(
  () => store.selectedItemIds.length,
  (n, prev) => {
    if (n > 0 && (prev ?? 0) === 0) store.setRightTab('property')
  },
)
</script>

<style scoped>
.right-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 264px;
  min-width: 264px;
  max-width: 264px;
  height: 100%;
  background: #252526;
  border-left: 1px solid #161616;
  flex-shrink: 0;
  overflow: hidden;
}

.rp-resizer {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 5px;
  cursor: col-resize;
  z-index: 20;
  touch-action: none;
}
.rp-resizer:hover {
  background: rgba(74, 144, 217, 0.35);
}

.rp-tabs {
  display: flex;
  height: 36px;
  flex-shrink: 0;
  background: #1e1e1e;
  border-bottom: 1px solid #161616;
  overflow-x: auto;
  scrollbar-width: none;
}
.rp-tabs::-webkit-scrollbar { display: none; }

.rp-tab {
  flex: 1 0 auto;
  min-width: 52px;
  padding: 0 6px;
  background: transparent;
  border: none;
  outline: none;
  cursor: pointer;
  color: #9a9a9a;
  font-size: 12px;
  letter-spacing: 0.5px;
  position: relative;
  height: 100%;
  transition: color 0.12s;
}

.rp-tab:hover {
  color: #d5d5d5;
}

.rp-tab.active {
  color: #fff;
  font-weight: 500;
}

.rp-tab.active::after {
  content: '';
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 0;
  height: 2px;
  background: #4a90d9;
  border-radius: 1px;
}

.rp-body {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.rp-pane {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  display: flex;
  flex-direction: column;
}

.rp-pane::-webkit-scrollbar {
  width: 8px;
}
.rp-pane::-webkit-scrollbar-thumb {
  background: #4a4a4a;
  border-radius: 4px;
  border: 2px solid #252526;
}
.rp-pane::-webkit-scrollbar-track {
  background: transparent;
}

.rp-pane-layer {
  overflow-y: auto;
}

.rp-artboard-wrap {
  border-top: 1px solid #161616;
}
</style>
