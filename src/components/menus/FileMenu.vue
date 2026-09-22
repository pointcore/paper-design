<template>
  <div class="file-menu">
    <el-dropdown trigger="click" @command="onFileCmd" @visible-change="onFileMenuVisible">
      <span class="menu-label">File</span>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="new">New Document</el-dropdown-item>
          <el-dropdown-item command="open" divided>Open...</el-dropdown-item>
          <el-dropdown-item command="save">Save</el-dropdown-item>
          <el-dropdown-item command="saveAs">Save As...</el-dropdown-item>
          <el-dropdown-item
            v-for="(rf, i) in recentFiles"
            :key="rf.id"
            :command="'recent:' + rf.id"
            :divided="i === 0"
            :title="'Saved ' + new Date(rf.savedAt).toLocaleString()"
          >{{ rf.name }}</el-dropdown-item>
          <el-dropdown-item v-if="recentFiles.length > 0" command="clearRecent" divided>Clear Recent</el-dropdown-item>
          <el-dropdown-item command="export" divided>Export SVG</el-dropdown-item>
          <el-dropdown-item command="exportSelection" :disabled="!store.hasSelection">Export Selection SVG</el-dropdown-item>
          <el-dropdown-item command="exportBoardsSvg">Export Boards SVG</el-dropdown-item>
          <el-dropdown-item command="exportRaster">Export Raster...</el-dropdown-item>
          <el-dropdown-item command="exportBoardsPng">Export Boards PNG</el-dropdown-item>
          <el-dropdown-item command="exportBoards">Export Boards...</el-dropdown-item>
          <el-dropdown-item command="exportPdf">Export PDF (Raster)</el-dropdown-item>
          <el-dropdown-item command="exportBoardsPdf">Export All Boards PDF (Raster)</el-dropdown-item>
          <el-dropdown-item command="exportVectorPdf">Export PDF (Vector)</el-dropdown-item>
          <el-dropdown-item command="exportBoardsVectorPdf">Export All Boards PDF (Vector)</el-dropdown-item>
          <el-dropdown-item command="import">Import SVG...</el-dropdown-item>
          <el-dropdown-item command="importCdr">Import CDR...</el-dropdown-item>
          <el-dropdown-item command="openCdr">Open CDR...</el-dropdown-item>
          <el-dropdown-item command="place">Place Image...</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <!-- Save As Dialog (custom project filename) -->
    <AppDialog
      v-model="saveVisible"
      title="Save As"
      :width="360"
      confirm-text="Save"
      cancel-text="Cancel"
      @confirm="onSaveConfirm"
      @cancel="saveVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Filename</span>
            <span class="setting-desc">Saved as .vec.json</span>
          </div>
          <el-input v-model="saveName" size="small" placeholder="project" />
        </div>
      </div>
    </AppDialog>

    <!-- Raster Export Dialog -->
    <AppDialog
      v-model="exportVisible"
      title="Export Raster"
      :width="420"
      confirm-text="Export"
      cancel-text="Cancel"
      @confirm="onExportRasterConfirm"
      @cancel="exportVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-section">
          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Format</span>
            </div>
            <el-select v-model="exportForm.format" size="small" style="width: 120px">
              <el-option v-for="f in EXPORT_FORMATS" :key="f.value" :label="f.label" :value="f.value" />
            </el-select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Scale</span>
            </div>
            <el-select v-model="exportForm.scale" size="small" style="width: 120px">
              <el-option v-for="s in EXPORT_SCALES" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
          </div>

          <div v-if="exportForm.format !== 'png'" class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Quality</span>
            </div>
            <el-select v-model="exportForm.quality" size="small" style="width: 120px">
              <el-option v-for="q in EXPORT_QUALITIES" :key="q.value" :label="q.label" :value="q.value" />
            </el-select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Area</span>
            </div>
            <el-radio-group v-model="exportForm.area" size="small">
              <el-radio-button value="artwork">All artwork</el-radio-button>
              <el-radio-button value="selection" :disabled="!store.hasSelection">Selection</el-radio-button>
              <el-radio-button value="page">Page</el-radio-button>
            </el-radio-group>
          </div>
        </div>
      </div>
    </AppDialog>

    <!-- Boards Export Dialog (Export-for-Screens parity: pick boards + format) -->
    <AppDialog
      v-model="boardsVisible"
      title="Export Boards"
      :width="420"
      confirm-text="Export"
      cancel-text="Cancel"
      @confirm="onBoardsExportConfirm"
      @cancel="boardsVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-section">
          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Format</span>
            </div>
            <el-select v-model="boardsForm.format" size="small" style="width: 110px">
              <el-option value="png" label="PNG" />
              <el-option value="jpeg" label="JPEG" />
              <el-option value="svg" label="SVG" />
              <el-option value="pdf" label="PDF" />
            </el-select>
            <el-select v-if="boardsForm.format !== 'svg'" v-model="boardsForm.scale" size="small" style="width: 80px" title="Raster scale">
              <el-option :value="1" label="1x" />
              <el-option :value="2" label="2x" />
              <el-option :value="3" label="3x" />
            </el-select>
          </div>
          <div v-if="boardsForm.format === 'jpeg'" class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Quality</span>
            </div>
            <el-select v-model="boardsForm.quality" size="small" style="width: 110px">
              <el-option v-for="q in EXPORT_QUALITIES" :key="q.value" :label="q.label" :value="q.value" />
            </el-select>
          </div>
          <div class="setting-row">
            <el-button size="small" @click="boardsCheckAll(true)">All</el-button>
            <el-button size="small" @click="boardsCheckAll(false)">None</el-button>
          </div>
          <div v-for="b in store.artboards" :key="b.id" class="setting-row">
            <el-checkbox :model-value="boardsForm.checked.includes(b.id)" @change="() => boardsToggle(b.id)">
              {{ b.name }} ({{ Math.round(b.width) }}x{{ Math.round(b.height) }})
            </el-checkbox>
          </div>
        </div>
      </div>
    </AppDialog>
  </div>
