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
        <el-input v-model="presetName" size="small" placeholder="Save current area, format + scales as preset" @keyup.enter="savePreset" />
        <el-button size="small" class="grid-btn" @click="savePreset">Save</el-button>
      </div>
      <div v-for="p in customPresets" :key="p.id" class="sc-row">
        <span class="sc-tool">{{ p.name }} · {{ describeExportPreset(p) }}</span>
        <el-button size="small" type="danger" plain @click="removePreset(p.id)">×</el-button>
      </div>
    </div>

    <div class="panel-section">
      <div class="sec-title">N-up Imposition</div>      <div class="row">
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
      <div class="sec-title">Data Merge <span class="sec-hint">CSV → one board per row</span></div>
      <div class="row">
        <input type="file" accept=".csv,text/csv" class="file-input" @change="loadMergeFile" />
      </div>
      <el-input
        v-model="mergeCsv"
        type="textarea"
        :rows="5"
        size="small"
        placeholder="name,title&#10;Ada,Engineer&#10;Bob,Designer"
        class="merge-text"
      />
      <div class="row">
        <el-input v-model="mergeTitle" size="small" placeholder="Title: {{name}}" />
      </div>
      <div class="row">
        <el-input v-model="mergeBody" size="small" placeholder="Body: {{title}}" />
      </div>
      <div class="hint">{{ mergeHint }}</div>
      <div class="row">
        <el-button size="small" class="grid-btn" :disabled="mergeRecords.length === 0" @click="runMerge">
          Generate {{ mergeRecords.length > 0 ? `${mergeRecords.length} board${mergeRecords.length === 1 ? '' : 's'}` : '' }}
        </el-button>
      </div>
    </div>

    <div class="panel-section">
      <div class="sec-title">Versions <span class="sec-hint">named milestones + diff replay</span></div>
      <div class="row">
        <el-input v-model="versionName" size="small" placeholder="Version name" @keyup.enter="saveVersion" />
        <el-button size="small" class="grid-btn" @click="saveVersion">Save</el-button>
      </div>
      <div class="hint">{{ versionHint }}</div>
      <div v-for="v in namedVersions" :key="v.id" class="sc-row">
        <span class="sc-tool">{{ v.name }} · {{ describeVersion(v) }}</span>
        <span class="ver-actions">
          <el-button size="small" plain @click="previewVersion(v.id)">{{ diffVersionId === v.id ? 'Hide' : 'Diff' }}</el-button>
          <el-button size="small" plain @click="restoreVersion(v.id)">Restore</el-button>
          <el-button size="small" type="danger" plain @click="removeVersion(v.id)">×</el-button>
        </span>
      </div>
      <div v-if="diffLines.length > 0" class="diff-list">
        <div v-for="(line, i) in diffLines" :key="i" class="diff-line">{{ line }}</div>
      </div>
    </div>

    <div class="panel-section">
      <div class="sec-title">Action Batch <span class="sec-hint">record once, replay on selection</span></div>
      <div class="row">
        <el-select v-model="batchOp" size="small" style="flex: 1">
          <el-option value="nudge" label="Nudge" />
          <el-option value="align" label="Align" />
          <el-option value="distribute" label="Distribute" />
          <el-option value="distributeSpacing" label="Distribute spacing" />
          <el-option value="boolean" label="Boolean" />
        </el-select>
        <el-button size="small" :type="recording ? 'danger' : ''" @click="toggleRecording">{{ recording ? 'Stop' : 'Record' }}</el-button>
      </div>
      <div class="row" v-if="batchOp === 'nudge'">
        <el-input v-model="batchDx" size="small" placeholder="dx" />
        <el-input v-model="batchDy" size="small" placeholder="dy" />
        <el-button size="small" class="grid-btn" @click="runBatchStep">Run</el-button>
      </div>
      <div class="row" v-if="batchOp === 'align'">
        <el-select v-model="batchMode" size="small" style="flex: 1">
          <el-option value="left" label="Left" />
          <el-option value="centerX" label="Center X" />
          <el-option value="right" label="Right" />
          <el-option value="top" label="Top" />
          <el-option value="centerY" label="Center Y" />
          <el-option value="bottom" label="Bottom" />
        </el-select>
        <el-button size="small" class="grid-btn" @click="runBatchStep">Run</el-button>
      </div>
      <div class="row" v-if="batchOp === 'distribute' || batchOp === 'distributeSpacing'">
        <el-select v-model="batchAxis" size="small" style="flex: 1">
          <el-option value="horizontal" label="Horizontal" />
          <el-option value="vertical" label="Vertical" />
        </el-select>
        <el-button size="small" class="grid-btn" @click="runBatchStep">Run</el-button>
      </div>
      <div class="row" v-if="batchOp === 'boolean'">
        <el-select v-model="batchBool" size="small" style="flex: 1">
          <el-option value="unite" label="Unite" />
          <el-option value="subtract" label="Subtract" />
          <el-option value="intersect" label="Intersect" />
          <el-option value="exclude" label="Exclude" />
        </el-select>
        <el-button size="small" class="grid-btn" @click="runBatchStep">Run</el-button>
      </div>
      <div class="hint">{{ batchHint }}</div>
      <div v-for="(s, i) in recordedSteps" :key="i" class="sc-row">
        <span class="sc-tool">{{ i + 1 }}. {{ describeStep(s) }}</span>
        <el-button size="small" type="danger" plain @click="dropRecordedStep(i)">×</el-button>
      </div>
      <div class="row" v-if="recordedSteps.length > 0">
        <el-input v-model="batchName" size="small" placeholder="Batch name" @keyup.enter="saveBatch" />
        <el-button size="small" class="grid-btn" @click="saveBatch">Save</el-button>
      </div>
      <div v-for="a in namedActions" :key="a.id" class="sc-row">
        <span class="sc-tool">{{ a.name }} · {{ describeAction(a) }}</span>
        <span class="ver-actions">
          <el-button size="small" plain @click="replayAction(a.id)">Replay</el-button>
          <el-button size="small" type="danger" plain @click="removeAction(a.id)">×</el-button>
        </span>
      </div>
    </div>

    <div class="panel-section">
      <div class="sec-title">Bitmap Trace <span class="sec-hint">placed raster → paths</span></div>
      <div class="row">
        <el-select v-model="traceColors" size="small" style="flex: 1">
          <el-option :value="2" label="2 colors" />
          <el-option :value="4" label="4 colors" />
          <el-option :value="8" label="8 colors" />
          <el-option :value="16" label="16 colors" />
        </el-select>
        <el-select v-model="traceDetail" size="small" style="flex: 1">
          <el-option value="low" label="Low detail" />
          <el-option value="medium" label="Medium detail" />
          <el-option value="high" label="High detail" />
        </el-select>
      </div>
      <div class="row">
        <el-button size="small" class="grid-btn" :loading="tracing" @click="runTrace">Trace selected bitmap</el-button>
      </div>
      <div class="hint">Replaces one selected bitmap in place (512px cap, single undo).</div>
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
// JSZip loads on demand with the export (keeps this async chunk lean until
// a multi-scale ZIP is actually requested).
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { AlignMode, BooleanOperation, DistributeAxis, RasterExportArea, RasterExportFormat, WorkspacePreset } from '../../editor/types'
import { COMMAND_SHORTCUTS, TOOL_SHORTCUTS } from '../../editor/shortcuts'
import {
  cleanExportPresets,
  defaultExportPresets,
  describeExportPreset,
  type ExportPreset,
} from '../../editor/export-presets'
import {
  MAX_MERGE_ROWS,
  parseCsv,
  recordsFromCsv,
  templateFields,
} from '../../editor/data-merge'
import {
  MAX_VERSIONS,
  cleanVersions,
  createNamedVersion,
  describeVersion,
  diffProjectFiles,
  isValidNamedVersion,
  type NamedVersion,
} from '../../editor/versions'
import {
  MAX_ACTIONS,
  MAX_STEPS_PER_ACTION,
  cleanActions,
  createNamedAction,
  describeAction,
  describeStep,
  isValidActionStep,
  runActionSteps,
  type ActionOp,
  type ActionStep,
  type NamedAction,
} from '../../editor/action-batch'
import { cleanTraceOptions, type TraceDetail } from '../../editor/trace'
import { withBusy } from '../../editor/busy'

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

