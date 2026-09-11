<template>
  <div class="tool-rail" :class="'density-' + store.ui.toolRailDensity">
    <div class="rail-search" title="Filter tools">
      <el-input v-model="search" size="small" placeholder="Tools" clearable :prefix-icon="Search" />
    </div>

    <!-- Filtered flat list while searching -->
    <div v-if="search.trim()" class="tool-section">
      <div class="tool-grid">
        <div class="tool-item" v-for="tool in filteredTools" :key="tool.name"
             :class="{ active: store.tool === tool.name }"
             :title="tool.tip" @click="selectTool(tool.name)">
          <el-icon v-if="tool.icon" :size="16"><component :is="tool.icon" /></el-icon>
          <span v-else class="glyph">{{ tool.glyph }}</span>
        </div>
      </div>
      <div v-if="filteredTools.length === 0" class="rail-empty">No tools</div>
    </div>

    <!-- Grouped flyouts (AI/CDR style) -->
    <template v-else>
      <div v-for="(g, gi) in groups" :key="g.key" class="group-block">
        <div v-if="gi > 0" class="tool-divider"></div>
        <div class="tool-section">
          <div class="tool-grid">
            <div class="tool-item group-main"
                 :class="{ active: isGroupActive(g) }"
                 :title="currentOf(g).tip + ' (click = use, ▸ = more, double-click = cycle)'"
                 @click="selectTool(currentOf(g).name)"
                 @dblclick="cycleGroup(g)">
              <el-icon v-if="currentOf(g).icon" :size="16"><component :is="currentOf(g).icon" /></el-icon>
              <span v-else class="glyph">{{ currentOf(g).glyph }}</span>
              <span v-if="g.members.length > 1" class="flyout-mark" @click.stop="toggleFlyout(g.key)">▸</span>
            </div>
          </div>
        </div>
        <div v-if="openFlyout === g.key" class="flyout">
          <div v-for="m in g.members" :key="m.name" class="flyout-item"
               :class="{ active: store.tool === m.name }"
               :title="m.tip" @click="pickFromGroup(g.key, m.name)">
            <el-icon v-if="m.icon" :size="14"><component :is="m.icon" /></el-icon>
            <span v-else class="glyph">{{ m.glyph }}</span>
            <span class="flyout-label">{{ shortLabel(m.name) }}</span>
          </div>
        </div>
      </div>
    </template>

    <div class="tool-spacer"></div>

    <div class="tool-section">
      <div class="tool-grid">
        <div class="tool-item" :title="densityTip" @click="toggleDensity">
          <el-icon :size="14"><Grid /></el-icon>
        </div>
        <div class="tool-item" title="Canvas Settings" @click="openSettings">
          <el-icon :size="16"><Setting /></el-icon>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, inject, type Ref, onMounted, onUnmounted } from 'vue'
import {
  Pointer, Aim, EditPen, Edit, MagicStick,
  Position, Setting, Brush, BrushFilled, Star, Operation, ChatLineRound,
  CirclePlus, Remove, Tickets, Link, Document, Delete, Stamp, Scissor, Crop,
  Discount, Loading, Lollipop, Coordinate, Share, Expand, Search, Grid,
} from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { ToolName } from '../../editor/types'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

interface ToolDef {
  name: ToolName
  tip: string
  icon?: any
  glyph?: string
}

interface ToolGroup {
  key: string
  members: ToolDef[]
}