</template>

<script setup lang="ts">
/**
 * FileMenu (C2: third menu slice out of TopBar.vue).
 *
 * The File dropdown with its dispatch (new/open/save, imports, place,
 * raster/vector/PDF/board exports) plus the three dialogs it owns (Save
 * As, Raster Export, Boards Export). Dialog body styling comes from
 * AppDialog's shared global block; everything else here is self-contained
 * (store + engine only). The Ctrl+Shift+S shortcut flips the same
 * store-backed save dialog, so it keeps working without TopBar.
 */
import { ref, reactive, computed, inject, onMounted, type Ref } from 'vue'
import AppDialog from '../ui/AppDialog.vue'
import { clearRecentProjects, listRecentProjects, loadRecentProjectText } from '../../editor/recent-files'
import { downloadHref, readFileAsDataURL } from './download'
import { useEditorStore } from '../../editor/store'
import { withBusy, yieldToUI } from '../../editor/busy'
import {
  defaultBoardsExport,
  EXPORT_FORMATS,
  EXPORT_QUALITIES,
  EXPORT_SCALES,
  rasterFailText,
  resolveBoardsToExport,
  sanitizeBoardsExport,
  sanitizeExportForm,
  selectableBoardIds,
} from '../../editor/topbar-dialogs'
import type { EditorEngine } from '../../editor/engine'
import type { RasterExportArea, RasterExportFormat } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

function blurMenuFocus() {
  const ae = document.activeElement as HTMLElement | null
  if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur()
}

// Store-backed so the Ctrl+Shift+S shortcut can open the same dialog.
const saveVisible = computed<boolean>({
  get: () => store.ui.saveDialogOpen,
  set: (v) => store.setSaveDialogOpen(v),
})
const saveName = ref('project')
function onSaveConfirm() {
  const e = engineRef?.value
  if (!e) {
    saveVisible.value = false
    return
  }
  try {
    e.downloadProjectFile(saveName.value)
  } catch {
    store.setStatusMessage('Project save failed')
  }
  saveVisible.value = false
}