// Scales the user actually exported with most recently (1x/2x/3x buttons
// or the full-set ZIP) — presets snapshot this instead of a hardcoded [1].
const lastExportScales = ref<number[]>([1])

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
    lastExportScales.value = [scale]
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
  const zip = new (await import('jszip')).default()
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
    lastExportScales.value = [...scales]
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
    { id, name: clean, area: area.value, format: format.value, scales: [...lastExportScales.value] },
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
  try {
    const mraw = localStorage.getItem('vve.datamerge')
    if (mraw) {
      const saved = JSON.parse(mraw) as { csv?: unknown; title?: unknown; body?: unknown }
      if (typeof saved.csv === 'string') mergeCsv.value = saved.csv.slice(0, 200000)
      if (typeof saved.title === 'string') mergeTitle.value = saved.title.slice(0, 200)
      if (typeof saved.body === 'string') mergeBody.value = saved.body.slice(0, 2000)
    }
  } catch { /* corrupt storage: defaults stand */ }
  try {
    const vraw = localStorage.getItem('vve.versions')
    if (vraw) namedVersions.value = cleanVersions(JSON.parse(vraw))
  } catch { /* corrupt storage: start empty */ }
  try {
    const araw = localStorage.getItem('vve.actions')
    if (araw) namedActions.value = cleanActions(JSON.parse(araw))
  } catch { /* corrupt storage: start empty */ }
})

