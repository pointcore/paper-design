<template>
  <div class="view-menu">
    <el-dropdown trigger="click" @command="onViewCmd">
      <span class="menu-label">View</span>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="fitAll">Fit to Window</el-dropdown-item>
          <el-dropdown-item command="zoomSelection" :disabled="!store.hasSelection">Zoom to Selection</el-dropdown-item>
          <el-dropdown-item command="zoomArtboard">Zoom to Artboard</el-dropdown-item>
          <el-dropdown-item command="zoomIn">Zoom In</el-dropdown-item>
          <el-dropdown-item command="zoomOut">Zoom Out</el-dropdown-item>
          <el-dropdown-item command="zoom100" divided>Actual Size</el-dropdown-item>
          <el-dropdown-item command="rulers" divided :icon="store.view.rulersVisible ? Check : undefined">
            Rulers
          </el-dropdown-item>
          <el-dropdown-item command="grid" :icon="store.view.showGrid ? Check : undefined">
            Grid
          </el-dropdown-item>
          <el-dropdown-item command="guides" :icon="store.view.showGuides ? Check : undefined">
            Guides
          </el-dropdown-item>
          <el-dropdown-item command="guidesDialog">Guides...</el-dropdown-item>
          <el-dropdown-item command="lockGuides" :icon="store.view.guidesLocked ? Check : undefined">
            Lock Guides
          </el-dropdown-item>
          <el-dropdown-item command="transparentBg" :icon="store.view.transparentBackground ? Check : undefined">
            Transparent Background
          </el-dropdown-item>
          <el-dropdown-item command="cmykPreview" :icon="store.view.proofMode === 'cmyk' ? Check : undefined">
            CMYK Preview
          </el-dropdown-item>
          <el-dropdown-item command="navigator" :icon="store.ui.showNavigator ? Check : undefined">
            Navigator
          </el-dropdown-item>
          <el-dropdown-item command="controlBar" :icon="store.ui.showControlBar ? Check : undefined">
            Control Bar
          </el-dropdown-item>
          <el-dropdown-item command="boundingBox" :icon="store.view.showBoundingBox ? Check : undefined">
            Bounding Box
          </el-dropdown-item>
          <el-dropdown-item command="pixelPreview" :icon="store.view.pixelPreview ? Check : undefined">
            Pixel Preview
          </el-dropdown-item>
          <el-dropdown-item command="pixelRatio">
            Pixel Ratio: {{ store.view.pixelRatio }}x
          </el-dropdown-item>
          <el-dropdown-item command="presentation" :icon="store.ui.zenMode ? Check : undefined">
            Presentation (Tab)
          </el-dropdown-item>
          <el-dropdown-item command="preflight">Preflight...</el-dropdown-item>
          <el-dropdown-item command="canvasSettings" divided>Canvas Settings...</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <!-- Canvas Settings Dialog (settings apply live; footer is just Close) -->
    <AppDialog v-model="settingsVisible" title="Canvas Settings" :width="420" :show-footer="false">
      <template #footer>
        <el-button size="small" @click="settingsVisible = false">Close</el-button>
      </template>
      <div class="settings-body app-settings">
        <div class="setting-section">
          <div class="setting-title">Display</div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Rulers</span>
              <span class="setting-desc">Show rulers along the canvas edges</span>
            </div>
            <el-switch v-model="settings.rulers" size="small" @change="onRulersToggle" />
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Grid</span>
              <span class="setting-desc">Show a grid on the canvas</span>
            </div>
            <el-switch v-model="settings.grid" size="small" @change="onGridToggle" />
          </div>

          <div v-if="settings.grid" class="setting-row setting-sub">
            <div class="setting-label">
              <span class="setting-name">Grid Size</span>
              <span class="setting-desc">Distance between grid lines</span>
            </div>
            <el-input-number v-model="settings.gridSize" :min="1" :max="100" :step="1" size="small"
              @change="onGridSizeChange" />
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Transparent Background</span>
              <span class="setting-desc">Show a checkerboard to indicate transparency</span>
            </div>
            <el-switch v-model="settings.transparent" size="small" @change="onTransparentToggle" />
          </div>
        </div>

        <div class="setting-section">
          <div class="setting-title">Snapping</div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Enable Snapping</span>
              <span class="setting-desc">Master switch for every snap source below</span>
            </div>
            <el-switch v-model="settings.snap" size="small" @change="onSnapToggle" />
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Snap to Grid</span>
              <span class="setting-desc">Pull points onto grid crossings</span>
            </div>
            <el-switch v-model="settings.snapGrid" size="small" :disabled="!settings.snap" @change="onSnapGridToggle" />
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Snap to Guides</span>
              <span class="setting-desc">Pull points onto ruler guide lines</span>
            </div>
            <el-switch v-model="settings.snapGuides" size="small" :disabled="!settings.snap" @change="onSnapGuidesToggle" />
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Snap to Anchors</span>
              <span class="setting-desc">Pull points onto nearby anchor points</span>
            </div>
            <el-switch v-model="settings.snapPoint" size="small" :disabled="!settings.snap" @change="onSnapPointToggle" />
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Smart Guides</span>
              <span class="setting-desc">Align dragged objects to nearby edges and centers</span>
            </div>
            <el-switch v-model="settings.smartGuides" size="small" :disabled="!settings.snap" @change="onSmartGuidesToggle" />
          </div>
        </div>

        <div class="setting-section">
          <div class="setting-title">Page</div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Preset</span>
            </div>
            <el-select v-model="settings.pagePreset" size="small" style="width: 150px" @change="onPagePresetChange">
              <el-option v-for="p in PAGE_PRESETS" :key="p.value" :label="p.label" :value="p.value" />
            </el-select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Page Size</span>
              <span class="setting-desc">Active artboard size in px</span>
            </div>
            <div class="page-size-inputs">
              <el-input-number v-model="settings.pageWidth" :min="1" :max="16384" size="small" @change="onPageSizeChange" />
              <el-button size="small" title="Swap orientation" @click="onPageOrientationSwap">Swap</el-button>
              <el-input-number v-model="settings.pageHeight" :min="1" :max="16384" size="small" @change="onPageSizeChange" />
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Bleed</span>
              <span class="setting-desc">Vector PDF page grows by this; crop marks print when above 0</span>
            </div>
            <el-input-number v-model="settings.bleed" :min="0" :max="100" size="small" @change="onBleedChange" />
          </div>
        </div>

        <div class="setting-section">
          <div class="setting-title">Units</div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Ruler Unit</span>
            </div>
            <el-select v-model="settings.unit" size="small" style="width: 120px" @change="onUnitChange">
              <el-option v-for="u in units" :key="u.value" :label="u.label" :value="u.value" />
            </el-select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Nudge Step</span>
              <span class="setting-desc">Arrow-key distance in document units (Shift moves 10x)</span>
            </div>
            <el-input-number v-model="settings.nudgeStep" :min="0.1" :max="100" :step="1" size="small"
              @change="onNudgeStepChange" />
          </div>
        </div>
      </div>
    </AppDialog>

    <!-- Guides Dialog (positions edit live; Clear All empties the guide layer) -->
    <AppDialog
      v-model="guidesVisible"
      title="Guides"
      :width="380"
      :show-footer="false"
    >
      <template #footer>
        <el-button size="small" @click="guidesVisible = false">Close</el-button>
      </template>
      <div class="settings-body app-settings">
        <div v-if="guideRows.length === 0" class="setting-desc">No guides yet — drag one out from a ruler.</div>
        <div v-for="g in guideRows" :key="g.id" class="setting-row">
          <div class="setting-label">
            <span class="setting-name">{{ g.orientation === 'vertical' ? 'Vertical X' : 'Horizontal Y' }}</span>
          </div>
          <el-input-number :model-value="g.position" :precision="1" size="small" style="width: 130px" @change="(v: number | undefined) => onGuidePosition(g.id, v)" />
          <el-button size="small" title="Delete guide" @click="onGuideDelete(g.id)">×</el-button>
        </div>
        <div v-if="guideRows.length > 0" class="setting-row">
          <div class="setting-label">
            <span class="setting-name">All guides</span>
          </div>
          <el-button size="small" @click="onGuidesClear">Clear All</el-button>
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">At selection</span>
            <span class="setting-desc">Through the center (respects lock)</span>
          </div>
          <el-button size="small" :disabled="!store.hasSelection" @click="onGuideAtSelection('horizontal')">H</el-button>
          <el-button size="small" :disabled="!store.hasSelection" @click="onGuideAtSelection('vertical')">V</el-button>
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Margins</span>
            <span class="setting-desc">Inset rect on the active board</span>
          </div>
          <el-input-number v-model="marginValue" :min="0" :max="500" size="small" style="width: 100px" />
          <el-button size="small" @click="onMarginGuides">Add</el-button>
        </div>
      </div>
    </AppDialog>

    <!-- Preflight Dialog (print-readiness: overflow / gamut / dpi / layers) -->
    <AppDialog
      v-model="preflightVisible"
      title="Preflight"
      :width="440"
      :show-footer="false"
    >
      <template #footer>
        <el-button size="small" @click="preflightVisible = false">Close</el-button>
      </template>
      <div class="settings-body app-settings">
        <div v-if="preflightRows.length === 0" class="setting-desc">No issues — overflow, gamut, image resolution and empty layers all pass.</div>
        <div v-else class="setting-row">
          <el-button size="small" @click="selectAllIssues">Select All Flagged</el-button>
          <span class="setting-desc">{{ preflightRows.length }} finding(s), capped at 50</span>
        </div>
        <div v-for="(row, i) in preflightRows" :key="i" class="setting-row preflight-row" :class="{ clickable: !!row.itemId }" @click="row.itemId && gotoIssue(row.itemId)">
          <el-tag size="small" :type="preflightSeverity(row.kind)">{{ preflightKindLabel(row.kind) }}</el-tag>
          <span class="setting-desc">{{ row.message }}</span>
        </div>
      </div>
    </AppDialog>
  </div>
