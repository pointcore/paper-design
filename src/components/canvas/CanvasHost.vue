<template>
  <div class="canvas-host" ref="containerRef" :class="{ 'transparent-bg': store.view.transparentBackground }">
    <!-- Horizontal ruler bar -->
    <div v-if="store.view.rulersVisible" class="ruler ruler-h" ref="rulerHRef"
         @mousedown.left="onRulerMouseDown($event, 'horizontal')">
      <canvas ref="rulerHCanvasRef" class="ruler-canvas"></canvas>
    </div>

    <!-- Vertical ruler bar -->
    <div v-if="store.view.rulersVisible" class="ruler ruler-v" ref="rulerVRef"
         @mousedown.left="onRulerMouseDown($event, 'vertical')">
      <canvas ref="rulerVCanvasRef" class="ruler-canvas"></canvas>
    </div>

    <!-- Ruler corner -->
    <div v-if="store.view.rulersVisible" class="ruler-corner"></div>

    <!-- Main drawing canvas -->
    <canvas ref="canvasRef" class="main-canvas" @contextmenu.prevent="onContextMenu" @wheel.prevent="onWheel"></canvas>

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
import { ref, onMounted, onUnmounted, onBeforeUnmount, watch, inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import { EditorEngine } from '../../editor/engine'
import { registerAllControllers } from '../../editor/register-controllers'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')
const containerRef = ref<HTMLDivElement>()
const canvasRef = ref<HTMLCanvasElement>()
const rulerHRef = ref<HTMLDivElement>()
const rulerVRef = ref<HTMLDivElement>()
const rulerHCanvasRef = ref<HTMLCanvasElement>()
const rulerVCanvasRef = ref<HTMLCanvasElement>()
const contextMenu = ref({ visible: false, x: 0, y: 0 })

const RULER_SIZE = 20 // px height/width of rulers

let engine: EditorEngine | null = null
let animationFrameId = 0

// Guide-drag state
let guideDragActive = false
let guideDragOrientation: 'horizontal' | 'vertical' = 'horizontal'
let guideDragGhost: paper.Path | null = null
let guideDragGhostLayer: paper.Layer | null = null
let guideDragStartClient = { x: 0, y: 0 }

onMounted(() => {
  if (!canvasRef.value || !containerRef.value) return

  // Compute canvas area accounting for rulers if visible
  const rect = containerRef.value.getBoundingClientRect()
  const rulerOffset = store.view.rulersVisible ? RULER_SIZE : 0
  canvasRef.value.style.left = rulerOffset + 'px'
  canvasRef.value.style.top = rulerOffset + 'px'
  canvasRef.value.width = rect.width - rulerOffset
  canvasRef.value.height = rect.height - rulerOffset

  engine = new EditorEngine(canvasRef.value, store)

  // Store the engine in the shared ref (provided by App.vue)
  if (engineRef) {
    engineRef.value = engine
  }

  registerAllControllers(engine)

  // Initially activate the select tool
  engine.setTool('select')

  // Setup rulers after mount
  setupRulerCanvases()
  drawRulers()

  // Apply initial view settings from store
  if (store.view.showGrid) {
    engine.refreshGrid()
  }

  // Redraw rulers whenever the engine view changes (zoom / pan)
  engine.onViewChange = () => {
    if (!animationFrameId) {
      animationFrameId = requestAnimationFrame(() => {
        animationFrameId = 0
        drawRulers()
      })
    }
  }

  window.addEventListener('resize', onResize)
  document.addEventListener('click', onDocumentClick)

  // Watch for view setting changes
  watch(
    () => store.view.showGrid,
    () => {
      engine?.refreshGrid()
    }
  )
  watch(
    () => store.view.transparentBackground,
    () => {
      drawRulers() // redraw rulers to match new bg
    }
  )
  watch(
    () => store.view.rulersVisible,
    (val) => {
      // Re-layout canvas and rulers when rulers visibility changes
      requestAnimationFrame(() => {
        onResize()
      })
    }
  )
  watch(
    () => store.view.showGuides,
    () => {
      engine?.refreshGuides()
    }
  )

  // Ensure guide visibility matches the store on startup.
  engine?.refreshGuides()
})

onBeforeUnmount(() => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
  }
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('mousemove', onGuideDragMove)
  window.removeEventListener('mouseup', onGuideDragEnd)
  guideDragActive = false
  if (engine) {
    if (engine.onViewChange) {
      engine.onViewChange = null
    }
    engine.destroy()
    engine = null
  }
})