const boardsVisible = ref(false)
const boardsForm = reactive({
  ...defaultBoardsExport(),
  checked: [] as string[],
})
try {
  const raw = localStorage.getItem('vve.boardsExport')
  if (raw) Object.assign(boardsForm, sanitizeBoardsExport(JSON.parse(raw)))
} catch { /* private mode: defaults stand */ }

function openBoardsExport() {
  boardsForm.checked = selectableBoardIds(store.artboards)
  boardsVisible.value = true
}
function boardsToggle(id: string) {
  boardsForm.checked = boardsForm.checked.includes(id)
    ? boardsForm.checked.filter((x) => x !== id)
    : [...boardsForm.checked, id]
}
function boardsCheckAll(on: boolean) {
  boardsForm.checked = on ? selectableBoardIds(store.artboards) : []
}
async function onBoardsExportConfirm() {
  const e = engineRef?.value
  if (!e) {
    boardsVisible.value = false
    return
  }
  const boards = resolveBoardsToExport(store.artboards, boardsForm.checked)
  if (boards.length === 0) {
    store.setStatusMessage('Tick at least one artboard')
    return
  }
  try {
    localStorage.setItem(
      'vve.boardsExport',
      JSON.stringify({ format: boardsForm.format, scale: boardsForm.scale, quality: boardsForm.quality })
    )
  } catch { /* private mode */ }
  const previousActive = store.activeArtboardId
  const useZip = boards.length > 1
  const zip = useZip ? new (await import('jszip')).default() : null
  try {
    if (boardsForm.format === 'pdf') {
      const { jsPDF } = await import('jspdf')
      let painted = 0
      for (const board of boards) {
        store.setActiveArtboard(board.id)
        const dataUrl = e.exportRaster({ format: 'png', scale: boardsForm.scale, area: 'page' })
        if (!dataUrl) continue
        const doc = new jsPDF({
          orientation: board.width >= board.height ? 'landscape' : 'portrait',
          unit: 'pt',
          format: [board.width, board.height],
          compress: true,
        })
        doc.addImage(dataUrl, 'PNG', 0, 0, board.width, board.height)
        const filename = `${board.name || 'artboard'}.pdf`
        if (zip) {
          zip.file(filename, doc.output('blob'))
        } else {
          doc.save(filename)
        }
        painted++
      }
      if (zip && painted > 0) {
        const blob = await zip.generateAsync({ type: 'blob' })
        downloadHref(URL.createObjectURL(blob), 'boards-export.zip')
      }
      store.setStatusMessage(painted > 0 ? `Exported ${painted} board PDF${painted === 1 ? '' : 's'}` : 'Board export failed')
    } else if (boardsForm.format === 'svg') {
      let painted = 0
      for (const board of boards) {
        const svg = e.exportBoardVectorSVG(board, { bleed: 0, marks: false })
        if (!svg) continue
        const str = new XMLSerializer().serializeToString(svg)
        const filename = `${board.name || 'artboard'}.svg`
        if (zip) {
          zip.file(filename, str)
        } else {
          downloadHref(URL.createObjectURL(new Blob([str], { type: 'image/svg+xml' })), filename)
        }
        painted++
      }
      if (zip && painted > 0) {
        const blob = await zip.generateAsync({ type: 'blob' })
        downloadHref(URL.createObjectURL(blob), 'boards-export.zip')
      }
      store.setStatusMessage(painted > 0 ? `Exported ${painted} board SVG${painted === 1 ? '' : 's'}` : 'Board export failed')
    } else {
      let painted = 0
      let skipped = 0
      for (const board of boards) {
        store.setActiveArtboard(board.id)
        const dataUrl = e.exportRaster({
          format: boardsForm.format as 'png' | 'jpeg',
          scale: boardsForm.scale,
          area: 'page',
          quality: boardsForm.quality,
        })
        if (!dataUrl) {
          skipped++
          continue
        }
        const filename = `${board.name || 'artboard'}.${boardsForm.format}`
        if (zip) {
          // Convert data URL to blob for ZIP storage.
          const res = await fetch(dataUrl)
          const blob = await res.blob()
          zip.file(filename, blob)
        } else {
          downloadHref(dataUrl, filename)
        }
        painted++
      }
      if (zip && painted > 0) {
        const blob = await zip.generateAsync({ type: 'blob' })
        downloadHref(URL.createObjectURL(blob), 'boards-export.zip')
      }
      store.setStatusMessage(
        painted === 0
          ? 'Board export failed'
          : skipped > 0
            ? `Exported ${painted} of ${boards.length} boards (${skipped} too large)`
            : `Exported ${painted} of ${boards.length} boards`
      )
    }
  } finally {
    store.setActiveArtboard(previousActive)
    e.refreshArtboards()
  }
  boardsVisible.value = false
}

