<template>
  <div class="canvas-host" ref="containerRef">
    <canvas ref="canvasRef" @contextmenu.prevent="onContextMenu"></canvas>
    
    <div v-if="store.view.rulersVisible" class="ruler ruler-h"></div>
    <div v-if="store.view.rulersVisible" class="ruler ruler-v"></div>
    
    <div v-if="contextMenu.visible" class="context-menu"
         :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
         @click.stop>
      <div class="menu-item" @click="ctxCopy">Copy</div>
      <div class="menu-item" @click="ctxDelete">Delete</div>
      <div class="menu-divider"></div>
      <div class="menu-item" @click="ctxBringToFront">Bring to Front</div>
      <div class="menu-item" @click="ctxSendToBack">Send to Back</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import { EditorEngine } from '../../editor/engine'
import { registerAllControllers } from '../../editor/register-controllers'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')
const containerRef = ref<HTMLDivElement>()
const canvasRef = ref<HTMLCanvasElement>()
const contextMenu = ref({ visible: false, x: 0, y: 0 })

let engine: EditorEngine | null = null

onMounted(() => {
  if (!canvasRef.value || !containerRef.value) return

  const rect = containerRef.value.getBoundingClientRect()
  canvasRef.value.width = rect.width
  canvasRef.value.height = rect.height

  engine = new EditorEngine(canvasRef.value, store)
  
  // Store the engine in the shared ref (provided by App.vue)
  if (engineRef) {
    engineRef.value = engine
  }

  registerAllControllers(engine)

  // Initially activate the select tool
  engine.setTool('select')

  window.addEventListener('resize', onResize)
  document.addEventListener('click', onDocumentClick)
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  document.removeEventListener('click', onDocumentClick)
  if (engine) {
    engine.destroy()
    engine = null
  }
})

function onResize() {
  if (!canvasRef.value || !containerRef.value || !engine) return
  const rect = containerRef.value.getBoundingClientRect()
  canvasRef.value.width = rect.width
  canvasRef.value.height = rect.height
  engine.scope.view.update()
}

function onDocumentClick() {
  contextMenu.value.visible = false
}

function onContextMenu(e: MouseEvent) {
  contextMenu.value = { visible: true, x: e.clientX, y: e.clientY }
}

function ctxCopy() {
  engine?.copySelected()
  hideMenu()
}

function ctxDelete() {
  engine?.deleteSelected()
  hideMenu()
}

function ctxBringToFront() {
  if (engine) {
    engine.getSelection().forEach((i) => i.bringToFront())
    engine.scope.view.update()
    engine.pushHistory('Bring to Front')
  }
  hideMenu()
}

function ctxSendToBack() {
  if (engine) {
    engine.getSelection().forEach((i) => i.sendToBack())
    engine.scope.view.update()
    engine.pushHistory('Send to Back')
  }
  hideMenu()
}

function hideMenu() {
  contextMenu.value.visible = false
}
</script>

<style scoped>
.canvas-host {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #1e1e1e;
}

canvas {
  position: absolute;
  top: 0;
  left: 0;
  cursor: crosshair;
  display: block;
}

.ruler {
  position: absolute;
  background: #2b2b2b;
  z-index: 10;
}

.ruler-h {
  top: 0;
  left: 20px;
  right: 0;
  height: 20px;
  border-bottom: 1px solid #3a3a3a;
}

.ruler-v {
  left: 0;
  top: 20px;
  bottom: 0;
  width: 20px;
  border-right: 1px solid #3a3a3a;
}

.context-menu {
  position: fixed;
  z-index: 1000;
  background: #3c3c3c;
  border: 1px solid #555;
  border-radius: 4px;
  padding: 4px;
  min-width: 160px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
}

.menu-item {
  padding: 6px 12px;
  color: #ddd;
  font-size: 13px;
  cursor: pointer;
  border-radius: 2px;
}

.menu-item:hover {
  background: #4a90d9;
  color: #fff;
}

.menu-divider {
  height: 1px;
  background: #555;
  margin: 4px 0;
}
</style>
