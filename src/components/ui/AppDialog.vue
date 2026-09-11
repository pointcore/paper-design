<template>
  <el-dialog
    v-model="innerVisible"
    :width="width"
    draggable
    :modal="modal"
    :close-on-click-modal="closeOnClickModal"
    modal-class="app-dialog-overlay"
    :class="['app-dialog', instanceClass, { 'popover-mode': !!trigger }]"
    @open="onOpen"
    @opened="onOpened"
    @close="onClose"
    @keydown="onKeydown"
  >
    <!-- Custom title bar: solid blue -->
    <template #header="{ close }">
      <div class="app-dlg__header">
        <span class="app-dlg__title">
          <svg
            v-if="showIcon"
            class="app-dlg__icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 9h6M9 13h6" />
          </svg>
          {{ title }}
        </span>
        <button v-if="showClose" class="app-dlg__close" @click="close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </template>

    <!-- Content slot -->
    <div class="app-dlg__body">
      <slot />
    </div>

    <!-- Footer: custom #footer slot wins, otherwise Confirm/Cancel.
         Rendered when showFooter is on or a custom footer is provided. -->
    <template v-if="showFooter || $slots.footer" #footer>
      <div class="app-dlg__footer">
        <slot name="footer">
          <el-button @click="onCancel">{{ cancelText }}</el-button>
          <el-button :type="confirmButtonType" @click="onConfirm">{{ confirmText }}</el-button>
        </slot>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, onBeforeUnmount } from "vue";

type Placement =
  | "top"
  | "top-start"
  | "top-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end"
  | "left"
  | "left-start"
  | "left-end"
  | "right"
  | "right-start"
  | "right-end";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title?: string;
    width?: number | string;
    /** Whether to show the Confirm/Cancel footer. */
    showFooter?: boolean;
    /** Icon on the left of the title bar. */
    showIcon?: boolean;
    /** Close button on the right of the title bar. */
    showClose?: boolean;
    /** Confirm button text; feature dialogs don't need their own footer. */
    confirmText?: string;
    /** Cancel button text. */
    cancelText?: string;
    /** Confirm button type; pass danger for destructive actions. */
    confirmButtonType?: "primary" | "success" | "warning" | "danger" | "info";
    closeOnClickModal?: boolean;
    /** Anchor element: the dialog is positioned next to it (popover style). An element or a getter. */
    trigger?: HTMLElement | (() => HTMLElement | null) | null;
    /** Popover direction, default bottom. */
    placement?: Placement;
    /** Gap to the anchor element (px), default 8. */
    offset?: number;
    /** Whether to show the mask; popovers usually set it to false. */
    modal?: boolean;
    /** Click-outside closes the dialog (only when modal=false). */
    closeOnClickOutside?: boolean;
    /** Flip to the opposite side when space is tight, default true. */
    autoFlip?: boolean;
  }>(),
  {
    title: "Dialog",
    width: 420,
    showFooter: true,
    showIcon: true,
    showClose: true,
    confirmText: "Confirm",
    cancelText: "Cancel",
    confirmButtonType: "primary",
    closeOnClickModal: true,
    trigger: null,
    placement: "bottom",
    offset: 8,
    modal: true,
    closeOnClickOutside: true,
    autoFlip: true
  }
);

const emit = defineEmits<{
  (e: "update:modelValue", val: boolean): void;
  (e: "open"): void;
  (e: "opened"): void;
  (e: "close"): void;
  (e: "keydown", event: KeyboardEvent): void;
  (e: "confirm"): void;
  (e: "cancel"): void;
}>();

const innerVisible = computed({
  get: () => props.modelValue,
  set: (val) => emit("update:modelValue", val)
});

// Unique per-instance class: lands on the .el-dialog root for precise targeting.
const uid = getCurrentInstance()?.uid ?? Math.random().toString(36).slice(2);
const instanceClass = `app-dialog-${uid}`;

let detach: (() => void) | null = null;

