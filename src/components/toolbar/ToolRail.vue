<template>
  <div class="tool-rail">
    <div class="tool-section">
      <div class="tool-grid">
        <div class="tool-item" v-for="tool in selectTools" :key="tool.name"
             :class="{ active: store.tool === tool.name }"
             :title="tool.tip" @click="selectTool(tool.name)">
          <el-icon :size="16"><component :is="tool.icon" /></el-icon>
        </div>
      </div>
    </div>
    
    <div class="tool-divider"></div>
    
    <div class="tool-section">
      <div class="tool-grid">
        <div class="tool-item" v-for="tool in drawTools" :key="tool.name"
             :class="{ active: store.tool === tool.name }"
             :title="tool.tip" @click="selectTool(tool.name)">
          <el-icon :size="16"><component :is="tool.icon" /></el-icon>
        </div>
      </div>
    </div>

    <div class="tool-divider"></div>

    <div class="tool-section">
      <div class="tool-grid">
        <div class="tool-item" v-for="tool in annotTools" :key="tool.name"
             :class="{ active: store.tool === tool.name }"
             :title="tool.tip" @click="selectTool(tool.name)">
          <el-icon :size="16"><component :is="tool.icon" /></el-icon>
        </div>
      </div>
    </div>

    <div class="tool-spacer"></div>

    <div class="tool-section">
      <div class="tool-grid">
        <div class="tool-item" title="Settings">
          <el-icon :size="16"><Setting /></el-icon>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  Pointer, Aim, EditPen, Edit, MagicStick,
  Position, ZoomIn, Setting, Brush, Star, Operation, ChatLineRound,
  CirclePlus, Remove
} from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { ToolName } from '../../editor/types'
import { inject, type Ref } from 'vue'
import type { EditorEngine } from '../../editor/engine'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

interface ToolDef {
  name: ToolName
  tip: string
  icon?: any
}

const selectTools: ToolDef[] = [
  { name: 'select', tip: 'Select Tool (V)', icon: Pointer },
  { name: 'direct-select', tip: 'Direct Select Tool (A)', icon: Aim },
]

const drawTools: ToolDef[] = [
  { name: 'pen', tip: 'Pen Tool (P)', icon: EditPen },
  { name: 'curvature', tip: 'Curvature Tool', icon: Operation },
  { name: 'add-anchor', tip: 'Add Anchor Point Tool (+)', icon: CirclePlus },
  { name: 'delete-anchor', tip: 'Delete Anchor Point Tool (-)', icon: Remove },
  { name: 'convert-anchor', tip: 'Convert Anchor Point Tool (Shift+C)', icon: MagicStick },
  { name: 'type', tip: 'Text Tool (T)', icon: Edit },
  { name: 'rect', tip: 'Rectangle Tool (R)', icon: MagicStick },
  { name: 'rounded-rect', tip: 'Rounded Rectangle Tool', icon: Brush },
  { name: 'ellipse', tip: 'Ellipse Tool (L)', icon: Star },
  { name: 'line', tip: 'Line Segment Tool (\\)', icon: Position },
]

const annotTools: ToolDef[] = [
  { name: 'callout', tip: 'Callout Tool', icon: ChatLineRound },
]

function selectTool(name: ToolName) {
  store.setTool(name)
  const e = engineRef?.value
  if (e) {
    e.setTool(name)
  }
}
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
}

.tool-rail::-webkit-scrollbar {
  width: 3px;
}
.tool-rail::-webkit-scrollbar-thumb {
  background: #555;
  border-radius: 2px;
}

.tool-section {
  padding: 4px;
  width: 100%;
  display: flex;
  justify-content: center;
}

.tool-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 0px;
  justify-content: center;
}

.tool-item {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 4px;
  color: #bbb;
  font-size: 16px;
  transition: all 0.15s;
}

.tool-item:hover {
  background: #3a3a3a;
  color: #fff;
}

.tool-item.active {
  background: #4a90d9;
  color: #fff;
}

.tool-divider {
  width: 28px;
  height: 1px;
  background: #3a3a3a;
  margin: 4px auto;
}

.tool-spacer {
  flex: 1;
}
</style>