// Data merge: CSV pasted or dropped in, one artboard per row.
const mergeCsv = ref('')
const mergeTitle = ref('{{name}}')
const mergeBody = ref('{{title}}')

const mergeParsed = computed(() => {
  try {
    return parseCsv(mergeCsv.value)
  } catch {
    return { headers: [], rows: [] }
  }
})

const mergeRecords = computed(() => recordsFromCsv(mergeParsed.value))

const mergeHint = computed(() => {
  const p = mergeParsed.value
  if (!mergeCsv.value.trim()) return 'Paste CSV or choose a file. First row is the header.'
  if (p.headers.length === 0) return 'No header row found.'
  const known = new Set(p.headers)
  const unknown = [...templateFields(mergeTitle.value), ...templateFields(mergeBody.value)]
    .filter((f) => f && !known.has(f))
    .filter((f, i, arr) => arr.indexOf(f) === i)
  const base = `${mergeRecords.value.length} row${mergeRecords.value.length === 1 ? '' : 's'} × ${p.headers.length} field${p.headers.length === 1 ? '' : 's'}`
  const capped = mergeRecords.value.length >= MAX_MERGE_ROWS ? ` (capped at ${MAX_MERGE_ROWS})` : ''
  return unknown.length > 0 ? `${base}${capped} · unknown: ${unknown.join(', ')}` : `${base}${capped}`
})

function loadMergeFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  if (file.size > 2 * 1024 * 1024) {
    store.setStatusMessage('CSV too large (2 MB max)')
    return
  }
  const reader = new FileReader()
  reader.onload = () => {
    mergeCsv.value = String(reader.result ?? '')
    persistMerge()
  }
  reader.onerror = () => store.setStatusMessage('Could not read CSV file')
  reader.readAsText(file)
}

function persistMerge() {
  try {
    localStorage.setItem('vve.datamerge', JSON.stringify({
      csv: mergeCsv.value.slice(0, 200000),
      title: mergeTitle.value.slice(0, 200),
      body: mergeBody.value.slice(0, 2000),
    }))
  } catch { /* private mode */ }
}