</template>

<script setup lang="ts">
/**
 * ViewMenu (C2: second menu slice out of TopBar.vue).
 *
 * The View dropdown with its dispatch plus the three dialogs it owns
 * (Canvas Settings, Guides, Preflight). Dialog body styling comes from
 * AppDialog's shared global block; everything else here is self-contained
 * (store + engine only). The settings dialog also opens from the Properties
 * panel and the tool rail through store.ui.settingsOpen — all flips land
 * here regardless of who raised them.
 */
import { ref, reactive, computed, inject, watch, type Ref } from 'vue'
import { Check } from '@element-plus/icons-vue'
import AppDialog from '../ui/AppDialog.vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import {
  PAGE_PRESETS,
  matchPagePreset,
  preflightKindLabel,
  preflightSeverity,
} from '../../editor/topbar-dialogs'
import type { RulerUnit } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

function blurMenuFocus() {
  const ae = document.activeElement as HTMLElement | null
  if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur()
}

const settingsVisible = computed({
  get: () => store.ui.settingsOpen,
  set: (v: boolean) => store.setSettingsOpen(v),
})
// The form is seeded once at setup, but the dialog can also be opened from
// the Properties panel and the tool rail (which only flip settingsOpen), so
// re-sync on every open. Otherwise the stale page size overwrote the active
// artboard on the next Page Size change.
watch(
  () => store.ui.settingsOpen,
  (open) => {
    if (open) syncSettingsFromStore()
  }
)
const guidesVisible = ref(false)
const guidesTick = ref(0)
/** Guide rows (rebuilt on open + every guide op + history jumps). */
const guideRows = computed(() => {
  void guidesTick.value
  void store.historyIndex
  void guidesVisible.value
  return engineRef?.value?.listGuides() ?? []
})
function openGuidesDialog() {
  guidesTick.value++
  guidesVisible.value = true
}
function onGuidePosition(id: string, v: number | undefined) {
  const e = engineRef?.value
  if (!e || v === undefined || !Number.isFinite(v)) {
    guidesTick.value++
    return
  }
  if (e.moveGuideById(id, v)) {
    e.pushHistory('Move Guide')
  } else {
    store.setStatusMessage('Guide not found')
  }
  guidesTick.value++
}
function onGuideDelete(id: string) {
  const e = engineRef?.value
  if (!e) return
  if (e.deleteGuideById(id)) {
    e.pushHistory('Delete Guide')
  }
  guidesTick.value++
}
function onGuidesClear() {
  const e = engineRef?.value
  if (!e) return
  e.clearGuides()
  e.pushHistory('Clear Guides')
  guidesTick.value++
}
function onGuideAtSelection(orientation: 'horizontal' | 'vertical') {
  const e = engineRef?.value
  if (!e) return
  if (!e.guideAtSelection(orientation)) {
    store.setStatusMessage(store.view.guidesLocked ? 'Guides are locked' : 'Select objects first')
    return
  }
  guidesTick.value++
}
const marginValue = ref(36)
function onMarginGuides() {
  const e = engineRef?.value
  const board = store.activeArtboard
  if (!e || !board) return
  const n = e.addMarginGuides(board.id, Number(marginValue.value) || 0)
  if (n === 0) {
    store.setStatusMessage(store.view.guidesLocked ? 'Guides are locked' : 'Margin must fit inside the board')
    return
  }
  guidesTick.value++
}