const exportVisible = ref(false)
const exportForm = reactive({
  format: 'png' as RasterExportFormat,
  scale: 2,
  area: 'artwork' as RasterExportArea,
  quality: 0.92,
})
try {
  const raw = localStorage.getItem('vve.export')
  if (raw) Object.assign(exportForm, sanitizeExportForm(JSON.parse(raw)))
} catch { /* private mode: defaults stand */ }
function persistExportForm() {
  try {
    localStorage.setItem('vve.export', JSON.stringify(exportForm))
  } catch { /* private mode */ }
}

/**
 * Guard destructive document switches (New/Open replace the scene).
 * Clean documents pass silently; dirty ones need an explicit confirm.
 */
function confirmDiscard(): boolean {
  if (!store.hasUnsavedChanges) return true
  try {
    return window.confirm('Discard unsaved changes?')
  } catch {
    return true
  }
}

// File > Recent: loaded when the menu opens (and once at startup).
const recentFiles = ref<Array<{ id: string; name: string; savedAt: number }>>([])
async function refreshRecentFiles() {
  try {
    recentFiles.value = await listRecentProjects()
  } catch {
    recentFiles.value = []
  }
}
function onFileMenuVisible(visible: boolean) {
  if (visible) void refreshRecentFiles()
}
onMounted(() => {
  void refreshRecentFiles()
})