function runMerge() {
  const e = engineRef?.value
  if (!e) return
  if (mergeRecords.value.length === 0) {
    store.setStatusMessage('Nothing to merge')
    return
  }
  // A template that references fields but matches none of the CSV headers
  // would silently stamp out identical boards — refuse and say why.
  const wanted = [...templateFields(mergeTitle.value), ...templateFields(mergeBody.value)]
  const known = new Set(mergeParsed.value.headers)
  if (wanted.length > 0 && !wanted.some((f) => known.has(f))) {
    store.setStatusMessage(`No template field matches CSV headers (${wanted.join(', ')})`)
    return
  }
  const { boards, items } = e.dataMerge(mergeRecords.value, {
    titleTemplate: mergeTitle.value,
    bodyTemplate: mergeBody.value,
  })
  persistMerge()
  store.setStatusMessage(
    boards > 0 ? `Data merge: ${boards} board${boards === 1 ? '' : 's'}, ${items} text item${items === 1 ? '' : 's'}` : 'Nothing to merge',
  )
}

// Named versions: labelled project snapshots with diff-against-current replay.
const versionName = ref('')
const namedVersions = ref<NamedVersion[]>([])
const diffVersionId = ref('')
const diffLines = ref<string[]>([])

const versionHint = computed(() => {
  if (namedVersions.value.length === 0) return 'Save the current document as a named milestone.'
  if (diffVersionId.value) {
    const v = namedVersions.value.find((x) => x.id === diffVersionId.value)
    if (!v) return ''
    if (diffLines.value.length === 0) return `"${v.name}" matches the current document.`
    return `"${v.name}" vs current: ${diffLines.value.length} change${diffLines.value.length === 1 ? '' : 's'}.`
  }
  return `${namedVersions.value.length}/${MAX_VERSIONS} versions kept (newest first).`
})

function persistVersions() {
  try {
    localStorage.setItem('vve.versions', JSON.stringify(namedVersions.value))
  } catch {
    // Quota or private mode: the in-memory list still works for this session.
  }
}

function saveVersion() {
  const e = engineRef?.value
  if (!e) return
  let fileText = ''
  try {
    fileText = e.exportProjectFile()
  } catch {
    store.setStatusMessage('Version save failed')
    return
  }
  const entry = createNamedVersion(versionName.value || `Version ${namedVersions.value.length + 1}`, fileText)
  if (!isValidNamedVersion(entry)) {
    store.setStatusMessage('Document too large for a named version')
    return
  }
  namedVersions.value = [entry, ...namedVersions.value].slice(0, MAX_VERSIONS)
  versionName.value = ''
  diffVersionId.value = ''
  diffLines.value = []
  persistVersions()
  try {
    // Confirm the list actually persisted (quota failures stay in memory).
    localStorage.setItem('vve.versions', JSON.stringify(namedVersions.value))
  } catch {
    store.setStatusMessage(`Version "${entry.name}" saved for this session (storage full)`)
    return
  }
  store.setStatusMessage(`Version "${entry.name}" saved`)
}

function previewVersion(id: string) {
  const e = engineRef?.value
  if (diffVersionId.value === id) {
    diffVersionId.value = ''
    diffLines.value = []
    return
  }
  const v = namedVersions.value.find((x) => x.id === id)
  if (!v || !e) return
  let current = ''
  try {
    current = e.exportProjectFile()
  } catch {
    store.setStatusMessage('Version diff failed')
    return
  }
  diffVersionId.value = id
  diffLines.value = diffProjectFiles(v.fileText, current)
}

function restoreVersion(id: string) {
  const e = engineRef?.value
  const v = namedVersions.value.find((x) => x.id === id)
  if (!v || !e) return
  // importProjectFile resets history and marks the document saved, so a
  // stray click would drop both the undo stack and the dirty flag with no
  // way back — mirror the File > Open confirmation before replacing.
  if (
    store.hasUnsavedChanges &&
    !window.confirm(`Replace current unsaved changes with version "${v.name}"?`)
  ) {
    return
  }
  try {
    e.importProjectFile(v.fileText)
    diffVersionId.value = ''
    diffLines.value = []
    store.setStatusMessage(`Restored version "${v.name}"`)
  } catch {
    store.setStatusMessage('Version restore failed')
  }
}

function removeVersion(id: string) {
  namedVersions.value = namedVersions.value.filter((v) => v.id !== id)
  if (diffVersionId.value === id) {
    diffVersionId.value = ''
    diffLines.value = []
  }
  persistVersions()
}