function setupRulerCanvases() {
  const container = containerRef.value
  if (!container) return
  const rect = container.getBoundingClientRect()

  if (rulerHCanvasRef.value) {
    rulerHCanvasRef.value.width = Math.max(1, rect.width)
    rulerHCanvasRef.value.height = RULER_SIZE
  }
  if (rulerVCanvasRef.value) {
    rulerVCanvasRef.value.width = RULER_SIZE
    rulerVCanvasRef.value.height = Math.max(1, rect.height)
  }
}


/**
 * Mouse-wheel zoom on the drawing canvas. Scroll up zooms in, scroll down
 * zooms out, keeping the point under the cursor stationary.
 */
function onWheel(e: WheelEvent) {
  if (!engine || !canvasRef.value) return
  const rect = canvasRef.value.getBoundingClientRect()
  const sx = e.clientX - rect.left
  const sy = e.clientY - rect.top
  const factor = e.deltaY < 0 ? 1.1 : 0.9
  engine.zoomAt(factor, sx, sy)
}

function onResize() {
  if (!canvasRef.value || !containerRef.value || !engine) return
  const rect = containerRef.value.getBoundingClientRect()
  const rulerOffset = store.view.rulersVisible ? RULER_SIZE : 0

  // Update canvas position and size
  canvasRef.value.style.left = rulerOffset + 'px'
  canvasRef.value.style.top = rulerOffset + 'px'
  canvasRef.value.width = Math.max(1, rect.width - rulerOffset)
  canvasRef.value.height = Math.max(1, rect.height - rulerOffset)

  engine.scope.view.update()
  engine.refreshGrid()
  setupRulerCanvases()
  drawRulers()
}

/**
 * Draw tick marks on the ruler canvases.
 * Rulers sit at the top and left of the canvas. The origin (0,0) of the
 * document maps to the top-left of the main canvas, which is offset by
 * RULER_SIZE from the container origin. Since the horizontal ruler spans
 * from x=RULER_SIZE to the right edge of the container, its local origin
 * maps directly to the top-left of the main canvas.
 */