async function onFileCmd(cmd: string) {
  blurMenuFocus()
  const e = engineRef?.value
  if (cmd === 'clearRecent') {
    await clearRecentProjects()
    recentFiles.value = []
    store.setStatusMessage('Recent files cleared')
    return
  }
  if (cmd.startsWith('recent:')) {
    if (!confirmDiscard()) return
    if (!e) return
    try {
      const meta = recentFiles.value.find((r) => r.id === cmd.slice(7))
      await withBusy(store, `Opening ${meta?.name ?? 'project'}…`, async (report) => {
        const text = await loadRecentProjectText(cmd.slice(7))
        if (!text) throw new Error('That recent file is gone (cleared or overwritten)')
        report(0.4, 'Opening project…')
        await yieldToUI()
        e.importProjectFile(text)
      })
      store.setDocumentName(meta?.name ?? '')
      store.setStatusMessage('Project opened')
    } catch (err) {
      store.setStatusMessage(err instanceof Error ? err.message : 'Project open failed')
    }
    return
  }
  switch (cmd) {
    case 'new': {
      if (!confirmDiscard()) break
      store.setDocumentName('')
      // New documents inherit the active artboard size (what Canvas
      // Settings shows), not the stale pageSize default from an old file.
      const board = store.activeArtboard
      const width = board?.width ?? store.pageSize.width
      const height = board?.height ?? store.pageSize.height
      if (e) {
        e.newDocument(width, height)
        store.setStatusMessage('New document')
      } else {
        store.setPageSize(width, height)
      }
      break
    }
    case 'save': {
      if (!e) break
      try {
        e.downloadProjectFile()
      } catch (err) {
        store.setStatusMessage('Project save failed')
      }
      break
    }
    case 'saveAs':
      // Seed the pristine default from the active board (desktop editors
      // name the file after the document); keep a user-chosen name.
      if (saveName.value === 'project' || !saveName.value.trim()) {
        saveName.value = (store.activeArtboard?.name ?? 'project')
          .replace(/[\/:*?"<>|]+/g, '-')
          .slice(0, 80) || 'project'
      }
      saveVisible.value = true
      break
    case 'open': {
      if (!e) break
      if (!confirmDiscard()) break
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,.vec.json,.cdr,application/json'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file || !e) return
        try {
          if (/\.cdr$/i.test(file.name)) {
            const result = await withBusy(store, `Opening ${file.name}…`, async (report) => {
              const bytes = new Uint8Array(await file.arrayBuffer())
              return e.openCdrBytes(bytes, file.name, report)
            })
            const warn = result.warnings.length ? ` (${result.warnings.length} warnings)` : ''
            const skipped = result.skippedPages > 0 ? `, ${result.skippedPages} skipped` : ''
            store.setStatusMessage(`CDR opened: ${result.pages} page${result.pages > 1 ? 's' : ''}${skipped}${warn}`)
            if (result.warnings.length) console.warn('[CDR open warnings]', result.warnings)
          } else {
            await withBusy(store, `Opening ${file.name}…`, async (report) => {
              const text = await file.text()
              report(0.4, 'Opening project…')
              await yieldToUI()
              e.importProjectFile(text)
            })
            store.setStatusMessage('Project opened')
          }
        } catch (err) {
          store.setStatusMessage(err instanceof Error ? err.message : 'Project open failed')
        }
      }
      input.click()
      break
    }
    case 'exportRaster':
      if (exportForm.area === 'selection' && !store.hasSelection) {
        exportForm.area = 'artwork'
      }
      exportVisible.value = true
      break
    case 'exportBoardsPng':
      void onExportBoardsPng()
      break
    case 'exportBoards':
      openBoardsExport()
      break
    case 'exportPdf':
      void onExportPdf()
      break
    case 'exportBoardsPdf':
      void onExportBoardsPdf()
      break
    case 'exportVectorPdf':
      void onExportVectorPdf()
      break
    case 'exportBoardsVectorPdf':
      void onExportBoardsVectorPdf()
      break
    case 'export':
      if (e) {
        // Temporarily hide non-user layers (grid / overlay / annotation / guides)
        // so they do not leak into the exported SVG.
        const hiddenLayers: any[] = []
        for (const layer of e.project.layers) {
          if (!(layer as any).data?.isUserLayer && layer.visible) {
            layer.visible = false
            hiddenLayers.push(layer)
          }
        }
        e.scope.view.update()

        try {
          const result = e.project.exportSVG({ asString: true })
          const svgStr = typeof result === 'string' ? result : String(result)
          const blob = new Blob([svgStr], { type: 'image/svg+xml' })
          const url = URL.createObjectURL(blob)
          downloadHref(url, 'export.svg')
          store.setStatusMessage('SVG exported')
        } finally {
          // Restore layer visibility
          hiddenLayers.forEach((layer) => {
            layer.visible = true
          })
          e.scope.view.update()
        }
      }
      break
    case 'exportSelection': {
      if (!e) break
      const svg = e.exportSelectionSVG()
      if (!svg) {
        store.setStatusMessage('Nothing selected to export')
        break
      }
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      downloadHref(url, 'selection.svg')
      store.setStatusMessage('Selection exported')
      break
    }
    case 'exportBoardsSvg': {
      if (!e) break
      const boards = store.artboards.filter((b) => b.width > 0 && b.height > 0)
      if (boards.length === 0) {
        store.setStatusMessage('Nothing to export')
        break
      }
      let painted = 0
      for (const board of boards) {
        const svg = e.exportBoardVectorSVG(board, { bleed: 0, marks: false })
        if (!svg) continue
        const str = new XMLSerializer().serializeToString(svg)
        const blob = new Blob([str], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        downloadHref(url, `${board.name || 'artboard'}.svg`)
        painted++
      }
      store.setStatusMessage(
        painted > 0 ? `Exported ${painted} of ${boards.length} boards` : 'Board export failed'
      )
      break
    }
    case 'import': {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.svg'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (file && e) {
          try {
            const ok = await withBusy(store, `Importing ${file.name}…`, async (report) => {
              const text = await file.text()
              report(0.4, 'Importing SVG…')
              await yieldToUI()
              return e.importSVGText(text, 'Import SVG')
            })
            if (ok) {
              store.setStatusMessage('SVG imported')
            } else {
              store.setStatusMessage('SVG import failed')
            }
          } catch (err) {
            store.setStatusMessage('SVG import failed')
          }
        }
      }
      input.click()
      break
    }
    case 'importCdr': {
      if (!e) break
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.cdr'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file || !e) return
        try {
          const result = await withBusy(store, `Importing ${file.name}…`, async (report) => {
            const bytes = new Uint8Array(await file.arrayBuffer())
            return e.importCdrBytes(bytes, file.name, report)
          })
          const warn = result.warnings.length ? ` (${result.warnings.length} warnings)` : ''
          const skipped = result.skippedPages > 0 ? `, ${result.skippedPages} skipped` : ''
          store.setStatusMessage(
            result.pages > 0
              ? `CDR imported: ${result.pages} page${result.pages > 1 ? 's' : ''}${skipped}${warn}`
              : 'CDR import failed'
          )
          if (result.warnings.length) console.warn('[CDR import warnings]', result.warnings)
        } catch (err) {
          store.setStatusMessage(err instanceof Error ? err.message : 'CDR import failed')
        }
      }
      input.click()
      break
    }
    case 'openCdr': {
      if (!e) break
      if (!confirmDiscard()) break
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.cdr'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file || !e) return
        try {
          const result = await withBusy(store, `Opening ${file.name}…`, async (report) => {
            const bytes = new Uint8Array(await file.arrayBuffer())
            return e.openCdrBytes(bytes, file.name, report)
          })
          const warn = result.warnings.length ? ` (${result.warnings.length} warnings)` : ''
          const skipped = result.skippedPages > 0 ? `, ${result.skippedPages} skipped` : ''
          store.setStatusMessage(
            `CDR opened: ${result.pages} page${result.pages > 1 ? 's' : ''}${skipped}${warn}`
          )
          if (result.warnings.length) console.warn('[CDR open warnings]', result.warnings)
        } catch (err) {
          store.setStatusMessage(err instanceof Error ? err.message : 'CDR open failed')
        }
      }
      input.click()
      break
    }
    case 'place': {
      if (!e) break
      // SVG joins bitmaps here (matching canvas drag-drop); the separate
      // Import SVG menu item stays for discoverability.
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.svg,image/png,image/jpeg,image/webp,image/gif'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file || !e) return
        if (file.size > 15 * 1024 * 1024) {
          store.setStatusMessage('File too large (15 MB max)')
          return
        }
        try {
          if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
            const ok = await withBusy(store, `Placing ${file.name}…`, async (report) => {
              const text = await file.text()
              report(0.4, 'Placing SVG…')
              await yieldToUI()
              return e.importSVGText(text, 'Place SVG')
            })
            if (ok) {
              store.setStatusMessage('SVG placed')
            } else {
              store.setStatusMessage('SVG placement failed')
            }
          } else {
            await withBusy(store, `Placing ${file.name}…`, async () => {
              e.placeImage(await readFileAsDataURL(file))
            })
            store.setStatusMessage('Image placed')
          }
        } catch (err) {
          store.setStatusMessage('File placement failed')
        }
      }
      input.click()
      break
    }
  }
}

