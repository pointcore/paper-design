<template>
  <div class="top-bar">
    <div class="menus">
      <div class="app-title">Vector Editor</div>
      <div class="menu-group">
        <el-dropdown trigger="click" @command="onFileCmd">
          <span class="menu-label">File</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="new">New Document</el-dropdown-item>
              <el-dropdown-item command="open" divided>Open...</el-dropdown-item>
              <el-dropdown-item command="save">Save</el-dropdown-item>
              <el-dropdown-item command="export" divided>Export SVG</el-dropdown-item>
              <el-dropdown-item command="exportRaster">Export Raster...</el-dropdown-item>
              <el-dropdown-item command="exportPdf">Export PDF</el-dropdown-item>
              <el-dropdown-item command="import">Import SVG...</el-dropdown-item>
              <el-dropdown-item command="place">Place Image...</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-dropdown trigger="click" @command="onEditCmd">
          <span class="menu-label">Edit</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="undo" :disabled="!store.canUndo">Undo</el-dropdown-item>
              <el-dropdown-item command="redo" :disabled="!store.canRedo">Redo</el-dropdown-item>
              <el-dropdown-item command="cut" divided :disabled="!store.hasSelection">Cut</el-dropdown-item>
              <el-dropdown-item command="copy" :disabled="!store.hasSelection">Copy</el-dropdown-item>
              <el-dropdown-item command="paste">Paste</el-dropdown-item>
              <el-dropdown-item command="pasteFront">Paste in Front</el-dropdown-item>
              <el-dropdown-item command="pasteBack">Paste in Back</el-dropdown-item>
              <el-dropdown-item command="delete" divided :disabled="!store.hasSelection">Delete</el-dropdown-item>
              <el-dropdown-item command="selectAll" divided>Select All</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-dropdown trigger="click" @command="onObjectCmd">
          <span class="menu-label">Object</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="transform" :disabled="!store.hasSelection">Transform</el-dropdown-item>
              <el-dropdown-item command="bringToFront" :disabled="!store.hasSelection">Bring to Front</el-dropdown-item>
              <el-dropdown-item command="bringForward" :disabled="!store.hasSelection">Bring Forward</el-dropdown-item>
              <el-dropdown-item command="sendBackward" :disabled="!store.hasSelection">Send Backward</el-dropdown-item>
              <el-dropdown-item command="sendToBack" :disabled="!store.hasSelection">Send to Back</el-dropdown-item>
              <el-dropdown-item command="group" divided :disabled="!store.hasSelection">Group</el-dropdown-item>
              <el-dropdown-item command="ungroup" :disabled="!store.hasSelection">Ungroup</el-dropdown-item>
              <el-dropdown-item command="makeCompound" divided :disabled="!store.hasSelection">Make Compound Path</el-dropdown-item>
              <el-dropdown-item command="releaseCompound" :disabled="!store.hasSelection">Release Compound Path</el-dropdown-item>
              <el-dropdown-item command="joinPaths" :disabled="!store.hasSelection">Join Paths</el-dropdown-item>
              <el-dropdown-item command="outlineStroke" :disabled="!store.hasSelection">Outline Stroke</el-dropdown-item>
              <el-dropdown-item command="makeMask" divided :disabled="!store.hasSelection">Make Clipping Mask</el-dropdown-item>
              <el-dropdown-item command="releaseMask" :disabled="!store.hasSelection">Release Clipping Mask</el-dropdown-item>
              <el-dropdown-item command="lock" divided :disabled="!store.hasSelection">Lock</el-dropdown-item>
              <el-dropdown-item command="unlockAll">Unlock All</el-dropdown-item>
              <el-dropdown-item command="hide" divided :disabled="!store.hasSelection">Hide</el-dropdown-item>
              <el-dropdown-item command="showAll">Show All</el-dropdown-item>
              <el-dropdown-item command="sameFill" divided :disabled="!store.hasSelection">Select Same Fill</el-dropdown-item>
              <el-dropdown-item command="sameStroke" :disabled="!store.hasSelection">Select Same Stroke</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-dropdown trigger="click" @command="onViewCmd">
          <span class="menu-label">View</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="fitAll">Fit to Window</el-dropdown-item>
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
              <el-dropdown-item command="transparentBg" :icon="store.view.transparentBackground ? Check : undefined">
                Transparent Background
              </el-dropdown-item>
              <el-dropdown-item command="canvasSettings" divided>Canvas Settings...</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div class="top-right">
      <el-tooltip content="Help">
        <el-button circle size="small" @click="onHelp">
          <el-icon><QuestionFilled /></el-icon>
        </el-button>
      </el-tooltip>
    </div>

    <!-- Canvas Settings Dialog -->
    <el-dialog v-model="settingsVisible" title="Canvas Settings" width="420px" class="canvas-settings-dialog">
      <div class="settings-body">
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
              <el-option v-for="p in pagePresets" :key="p.value" :label="p.label" :value="p.value" />
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
        </div>
      </div>
      <template #footer>
        <el-button size="small" @click="settingsVisible = false">Close</el-button>
      </template>
    </el-dialog>

    <!-- Raster Export Dialog -->
    <el-dialog v-model="exportVisible" title="Export Raster" width="420px" class="canvas-settings-dialog">
      <div class="settings-body">
        <div class="setting-section">
          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Format</span>
            </div>
            <el-select v-model="exportForm.format" size="small" style="width: 120px">
              <el-option v-for="f in exportFormats" :key="f.value" :label="f.label" :value="f.value" />
            </el-select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Scale</span>
            </div>
            <el-select v-model="exportForm.scale" size="small" style="width: 120px">
              <el-option v-for="s in exportScales" :key="s.value" :label="s.label" :value="s.value" />
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
      <template #footer>
        <el-button size="small" @click="exportVisible = false">Cancel</el-button>
        <el-button size="small" type="primary" @click="onExportRasterConfirm">Export</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, inject, type Ref } from 'vue'
