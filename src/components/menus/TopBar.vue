<template>
  <div class="top-bar">
    <div class="menus">
      <div class="app-title">Vector Editor{{ store.documentName ? ' — ' + store.documentName : '' }}</div>
      <div class="menu-group">
        <FileMenu />

        <EditMenu />

        <ObjectMenu />

        <ViewMenu />
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
import { watch } from 'vue'
import { QuestionFilled } from '@element-plus/icons-vue'
import EditMenu from './EditMenu.vue'
import ViewMenu from './ViewMenu.vue'
import FileMenu from './FileMenu.vue'
import ObjectMenu from './ObjectMenu.vue'
import { useEditorStore } from '../../editor/store'

const store = useEditorStore()

watch(() => store.documentName, (name) => {
  document.title = name ? `Vue Vector Editor — ${name}` : 'Vue Vector Editor'
})

function onHelp() {
  store.setStatusMessage('Shortcuts: V Select | A Direct | Q Lasso | Y Wand | P Pen | N Pencil | Shift+E Eraser | Shift+B Blob | B Brush | G Gradient | C Scissors | Shift+M Builder | Shift+W Width | Shift+R Rotate | Shift+S Scale | Shift+O Mirror | Shift+F FreeTf | +/- & Shift+C Anchors | [ ] Brush Size | X Target · Shift+X Swap | Tab Present | Space Pan | Ctrl+0 Fit | Arrows Nudge | Ctrl+A Select | Ctrl+Shift+A Reselect | Ctrl+D Duplicate | Ctrl+G Group | Ctrl+2 Lock | Ctrl+3 Hide | Ctrl+C/X/V Clipb | Ctrl+Shift+C PNG | Ctrl+F/B Paste | Ctrl+[ Order | Ctrl+S Save | Ctrl+Shift+I Invert | Esc Cancel')
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

.top-right {
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