function onExportRasterConfirm() {
  const e = engineRef?.value
  if (!e) {
    exportVisible.value = false
    return
  }
  if (exportForm.area === 'selection' && !store.hasSelection) {
    store.setStatusMessage('Nothing selected to export')
    return
  }
  try {
    const dataUrl = e.exportRaster({
      format: exportForm.format,
      scale: exportForm.scale,
      area: exportForm.area,
      quality: exportForm.quality,
    })
    if (!dataUrl) {
      store.setStatusMessage(
        rasterFailText(e.estimateRasterSize(exportForm.area, exportForm.scale)) ?? 'Raster export failed'
      )
      return
    }
    downloadHref(dataUrl, `export.${exportForm.format}`)
    exportVisible.value = false
    persistExportForm()
    store.setStatusMessage(`Raster exported (${exportForm.format.toUpperCase()} ${exportForm.scale}x)`)
  } catch (err) {
    store.setStatusMessage('Raster export failed')
  }
}

/**
 * Export the active artboard as PDF (2x board raster embedded full-bleed).
 * The jsPDF orientation matches the board aspect so the page keeps the
 * exact board dimensions.
 */
async function onExportPdf() {
  const e = engineRef?.value
  if (!e) return
  const board = store.activeArtboard ?? store.artboards[0]
  if (!board || board.width < 1 || board.height < 1) {
    store.setStatusMessage('Nothing to export')
    return
  }
  try {
    const dataUrl = e.exportRaster({ format: 'png', scale: 2, area: 'page' })
    if (!dataUrl) {
      const size = e.estimateRasterSize('page', 2)
      store.setStatusMessage(
        size && (size.width > 16384 || size.height > 16384)
          ? `Board too large for raster PDF (${size.width}x${size.height}px) — try Vector PDF`
          : 'PDF export failed'
      )
      return
    }
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({
      orientation: board.width >= board.height ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [board.width, board.height],
      compress: true,
    })
    doc.addImage(dataUrl, 'PNG', 0, 0, board.width, board.height)
    doc.save('export.pdf')
    store.setStatusMessage('PDF exported')
  } catch (err) {
    store.setStatusMessage('PDF export failed')
  }
}