import { QuestionFilled, Check } from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { RulerUnit, RasterExportFormat, RasterExportArea } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const settingsVisible = ref(false)
const exportVisible = ref(false)
const exportForm = reactive({
  format: 'png' as RasterExportFormat,
  scale: 2,
  area: 'artwork' as RasterExportArea,
})
const exportFormats = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
]
const exportScales = [
  { value: 1, label: '1x' },
  { value: 2, label: '2x' },
  { value: 3, label: '3x' },
]

const pagePresets = [
  { value: 'custom', label: 'Custom' },
  { value: '1920x1080', label: 'HD 1920 x 1080' },
  { value: '1080x1080', label: 'Square 1080 x 1080' },
  { value: '1080x1920', label: 'Story 1080 x 1920' },
  { value: '595x842', label: 'A4 595 x 842' },
  { value: '612x792', label: 'Letter 612 x 792' },
]

/** Preset value matching W/H, or custom when nothing matches. */
function matchPagePreset(width: number, height: number): string {
  const found = pagePresets.find((p) => p.value === `${width}x${height}`)
  return found ? found.value : 'custom'
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
})

const units = [
  { value: 'px', label: 'px' },
  { value: 'pt', label: 'pt' },
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
  { value: 'in', label: 'in' },
]

function onFileCmd(cmd: string) {
  const e = engineRef?.value
  switch (cmd) {
    case 'new':
      if (e) {
        e.newDocument(store.pageSize.width, store.pageSize.height)
        store.setStatusMessage('New document')
      } else {
        store.setPageSize(1920, 1080)
      }
      break
    case 'save': {
      if (!e) break
      try {
        const fileText = e.exportProjectFile()
        const blob = new Blob([fileText], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'project.vec.json'
        a.click()
        URL.revokeObjectURL(url)
        store.setStatusMessage('Project saved')
      } catch (err) {
        store.setStatusMessage('Project save failed')
      }
      break
    }
    case 'open': {
      if (!e) break
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,.vec.json,application/json'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file || !e) return
        try {
          const text = await file.text()
          e.importProjectFile(text)
          store.setStatusMessage('Project opened')
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
    case 'exportPdf':
      void onExportPdf()
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
          const a = document.createElement('a')
          a.href = url
          a.download = 'export.svg'
          a.click()
          URL.revokeObjectURL(url)
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
    case 'import': {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.svg'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (file && e) {
          const text = await file.text()
          try {
            if (e.importSVGText(text, 'Import SVG')) {
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
    case 'place': {
      if (!e) break
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/png,image/jpeg,image/webp,image/gif'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file || !e) return
        if (file.size > 15 * 1024 * 1024) {
          store.setStatusMessage('Image too large (15 MB max)')
          return
        }
        try {
          e.placeImage(await readFileAsDataURL(file))
        } catch (err) {
          store.setStatusMessage('Image placement failed')
        }
      }
      input.click()
      break
    }
  }
}

/** Read a file as a data URL (embeddable, unlike object URLs). */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
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
    })
    if (!dataUrl) {
      store.setStatusMessage('Raster export failed')
      return
    }
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `export.${exportForm.format}`
    a.click()
    exportVisible.value = false
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
      store.setStatusMessage('PDF export failed')
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

function onEditCmd(cmd: string) {
  const e = engineRef?.value
  if (!e) return
  switch (cmd) {
    case 'undo':
      e.undo()
      break
    case 'redo':
      e.redo()
      break
    case 'cut':
      // Capture the OS copy before the cut deletes the selection.
      e.copyToSystemClipboard().catch(() => undefined)
      e.cutSelectedToClipboard()
      break
    case 'copy':
      e.copySelectedToClipboard()
      e.copyToSystemClipboard().catch(() => undefined)
      break
    case 'paste':
      e.pasteWithSystemFallback().catch(() => undefined)
      break
    case 'pasteFront':
      if (!e.pasteInPlace('front')) store.setStatusMessage('Clipboard is empty')
      break
    case 'pasteBack':
      if (!e.pasteInPlace('back')) store.setStatusMessage('Clipboard is empty')
      break
    case 'delete':
      e.deleteSelected()
      break
    case 'selectAll':
      e.getActiveLayer().children.forEach((c) => {
        c.selected = true
      })
      e.syncSelectionToStore()
      break
  }
}

function onObjectCmd(cmd: string) {
  const e = engineRef?.value
  if (!e) return
  switch (cmd) {
    case 'transform':
      store.setReferencePoint('center')
      break
    case 'bringToFront':
      e.getSelection().forEach((i) => i.bringToFront())
      e.scope.view.update()
      e.pushHistory('Bring to Front')
      break
    case 'sendToBack':
      e.getSelection().forEach((i) => i.sendToBack())
      e.scope.view.update()
      e.pushHistory('Send to Back')
      break
    case 'group': {
      const items = e.getSelection()
      if (items.length > 1) {
        const group = new e.scope.Group(items) as paper.Group
        group.data.id = e.genId()
        group.data.isUserItem = true
        e.selectItem(group)
        e.pushHistory('Group')
      }
      break
    }
    case 'ungroup': {
      const groups = e.getSelection().filter((i) => i instanceof e.scope.Group)
      groups.forEach((g) => {
        const children = g.children.slice()
        const parent = g.parent
        children.forEach((c: any) => {
          if (parent) parent.addChild(c)
        })
        g.remove()
      })
      e.clearSelection()
      e.pushHistory('Ungroup')
      e.scope.view.update()
      break
    }
    case 'bringForward':
      e.bringForward()
      break
    case 'sendBackward':
      e.sendBackward()
      break
    case 'lock':
      e.setSelectedLocked(true)
      break
    case 'unlockAll':
      e.unlockAll()
      break
    case 'hide':
      e.setSelectedVisible(false)
      break
    case 'showAll':
      e.showAll()
      break
    case 'sameFill': {
      const count = e.selectSame('fill')
      store.setStatusMessage(`Selected ${count} items with the same fill`)
      break
    }
    case 'sameStroke': {
      const count = e.selectSame('stroke')
      store.setStatusMessage(`Selected ${count} items with the same stroke`)
      break
    }
    case 'makeCompound':
      if (!e.makeCompoundPath()) {
        store.setStatusMessage('Compound needs at least two unlocked paths')
      }
      break
    case 'releaseCompound':
      if (!e.releaseCompoundPath()) {
        store.setStatusMessage('Select a compound path to release')
      }
      break
    case 'joinPaths':
      if (!e.joinPaths()) {
        store.setStatusMessage('Join needs exactly two unlocked open paths')
      }
      break
    case 'outlineStroke':
      if (!e.outlineStroke()) {
        store.setStatusMessage('Outline needs a path with a stroke')
      }
      break
    case 'makeMask':
      if (!e.makeClippingMask()) {
        store.setStatusMessage('Clipping needs art plus a path on top')
      }
      break
    case 'releaseMask':
      if (!e.releaseClippingMask()) {
        store.setStatusMessage('Select a clipping mask to release')
      }
      break
  }
}

function onViewCmd(cmd: string) {
  const e = engineRef?.value
  if (!e) return
  switch (cmd) {
    case 'fitAll':
      e.fitToContent()
      break
    case 'zoomIn':
      e.zoomAt(1.2, e.canvas.width / 2, e.canvas.height / 2)
      break
    case 'zoomOut':
      e.zoomAt(1 / 1.2, e.canvas.width / 2, e.canvas.height / 2)
      break
    case 'zoom100':
      e.zoom = 1
      e.scope.view.zoom = 1
      store.updateView({ zoom: 1 })
      e.scope.view.update()
      e.refreshGrid()
      e.emitViewChange()
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
    case 'transparentBg':
      toggleTransparent()
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
  store.updateArtboard(board.id, { width, height })
  engineRef?.value?.refreshArtboards()
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

function onUnitChange(val: string) {
  store.setRulerUnit(val as RulerUnit)
  store.setStatusMessage(`Ruler unit: ${val}`)
}

function onHelp() {
  store.setStatusMessage('Shortcuts: V Select | A Direct Select | P Pen | N Pencil | Shift+E Eraser | Shift+B Blob | C Scissors | Curvature | +/- & C Anchor Tools | Space Pan | Ctrl+0 Fit | Esc Cancel')
}
</script>

<style scoped>
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 36px;
  background: #2b2b2b;
  border-bottom: 1px solid #3a3a3a;
  padding: 0 8px;
  color: #ccc;
  flex-shrink: 0;
}

.menus {
  display: flex;
  align-items: center;
  gap: 16px;
}

.app-title {
  font-weight: bold;
  font-size: 14px;
  color: #fff;
  padding-right: 8px;
  border-right: 1px solid #4a4a4a;
}

.menu-group {
  display: flex;
  gap: 4px;
}

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

.top-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.settings-body {
  max-height: 400px;
  overflow-y: auto;
}

.setting-section {
  padding: 8px 0;
  border-bottom: 1px solid #f0f0f0;
}

.setting-section:last-child {
  border-bottom: none;
}

.setting-title {
  font-size: 13px;
  font-weight: bold;
  color: #4a90d9;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  gap: 12px;
}

.setting-row.setting-sub {
  padding-left: 24px;
  border-left: 2px solid #e0e0e0;
  margin-left: 8px;
}

.page-size-inputs {
  display: flex;
  align-items: center;
  gap: 4px;
}

.page-size-inputs .el-input-number {
  width: 90px;
}

.setting-label {
  flex: 1;
  min-width: 0;
}

.setting-name {
  display: block;
  font-size: 13px;
  color: #333;
  font-weight: 500;
}

.setting-desc {
  display: block;
  font-size: 11px;
  color: #888;
  margin-top: 2px;
}

:deep(.el-dialog) {
  border-radius: 8px;
}

:deep(.el-dialog__header) {
  padding: 14px 16px;
  border-bottom: 1px solid #eee;
}

:deep(.el-dialog__title) {
  font-size: 14px;
  font-weight: bold;
}
</style>
