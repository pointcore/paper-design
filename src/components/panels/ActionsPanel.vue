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
      <div class="sec-title">Export Presets <span class="sec-hint">one-click hand-off</span></div>
      <div class="row">
        <el-select v-model="presetId" size="small" style="flex: 1" placeholder="Choose a preset">
          <el-option v-for="p in allPresets" :key="p.id" :value="p.id" :label="`${p.name} · ${describeExportPreset(p)}`" />
        </el-select>
        <el-button size="small" class="grid-btn" @click="runPreset">Run</el-button>
      </div>
      <div class="row">
        <el-input v-model="presetName" size="small" placeholder="Save current area + format as preset" @keyup.enter="savePreset" />
        <el-button size="small" class="grid-btn" @click="savePreset">Save</el-button>
      </div>
      <div v-for="p in customPresets" :key="p.id" class="sc-row">
        <span class="sc-tool">{{ p.name }} · {{ describeExportPreset(p) }}</span>
        <el-button size="small" type="danger" plain @click="removePreset(p.id)">×</el-button>
      </div>
    </div>

    <div class="panel-section">
      <div class="sec-title">N-up Imposition</div>
      <div class="row">
        <el-select v-model="nUpCount" size="small" style="width: 100px">
          <el-option :value="2" label="2-up" />
          <el-option :value="4" label="4-up" />
          <el-option :value="6" label="6-up" />
          <el-option :value="9" label="9-up" />
          <el-option :value="16" label="16-up" />
        </el-select>
        <el-button size="small" class="grid-btn" @click="exportNUp('svg')">SVG</el-button>
        <el-button size="small" class="grid-btn" @click="exportNUp('pdf')">PDF</el-button>
      </div>
      <div class="hint">Arrange artboards on a single sheet for print.</div>
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

    <div class="panel-section">
      <div class="sec-title">Command Keys</div>
      <div class="sc-list">
        <div v-for="c in commandShortcuts" :key="c.label" class="sc-row">
          <span class="sc-tool">{{ c.desc }}</span>
          <span class="sc-key">{{ c.label }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, inject, onMounted, type Ref } from 'vue'