// Action batches: v1 records only ops run from this section (palette and
// menu ops are not intercepted yet). Each op runs against the current
// selection immediately; replay re-runs the recorded steps on whatever is
// selected then. Steps stop at the first failure so a later destructive op
// never applies after an earlier miss.
const batchOp = ref<ActionOp>('nudge')
const batchDx = ref('10')
const batchDy = ref('0')
const batchMode = ref<AlignMode>('left')
const batchAxis = ref<DistributeAxis>('horizontal')
const batchBool = ref<BooleanOperation>('unite')
const recording = ref(false)
const recordedSteps = ref<ActionStep[]>([])
const batchName = ref('')
const namedActions = ref<NamedAction[]>([])

const batchHint = computed(() => {
  if (recording.value) return `Recording: ${recordedSteps.value.length}/${MAX_STEPS_PER_ACTION} steps — Run adds ops.`
  if (recordedSteps.value.length > 0) {
    return `${recordedSteps.value.length} recorded — Save as a batch or keep running ops.`
  }
  if (namedActions.value.length === 0) return 'Record panel ops once, then replay them on any selection.'
  return `${namedActions.value.length}/${MAX_ACTIONS} batches kept (newest first).`
})

function persistActions() {
  try {
    localStorage.setItem('vve.actions', JSON.stringify(namedActions.value))
  } catch {
    // Quota or private mode: the in-memory list still works for this session.
  }
}

/** Build a step from the current inputs (null when params are invalid). */
function buildBatchStep(): ActionStep | null {
  let step: ActionStep
  switch (batchOp.value) {
    case 'nudge': {
      const dx = Number(batchDx.value)
      const dy = Number(batchDy.value)
      step = { op: 'nudge', params: { dx, dy } }
      break
    }
    case 'align':
      step = { op: 'align', params: { mode: batchMode.value } }
      break
    case 'distribute':
      step = { op: 'distribute', params: { axis: batchAxis.value } }
      break
    case 'distributeSpacing':
      step = { op: 'distributeSpacing', params: { axis: batchAxis.value } }
      break
    case 'boolean':
      step = { op: 'boolean', params: { op: batchBool.value } }
      break
  }
  return isValidActionStep(step) ? step : null
}

/**
 * Run one step against the engine. Align/distribute need an explicit
 * history entry (the engine only reports whether anything moved); nudge
 * and boolean record their own.
 */
function runStepOnEngine(step: ActionStep): boolean {
  const e = engineRef?.value
  if (!e) return false
  switch (step.op) {
    case 'nudge':
      return e.nudgeSelection(Number(step.params.dx), Number(step.params.dy))
    case 'align': {
      const ok = e.alignSelection(step.params.mode as AlignMode)
      if (ok) e.pushHistory('Align')
      return ok
    }
    case 'distribute': {
      const ok = e.distributeSelection(step.params.axis as DistributeAxis)
      if (ok) e.pushHistory('Distribute')
      return ok
    }
    case 'distributeSpacing': {
      const ok = e.distributeSpacing(step.params.axis as DistributeAxis)
      if (ok) e.pushHistory('Distribute Spacing')
      return ok
    }
    case 'boolean':
      return e.booleanOperation(step.params.op as BooleanOperation)
  }
}

function runBatchStep() {
  const step = buildBatchStep()
  if (!step) {
    store.setStatusMessage('Invalid step params')
    return
  }
  // Cap check runs BEFORE execution while recording: a step that mutates
  // the document but never lands in the batch would desync doc and replay.
  if (recording.value && recordedSteps.value.length >= MAX_STEPS_PER_ACTION) {
    store.setStatusMessage(`Step cap reached (${MAX_STEPS_PER_ACTION}) — stop and save`)
    return
  }
  if (!runStepOnEngine(step)) {
    store.setStatusMessage(`${describeStep(step)} did nothing (check selection)`)
    return
  }
  if (recording.value) {
    recordedSteps.value = [...recordedSteps.value, step]
    store.setStatusMessage(`Recorded step ${recordedSteps.value.length}: ${describeStep(step)}`)
  } else {
    store.setStatusMessage(`${describeStep(step)} done`)
  }
}