// Escape closes the topmost open dialog. Stacked per-instance close
// callbacks: only the last-opened dialog consumes the chord, so stacked
// dialogs peel off one at a time.
const escapeStack: Array<{ id: number; close: () => void }> = [];
let escapeSeq = 0;
let escapeListenerAttached = false;
function onWindowEscape(e: KeyboardEvent) {
  const top = escapeStack[escapeStack.length - 1];
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  top.close();
}
function pushEscapeHandler(close: () => void): number {
  escapeStack.push({ id: ++escapeSeq, close });
  if (!escapeListenerAttached) {
    window.addEventListener("keydown", onWindowEscape, true);
    escapeListenerAttached = true;
  }
  return escapeSeq;
}
function popEscapeHandler(id: number) {
  const idx = escapeStack.findIndex((entry) => entry.id === id);
  if (idx >= 0) escapeStack.splice(idx, 1);
  if (escapeStack.length === 0 && escapeListenerAttached) {
    window.removeEventListener("keydown", onWindowEscape, true);
    escapeListenerAttached = false;
  }
}

function resolveTrigger(): HTMLElement | null {
  const t = props.trigger;
  if (!t) return null;
  return typeof t === "function" ? t() : t;
}

function parsePlacement(p: Placement): [string, string] {
  const [side, align = "center"] = p.split("-");
  return [side, align];
}

/** Position the popover from the trigger's viewport rect (with auto-flip). */
function computePosition() {
  const triggerEl = resolveTrigger();
  const dlgEl = document.querySelector<HTMLElement>(`.${instanceClass}`);
  if (!triggerEl || !dlgEl) return;

  const tr = triggerEl.getBoundingClientRect();
  const dw = dlgEl.offsetWidth;
  const dh = dlgEl.offsetHeight;
  const off = props.offset;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const [side, align] = parsePlacement(props.placement);

  // Top/left for a given side (with start/center/end alignment).
  const calc = (s: string): { top: number; left: number } => {
    let top = 0;
    let left = 0;
    if (s === "top") top = tr.top - dh - off;
    else if (s === "bottom") top = tr.bottom + off;
    else if (s === "left") left = tr.left - dw - off;
    else if (s === "right") left = tr.right + off;

    if (s === "top" || s === "bottom") {
      if (align === "start") left = tr.left;
      else if (align === "end") left = tr.right - dw;
      else left = tr.left + tr.width / 2 - dw / 2;
    } else {
      if (align === "start") top = tr.top;
      else if (align === "end") top = tr.bottom - dh;
      else top = tr.top + tr.height / 2 - dh / 2;
    }
    return { top, left };
  };

  // Fully inside the viewport (4px margin)?
  const fits = (top: number, left: number) =>
    top >= 4 && left >= 4 && top + dh <= vh - 4 && left + dw <= vw - 4;

  const primary = calc(side);
  let chosen = primary;
  if (props.autoFlip && !fits(primary.top, primary.left)) {
    // Flip to the opposite side (keep alignment).
    const opposite =
      side === "top" ? "bottom" : side === "bottom" ? "top" : side === "left" ? "right" : "left";
    const flipped = calc(opposite);
    if (fits(flipped.top, flipped.left)) chosen = flipped;
    // Both sides overflow: keep the preferred side, clamped below.
  }

  // Clamp into the viewport.
  const top = Math.max(4, Math.min(chosen.top, vh - dh - 4));
  const left = Math.max(4, Math.min(chosen.left, vw - dw - 4));

  // position:fixed is guaranteed by .popover-mode's !important; only write coords.
  dlgEl.style.top = `${top}px`;
  dlgEl.style.left = `${left}px`;
}

function onResize() {
  computePosition();
}

function onDocMouseDown(e: MouseEvent) {
  const dlgEl = document.querySelector<HTMLElement>(`.${instanceClass}`);
  const triggerEl = resolveTrigger();
  const target = e.target as Node;
  if (dlgEl && dlgEl.contains(target)) return;
  if (triggerEl && triggerEl.contains(target)) return;
  innerVisible.value = false;
}

function attachListeners() {
  detach?.();
  window.addEventListener("resize", onResize);
  const needOutsideClose = !props.modal && props.closeOnClickOutside;
  if (needOutsideClose) {
    // Bind a tick later so the opening click doesn't close it immediately.
    document.addEventListener("mousedown", onDocMouseDown, true);
  }
  detach = () => {
    window.removeEventListener("resize", onResize);
    document.removeEventListener("mousedown", onDocMouseDown, true);
    detach = null;
  };
}

let escapeId = -1;

function onOpen() {
  emit("open");
  escapeId = pushEscapeHandler(() => innerVisible.value = false);
  nextTick(() => {
    computePosition();
    attachListeners();
  });
}