import JSZip from 'jszip'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { RasterExportArea, RasterExportFormat, WorkspacePreset } from '../../editor/types'
import { COMMAND_SHORTCUTS, TOOL_SHORTCUTS } from '../../editor/shortcuts'
import {
  cleanExportPresets,
  defaultExportPresets,
  describeExportPreset,
  type ExportPreset,
} from '../../editor/export-presets'

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
      panelCollapsed: store.ui.panelCollapsed,
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
    // Page-area exports carry the board name so multi-board files sort apart.
    const label = area.value === 'page'
      ? (store.activeArtboard?.name || 'page').replace(/[\/:*?"<>|]+/g, '-').slice(0, 40)
      : area.value
    downloadHref(url, `asset-${label}-${scale}x.${format.value}`)
    store.setStatusMessage(`Asset exported (${format.value.toUpperCase()} ${scale}x)`)
  } catch { store.setStatusMessage('Raster export failed') }
}
async function exportAll(scales: number[] = [1, 2, 3]) {
  const e = engineRef?.value
  if (!e) return
  if (area.value === 'selection' && !store.hasSelection) {
    store.setStatusMessage('Nothing selected to export')
    return
  }
  const zip = new JSZip()
  let exported = 0
  for (const s of scales) {
    const url = e.exportRaster({ format: format.value, scale: s, area: area.value })
    if (!url) continue
    const label = area.value === 'page'
      ? (store.activeArtboard?.name || 'page').replace(/[\/:*?"<>|]+/g, '-').slice(0, 40)
      : area.value
    const filename = `asset-${label}-${s}x.${format.value}`
    // Convert data URL to blob for ZIP storage.
    const res = await fetch(url)
    const blob = await res.blob()
    zip.file(filename, blob)
    exported++
  }
  if (exported > 0) {
    const blob = await zip.generateAsync({ type: 'blob' })
    downloadHref(URL.createObjectURL(blob), 'assets-export.zip')
    store.setStatusMessage(`Exported ${exported} assets as ZIP`)
  } else {
    store.setStatusMessage('Raster export failed')
  }
}

const commandShortcuts = COMMAND_SHORTCUTS

// Named export presets: built-ins plus user customs (persisted).
const builtInPresets = defaultExportPresets()
const customPresets = ref<ExportPreset[]>([])
const allPresets = computed<ExportPreset[]>(() => [...customPresets.value, ...builtInPresets])
const presetId = ref(builtInPresets[0].id)
const presetName = ref('')

function persistPresets() {
  try {
    localStorage.setItem('vve.exportPresets', JSON.stringify(customPresets.value))
  } catch { /* private mode */ }
}

function savePreset() {
  const clean = presetName.value.trim().slice(0, 40) || `Preset ${customPresets.value.length + 1}`
  const id = `preset-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
  customPresets.value = [
    { id, name: clean, area: area.value, format: format.value, scales: [1] },
    ...customPresets.value,
  ].slice(0, 24)
  presetId.value = id
  presetName.value = ''
  persistPresets()
  store.setStatusMessage(`Export preset "${clean}" saved`)
}

function removePreset(id: string) {
  customPresets.value = customPresets.value.filter((p) => p.id !== id)
  if (presetId.value === id) presetId.value = builtInPresets[0].id
  persistPresets()
}

function runPreset() {
  const preset = allPresets.value.find((p) => p.id === presetId.value)
  if (!preset) {
    store.setStatusMessage('Choose an export preset')
    return
  }
  area.value = preset.area
  format.value = preset.format
  if (preset.scales.length === 1) {
    exportOne(preset.scales[0])
  } else {
    exportAll([...preset.scales])
  }
}

onMounted(() => {
  try {
    const raw = localStorage.getItem('vve.exportPresets')
    if (raw) customPresets.value = cleanExportPresets(JSON.parse(raw))
  } catch { /* corrupt storage: defaults stand */ }
})

const shortcuts = computed(() =>
  (Object.entries(TOOL_SHORTCUTS) as Array<[string, { label: string } | null]>)
    .filter(([, def]) => !!def)
    .map(([tool, def]) => ({ tool, label: (def as { label: string }).label }))
    .sort((a, b) => a.tool.localeCompare(b.tool))
)

// N-up imposition
const nUpCount = ref(4)

async function exportNUp(format: 'svg' | 'pdf' = 'svg') {
  const e = engineRef?.value
  if (!e) return
  const boards = store.artboards.filter((b) => b.width > 0 && b.height > 0)
  if (boards.length === 0) {
    store.setStatusMessage('No artboards to impose')
    return
  }
  try {
    const svg = e.exportNUpSVG(boards, { upCount: nUpCount.value, spacing: 12, margin: 36 })
    if (!svg) {
      store.setStatusMessage('N-up export failed')
      return
    }
    if (format === 'pdf') {
      const { jsPDF } = await import('jspdf')
      const { svg2pdf } = await import('svg2pdf.js')
      const w = parseFloat(svg.getAttribute('width') || '800')
      const h = parseFloat(svg.getAttribute('height') || '600')
      const doc = new jsPDF({
        orientation: w >= h ? 'landscape' : 'portrait',
        unit: 'pt',
        format: [w, h],
        compress: true,
      })
      await svg2pdf(svg, doc, { x: 0, y: 0, width: w, height: h })
      doc.save(`imposition-${nUpCount.value}up.pdf`)
      store.setStatusMessage(`N-up imposition exported as PDF (${nUpCount.value}-up)`)
    } else {
      const str = new XMLSerializer().serializeToString(svg)
      downloadHref(URL.createObjectURL(new Blob([str], { type: 'image/svg+xml' })), `imposition-${nUpCount.value}up.svg`)
      store.setStatusMessage(`N-up imposition exported (${nUpCount.value}-up)`)
    }
  } catch {
    store.setStatusMessage('N-up export failed')
  }
}
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
