<template>
  <div class="editor-root">
    <TopBar v-if="!store.ui.zenMode" />
    <ControlBar v-if="!store.ui.zenMode" />
    
    <div class="editor-main">
      <ToolRail v-if="!store.ui.zenMode" />
      
      <div class="canvas-area">
        <DocTabs v-if="!store.ui.zenMode" />
        <CanvasHost />
        <ColorBar v-if="!store.ui.zenMode" />
        <el-button v-if="store.ui.zenMode" class="zen-exit" size="small" title="Exit presentation (Tab)" @click="store.setZenMode(false)">Exit ⤢</el-button>
        <div v-if="!store.ui.zenMode" class="status-bar">
          <div class="status-left">
            <span class="status-item status-click" :title="'Ruler unit (click to cycle)'" @click="cycleUnit">{{ cursorReadout }}</span>
            <span v-if="selectionLabel" class="status-item">{{ selectionLabel }}</span>
            <span class="status-item status-click" :title="'Toggle snapping'" @click="toggleSnap">{{ snapLabel }}</span>
            <span v-if="store.keyObjectId" class="status-item status-click" title="Clear key object" @click="clearKey">Key ●</span>
          </div>
          <div class="status-right">
            <span class="status-item status-click" :title="'Artboards (click to cycle)'" @click="cycleBoard">{{ artboardLabel }}</span>
            <span class="status-item status-click" :title="'Proof mode (click to toggle RGB/CMYK)'" @click="toggleProof">{{ proofLabel }}</span>
            <span class="status-item">{{ currentToolName }}</span>
            <span v-if="store.statusMessage" class="status-item status-msg">{{ store.statusMessage }}</span>
            <el-dropdown trigger="click" @command="onZoomCmd">
              <span class="status-item zoom-display" title="Zoom presets · scroll to step" @wheel.prevent="onZoomWheel">{{ zoomPercent }}</span>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item v-for="z in [10, 25, 50, 100, 200, 400, 800]" :key="z" :command="z">{{ z }}%</el-dropdown-item>
                  <el-dropdown-item command="fit" divided>Fit to Window</el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
        </div>
      </div>

      <RightPanel v-if="store.ui.showPropertyPanel || store.ui.showLayerPanel" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, provide, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useEditorStore } from './editor/store'
import { rulerUnitFactor } from './editor/geometry'
import type { EditorEngine } from './editor/engine'
import TopBar from './components/menus/TopBar.vue'
import ControlBar from './components/menus/ControlBar.vue'
import ToolRail from './components/toolbar/ToolRail.vue'
import CanvasHost from './components/canvas/CanvasHost.vue'
import DocTabs from './components/canvas/DocTabs.vue'
import ColorBar from './components/canvas/ColorBar.vue'
import RightPanel from './components/panels/RightPanel.vue'

const store = useEditorStore()
const { tool } = storeToRefs(store)

const engineRef = ref<EditorEngine | null>(null)
provide('engine', engineRef)

// Restore dock prefs saved by the Actions panel (best effort).
onMounted(() => {
  // Warn before losing unsaved work on reload/close (browsers show chrome).
  // Registered even when no prefs exist yet: the early return below used to
  // skip it, so first-time visitors lost the unsaved-changes warning.
  window.addEventListener('beforeunload', onBeforeUnload)
  try {
    const raw = localStorage.getItem('vve.ui')
    if (!raw) return
    const prefs = JSON.parse(raw) as {
      workspace?: string; density?: string; controlBar?: boolean; navigator?: boolean
      panelWidth?: number; panelCollapsed?: boolean
    }
    if (prefs.workspace === 'essentials' || prefs.workspace === 'typography' || prefs.workspace === 'print') {
      store.setWorkspace(prefs.workspace)
    }
    if (prefs.density === 'single' || prefs.density === 'double') {
      store.setToolRailDensity(prefs.density)
    }
    if (typeof prefs.controlBar === 'boolean') store.setShowControlBar(prefs.controlBar)
    if (typeof prefs.navigator === 'boolean') store.setShowNavigator(prefs.navigator)
    if (typeof prefs.panelWidth === 'number') store.setPanelWidth(prefs.panelWidth)
    if (typeof prefs.panelCollapsed === 'boolean') store.setPanelCollapsed(prefs.panelCollapsed)
  } catch { /* private mode: defaults stand */ }
})

