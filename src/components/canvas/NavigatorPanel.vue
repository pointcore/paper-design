<template>
  <div v-if="store.ui.showNavigator" class="navigator" :class="{ collapsed }">
    <div class="nav-header" @click="collapsed = !collapsed">
      <span>Navigator</span>
      <span class="nav-zoom">{{ zoomPercent }}</span>
    </div>
    <div
      v-if="!collapsed"
      ref="bodyRef"
      class="nav-body"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
    >
      <img v-if="thumbUrl" :src="thumbUrl" class="nav-image" draggable="false" @dragstart.prevent />
      <div v-else class="nav-empty">Nothing to show</div>
      <div v-if="viewportStyle" class="nav-viewport" :style="viewportStyle" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const bodyRef = ref<HTMLElement>()
const collapsed = ref(false)
const thumbUrl = ref('')
const thumbBounds = ref<{ x: number; y: number; width: number; height: number } | null>(null)
const viewRect = ref<{ x: number; y: number; width: number; height: number } | null>(null)

let attachedEngine: EditorEngine | null = null
let panning = false
let rafId = 0

function getEngine() { return attachedEngine }

const zoomPercent = computed(() => `${Math.round(store.view.zoom * 100)}%`)

/** Viewport rectangle as percentages of the thumbnail frame. */
const viewportStyle = computed(() => {
  const tb = thumbBounds.value
  const vp = viewRect.value
  if (!tb || !vp || tb.width <= 0 || tb.height <= 0) return null
  const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
  const left = clamp01((vp.x - tb.x) / tb.width)
  const top = clamp01((vp.y - tb.y) / tb.height)
  const right = clamp01((vp.x + vp.width - tb.x) / tb.width)
  const bottom = clamp01((vp.y + vp.height - tb.y) / tb.height)
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${Math.max(0, right - left) * 100}%`,
    height: `${Math.max(0, bottom - top) * 100}%`,
  }
})

/** Re-render the thumbnail (content changed). */
function rebuild() {
  const engine = getEngine()
  if (!engine) return
  const shot = engine.renderThumbnail(320)
  if (!shot) {
    thumbUrl.value = ''
    thumbBounds.value = null
    return
  }
  thumbUrl.value = shot.url
  thumbBounds.value = { x: shot.x, y: shot.y, width: shot.width, height: shot.height }
  updateViewport()
}

/** Re-read the viewport rectangle (cheap, runs on every view change). */
function updateViewport() {
  const engine = getEngine()
  if (!engine) return
  try {
    const bounds = engine.scope.view.bounds
    const next = {
      x: Math.round(bounds.x * 10) / 10,
      y: Math.round(bounds.y * 10) / 10,
      width: Math.round(bounds.width * 10) / 10,
      height: Math.round(bounds.height * 10) / 10,
    }
    const prev = viewRect.value
    if (
      !prev ||
      prev.x !== next.x ||
      prev.y !== next.y ||
      prev.width !== next.width ||
      prev.height !== next.height
    ) {
      viewRect.value = next
    }
  } catch {
    viewRect.value = null
  }
}

/**
 * Frame loop syncing the viewport rectangle. A loop (instead of chaining
 * engine.onViewChange) avoids clobbering CanvasHost's own view handler,
 * which is assigned after children mount; rounding keeps idle frames
 * free of reactive churn.
 */
function startViewportLoop() {
  const tick = () => {
    updateViewport()
    rafId = requestAnimationFrame(tick)
  }
  rafId = requestAnimationFrame(tick)
}

function docPointAt(e: PointerEvent): paper.Point | null {
  const engine = getEngine()
  const body = bodyRef.value
  const tb = thumbBounds.value
  if (!engine || !body || !tb || tb.width <= 0 || tb.height <= 0) return null
  const rect = body.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const fx = (e.clientX - rect.left) / rect.width
  const fy = (e.clientY - rect.top) / rect.height
  return new engine.scope.Point(tb.x + fx * tb.width, tb.y + fy * tb.height)
}

function onPointerDown(e: PointerEvent) {
  const engine = getEngine()
  if (!engine || e.button !== 0) return
  const point = docPointAt(e)
  if (!point) return
  panning = true
  bodyRef.value?.setPointerCapture?.(e.pointerId)
  engine.panViewTo(point)
}

function onPointerMove(e: PointerEvent) {
  if (!panning) return
  const engine = getEngine()
  const point = docPointAt(e)
  if (!engine || !point) return
  engine.panViewTo(point)
}

function onPointerUp() {
  panning = false
}

// The engine is created in CanvasHost mounting (after children), so attach
// lazily on first availability; the viewport loop picks it up once set.
const stopEngineWatch = watch(
  () => engineRef?.value,
  (engine) => {
    if (!engine || attachedEngine) return
    attachedEngine = engine
    rebuild()
    updateViewport()
    stopEngineWatch()
  },
  { immediate: true }
)

watch(
  () => [
    store.historyIndex,
    store.activeArtboardId,
    store.artboards.map((b) => `${b.id}:${b.x},${b.y},${b.width},${b.height},${b.name}`).join(';'),
  ],
  () => rebuild()
)

onMounted(() => {
  startViewportLoop()
})

onBeforeUnmount(() => {
  if (rafId) cancelAnimationFrame(rafId)
  attachedEngine = null
})
</script>

<style scoped>
.navigator {
  position: absolute;
  right: 12px;
  bottom: 40px;
  width: 184px;
  background: #252526;
  border: 1px solid #161616;
  border-radius: 6px;
  z-index: 5;
  overflow: hidden;
  user-select: none;
}

.nav-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 28px;
  padding: 0 10px;
  background: #1e1e1e;
  color: #ddd;
  font-size: 12px;
  font-weight: bold;
  cursor: pointer;
  flex-shrink: 0;
}

.nav-zoom {
  color: #888;
  font-weight: normal;
}

.nav-body {
  position: relative;
  padding: 0;
  cursor: crosshair;
  touch-action: none;
}

.nav-image {
  display: block;
  width: 100%;
  height: auto;
  background: #1e1e1e;
}

.nav-empty {
  padding: 16px 10px;
  font-size: 12px;
  color: #666;
  font-style: italic;
  text-align: center;
}

.nav-viewport {
  position: absolute;
  border: 1px solid #4a90d9;
  background: rgba(74, 144, 217, 0.15);
  pointer-events: none;
}
</style>
