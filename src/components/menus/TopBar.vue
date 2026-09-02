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
              <el-dropdown-item command="import">Import SVG...</el-dropdown-item>
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
              <el-dropdown-item command="sendToBack" :disabled="!store.hasSelection">Send to Back</el-dropdown-item>
              <el-dropdown-item command="group" divided :disabled="!store.hasSelection">Group</el-dropdown-item>
              <el-dropdown-item command="ungroup" :disabled="!store.hasSelection">Ungroup</el-dropdown-item>
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
              <el-dropdown-item command="rulers" divided>Rulers</el-dropdown-item>
              <el-dropdown-item command="grid">Grid</el-dropdown-item>
              <el-dropdown-item command="guides">Guides</el-dropdown-item>
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
  </div>
</template>

<script setup lang="ts">
import { QuestionFilled } from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import { inject, type Ref } from 'vue'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

function onFileCmd(cmd: string) {
  const e = engineRef?.value
  switch (cmd) {
    case 'new':
      store.setPageSize(1920, 1080)
      e?.clearSelection()
      break
    case 'export':
      if (e) {
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
            const imported = e.project.importSVG(text)
            const layer = e.getActiveLayer()
            if (Array.isArray(imported)) {
              imported.forEach((item) => {
                item.data.id = e.genId()
                item.data.isUserItem = true
                layer.addChild(item)
              })
            } else {
              const item = imported as any
              item.data.id = e.genId()
              item.data.isUserItem = true
              layer.addChild(item)
            }
            e.syncLayersToStore()
            e.scope.view.update()
            e.pushHistory('Import SVG')
            store.setStatusMessage('SVG imported')
          } catch (err) {
            store.setStatusMessage('SVG import failed')
          }
        }
      }
      input.click()
      break
    }
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
      e.copySelected()
      e.deleteSelected()
      break
    case 'copy':
      e.copySelected()
      break
    case 'paste':
      e.copySelected()
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
      e.scope.view.update()
      break
    case 'rulers':
      store.updateView({ rulersVisible: !store.view.rulersVisible })
      break
    case 'grid':
      store.updateView({ showGrid: !store.view.showGrid })
      break
    case 'guides':
      store.updateView({ showGuides: !store.view.showGuides })
      break
  }
}

function onHelp() {
  store.setStatusMessage('Shortcuts: V Select / P Pen / T Text / R Rectangle / Esc Cancel')
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
</style>
