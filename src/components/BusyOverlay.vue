<template>
  <div v-if="store.busy.active" class="busy-overlay">
    <div class="busy-box">
      <div class="busy-spinner" />
      <div class="busy-message">{{ store.busy.message || 'Working…' }}</div>
      <div v-if="store.busy.progress !== null" class="busy-track">
        <div class="busy-fill" :style="{ width: store.busy.progress + '%' }" />
      </div>
      <div v-if="store.busy.progress !== null" class="busy-pct">{{ store.busy.progress }}%</div>
      <div v-else class="busy-hint">One moment…</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useEditorStore } from '../editor/store'

const store = useEditorStore()
</script>

<style scoped>
.busy-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 20, 20, 0.55);
  cursor: wait;
}
.busy-box {
  min-width: 260px;
  max-width: 80vw;
  padding: 24px 32px;
  border-radius: 10px;
  background: #262626;
  border: 1px solid #3a3a3a;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.busy-spinner {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 3px solid #3a3a3a;
  border-top-color: #4a90d9;
  animation: busy-spin 0.8s linear infinite;
}
@keyframes busy-spin {
  to { transform: rotate(360deg); }
}
.busy-message {
  color: #e0e0e0;
  font-size: 14px;
  white-space: nowrap;
}
.busy-track {
  width: 220px;
  height: 6px;
  border-radius: 3px;
  background: #3a3a3a;
  overflow: hidden;
}
.busy-fill {
  height: 100%;
  border-radius: 3px;
  background: #4a90d9;
  transition: width 0.15s ease-out;
}
.busy-pct {
  color: #9ab8dd;
  font-size: 12px;
}
.busy-hint {
  color: #888;
  font-size: 12px;
}
</style>