const groups: ToolGroup[] = [
  { key: 'select', members: [
    { name: 'select', tip: 'Select Tool (V)', icon: Pointer },
    { name: 'direct-select', tip: 'Direct Select Tool (A)', icon: Aim },
    { name: 'lasso', tip: 'Lasso Tool (Q, drag a loop)', glyph: '◎' },
    { name: 'wand', tip: 'Magic Wand (Y, click a fill)', glyph: '🪄' },
    { name: 'free-transform', tip: 'Free Transform (Shift+F)', glyph: '⛶' },
  ] },
  { key: 'draw', members: [
    { name: 'pen', tip: 'Pen Tool (P)', icon: EditPen },
    { name: 'curvature', tip: 'Curvature Tool (Shift+~)', icon: Operation },
    { name: 'add-anchor', tip: 'Add Anchor Point Tool (+)', icon: CirclePlus },
    { name: 'delete-anchor', tip: 'Delete Anchor Point Tool (-)', icon: Remove },
    { name: 'convert-anchor', tip: 'Convert Anchor Point Tool (Shift+C)', icon: MagicStick },
  ] },
  { key: 'text', members: [
    { name: 'type', tip: 'Text Tool (T)', icon: Edit },
    { name: 'area-type', tip: 'Area Text Tool (drag a frame)', icon: Tickets },
    { name: 'type-on-path', tip: 'Type on Path Tool (click a path)', icon: Link },
    { name: 'vertical-type', tip: 'Vertical Text Tool', icon: Document },
  ] },
  { key: 'shapes', members: [
    { name: 'rect', tip: 'Rectangle Tool (R)', icon: MagicStick },
    { name: 'rounded-rect', tip: 'Rounded Rectangle Tool', icon: Crop },
    { name: 'ellipse', tip: 'Ellipse Tool (L)', icon: Star },
    { name: 'polygon', tip: 'Polygon / Star Tool', icon: Discount },
    { name: 'arc', tip: 'Arc Tool', glyph: '◠' },
    { name: 'line', tip: 'Line Segment Tool (\\)', icon: Position },
    { name: 'spiral', tip: 'Spiral Tool', icon: Loading },
    { name: 'rect-grid', tip: 'Rectangular Grid Tool', glyph: '#' },
    { name: 'polar-grid', tip: 'Polar Grid Tool', glyph: '⊙' },
  ] },
  { key: 'paint', members: [
    { name: 'pencil', tip: 'Pencil Tool (N)', icon: BrushFilled },
    { name: 'blob-brush', tip: 'Blob Brush Tool (Shift+B)', icon: Lollipop },
    { name: 'brush', tip: 'Brush Tool (B)', icon: Brush },
    { name: 'eraser', tip: 'Eraser Tool (Shift+E)', icon: Delete },
    { name: 'spray', tip: 'Symbol Sprayer (drag to scatter, needs a symbol)', glyph: '⁂' },
  ] },
  { key: 'edit', members: [
    { name: 'scissors', tip: 'Scissors Tool (C)', icon: Scissor },
    { name: 'shape-builder', tip: 'Shape Builder Tool (Shift+M)', icon: Share },
    { name: 'width', tip: 'Width Tool (Shift+W)', icon: Expand },
    { name: 'reshape', tip: 'Reshape Tool (drag to push anchors)', glyph: '〰' },
    { name: 'gradient', tip: 'Gradient Tool (G, drag to set angle)', glyph: '🌈' },
    { name: 'eyedropper', tip: 'Eyedropper Tool (I, Alt = sample only)', icon: Stamp },
  ] },
  { key: 'transform', members: [
    { name: 'rotate', tip: 'Rotate Tool (Shift+R, drag to rotate)', glyph: '⟳' },
    { name: 'scale', tip: 'Scale Tool (Shift+S, drag to scale)', glyph: '⤢' },
    { name: 'mirror', tip: 'Mirror Tool (Shift+O, click flips)', glyph: '⇋' },
  ] },
  { key: 'annot', members: [
    { name: 'callout', tip: 'Callout Tool', icon: ChatLineRound },
    { name: 'measure', tip: 'Measure Tool (drag for length and angle)', icon: Coordinate },
  ] },
  { key: 'view', members: [
    { name: 'view-hand', tip: 'Hand Tool (H)', glyph: '✋' },
    { name: 'zoom', tip: 'Zoom Tool (Z)', glyph: '🔍' },
  ] },
]

const allTools = computed<ToolDef[]>(() => groups.flatMap((g) => g.members))
const search = ref('')
const filteredTools = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return allTools.value
  return allTools.value.filter((t) => t.name.includes(q) || t.tip.toLowerCase().includes(q))
})

// Per-group memory of the last used member (AI keeps the flyout selection).
const groupCurrent = ref<Record<string, ToolName>>({})
const openFlyout = ref('')

function groupOf(tool: ToolName): ToolGroup | undefined {
  return groups.find((g) => g.members.some((m) => m.name === tool))
}
function currentOf(g: ToolGroup): ToolDef {
  const cur = groupCurrent.value[g.key]
  return g.members.find((m) => m.name === cur) ?? g.members.find((m) => m.name === store.tool) ?? g.members[0]
}
function isGroupActive(g: ToolGroup): boolean {
  return g.members.some((m) => m.name === store.tool)
}
function shortLabel(name: ToolName): string {
  return name.replace(/-/g, ' ')
}

function selectTool(name: ToolName) {
  const g = groupOf(name)
  if (g) groupCurrent.value[g.key] = name
  persistGroupMemory()
  store.setTool(name)
  engineRef?.value?.setTool(name)
  openFlyout.value = ''
}