/**
 * Export every artboard as a 2x PNG. A single board downloads directly;
 * multiple boards are zipped into one file so the browser cannot block
 * the second and later downloads of the same gesture. The active board
 * is restored afterwards.
 */
async function onExportBoardsPng() {
  const e = engineRef?.value
  if (!e) return
  const boards = store.artboards.filter((b) => b.width > 0 && b.height > 0)
  if (boards.length === 0) {
    store.setStatusMessage('Nothing to export')
    return
  }
  const previousActive = store.activeArtboardId
  const zip = boards.length > 1 ? new (await import('jszip')).default() : null
  try {
    let painted = 0
    let skipped = 0
    for (const board of boards) {
      store.setActiveArtboard(board.id)
      const dataUrl = e.exportRaster({ format: 'png', scale: 2, area: 'page' })
      if (!dataUrl) {
        skipped++
        continue
      }
      const filename = `${board.name || 'artboard'}.png`
      if (zip) {
        // A data URL cannot go into a ZIP entry directly; fetch it as a blob first.
        const res = await fetch(dataUrl)
        zip.file(filename, await res.blob())
      } else {
        downloadHref(dataUrl, filename)
      }
      painted++
    }
    if (zip && painted > 0) {
      const blob = await zip.generateAsync({ type: 'blob' })
      downloadHref(URL.createObjectURL(blob), 'boards-export.zip')
    }
    store.setStatusMessage(
      painted === 0
        ? 'Board export failed'
        : skipped > 0
          ? `Exported ${painted} of ${boards.length} boards (${skipped} too large)`
          : `Exported ${painted} of ${boards.length} boards`
    )
  } finally {
    store.setActiveArtboard(previousActive)
    e.refreshArtboards()
  }
}

async function onExportBoardsPdf() {  const e = engineRef?.value
  if (!e) return
  const boards = store.artboards.filter((b) => b.width > 0 && b.height > 0)
  if (boards.length === 0) {
    store.setStatusMessage('Nothing to export')
    return
  }
  const previousActive = store.activeArtboardId
  try {
    const { jsPDF } = await import('jspdf')
    let doc = null as InstanceType<typeof jsPDF> | null
    let painted = 0
    let skipped = 0
    for (const board of boards) {
      store.setActiveArtboard(board.id)
      const dataUrl = e.exportRaster({ format: 'png', scale: 2, area: 'page' })
      if (!dataUrl) {
        skipped++
        continue
      }
      const orientation = board.width >= board.height ? 'landscape' : 'portrait'
      if (!doc) {
        doc = new jsPDF({ orientation, unit: 'pt', format: [board.width, board.height], compress: true })
      } else {
        doc.addPage([board.width, board.height], orientation)
      }
      doc.addImage(dataUrl, 'PNG', 0, 0, board.width, board.height)
      painted++
    }
    if (!doc || painted === 0) {
      store.setStatusMessage('PDF export failed')
      return
    }
    doc.save('export-boards.pdf')
    store.setStatusMessage(
      skipped > 0
        ? `PDF exported (${painted} of ${boards.length} boards, ${skipped} too large)`
        : `PDF exported (${painted} of ${boards.length} boards)`
    )
  } catch (err) {
    store.setStatusMessage('PDF export failed')
  } finally {
    store.setActiveArtboard(previousActive)
    e.refreshArtboards()
  }
}