const preflightVisible = ref(false)
const preflightTick = ref(0)
const preflightRows = computed(() => {
  void preflightTick.value
  void store.historyIndex
  void preflightVisible.value
  try {
    return engineRef?.value?.preflight() ?? []
  } catch {
    return []
  }
})
function openPreflight() {
  preflightTick.value++
  preflightVisible.value = true
}
function selectAllIssues() {
  const e = engineRef?.value
  if (!e) return
  const ids = preflightRows.value.map((r) => r.itemId).filter(Boolean)
  if (ids.length === 0) return
  const n = e.selectByIds(ids)
  store.setStatusMessage(`Selected ${n} flagged object${n === 1 ? '' : 's'}`)
}
function gotoIssue(id: string) {
  engineRef?.value?.selectItemById(id)
}

const settings = reactive({
  rulers: store.view.rulersVisible,
  grid: store.view.showGrid,
  gridSize: store.snap.gridSize,
  transparent: store.view.transparentBackground,
  unit: store.rulerUnit as RulerUnit,
  snap: store.snap.enable,
  snapGrid: store.snap.grid,
  snapGuides: store.snap.guides,
  snapPoint: store.snap.point,
  smartGuides: store.snap.smartGuides,
  pageWidth: store.activeArtboard?.width ?? store.pageSize.width,
  pageHeight: store.activeArtboard?.height ?? store.pageSize.height,
  pagePreset: matchPagePreset(
    store.activeArtboard?.width ?? store.pageSize.width,
    store.activeArtboard?.height ?? store.pageSize.height
  ),
  bleed: store.bleed,
  nudgeStep: store.nudgeStep,
})

