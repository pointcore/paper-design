<template>
  <div class="editor-root">
    <TopBar />
    
    <div class="editor-main">
      <ToolRail />
      
      <div class="canvas-area">
        <CanvasHost />
        <div class="status-bar">
          <div class="status-left">
            <span class="status-item">{{ store.cursorPos.x }}, {{ store.cursorPos.y }}</span>
            <span class="status-item">{{ zoomPercent }}</span>
          </div>
          <div class="status-right">
            <span class="status-item">{{ currentToolName }}</span>
            <span v-if="store.statusMessage" class="status-item status-msg">{{ store.statusMessage }}</span>
          </div>
        </div>
      </div>

      <div v-if="store.ui.showPropertyPanel || store.ui.showLayerPanel" class="right-panels">
        <PropertyPanel v-if="store.hasSelection && store.ui.showPropertyPanel" />
        <LayerPanel v-if="store.ui.showLayerPanel" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, provide } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from './editor/store'
import type { EditorEngine } from './editor/engine'
import TopBar from './components/menus/TopBar.vue'
import ToolRail from './components/toolbar/ToolRail.vue'
import CanvasHost from './components/canvas/CanvasHost.vue'
import PropertyPanel from './components/panels/PropertyPanel.vue'
import LayerPanel from './components/panels/LayerPanel.vue'

const store = useEditorStore()
const { tool } = storeToRefs(store)

const engineRef = ref<EditorEngine | null>(null)
provide('engine', engineRef)

const zoomPercent = computed(() => `${Math.round(store.view.zoom * 100)}%`)

const currentToolName = computed(() => {
  const names: Record<string, string> = {
    select: 'Select',
    'direct-select': 'Direct Select',
    pen: 'Pen',
    type: 'Text',
    rect: 'Rectangle',
    callout: 'Callout',
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

.right-panels {
  display: flex;
  flex-direction: column;
  width: 240px;
  min-width: 240px;
  background: #2b2b2b;
  border-left: 1px solid #3a3a3a;
  overflow-y: auto;
  flex-shrink: 0;
}

.right-panels::-webkit-scrollbar {
  width: 6px;
}
.right-panels::-webkit-scrollbar-track {
  background: transparent;
}
.right-panels::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 3px;
}
</style>
