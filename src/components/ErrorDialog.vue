/**
 * Error log dialog — surfaces what the global handlers caught.
 *
 * Previously an uncaught throw only reached the console, so a failure during
 * a tool gesture was invisible and left the document half-modified with no
 * way to report it. This shows the newest failures with their context and
 * repeat count, and offers a copy-to-clipboard report.
 */

<template>
  <AppDialog
    :model-value="open"
    title="Unexpected error"
    :width="560"
    :show-footer="false"
    :close-on-click-modal="false"
    @update:model-value="onVisibility"
  >
    <div class="errlog">
      <p class="errlog__intro">
        Something went wrong. The editor kept running and your document is unchanged —
        use Undo if a change looks wrong. Copying the details below helps pin down the cause.
      </p>

      <ul class="errlog__list">
        <li v-for="(entry, i) in entries" :key="i" class="errlog__item">
          <div class="errlog__head">
            <span class="errlog__name">{{ entry.name }}</span>
            <span class="errlog__msg">{{ entry.message }}</span>
            <span v-if="entry.count > 1" class="errlog__count">{{ entry.count }}x</span>
          </div>
          <div class="errlog__meta">in {{ entry.context }} · {{ timeOf(entry.lastSeen) }}</div>
        </li>
      </ul>

      <div class="errlog__actions">
        <el-button size="small" @click="copy">Copy details</el-button>
        <el-button size="small" @click="dismiss">Clear log</el-button>
      </div>
      <p class="errlog__status">{{ status }}</p>
    </div>
  </AppDialog>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEditorStore } from '../editor/store'
import { errorLog, formatDiagnostics } from '../editor/error-reporting'
import AppDialog from './ui/AppDialog.vue'

const store = useEditorStore()
const status = ref('')

const entries = computed(() => errorLog.entries())
const open = computed(() => store.ui.errorLogOpen)

function onVisibility(v: boolean) {
  store.setErrorLogOpen(v)
}

function timeOf(ms: number): string {
  const d = new Date(ms)
  return Number.isFinite(ms) && !Number.isNaN(d.getTime())
    ? d.toLocaleTimeString()
    : 'unknown time'
}

/** Compose the report once; both copy buttons paste the same text. */
function report(): string {
  return formatDiagnostics(errorLog.entries(), {
    documentName: store.documentName || 'Untitled',
    tool: store.tool,
    boardCount: store.artboards.length,
    historyLength: store.history.length,
    hasUnsavedChanges: store.hasUnsavedChanges,
    zoom: store.view.zoom,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    viewport: typeof window !== 'undefined' ? `${window.innerWidth}x${window.innerHeight}` : '',
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : undefined,
  })
}

/**
 * Clipboard writes need a secure context; over plain http (the dev server on
 * a LAN address) navigator.clipboard is undefined, so fall back to a hidden
 * textarea + execCommand, which still works there.
 */
async function copy() {
  const text = report()
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      status.value = 'Copied to clipboard'
      return
    }
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    status.value = ok ? 'Copied to clipboard' : 'Copy failed — select the text manually'
  } catch {
    status.value = 'Copy failed — select the text manually'
  }
}

function dismiss() {
  errorLog.clear()
  status.value = ''
  store.setErrorLogOpen(false)
}
</script>

<style scoped>
.errlog__intro {
  color: #bbb;
  font-size: 12px;
  line-height: 1.5;
  margin-bottom: 12px;
}

.errlog__list {
  list-style: none;
  max-height: 260px;
  overflow-y: auto;
  border: 1px solid #3a3a3a;
  border-radius: 4px;
  background: #252526;
}

.errlog__item {
  padding: 8px 10px;
  border-bottom: 1px solid #333;
}
.errlog__item:last-child { border-bottom: none; }

.errlog__head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
}

.errlog__name {
  color: #e88;
  font-weight: 600;
  flex-shrink: 0;
}

.errlog__msg {
  color: #ddd;
  word-break: break-word;
  flex: 1;
}

.errlog__count {
  color: #e8a33d;
  font-size: 11px;
  flex-shrink: 0;
}

.errlog__meta {
  color: #777;
  font-size: 11px;
  margin-top: 3px;
}

.errlog__actions {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.errlog__status {
  color: #8db4e3;
  font-size: 11px;
  min-height: 14px;
  margin-top: 6px;
}
</style>