const units = [
  { value: 'px', label: 'px' },
  { value: 'pt', label: 'pt' },
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
  { value: 'in', label: 'in' },
]

function onViewCmd(cmd: string) {
  blurMenuFocus()
  const e = engineRef?.value
  if (!e) return
  switch (cmd) {
    case 'fitAll':
      e.fitToContent()
      break
    case 'zoomSelection':
      e.zoomToSelection()
      break
    case 'zoomArtboard':
      e.zoomToArtboard()
      break
    case 'zoomIn':
      e.zoomAt(1.2, e.canvas.width / 2, e.canvas.height / 2)
      break
    case 'zoomOut':
      e.zoomAt(1 / 1.2, e.canvas.width / 2, e.canvas.height / 2)
      break
    case 'zoom100':
      e.zoomToActualSize()
      break
    case 'rulers':
      toggleRulers()
      break
    case 'grid':
      toggleGrid()
      break
    case 'guides':
      store.updateView({ showGuides: !store.view.showGuides })
      break
    case 'guidesDialog':
      openGuidesDialog()
      break
    case 'lockGuides':
      store.updateView({ guidesLocked: !store.view.guidesLocked })
      break
    case 'transparentBg':
      toggleTransparent()
      break
    case 'cmykPreview': {
      const next = store.view.proofMode === 'cmyk' ? 'rgb' : 'cmyk'
      store.updateView({ proofMode: next })
      store.setStatusMessage(next === 'cmyk' ? 'CMYK proof on (numeric preview)' : 'CMYK proof off')
      break
    }
    case 'boundingBox': {
      store.updateView({ showBoundingBox: !store.view.showBoundingBox })
      const select = e.getController('select') as { dropFrame?: () => void; refreshSelectionChrome?: () => void } | null
      select?.dropFrame?.()
      try {
        select?.refreshSelectionChrome?.()
      } catch { /* chrome repaint is best effort */ }
      break
    }
    case 'pixelPreview': {
      const next = !store.view.pixelPreview
      store.updateView({ pixelPreview: next })
      store.setStatusMessage(next ? `Pixel preview on (${store.view.pixelRatio}x)` : 'Pixel preview off')
      break
    }
    case 'pixelRatio': {
      const next = store.view.pixelRatio === 2 ? 1 : 2
      store.updateView({ pixelRatio: next })
      store.setStatusMessage(`Pixel ratio ${next}x`)
      break
    }
    case 'navigator':
      store.setShowNavigator(!store.ui.showNavigator)
      break
    case 'presentation':
      store.setZenMode(!store.ui.zenMode)
      break
    case 'preflight':
      openPreflight()
      break
    case 'controlBar':
      store.setShowControlBar(!store.ui.showControlBar)
      break
    case 'canvasSettings':
      settingsVisible.value = true
      syncSettingsFromStore()
      break
  }
}

