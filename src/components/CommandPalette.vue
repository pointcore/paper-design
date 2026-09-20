<template>
  <el-dialog
    :model-value="store.ui.commandPaletteOpen"
    title="Command Palette"
    width="480px"
    :close-on-click-modal="true"
    @close="close"
    @opened="focusInput"
  >
    <el-input
      ref="inputRef"
      v-model="query"
      placeholder="Type a command, tool, artboard or layer…"
      clearable
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="runActive"
    />
    <div class="palette-list">
      <div
        v-for="(item, i) in filtered"
        :key="item.id"
        class="palette-row"
        :class="{ active: i === activeIdx }"
        @click="run(item)"
        @mouseenter="activeIdx = i"
      >
        <span class="palette-cat">{{ item.category }}</span>
        <span class="palette-title">{{ item.title }}</span>
        <span v-if="item.hint" class="palette-hint">{{ item.hint }}</span>
      </div>
      <div v-if="filtered.length === 0" class="palette-empty">No matches</div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, inject, ref, watch, type Ref } from 'vue'
import { useEditorStore } from '../editor/store'
import type { EditorEngine } from '../editor/engine'
import type { ToolName } from '../editor/types'
import { filterPalette, toolEntries, commandEntries, type PaletteItem } from '../editor/command-palette'
import { TOOL_SHORTCUTS } from '../editor/shortcuts'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')
const query = ref('')
const activeIdx = ref(0)
const inputRef = ref<{ focus?: () => void } | null>(null)

function close() {
  store.setCommandPaletteOpen(false)
}

function focusInput() {
  query.value = ''
  activeIdx.value = 0
  try {
    ;(inputRef.value as unknown as { focus?: () => void })?.focus?.()
  } catch { /* focus is best-effort */ }
}

watch(() => store.ui.commandPaletteOpen, (open) => {
  if (open) {
    query.value = ''
    activeIdx.value = 0
  }
})

const TOOL_LABELS: Record<string, string> = {
  select: 'Select', 'direct-select': 'Direct Select', pen: 'Pen', rect: 'Rectangle',
  ellipse: 'Ellipse', type: 'Text', pencil: 'Pencil', brush: 'Brush', eraser: 'Eraser',
  gradient: 'Gradient', scissors: 'Scissors', knife: 'Knife', zoom: 'Zoom', 'view-hand': 'Hand',
  eyedropper: 'Eyedropper', lasso: 'Lasso', wand: 'Wand', line: 'Line',
}

const STATIC_COMMANDS = [
  { id: 'save', label: 'Save Project', shortcut: 'Ctrl+S' },
  { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z' },
  { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z' },
  { id: 'fit', label: 'Fit to Window', shortcut: 'Ctrl+0' },
  { id: 'zoom-selection', label: 'Zoom to Selection', shortcut: 'Shift+F2' },
  { id: 'group', label: 'Group Selection', shortcut: 'Ctrl+G' },
  { id: 'ungroup', label: 'Ungroup Selection', shortcut: 'Ctrl+Shift+G' },
]

const allItems = computed<PaletteItem[]>(() => {
  const tools = toolEntries(
    Object.entries(TOOL_LABELS).map(([id, label]) => ({
      id,
      label: `${label} Tool`,
      shortcut: (TOOL_SHORTCUTS as Record<string, { label: string } | null>)[id]?.label,
    })),
  )
  const cmds = commandEntries(STATIC_COMMANDS)
  const boards: PaletteItem[] = store.artboards.map((b, i) => ({
    id: `board:${b.id}`,
    title: b.name || `Board ${i + 1}`,
    category: 'Artboard',
    keywords: `board artboard ${b.name ?? ''}`,
  }))
  const layers: PaletteItem[] = store.layers.map((l) => ({
    id: `layer:${l.id}`,
    title: l.name || 'Layer',
    category: 'Layer',
    keywords: `layer ${l.name ?? ''}`,
  }))
  return [...tools, ...cmds, ...boards, ...layers]
})

const filtered = computed(() => filterPalette(allItems.value, query.value, 12))

function move(delta: number) {
  if (filtered.value.length === 0) return
  activeIdx.value = (activeIdx.value + delta + filtered.value.length) % filtered.value.length
}

function runActive() {
  const item = filtered.value[activeIdx.value]
  if (item) run(item)
}

function run(item: PaletteItem) {
  const engine = engineRef?.value
  const [kind, rest] = [item.id.split(':')[0], item.id.slice(item.id.indexOf(':') + 1)]
  try {
    if (kind === 'tool') {
      const tool = rest as ToolName
      store.setTool(tool)
      engine?.setTool(tool)
    } else if (kind === 'board') {
      store.setActiveArtboard(rest)
      engine?.refreshArtboards()
    } else if (kind === 'layer') {
      store.setActiveLayer(rest)
    } else if (kind === 'cmd') {
      if (rest === 'save') {
        try {
          engine?.downloadProjectFile()
        } catch {
          store.setStatusMessage('Project save failed')
        }
      }
      else if (rest === 'undo') engine?.undo()
      else if (rest === 'redo') engine?.redo()
      else if (rest === 'fit') engine?.fitToContent()
      else if (rest === 'zoom-selection') {
        if (store.hasSelection) engine?.zoomToSelection()
        else store.setStatusMessage('Nothing selected to zoom to')
      }
      else if (rest === 'group') engine?.groupSelection()
      else if (rest === 'ungroup') engine?.ungroupSelection()
    }
  } finally {
    close()
  }
}
</script>

<style scoped>
.palette-list {
  margin-top: 10px;
  max-height: 320px;
  overflow-y: auto;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
}
.palette-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  cursor: pointer;
  font-size: 13px;
}
.palette-row:hover,
.palette-row.active {
  background: #2f6fbf;
  color: #fff;
}
.palette-row.active .palette-cat,
.palette-row.active .palette-hint {
  color: #dbeafe;
}
.palette-cat {
  width: 72px;
  flex-shrink: 0;
  font-size: 11px;
  color: #8a8a8a;
}
.palette-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.palette-hint {
  font-size: 11px;
  color: #8a8a8a;
}
.palette-empty {
  padding: 16px;
  text-align: center;
  color: #8a8a8a;
  font-size: 12px;
}
</style>