function drawRulers() {
  if (!engine) return
  const hCanvas = rulerHCanvasRef.value
  const vCanvas = rulerVCanvasRef.value
  if (!hCanvas || !vCanvas) return

  const hctx = hCanvas.getContext('2d')
  const vctx = vCanvas.getContext('2d')
  if (!hctx || !vctx) return

  // Clear
  hctx.clearRect(0, 0, hCanvas.width, hCanvas.height)
  vctx.clearRect(0, 0, vCanvas.width, vCanvas.height)

  // Background
  hctx.fillStyle = '#2b2b2b'
  hctx.fillRect(0, 0, hCanvas.width, hCanvas.height)
  vctx.fillStyle = '#2b2b2b'
  vctx.fillRect(0, 0, vCanvas.width, vCanvas.height)

  const view = engine.scope.view
  const zoom = engine.zoom || 1

  // Choose a "nice" tick step: minor ticks between 30~60 screen px.
  const baseUnit = 10
  let tickUnit = baseUnit
  while (tickUnit * zoom < 30) tickUnit *= 2
  while (tickUnit * zoom > 60) tickUnit /= 2
  if (tickUnit < 1) {
    // At very low zoom, keep units at 1
    tickUnit = 1
  }

  const majorEvery = 5

  // Convert document origin to view space.
  // view.projectToView returns coordinates relative to the main canvas.
  // Since the canvas is offset from the container by RULER_SIZE, the same
  // document point appears RULER_SIZE pixels further right/down on the rulers.
  const origin = view.projectToView(new engine.scope.Point(0, 0))
  const originX = origin.x + RULER_SIZE
  const originY = origin.y + RULER_SIZE

  const tickColor = '#8a8a8a'
  const majorTickColor = '#b0b0b0'
  const textColor = '#aaa'

  // ---- Horizontal ruler ----
  const hStartDoc = Math.floor((0 - originX) / (zoom * tickUnit)) * tickUnit
  const hEndDoc = Math.ceil((hCanvas.width - originX) / (zoom * tickUnit)) * tickUnit

  hctx.font = '8px sans-serif'
  hctx.textBaseline = 'top'
  hctx.fillStyle = textColor

  for (let doc = hStartDoc; doc <= hEndDoc; doc += tickUnit) {
    const screenX = originX + doc * zoom
    if (screenX < 0 || screenX > hCanvas.width) continue

    const isMajor = Math.round(doc / tickUnit) % majorEvery === 0
    const isZero = doc === 0

    const tickHeight = isMajor || isZero ? 7 : 3
    hctx.strokeStyle = isMajor || isZero ? majorTickColor : tickColor
    hctx.lineWidth = 1
    hctx.beginPath()
    hctx.moveTo(Math.round(screenX) + 0.5, hCanvas.height)
    hctx.lineTo(Math.round(screenX) + 0.5, hCanvas.height - tickHeight)
    hctx.stroke()

    if (isMajor || isZero) {
      hctx.fillStyle = textColor
      hctx.fillText(String(Math.round(doc)), screenX + 2, 1)
    }
  }

  // ---- Vertical ruler ----
  const vStartDoc = Math.floor((0 - originY) / (zoom * tickUnit)) * tickUnit
  const vEndDoc = Math.ceil((vCanvas.height - originY) / (zoom * tickUnit)) * tickUnit

  vctx.font = '8px sans-serif'
  vctx.textBaseline = 'middle'

  for (let doc = vStartDoc; doc <= vEndDoc; doc += tickUnit) {
    const screenY = originY + doc * zoom
    if (screenY < 0 || screenY > vCanvas.height) continue

    const isMajor = Math.round(doc / tickUnit) % majorEvery === 0
    const isZero = doc === 0

    const tickWidth = isMajor || isZero ? 7 : 3
    vctx.strokeStyle = isMajor || isZero ? majorTickColor : tickColor
    vctx.lineWidth = 1
    vctx.beginPath()
    vctx.moveTo(vCanvas.width, Math.round(screenY) + 0.5)
    vctx.lineTo(vCanvas.width - tickWidth, Math.round(screenY) + 0.5)
    vctx.stroke()

    if (isMajor || isZero) {
      vctx.fillStyle = textColor
      vctx.save()
      vctx.translate(1, screenY - 2)
      vctx.fillText(String(Math.round(doc)), 1, 0)
      vctx.restore()
    }
  }
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

// ------------------------------------------------------------------
// Ruler guide drag-out support
// ------------------------------------------------------------------

/**
 * User pressed the mouse down on a ruler - begin dragging out a new guide.
 * The guide follows the cursor until mouse up; if released over the canvas
 * a permanent guide line is created at that document position.
 */
function onRulerMouseDown(e: MouseEvent, orientation: 'horizontal' | 'vertical') {
  if (!engine) return
  guideDragActive = true
  guideDragOrientation = orientation
  guideDragStartClient = { x: e.clientX, y: e.clientY }
  e.preventDefault()
  e.stopPropagation()
  // Prevent the canvas from receiving events while the user drags out a guide.
  if (canvasRef.value) {
    canvasRef.value.style.pointerEvents = 'none'
  }

  // Show a ghost guide line immediately.
  updateGuideDrag(e)

  // Listen on window so the drag can continue outside the ruler element.
  window.addEventListener('mousemove', onGuideDragMove)
  window.addEventListener('mouseup', onGuideDragEnd)
}

function onGuideDragMove(e: MouseEvent) {
  if (!guideDragActive || !engine) return
  updateGuideDrag(e)
}

function onGuideDragEnd(e: MouseEvent) {
  if (!guideDragActive || !engine) return

  guideDragActive = false
  window.removeEventListener('mousemove', onGuideDragMove)
  window.removeEventListener('mouseup', onGuideDragEnd)
  if (canvasRef.value) {
    canvasRef.value.style.pointerEvents = ''
  }

  removeGuideGhost()

  // Determine if released over the canvas region.
  const rect = containerRef.value?.getBoundingClientRect()
  if (!rect) return
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top
  if (mouseX < RULER_SIZE || mouseY < RULER_SIZE) return // released on a ruler
  if (mouseX > rect.width || mouseY > rect.height) return // outside container

  // Convert to document coordinates.
  const viewPt = engine.scope.view.viewToProject(
    new engine.scope.Point(mouseX - RULER_SIZE, mouseY - RULER_SIZE)
  )

  const pos = guideDragOrientation === 'horizontal' ? viewPt.y : viewPt.x
  engine.createGuide(pos, guideDragOrientation)
  engine.scope.view.update()
  engine.pushHistory('Add Guide')
}

/**
 * While dragging out a guide from a ruler, show a ghost line preview.
 */
function updateGuideDrag(e: MouseEvent) {
  if (!engine || !containerRef.value) return
  const scope = engine.scope
  const rect = containerRef.value.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top

  // Convert container position to document space.
  const viewPt = scope.view.viewToProject(
    new scope.Point(mouseX - RULER_SIZE, mouseY - RULER_SIZE)
  )

  // Remove previous ghost line.
  removeGuideGhost()

  // Only draw the ghost when the cursor is inside the canvas area.
  if (mouseX < RULER_SIZE || mouseY < RULER_SIZE) return
  if (mouseX > rect.width || mouseY > rect.height) return

  // Create a temporary chrome layer for the ghost.
  if (!guideDragGhostLayer || !guideDragGhostLayer.parent) {
    guideDragGhostLayer = new scope.Layer()
    guideDragGhostLayer.name = 'guide-drag-ghost'
    guideDragGhostLayer.locked = true
    guideDragGhostLayer.data.isUserLayer = false
    guideDragGhostLayer.data.isChromeRoot = true
    guideDragGhostLayer.bringToFront()
  }

  const span = 1e6
  let p1: paper.Point, p2: paper.Point
  if (guideDragOrientation === 'horizontal') {
    p1 = new scope.Point(-span, viewPt.y)
    p2 = new scope.Point(span, viewPt.y)
  } else {
    p1 = new scope.Point(viewPt.x, -span)
    p2 = new scope.Point(viewPt.x, span)
  }

  const line = new scope.Path.Line(p1, p2) as paper.Path
  line.strokeColor = new scope.Color('#00bcd4')
  line.strokeWidth = 1 / engine.zoom
  line.dashArray = [4 / engine.zoom, 3 / engine.zoom]
  guideDragGhostLayer.addChild(line)
  guideDragGhost = line
  scope.view.update()
}

function removeGuideGhost() {
  if (guideDragGhost) {
    guideDragGhost.remove()
    guideDragGhost = null
  }
  if (guideDragGhostLayer && guideDragGhostLayer.parent) {
    guideDragGhostLayer.remove()
    guideDragGhostLayer = null
  }
  engine?.scope.view.update()
}
</script>

<style scoped>
.canvas-host {
  flex: 1;
  position: relative;
  overflow: hidden;
  background: #1e1e1e;
}

.canvas-host.transparent-bg {
  background-image:
    linear-gradient(45deg, #3a3a3a 25%, transparent 25%),
    linear-gradient(-45deg, #3a3a3a 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #3a3a3a 75%),
    linear-gradient(-45deg, transparent 75%, #3a3a3a 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
  background-color: #2d2d2d;
}

.main-canvas {
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
  overflow: hidden;
  pointer-events: auto;
  cursor: default;
}

.ruler:hover {
  cursor: crosshair;
}

.ruler-h {
  top: 0;
  left: 0;
  right: 0;
  height: 20px;
  border-bottom: 1px solid #3a3a3a;
}

.ruler-v {
  left: 0;
  top: 0;
  bottom: 0;
  width: 20px;
  border-right: 1px solid #3a3a3a;
}

.ruler-corner {
  position: absolute;
  top: 0;
  left: 0;
  width: 20px;
  height: 20px;
  background: #2b2b2b;
  z-index: 11;
  pointer-events: none;
}

.ruler-canvas {
  width: 100%;
  height: 100%;
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
