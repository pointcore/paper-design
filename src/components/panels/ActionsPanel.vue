<template>
  <div class="actions-panel ai-panel">
    <div class="panel-section">
      <div class="sec-title">Workspace</div>
      <el-radio-group v-model="workspace" size="small" @change="onWorkspace">
        <el-radio-button value="essentials">Essentials</el-radio-button>
        <el-radio-button value="typography">Typography</el-radio-button>
        <el-radio-button value="print">Print</el-radio-button>
      </el-radio-group>
      <div class="hint">{{ workspaceHint }}</div>
      <div class="row">
        <el-button size="small" class="grid-btn" :type="store.ui.showControlBar ? 'primary' : ''" @click="store.setShowControlBar(!store.ui.showControlBar)">Control Bar</el-button>
        <el-button size="small" class="grid-btn" :type="store.ui.showNavigator ? 'primary' : ''" @click="store.setShowNavigator(!store.ui.showNavigator)">Navigator</el-button>
      </div>
      <div class="row">
        <el-button size="small" class="grid-btn" @click="store.setToolRailDensity(store.ui.toolRailDensity === 'single' ? 'double' : 'single')">
          Rail: {{ store.ui.toolRailDensity === 'single' ? 'Single' : 'Double' }}
        </el-button>
      </div>
    </div>

    <div class="panel-section">
      <div class="sec-title">Asset Export <span class="sec-hint">selection / artwork / page</span></div>
      <div class="row">
        <el-select v-model="area" size="small" style="width: 120px">
          <el-option value="selection" label="Selection" :disabled="!store.hasSelection" />
          <el-option value="artwork" label="Artwork" />
          <el-option value="page" label="Page" />
        </el-select>
        <el-select v-model="format" size="small" style="width: 90px">
          <el-option value="png" label="PNG" />
          <el-option value="jpeg" label="JPEG" />
          <el-option value="webp" label="WebP" />
        </el-select>
      </div>
      <div class="row">
        <el-button v-for="s in [1, 2, 3]" :key="s" size="small" class="grid-btn" @click="exportOne(s)">{{ s }}x</el-button>
        <el-button size="small" class="grid-btn" @click="exportAll">1x+2x+3x</el-button>
      </div>
      <div class="hint">Multi-scale export downloads one file per scale (asset-workflow parity).</div>
    </div>

    <div class="panel-section">
      <div class="sec-title">Keyboard Shortcuts</div>
      <div class="sc-list">
        <div v-for="s in shortcuts" :key="s.label + s.tool" class="sc-row">
          <span class="sc-tool">{{ s.tool }}</span>
          <span class="sc-key">{{ s.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, inject, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { RasterExportArea, RasterExportFormat, WorkspacePreset } from '../../editor/types'
import { TOOL_SHORTCUTS } from '../../editor/shortcuts'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const workspace = computed({
  get: () => store.ui.workspace,
  set: (v: WorkspacePreset) => store.setWorkspace(v),
})
const workspaceHint = computed(() => {
  switch (store.ui.workspace) {
    case 'typography': return 'Typography: Properties tab holds Character/Paragraph controls.'
    case 'print': return 'Print: CMYK Preview + bleed live in Canvas Settings.'
    default: return 'Essentials: balanced panels for drawing and layout.'
  }
})
function onWorkspace(v: string) {
  const preset = v as WorkspacePreset
  store.setWorkspace(preset)
  // Workspaces rearrange the dock instead of hiding tools.
  if (preset === 'typography') {
    store.setShowControlBar(true)
    store.setShowNavigator(false)
    store.setToolRailDensity('single')
    store.setRightTab('property')
  } else if (preset === 'print') {
    store.setShowControlBar(true)
    store.setShowNavigator(true)
    store.setToolRailDensity('single')
    store.updateView({ proofMode: 'cmyk' })
    store.setRightTab('property')
  } else {
    store.setShowControlBar(true)
    store.setShowNavigator(true)
    store.setToolRailDensity('single')
    store.updateView({ proofMode: 'rgb' })
    store.setRightTab('property')
  }
  persistUiPrefs()
  store.setStatusMessage(`Workspace: ${preset}`)
}

/** Persist dock prefs across reloads (best effort). */
function persistUiPrefs() {
  try {
    localStorage.setItem('vve.ui', JSON.stringify({
      workspace: store.ui.workspace,
      density: store.ui.toolRailDensity,
      controlBar: store.ui.showControlBar,
      navigator: store.ui.showNavigator,
      panelWidth: store.ui.panelWidth,
    }))
  } catch { /* private mode */ }
}

// Keep stored prefs in sync when the dock buttons toggle them.
watch(
  () => [store.ui.toolRailDensity, store.ui.showControlBar, store.ui.showNavigator, store.ui.workspace].join('|'),
  () => persistUiPrefs()
)

const area = ref<RasterExportArea>('artwork')
const format = ref<RasterExportFormat>('png')

function downloadHref(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}

function exportOne(scale: number) {
  const e = engineRef?.value
  if (!e) return
  if (area.value === 'selection' && !store.hasSelection) {
    store.setStatusMessage('Nothing selected to export')
    return
  }
  try {
    const url = e.exportRaster({ format: format.value, scale, area: area.value })
    if (!url) { store.setStatusMessage('Raster export failed'); return }
    downloadHref(url, `asset-${area.value}-${scale}x.${format.value}`)
    store.setStatusMessage(`Asset exported (${format.value.toUpperCase()} ${scale}x)`)
  } catch { store.setStatusMessage('Raster export failed') }
}
function exportAll() {
  for (const s of [1, 2, 3]) exportOne(s)
}

const shortcuts = computed(() =>
  (Object.entries(TOOL_SHORTCUTS) as Array<[string, { label: string } | null]>)
    .filter(([, def]) => !!def)
    .map(([tool, def]) => ({ tool, label: (def as { label: string }).label }))
    .sort((a, b) => a.tool.localeCompare(b.tool))
)
</script>

<style scoped>
.ai-panel { background: #252526; color: #c9c9c9; font-size: 12px; display: flex; flex-direction: column; min-height: 100%; padding: 8px; gap: 10px; }
.panel-section { border-bottom: 1px solid #1e1e1e; padding-bottom: 10px; display: flex; flex-direction: column; gap: 6px; }
.sec-title { font-size: 11px; color: #dcdcdc; font-weight: 600; letter-spacing: 0.5px; }
.sec-hint { color: #8a8a8a; font-weight: 400; }
.hint { font-size: 11px; color: #8a8a8a; line-height: 1.5; }
.row { display: flex; gap: 4px; }
.grid-btn { flex: 1; margin: 0 !important; }
.sc-list { display: flex; flex-direction: column; max-height: 260px; overflow-y: auto; }
.sc-row { display: flex; justify-content: space-between; padding: 3px 2px; border-bottom: 1px solid #1e1e1e; font-size: 11px; }
.sc-tool { color: #d5d5d5; text-transform: capitalize; }
.sc-key { color: #8a8a8a; font-variant-numeric: tabular-nums; }
.ai-panel :deep(.el-button--small) { background: #333; border: 1px solid #4a4a4a; color: #d5d5d5; border-radius: 3px; height: 24px; font-size: 11px; }
.ai-panel :deep(.el-button--small.el-button--primary) { background: #2f6fbf; border-color: #2f6fbf; color: #fff; }
.ai-panel :deep(.el-radio-button__inner) { background: #1a1a1a; border-color: #3d3d3d; color: #b5b5b5; font-size: 11px; padding: 5px 6px; box-shadow: none; }
.ai-panel :deep(.el-radio-button__orig-radio:checked + .el-radio-button__inner) { background: #2f6fbf; border-color: #2f6fbf; color: #fff; }
</style>