function onBeforeUnload(e: BeforeUnloadEvent) {
  if (store.hasUnsavedChanges) e.preventDefault()
}

onUnmounted(() => {
  window.removeEventListener('beforeunload', onBeforeUnload)
})

const zoomPercent = computed(() => `${Math.round(store.view.zoom * 100)}%`)
const snapLabel = computed(() => store.snap.enable ? 'Snap On' : 'Snap Off')
/** Selection readout (AI Info parity): count + united size. */
const selectionLabel = computed(() => {
  const n = store.selectedItemIds.length
  if (n === 0) return ''
  const w = Math.round(store.transform.width * 10) / 10
  const h = Math.round(store.transform.height * 10) / 10
  return `${n} selected · ${w}×${h}`
})
const artboardLabel = computed(() => {
  const boards = store.artboards
  if (boards.length === 0) return 'No boards'
  const idx = boards.findIndex((b) => b.id === store.activeArtboardId)
  return `Board ${(idx < 0 ? 0 : idx) + 1}/${boards.length}`
})
const proofLabel = computed(() => store.view.proofMode === 'cmyk' ? 'CMYK' : 'RGB')
function toggleProof() {
  const next = store.view.proofMode === 'cmyk' ? 'rgb' : 'cmyk'
  store.updateView({ proofMode: next })
}

function toggleSnap() {
  store.updateSnap({ enable: !store.snap.enable })
}
/** Cycle ruler units px → pt → mm → cm → in (geometry stays in px). */
function cycleUnit() {
  const order = ['px', 'pt', 'mm', 'cm', 'in'] as const
  const next = order[(order.indexOf(store.rulerUnit) + 1) % order.length]
  store.setRulerUnit(next)
}
/** Cycle to the next artboard (wraps), like the unit cycler. */
function cycleBoard() {
  const e = engineRef.value
  const boards = store.artboards
  if (!e || boards.length === 0) return
  const idx = boards.findIndex((b) => b.id === store.activeArtboardId)
  const next = boards[(idx + 1) % boards.length]
  store.setActiveArtboard(next.id)
  e.refreshArtboards()
  e.panViewTo(new e.scope.Point(next.x + next.width / 2, next.y + next.height / 2))
}

function clearKey() {
  store.setKeyObject('')
  store.setAlignTarget('selection')
}
/** Wheel over the zoom readout steps in/out around the view center. */
function onZoomWheel(e: WheelEvent) {
  const e2 = engineRef.value
  if (!e2) return
  e2.zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2)
}

function onZoomCmd(cmd: string | number) {
  const e = engineRef.value
  if (!e) return
  if (cmd === 'fit') {
    e.fitToContent()
    return
  }
  const pct = Number(cmd) / 100
  if (!Number.isFinite(pct) || pct <= 0) return
  e.zoomAt(pct / (e.scope.view.zoom || 1))
}

/** Cursor readout in the current ruler unit (geometry stays in px). */
const cursorReadout = computed(() => {
  const factor = rulerUnitFactor(store.rulerUnit)
  const x = Math.round(store.cursorPos.x * factor * 10) / 10
  const y = Math.round(store.cursorPos.y * factor * 10) / 10
  return `${x}, ${y} ${store.rulerUnit}`
})

const currentToolName = computed(() => {
  const names: Record<string, string> = {
    select: 'Select',
    'direct-select': 'Direct Select',
    lasso: 'Lasso',
    'free-transform': 'Free Transform',
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
    arc: 'Arc',
    spiral: 'Spiral',
    'rect-grid': 'Rect Grid',
    'polar-grid': 'Polar Grid',
    pencil: 'Pencil',
    'blob-brush': 'Blob Brush',
    brush: 'Brush',
    eraser: 'Eraser',
    gradient: 'Gradient',
    reshape: 'Reshape',
    spray: 'Spray',
    wand: 'Wand',
    eyedropper: 'Eyedropper',
    scissors: 'Scissors',
    'shape-builder': 'Shape Builder',
    width: 'Width',
    rotate: 'Rotate',
    scale: 'Scale',
    mirror: 'Mirror',
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

.status-click {
  cursor: pointer;
  color: #9ab8dd;
}
.status-click:hover { color: #fff; }

.zen-exit {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 30;
  opacity: 0.7;
}
.zen-exit:hover { opacity: 1; }

.zoom-display {
  cursor: pointer;
  user-select: none;
}
.zoom-display:hover {
  color: #fff;
}
</style>