function toggleRulers() {
  store.updateView({ rulersVisible: !store.view.rulersVisible })
  settings.rulers = store.view.rulersVisible
}

function toggleGrid() {
  store.updateView({ showGrid: !store.view.showGrid })
  settings.grid = store.view.showGrid
  const e = engineRef?.value
  if (e) e.refreshGrid()
}

function toggleTransparent() {
  store.updateView({ transparentBackground: !store.view.transparentBackground })
  settings.transparent = store.view.transparentBackground
}

function syncSettingsFromStore() {
  settings.rulers = store.view.rulersVisible
  settings.grid = store.view.showGrid
  settings.gridSize = store.snap.gridSize
  settings.transparent = store.view.transparentBackground
  settings.unit = store.rulerUnit as RulerUnit
  settings.snap = store.snap.enable
  settings.snapGrid = store.snap.grid
  settings.snapGuides = store.snap.guides
  settings.snapPoint = store.snap.point
  settings.smartGuides = store.snap.smartGuides
  settings.nudgeStep = store.nudgeStep
  settings.bleed = store.bleed
  syncPageSettings()
}

function onRulersToggle(val: boolean) {
  store.updateView({ rulersVisible: val })
}

function onGridToggle(val: boolean) {
  store.updateView({ showGrid: val })
  const e = engineRef?.value
  if (e) e.refreshGrid()
}

function onGridSizeChange(val: number | undefined) {
  if (!val) return
  store.updateSnap({ gridSize: val })
  const e = engineRef?.value
  if (e) e.refreshGrid()
}