/**
 * Export the active artboard as a vector PDF (paths/text stay selectable;
 * fonts are referenced, not embedded — stick to standard families for
 * fidelity). The page grows by the document bleed with crop marks at the
 * trim corners. Falls back to the raster PDF when vector rendering fails.
 */
async function onExportVectorPdf() {
  const e = engineRef?.value
  if (!e) return
  const board = store.activeArtboard ?? store.artboards[0]
  if (!board || board.width < 1 || board.height < 1) {
    store.setStatusMessage('Nothing to export')
    return
  }
  try {
    const bleed = Number(store.bleed) || 0
    const svg = e.exportBoardVectorSVG(board, { bleed, marks: true })
    if (!svg) {
      store.setStatusMessage('PDF export failed')
      return
    }
    const pageWidth = board.width + bleed * 2
    const pageHeight = board.height + bleed * 2
    const { jsPDF } = await import('jspdf')
    const { svg2pdf } = await import('svg2pdf.js')
    const doc = new jsPDF({
      orientation: pageWidth >= pageHeight ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [pageWidth, pageHeight],
      compress: true,
    })
    // Embed registered fonts into the PDF
    await e.applyFontsToPdf(doc)
    await svg2pdf(svg, doc, { x: 0, y: 0, width: pageWidth, height: pageHeight })
    doc.save('export-vector.pdf')
    store.setStatusMessage(bleed > 0 ? `Vector PDF exported (bleed ${bleed})` : 'Vector PDF exported')
  } catch (err) {
    store.setStatusMessage('Vector PDF failed, use PDF (Raster)')
  }
}

/**
 * Export every artboard as one vector PDF page each (one-up imposition:
 * every board is its own page). Boards keep their own page sizes plus the
 * shared bleed; registered fonts are embedded.
 */
async function onExportBoardsVectorPdf() {
  const e = engineRef?.value
  if (!e) return
  const boards = store.artboards.filter((b) => b.width > 0 && b.height > 0)
  if (boards.length === 0) {
    store.setStatusMessage('Nothing to export')
    return
  }
  try {
    const bleed = Number(store.bleed) || 0
    const { jsPDF } = await import('jspdf')
    const { svg2pdf } = await import('svg2pdf.js')
    let doc = null as InstanceType<typeof jsPDF> | null
    let painted = 0
    for (const board of boards) {
      const svg = e.exportBoardVectorSVG(board, { bleed, marks: true })
      if (!svg) continue
      const pageWidth = board.width + bleed * 2
      const pageHeight = board.height + bleed * 2
      const orientation = pageWidth >= pageHeight ? 'landscape' : 'portrait'
      if (!doc) {
        doc = new jsPDF({ orientation, unit: 'pt', format: [pageWidth, pageHeight], compress: true })
        // Embed registered fonts into the PDF
        await e.applyFontsToPdf(doc)
      } else {
        doc.addPage([pageWidth, pageHeight], orientation)
      }
      await svg2pdf(svg, doc, { x: 0, y: 0, width: pageWidth, height: pageHeight })
      painted++
    }
    if (!doc || painted === 0) {
      store.setStatusMessage('PDF export failed')
      return
    }
    doc.save('export-boards-vector.pdf')
    store.setStatusMessage(`Vector PDF exported (${painted} of ${boards.length} boards)`)
  } catch (err) {
    store.setStatusMessage('Vector PDF failed, use PDF (Raster)')
  }
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
</style>