function toggleRecording() {
  if (recording.value) {
    recording.value = false
    return
  }
  recordedSteps.value = []
  recording.value = true
}

function dropRecordedStep(index: number) {
  recordedSteps.value = recordedSteps.value.filter((_, i) => i !== index)
}

function saveBatch() {
  const entry = createNamedAction(
    batchName.value || `Batch ${namedActions.value.length + 1}`,
    recordedSteps.value,
  )
  if (!entry) {
    store.setStatusMessage('Record steps first')
    return
  }
  namedActions.value = [entry, ...namedActions.value].slice(0, MAX_ACTIONS)
  recordedSteps.value = []
  batchName.value = ''
  recording.value = false
  persistActions()
  store.setStatusMessage(`Batch "${entry.name}" saved (${entry.steps.length} steps)`)
}

function replayAction(id: string) {
  const a = namedActions.value.find((x) => x.id === id)
  if (!a) return
  const res = runActionSteps(a.steps, (s) => runStepOnEngine(s))
  if (res.ok) {
    store.setStatusMessage(`Batch "${a.name}" replayed (${res.ran} steps)`)
  } else {
    store.setStatusMessage(`Batch "${a.name}" stopped at step ${res.ran + 1}/${res.total}`)
  }
}

function removeAction(id: string) {
  namedActions.value = namedActions.value.filter((a) => a.id !== id)
  persistActions()
}

// Bitmap trace: one selected raster becomes vector paths in place.
const traceColors = ref(8)
const traceDetail = ref<TraceDetail>('medium')
const tracing = ref(false)

async function runTrace() {
  const e = engineRef?.value
  if (!e || tracing.value) return
  tracing.value = true
  try {
    const opts = cleanTraceOptions({ colors: Number(traceColors.value), detail: traceDetail.value })
    const res = await withBusy(store, 'Tracing bitmap…', () => e.traceSelectedRaster(opts))
    if (!res) {
      store.setStatusMessage('Trace needs one selected bitmap')
      return
    }
    store.setStatusMessage(`Traced ${res.paths} path${res.paths === 1 ? '' : 's'}`)
  } catch {
    store.setStatusMessage('Trace failed')
  } finally {
    tracing.value = false
  }
}

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
.file-input { font-size: 11px; color: #b5b5b5; max-width: 100%; }
.merge-text :deep(.el-textarea__inner) {
  font-family: ui-monospace, monospace;
  background: #111;
  color: #e6e6e6;
}
.sc-list { display: flex; flex-direction: column; max-height: 260px; overflow-y: auto; }
.sc-row { display: flex; justify-content: space-between; padding: 3px 2px; border-bottom: 1px solid #1e1e1e; font-size: 11px; }
.sc-tool { color: #d5d5d5; text-transform: capitalize; }
.sc-key { color: #8a8a8a; font-variant-numeric: tabular-nums; }
.ver-actions { display: flex; gap: 4px; flex-shrink: 0; }
.diff-list { display: flex; flex-direction: column; gap: 2px; background: #111; border: 1px solid #333; border-radius: 3px; padding: 6px; max-height: 160px; overflow-y: auto; }
.diff-line { font-size: 11px; color: #b5b5b5; font-family: ui-monospace, monospace; line-height: 1.4; }
.ai-panel :deep(.el-button--small) { background: #333; border: 1px solid #4a4a4a; color: #d5d5d5; border-radius: 3px; height: 24px; font-size: 11px; }
.ai-panel :deep(.el-button--small.el-button--primary) { background: #2f6fbf; border-color: #2f6fbf; color: #fff; }
.ai-panel :deep(.el-radio-button__inner) { background: #1a1a1a; border-color: #3d3d3d; color: #b5b5b5; font-size: 11px; padding: 5px 6px; box-shadow: none; }
.ai-panel :deep(.el-radio-button__orig-radio:checked + .el-radio-button__inner) { background: #2f6fbf; border-color: #2f6fbf; color: #fff; }
</style>
