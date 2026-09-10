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
    <canvas ref="canvasRef" class="main-canvas" @contextmenu.prevent="onContextMenu" @wheel.prevent="onWheel" @mousedown="onCanvasMouseDown"></canvas>

    <NavigatorPanel />

    <div v-if="store.isolationActive" class="isolation-banner">
      <span>Isolated editing (Esc to exit)</span>
      <el-button size="small" @click="exitIsolation">Exit</el-button>
    </div>

    <div v-if="contextMenu.visible" class="context-menu"
         :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
         @click.stop>
      <div class="menu-item" @click="ctxCopy">Copy</div>
      <div class="menu-item" @click="ctxCut">Cut</div>
      <div class="menu-item" @click="ctxPaste">Paste</div>
      <div class="menu-item" @click="ctxDelete">Delete</div>
      <div class="menu-divider"></div>
      <div class="menu-item" @click="ctxGroup">Group</div>
      <div class="menu-item" @click="ctxUngroup">Ungroup</div>
      <div class="menu-item" @click="ctxJoin">Join Paths</div>
      <div class="menu-item" @click="ctxCompound">Make Compound Path</div>
      <div class="menu-divider"></div>
      <div class="menu-item" @click="ctxBringToFront">Bring to Front</div>
      <div class="menu-item" @click="ctxBringForward">Bring Forward</div>
      <div class="menu-item" @click="ctxSendBackward">Send Backward</div>
      <div class="menu-item" @click="ctxSendToBack">Send to Back</div>
      <div class="menu-divider"></div>
      <div class="menu-item" @click="ctxMakeMask">Make Clipping Mask</div>
      <div class="menu-item" @click="ctxSetKey">Set as Key Object</div>
      <div class="menu-divider"></div>
      <div class="menu-item" @click="ctxLock">Lock</div>
      <div class="menu-item" @click="ctxHide">Hide</div>
      <div class="menu-item" @click="ctxSameFill">Select Same Fill</div>
      <div class="menu-item" @click="ctxSameStroke">Select Same Stroke</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, onBeforeUnmount, watch, inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import { EditorEngine } from '../../editor/engine'
import { registerAllControllers } from '../../editor/register-controllers'
import { handleGlobalKeydown, handleGlobalKeyUp } from '../../editor/shortcuts'
import { cursorForTool } from '../../editor/cursors'
import { rulerUnitFactor } from '../../editor/geometry'
import NavigatorPanel from './NavigatorPanel.vue'

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

// Middle-drag pan state (works in every tool; paper tools ignore button 1)
let middlePanActive = false
let middlePanLast: { x: number; y: number } | null = null
let middlePanPrevCursor = ''

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
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('keyup', onGlobalKeyUp)
  // Capture phase runs before Paper's document-level key handling: an open
  // context menu swallows Escape (close only) so tool shortcuts below never
  // see it and the selection survives.
  window.addEventListener('keydown', onCaptureKeydown, true)
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
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('keyup', onGlobalKeyUp)
  window.removeEventListener('keydown', onCaptureKeydown, true)
  document.removeEventListener('click', onDocumentClick)
  window.removeEventListener('mousemove', onGuideDragMove)
  window.removeEventListener('mouseup', onGuideDragEnd)
  window.removeEventListener('mousemove', onMiddlePanMove)
  window.removeEventListener('mouseup', onMiddlePanEnd)
  guideDragActive = false
  middlePanActive = false
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

/** Global tool-switch keyboard shortcut handler. */
function onGlobalKeydown(e: KeyboardEvent) {
  handleGlobalKeydown(e, store, engine)
}

/** Middle-button drag pans in every tool (paper tools ignore button 1). */
function onCanvasMouseDown(e: MouseEvent) {
  // Any press on the canvas returns keyboard focus to the document: menu
  // triggers keep focus after a command, and a later Space would re-open
  // the menu instead of parking the hand tool.
  const ae = document.activeElement as HTMLElement | null
  if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur()
  if (!engine || e.button !== 1 || middlePanActive) return
  middlePanActive = true
  // Screen-space anchor: doc-space diffs would feed the just-moved view back
  // into the next measurement and make the pan judder in place.
  middlePanLast = { x: e.clientX, y: e.clientY }
  if (canvasRef.value) {
    middlePanPrevCursor = canvasRef.value.style.cursor
    canvasRef.value.style.cursor = 'grabbing'
  }
  e.preventDefault()
  window.addEventListener('mousemove', onMiddlePanMove)
  window.addEventListener('mouseup', onMiddlePanEnd)
}

function onMiddlePanMove(e: MouseEvent) {
  if (!middlePanActive || !engine || !middlePanLast) return
  const zoom = engine.scope.view.zoom || 1
  engine.panBy(
    (e.clientX - middlePanLast.x) / zoom,
    (e.clientY - middlePanLast.y) / zoom
  )
  middlePanLast = { x: e.clientX, y: e.clientY }
  engine.scope.view.update()
}

function onMiddlePanEnd() {
  if (!middlePanActive) return
  middlePanActive = false
  middlePanLast = null
  window.removeEventListener('mousemove', onMiddlePanMove)
  window.removeEventListener('mouseup', onMiddlePanEnd)
  if (canvasRef.value) {
    // Restore the pre-pan cursor; an empty inline value means the tool
    // default was CSS-driven, so re-apply the AI-aligned tool cursor.
    if (middlePanPrevCursor) {
      canvasRef.value.style.cursor = middlePanPrevCursor
    } else if (engine) {
      canvasRef.value.style.cursor = cursorForTool(store.tool)
    }
  }
}

