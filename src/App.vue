<template>
  <div class="editor-root">
    <TopBar />
    
    <div class="editor-main">
      <ToolRail />
      
      <div class="canvas-area">
        <CanvasHost />
        <div class="status-bar">
          <div class="status-left">
            <span class="status-item">{{ cursorReadout }}</span>
          </div>
          <div class="status-right">
            <span class="status-item">{{ currentToolName }}</span>
            <span v-if="store.statusMessage" class="status-item status-msg">{{ store.statusMessage }}</span>
            <span class="status-item zoom-display" :title="'Wheel to zoom / click resets to 100%'" @click="resetZoom">{{ zoomPercent }}</span>
          </div>
        </div>
      </div>

      <RightPanel v-if="store.ui.showPropertyPanel || store.ui.showLayerPanel" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, provide } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from './editor/store'
import { rulerUnitFactor } from './editor/geometry'
import type { EditorEngine } from './editor/engine'
import TopBar from './components/menus/TopBar.vue'
import ToolRail from './components/toolbar/ToolRail.vue'
import CanvasHost from './components/canvas/CanvasHost.vue'
import RightPanel from './components/panels/RightPanel.vue'

const store = useEditorStore()
const { tool } = storeToRefs(store)

const engineRef = ref<EditorEngine | null>(null)
provide('engine', engineRef)

const zoomPercent = computed(() => `${Math.round(store.view.zoom * 100)}%`)

/** Cursor readout in the current ruler unit (geometry stays in px). */
const cursorReadout = computed(() => {
  const factor = rulerUnitFactor(store.rulerUnit)
  const x = Math.round(store.cursorPos.x * factor * 10) / 10
  const y = Math.round(store.cursorPos.y * factor * 10) / 10
  return `${x}, ${y} ${store.rulerUnit}`
})

/** Reset the view zoom back to 100%. */
function resetZoom() {
  const e = engineRef.value
  if (!e) return
  e.zoomAt(1 / (e.scope.view.zoom || 1))
}

const currentToolName = computed(() => {
  const names: Record<string, string> = {
    select: 'Select',
    'direct-select': 'Direct Select',
    pen: 'Pen',
    curvature: 'Curvature',
    'add-anchor': 'Add Anchor',
    'delete-anchor': 'Delete Anchor',
    'convert-anchor': 'Convert Anchor',
    type: 'Text',
    'area-type': 'Area Text',
    'type-on-path': 'Type on Path',
    'vertical-type': 'Vertical Text',
    line: 'Line',
    rect: 'Rectangle',
    'rounded-rect': 'Rounded Rectangle',
    ellipse: 'Ellipse',
    polygon: 'Polygon',
    spiral: 'Spiral',
    pencil: 'Pencil',
    'blob-brush': 'Blob Brush',
    brush: 'Brush',
    eraser: 'Eraser',
    eyedropper: 'Eyedropper',
    scissors: 'Scissors',
    'shape-builder': 'Shape Builder',
    width: 'Width',
    callout: 'Callout',
    measure: 'Measure',
    zoom: 'Zoom',
    'view-hand': 'Hand',
  }
  return names[tool.value] || tool.value
})
</script>

<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #app { height: 100%; width: 100%; overflow: hidden; }

.editor-root {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  background: #1e1e1e;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  user-select: none;
}

.editor-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.canvas-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  background: #2d2d2d;
  overflow: hidden;
}

.status-bar {
  height: 28px;
  background: #2b2b2b;
  color: #ccc;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  border-top: 1px solid #3a3a3a;
  flex-shrink: 0;
}

.status-left, .status-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.status-item {
  white-space: nowrap;
}

.status-msg {
  color: #8db4e3;
}

.zoom-display {
  cursor: pointer;
  user-select: none;
}
.zoom-display:hover {
  color: #fff;
}
</style>