function onOpened() {
  // Re-calibrate with final size after the transition.
  computePosition();
  emit("opened");
}

function onClose() {
  if (escapeId > 0) {
    popEscapeHandler(escapeId);
    escapeId = -1;
  }
  detach?.();
  emit("close");
}

function onKeydown(event: KeyboardEvent) {
  emit("keydown", event);
}

function onConfirm() {
  emit("confirm");
}

function onCancel() {
  emit("cancel");
}

onBeforeUnmount(() => {
  if (escapeId > 0) popEscapeHandler(escapeId);
  detach?.();
});
</script>

<style>
/* NOTE: global (not scoped) on purpose — el-dialog teleports its DOM to
   <body>, so scoped selectors never match the rendered dialog. All classes
   below are app-namespaced to avoid leaking. */

/* ── el-dialog container overrides ──
   NOTE: .app-dialog may land on the overlay (fallthrough class through
   el-dialog's teleport), so the dialog box itself is styled through the
   overlay class below, which is guaranteed to be an ancestor. */
.app-dialog {
  --dlg-header-bg: #0f59a4;
  --dlg-body-bg: #141414;
  --dlg-border-radius: 6px;
  --dlg-primary: #2f7bff;

  border-radius: var(--dlg-border-radius) !important;
  max-width: calc(100vw - 16px);
  box-sizing: border-box;
  overflow: hidden;
}

/* The dialog box: kill el-dialog's own white background + padding
   (the white rim), whichever element carries .app-dialog. */
.app-dialog-overlay .el-dialog {
  background: var(--dlg-body-bg, #141414) !important;
  padding: 0 !important;
  border-radius: var(--dlg-border-radius, 6px) !important;
  overflow: hidden;
}

/* ── Title bar ── */
.app-dlg__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--dlg-header-bg);
  color: #ffffff;
  padding: 8px 12px;
  user-select: none;
  cursor: default;
}
.app-dlg__title {
  font-size: 14px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  letter-spacing: 0.3px;
}
.app-dlg__icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  opacity: 0.9;
}
.app-dlg__close {
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.65);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  flex-shrink: 0;
}
.app-dlg__close:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #fff;
}
.app-dlg__close svg {
  width: 15px;
  height: 15px;
}

/* ── Body ── */
.app-dlg__body {
  background: var(--dlg-body-bg);
  padding: 12px 14px 6px;
  color: #d5d5d5;
  font-size: 12px;
  min-height: 40px;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: #4a4a4a transparent;
}

/* Layers-style dark scrollbar */
.app-dlg__body::-webkit-scrollbar {
  width: 8px;
}
.app-dlg__body::-webkit-scrollbar-track {
  background: transparent;
}
.app-dlg__body::-webkit-scrollbar-thumb {
  background: #4a4a4a;
  border-radius: 4px;
  border: 2px solid var(--dlg-body-bg);
}

/* ── Footer ── */
.app-dlg__footer {
  background: var(--dlg-body-bg);
  padding: 8px 14px 12px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.app-dlg__footer .el-button {
  min-width: 72px;
}
.app-dlg__footer .el-button--primary {
  background: var(--dlg-primary);
  border-color: var(--dlg-primary);
}
</style>

<style>
/* Global: transparent mask + el-dialog inner overrides */
.app-dialog-overlay {
  background-color: transparent !important;
  overflow-x: hidden !important;
  overflow-y: auto !important;
}
/* Strip el-dialog default header/body padding and background */
.app-dialog .el-dialog__header {
  padding: 0 !important;
  margin: 0 !important;
}
.app-dialog .el-dialog__body {
  padding: 0 !important;
}
.app-dialog .el-dialog__footer {
  padding: 0 !important;
}
/* Hide the default title text (custom header slot is used) */
.app-dialog .el-dialog__title {
  display: none !important;
}
/* Hide the default close button (custom header has its own) */
.app-dialog .el-dialog__headerbtn {
  display: none !important;
}

/* ── Popover positioning mode ──
   Breaks out of the overlay's flex centering into fixed positioning
   next to the trigger element.
   position/margin use !important to beat el-dialog defaults. */
.app-dialog.popover-mode {
  position: fixed !important;
  margin: 0 !important;
  z-index: 3000 !important;
}
</style>