/** Space-pan release handler (restores the parked tool). */
function onGlobalKeyUp(e: KeyboardEvent) {
  handleGlobalKeyUp(e, store, engine)
}

function onResize() {
  if (!canvasRef.value || !containerRef.value || !engine) return
  const rect = containerRef.value.getBoundingClientRect()
  const rulerOffset = store.view.rulersVisible ? RULER_SIZE : 0

  // Update canvas position and size
  canvasRef.value.style.left = rulerOffset + 'px'
  canvasRef.value.style.top = rulerOffset + 'px'
  const width = Math.max(1, rect.width - rulerOffset)
  const height = Math.max(1, rect.height - rulerOffset)

  // Go through Paper's viewSize setter: assigning canvas.width directly
  // leaves Paper's internal _viewSize (and view.bounds) stale, so the grid
  // painted for the old viewport and zoom-to-cursor anchored off-screen.
  engine.scope.view.viewSize = new engine.scope.Size(width, height)
  engine.scope.view.update()
  // Canvas backing-store size changed -> Paper's bounds changed with it.
  // Re-mirror the transform so the next pan starts from the live view.
  engine.syncViewBookkeeping()
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
      hctx.fillText(unitLabel(doc), screenX + 2, 1)
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
      vctx.fillText(unitLabel(doc), 1, 0)
      vctx.restore()
    }
  }
}

/** Ruler tick label in the current ruler unit (integers for px). */
function unitLabel(doc: number): string {
  const scaled = doc * rulerUnitFactor(store.rulerUnit)
  return store.rulerUnit === 'px'
    ? String(Math.round(scaled))
    : String(Math.round(scaled * 10) / 10)
}

function onDocumentClick() {
  contextMenu.value.visible = false
}

/** Capture-phase Escape: close the context menu without touching tools. */
function onCaptureKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && contextMenu.value.visible) {
    e.stopPropagation()
    e.preventDefault()
    hideMenu()
  }
}

function exitIsolation() {
  engine?.exitIsolation()
}

function onContextMenu(e: MouseEvent) {
  // Clamp inside the viewport so edge clicks keep every item clickable.
  const MENU_W = 200
  const MENU_H = 490
  contextMenu.value = {
    visible: true,
    x: Math.min(e.clientX, window.innerWidth - MENU_W),
    y: Math.min(e.clientY, window.innerHeight - MENU_H),
  }
}

function ctxCopy() {
  engine?.copySelectedToClipboard()
  engine?.copyToSystemClipboard()?.catch(() => undefined)
  hideMenu()
}

function ctxCut() {
  // Capture the OS copy before the cut deletes the selection.
  engine?.copyToSystemClipboard()?.catch(() => undefined)
  engine?.cutSelectedToClipboard()
  hideMenu()
}

function ctxPaste() {
  engine?.pasteWithSystemFallback()?.catch(() => undefined)
  hideMenu()
}

function ctxDelete() {
  engine?.deleteSelected()
  hideMenu()
}

function ctxBringToFront() {
  engine?.bringSelectionToFront()
  hideMenu()
}

function ctxBringForward() {
  engine?.bringForward()
  hideMenu()
}

function ctxSendBackward() {
  engine?.sendBackward()
  hideMenu()
}

function ctxSendToBack() {
  engine?.sendSelectionToBack()
  hideMenu()
}

function ctxGroup() {
  if (engine && !engine.groupSelection()) store.setStatusMessage('Select 2 or more objects to group')
  hideMenu()
}

function ctxUngroup() {
  if (engine && !engine.ungroupSelection()) store.setStatusMessage('Select a group to ungroup')
  hideMenu()
}

function ctxJoin() {
  if (engine && !engine.joinPaths()) store.setStatusMessage('Join needs exactly two unlocked open paths')
  hideMenu()
}

function ctxCompound() {
  if (engine && !engine.makeCompoundPath()) store.setStatusMessage('Compound needs at least two unlocked paths')
  hideMenu()
}

function ctxMakeMask() {
  if (engine && !engine.makeClippingMask()) store.setStatusMessage('Clipping needs art plus a path on top')
  hideMenu()
}

function ctxSetKey() {
  const id = store.selectedItemIds[0]
  if (!id) {
    store.setStatusMessage('Select an object first')
  } else {
    ;(store as any).setKeyObject?.(id)
    ;(store as any).setAlignTarget?.('key')
    store.setStatusMessage('Key object set (align target)')
  }
  hideMenu()
}

function ctxLock() {
  engine?.setSelectedLocked(true)
  hideMenu()
}

function ctxHide() {
  engine?.setSelectedVisible(false)
  hideMenu()
}

function ctxSameFill() {
  if (engine) {
    const n = engine.selectSame('fill')
    store.setStatusMessage(`Selected ${n} items with the same fill`)
  }
  hideMenu()
}

function ctxSameStroke() {
  if (engine) {
    const n = engine.selectSame('stroke')
    store.setStatusMessage(`Selected ${n} items with the same stroke`)
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
  if (store.view.guidesLocked) {
    store.setStatusMessage('Guides are locked')
    return
  }
  guideDragActive = true
  guideDragOrientation = orientation
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
  cursor: default;
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

.ruler-h {
  cursor: ns-resize;
}

.ruler-v {
  cursor: ew-resize;
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

.isolation-banner {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: #3c3c3c;
  border: 1px solid #4a90d9;
  border-radius: 4px;
  color: #ddd;
  font-size: 12px;
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
