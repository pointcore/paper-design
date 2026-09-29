<template>
  <!-- Collapsed: a slim strip that restores the dock (state persisted).
       A button, not a div: it is a control and must be reachable by keyboard. -->
  <button
    v-if="collapsed"
    class="right-panel-collapsed"
    type="button"
    :title="'Expand panel'"
    :aria-label="`Expand ${tabLabel(activeTab)} panel`"
    @click="toggleCollapsed"
  >
    <span class="rpc-label">{{ tabLabel(activeTab) }}</span>
    <span class="rpc-chevron" aria-hidden="true">«</span>
  </button>
  <div v-else class="right-panel" :style="panelStyle">
    <div
      class="rp-resizer"
      title="Drag to resize · double-click to reset"
      @pointerdown="onResizeStart"
      @pointermove="onResizeMove"
      @pointerup="onResizeEnd"
      @pointercancel="onResizeEnd"
      @dblclick="resetWidth"
    ></div>
    <div class="rp-tabs" role="tablist" aria-label="Editor panels">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="rp-tab"
        :class="{ active: activeTab === t.key }"
        role="tab"
        type="button"
        :id="`rp-tab-${t.key}`"
        :aria-selected="activeTab === t.key"
        :aria-controls="`rp-panel-${t.key}`"
        :tabindex="activeTab === t.key ? 0 : -1"
        @click="activeTab = t.key"
        @keydown="onTabKeydown($event, t.key)"
      >
        {{ t.label }}
      </button>
      <button class="rp-collapse" type="button" :title="'Collapse panel'" @click="toggleCollapsed">»</button>
    </div>
    <div class="rp-body">
      <div v-show="activeTab === 'property'" class="rp-pane" role="tabpanel" :id="`rp-panel-property`" :aria-labelledby="`rp-tab-property`" aria-label="Properties">
        <PropertyPanel />
      </div>
      <div v-show="activeTab === 'align'" class="rp-pane" role="tabpanel" :id="`rp-panel-align`" :aria-labelledby="`rp-tab-align`" aria-label="Align">
        <AlignPanel />
      </div>
      <div v-show="activeTab === 'layer'" class="rp-pane rp-pane-layer" role="tabpanel" :id="`rp-panel-layer`" :aria-labelledby="`rp-tab-layer`" aria-label="Layers">
        <LayerPanel />
      </div>
      <div v-show="activeTab === 'artboards'" class="rp-pane" role="tabpanel" :id="`rp-panel-artboards`" :aria-labelledby="`rp-tab-artboards`" aria-label="Artboards">
        <ArtboardPanel />
      </div>
      <div v-show="activeTab === 'swatches'" class="rp-pane" role="tabpanel" :id="`rp-panel-swatches`" :aria-labelledby="`rp-tab-swatches`" aria-label="Swatches">
        <SwatchesPanel />
      </div>
      <div v-show="activeTab === 'symbols'" class="rp-pane" role="tabpanel" :id="`rp-panel-symbols`" :aria-labelledby="`rp-tab-symbols`" aria-label="Symbols">
        <SymbolsPanel />
      </div>
      <div v-show="activeTab === 'history'" class="rp-pane" role="tabpanel" :id="`rp-panel-history`" :aria-labelledby="`rp-tab-history`" aria-label="History">
        <HistoryPanel />
      </div>
      <div v-show="activeTab === 'actions'" class="rp-pane" role="tabpanel" :id="`rp-panel-actions`" :aria-labelledby="`rp-tab-actions`" aria-label="Actions">
        <ActionsPanel />
      </div>
      <div v-show="activeTab === 'appearance'" class="rp-pane" role="tabpanel" :id="`rp-panel-appearance`" :aria-labelledby="`rp-tab-appearance`" aria-label="Appearance">
        <AppearancePanel />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, defineAsyncComponent } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { RightPanelTab } from '../../editor/types'