function onTransparentToggle(val: boolean) {
  store.updateView({ transparentBackground: val })
}

function onSnapToggle(val: boolean) {
  store.updateSnap({ enable: val })
}

function onSnapGridToggle(val: boolean) {
  store.updateSnap({ grid: val })
}

function onSnapGuidesToggle(val: boolean) {
  store.updateSnap({ guides: val })
}

function onSnapPointToggle(val: boolean) {
  store.updateSnap({ point: val })
}

function onSmartGuidesToggle(val: boolean) {
  store.updateSnap({ smartGuides: val })
}

function syncPageSettings() {
  const board = store.activeArtboard
  settings.pageWidth = board?.width ?? store.pageSize.width
  settings.pageHeight = board?.height ?? store.pageSize.height
  settings.pagePreset = matchPagePreset(settings.pageWidth, settings.pageHeight)
}

/** Resize the active artboard (page visuals redraw with it). */
function resizeActiveBoard(width: number, height: number) {
  const board = store.activeArtboard
  if (!board) return
  const e = engineRef?.value
  if (e) {
    e.resizeArtboard(board.id, width, height)
  } else {
    store.updateArtboard(board.id, { width, height })
  }
}

function onPagePresetChange(value: string) {
  if (value === 'custom') return
  const [width, height] = value.split('x').map(Number)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return
  resizeActiveBoard(width, height)
  syncPageSettings()
}

function onPageSizeChange() {
  const width = Math.round(settings.pageWidth)
  const height = Math.round(settings.pageHeight)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    syncPageSettings()
    return
  }
  resizeActiveBoard(width, height)
  settings.pagePreset = matchPagePreset(width, height)
}

function onPageOrientationSwap() {
  const board = store.activeArtboard
  if (!board) return
  resizeActiveBoard(board.height, board.width)
  syncPageSettings()
}

/** Bleed change: persist, redraw the dashed bleed guides, confirm. */
function onBleedChange(val: number | undefined) {
  if (val === undefined || !Number.isFinite(val)) {
    settings.bleed = store.bleed
    return
  }
  const before = store.bleed
  store.setBleed(val)
  settings.bleed = store.bleed
  const e = engineRef?.value
  if (e) {
    e.refreshArtboards()
    if (settings.bleed !== before) e.pushHistory('Change Bleed')
  }
}

function onUnitChange(val: string) {
  store.setRulerUnit(val as RulerUnit)
  store.setStatusMessage(`Ruler unit: ${val}`)
}

function onNudgeStepChange(val: number | undefined) {
  if (!val) {
    settings.nudgeStep = store.nudgeStep
    return
  }
  store.setNudgeStep(val)
  settings.nudgeStep = store.nudgeStep
}
</script>

<style scoped>
/* Menu trigger shared with the bar (duplicated: scoped CSS does not cross
   the component boundary). */
.menu-label {
  display: inline-block;
  padding: 4px 8px;
  font-size: 13px;
  cursor: pointer;
  border-radius: 3px;
  color: #ccc;
}

.menu-label:hover {
  background: #3a3a3a;
  color: #fff;
}

/* Canvas Settings page-size row: keep W/Swap/H on one line with equal
   input widths (rules lost when the dialog moved out of TopBar). */
.page-size-inputs {
  display: flex;
  align-items: center;
  gap: 4px;
}

.page-size-inputs .el-input-number {
  width: 90px;
}

/* Preflight rows: tag + message side by side, clickable rows give
   hover feedback and the message fills the remaining width. */
.preflight-row {
  align-items: flex-start;
  gap: 8px;
}

.preflight-row.clickable {
  cursor: pointer;
}

.preflight-row.clickable:hover .setting-desc {
  color: #d5d5d5;
}

.preflight-row .setting-desc {
  flex: 1;
  margin-top: 0;
  line-height: 1.5;
}
</style>