function pickFromGroup(key: string, name: ToolName) {
  groupCurrent.value[key] = name
  persistGroupMemory()
  selectTool(name)
}

function toggleFlyout(key: string) {
  openFlyout.value = openFlyout.value === key ? '' : key
}

function cycleGroup(g: ToolGroup) {
  const idx = g.members.findIndex((m) => m.name === store.tool)
  const next = g.members[(idx + 1) % g.members.length]
  selectTool(next.name)
}

const densityTip = computed(() =>
  store.ui.toolRailDensity === 'single' ? 'Switch to double column' : 'Switch to single column'
)
function toggleDensity() {
  store.setToolRailDensity(store.ui.toolRailDensity === 'single' ? 'double' : 'single')
}

function openSettings() {
  store.setSettingsOpen(true)
}

function persistGroupMemory() {
  try {
    localStorage.setItem('vve.toolGroups', JSON.stringify(groupCurrent.value))
  } catch { /* private mode: memory stays in session */ }
}
function restoreGroupMemory() {
  try {
    const raw = localStorage.getItem('vve.toolGroups')
    if (!raw) return
    const parsed = JSON.parse(raw) as unknown
    // Stored JSON is hand-editable and survives across builds, so a bare
    // JSON.parse used to be able to assign null/array here — currentOf()
    // then threw on groupCurrent.value[key] and the whole rail failed to
    // render. Only keep known tool names.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const known = new Set<string>(groups.flatMap((g) => g.members.map((m) => m.name)))
    const next: Record<string, ToolName> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && known.has(value)) next[key] = value as ToolName
    }
    groupCurrent.value = next
  } catch { /* ignore */ }
}

function onDocClick() { openFlyout.value = '' }
onMounted(() => {
  restoreGroupMemory()
  document.addEventListener('click', onDocClick)
})
onUnmounted(() => {
  document.removeEventListener('click', onDocClick)
})
</script>

<style scoped>
.tool-rail {
  width: 48px;
  background: #2b2b2b;
  border-right: 1px solid #3a3a3a;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 4px 0;
  flex-shrink: 0;
  overflow-y: auto;
  position: relative;
}
.tool-rail.density-double { width: 76px; }
.tool-rail::-webkit-scrollbar { width: 3px; }
.tool-rail::-webkit-scrollbar-thumb { background: #555; border-radius: 2px; }
.rail-search { width: 100%; padding: 2px 4px 6px; }
.rail-search :deep(.el-input__wrapper) {
  background: #111; border: 1px solid #3d3d3d; box-shadow: none !important; border-radius: 3px;
}
.rail-search :deep(.el-input__inner) { color: #e6e6e6; font-size: 11px; }
.rail-empty { color: #666; font-size: 11px; text-align: center; padding: 8px 0; }
.tool-section { padding: 4px; width: 100%; display: flex; justify-content: center; }
.tool-grid { display: flex; flex-wrap: wrap; gap: 0px; justify-content: center; }
.density-double .tool-grid { max-width: 68px; }
.tool-item {
  width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
  cursor: pointer; border-radius: 4px; color: #bbb; font-size: 16px; transition: all 0.15s; position: relative;
}
.tool-item:hover { background: #3a3a3a; color: #fff; }
.tool-item.active { background: #4a90d9; color: #fff; }
.glyph { font-size: 15px; line-height: 1; }
.flyout-mark { position: absolute; right: 1px; bottom: 0px; font-size: 8px; color: #888; padding: 2px; }
.group-main:hover .flyout-mark { color: #fff; }
.tool-divider { width: 28px; height: 1px; background: #3a3a3a; margin: 4px auto; }
.tool-spacer { flex: 1; }
.group-block { width: 100%; position: relative; display: flex; flex-direction: column; align-items: center; }
.flyout {
  position: absolute; left: 46px; top: 0; z-index: 50; min-width: 150px;
  background: #1e1e1e; border: 1px solid #3d3d3d; border-radius: 4px; padding: 4px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.density-double .flyout { left: 74px; }
.flyout-item {
  display: flex; align-items: center; gap: 8px; padding: 6px 8px; font-size: 12px;
  color: #d5d5d5; border-radius: 3px; cursor: pointer; white-space: nowrap; text-transform: capitalize;
}
.flyout-item:hover { background: #333; color: #fff; }
.flyout-item.active { background: #2f6fbf; color: #fff; }
.flyout-label { flex: 1; }
</style>