// Lazy-load panels so each tab's code is only fetched when first activated.
const PropertyPanel = defineAsyncComponent(() => import('./PropertyPanel.vue'))
const AlignPanel = defineAsyncComponent(() => import('./AlignPanel.vue'))
const LayerPanel = defineAsyncComponent(() => import('./LayerPanel.vue'))
const ArtboardPanel = defineAsyncComponent(() => import('./ArtboardPanel.vue'))
const SwatchesPanel = defineAsyncComponent(() => import('./SwatchesPanel.vue'))
const HistoryPanel = defineAsyncComponent(() => import('./HistoryPanel.vue'))
const SymbolsPanel = defineAsyncComponent(() => import('./SymbolsPanel.vue'))
const ActionsPanel = defineAsyncComponent(() => import('./ActionsPanel.vue'))
const AppearancePanel = defineAsyncComponent(() => import('./AppearancePanel.vue'))

const store = useEditorStore()

// Panel collapse: a persisted dock pref toggled from the tab strip; the
// collapsed strip restores with one click.
const collapsed = computed(() => store.ui.panelCollapsed)
function toggleCollapsed() {
  store.setPanelCollapsed(!collapsed.value)
  persistUiPrefs()
}
function tabLabel(key: RightPanelTab): string {
  return tabs.find((t) => t.key === key)?.label ?? 'Panel'
}
function persistUiPrefs() {
  try {
    let prefs: Record<string, unknown> = {}
    const raw = localStorage.getItem('vve.ui')
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        prefs = parsed as Record<string, unknown>
      }
    }
    prefs.panelCollapsed = store.ui.panelCollapsed
    prefs.panelWidth = store.ui.panelWidth
    localStorage.setItem('vve.ui', JSON.stringify(prefs))
  } catch { /* private mode: session-only dock state */ }
}

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
  persistUiPrefs()
}

const tabs = [
  { key: 'property', label: 'Props' },
  { key: 'align', label: 'Align' },
  { key: 'layer', label: 'Layers' },
  { key: 'artboards', label: 'Boards' },
  { key: 'swatches', label: 'Swatch' },
  { key: 'symbols', label: 'Symbol' },
  { key: 'appearance', label: 'Appear' },
  { key: 'history', label: 'Hist' },
  { key: 'actions', label: 'Action' },
] as const

// Shared tab state so other panels (e.g. "Edit Artboards") can jump here.
const activeTab = computed<RightPanelTab>({
  get: () => store.ui.rightTab,
  set: (v) => store.setRightTab(v),
})

/**
 * Standard tablist keyboard model (WAI-ARIA authoring practices): arrows move
 * between tabs and activate as they go, Home/End jump to the ends, and only
 * the active tab is in the tab order.
 *
 * Without this the strip is reachable but not navigable — a keyboard user
 * would have to Tab through all nine panels to reach the one they want.
 */
function onTabKeydown(event: KeyboardEvent, key: RightPanelTab) {
  const index = tabs.findIndex((t) => t.key === key)
  if (index < 0) return
  const last = tabs.length - 1
  let next = -1
  switch (event.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      next = index >= last ? 0 : index + 1
      break
    case 'ArrowLeft':
    case 'ArrowUp':
      next = index <= 0 ? last : index - 1
      break
    case 'Home':
      next = 0
      break
    case 'End':
      next = last
      break
    default:
      return
  }
  event.preventDefault()
  activeTab.value = tabs[next].key
  // Move focus with selection, so the next arrow press continues from there.
  nextTick(() => {
    document.getElementById(`rp-tab-${tabs[next].key}`)?.focus()
  })
}

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

.right-panel-collapsed {
  width: 22px;
  min-width: 22px;
  height: 100%;
  background: #252526;
  border: none;
  border-left: 1px solid #161616;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px 0;
  gap: 6px;
  cursor: pointer;
  color: #9a9a9a;
  user-select: none;
}
/* Now a <button>: keep the browser's default chrome out of the strip. */
.right-panel-collapsed:focus-visible {
  outline: 1px solid #4a90d9;
  outline-offset: -1px;
}
.right-panel-collapsed:hover { color: #fff; }
.rpc-label {
  writing-mode: vertical-rl;
  font-size: 11px;
  letter-spacing: 1px;
}
.rpc-chevron { font-size: 12px; margin-top: auto; }

.rp-collapse {
  margin-left: auto;
  background: transparent;
  border: none;
  color: #9a9a9a;
  font-size: 12px;
  cursor: pointer;
  padding: 0 4px;
  flex-shrink: 0;
}
.rp-collapse:hover { color: #fff; }

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
