<template>
  <div v-if="isTextSelected" class="prop-section text-section">
    <div class="prop-head" @click="expanded = !expanded">
      <span class="prop-chevron" :class="{ closed: !expanded }">›</span>
      <span class="prop-label">Text</span>
    </div>
    <div v-show="expanded" class="prop-body">
      <div class="prop-row">
        <el-select v-model="fontFamily" size="small" class="flex-ctl" filterable allow-create default-first-option placeholder="Font family" @change="onFontFamilyChange">
          <el-option v-for="f in fontFamilies" :key="f" :label="f" :value="f" />
        </el-select>
      </div>
      <div class="prop-row">
        <span class="prop-label-sm">Size</span>
        <el-input-number v-model="fontSize" :min="1" :max="400" size="small" controls-position="right" @change="onFontSizeChange" />
        <el-button size="small" class="fmt-btn" :type="isBold ? 'primary' : ''" @click="toggleBold">B</el-button>
        <el-button size="small" class="fmt-btn" :type="isItalic ? 'primary' : ''" @click="toggleItalic">I</el-button>
        <el-button size="small" class="fmt-btn" :type="isUnderline ? 'primary' : ''" title="Underline" @click="toggleUnderline">U</el-button>
        <el-button size="small" class="fmt-btn" :type="isStrikethrough ? 'primary' : ''" title="Strikethrough" @click="toggleStrikethrough">S</el-button>
      </div>
      <div class="prop-row">
        <span class="prop-label-sm">Align</span>
        <el-radio-group v-model="textAlign" size="small" class="seg-full" @change="onAlignChange">
          <el-radio-button value="left">Left</el-radio-button>
          <el-radio-button value="center">Center</el-radio-button>
          <el-radio-button value="right">Right</el-radio-button>
          <el-radio-button value="justify">Justify</el-radio-button>
        </el-radio-group>
      </div>
      <div class="prop-row">
        <span class="prop-label-sm">Case</span>
        <el-button size="small" class="fmt-btn" title="UPPERCASE" @click="onChangeCase('upper')">AA</el-button>
        <el-button size="small" class="fmt-btn" title="lowercase" @click="onChangeCase('lower')">aa</el-button>
        <el-button size="small" class="fmt-btn" title="Title Case" @click="onChangeCase('title')">Aa</el-button>
        <el-button size="small" class="grid-btn" title="Fill with placeholder text" @click="onLorem">Lorem</el-button>
      </div>
      <div class="prop-row">
        <span class="prop-label-sm">Leading</span>
        <el-input-number v-model="leadingValue" :min="1" :max="1000" size="small" controls-position="right" :disabled="leadingAuto" @change="onLeadingChange" />
        <el-button size="small" class="fmt-btn" :type="leadingAuto ? 'primary' : ''" title="Auto leading (1.2x)" @click="toggleLeadingAuto">A</el-button>
      </div>
      <div class="prop-row">
        <span class="prop-label-sm">Tracking</span>
        <el-input-number v-model="trackingValue" :min="-200" :max="1000" size="small" controls-position="right" @change="onTrackingChange" />
        <span class="unit">/1000em</span>
      </div>
      <div class="prop-row">
        <span class="prop-label-sm">Base</span>
        <el-input-number v-model="baselineValue" :min="-100" :max="100" size="small" controls-position="right" @change="onBaselineChange" />
        <el-button size="small" class="fmt-btn" title="Superscript (+33% size)" @click="onBaselineQuick(1)">↑</el-button>
        <el-button size="small" class="fmt-btn" title="Subscript (−33% size)" @click="onBaselineQuick(-1)">↓</el-button>
        <span class="prop-label-sm">H%</span>
        <el-input-number v-model="hScaleValue" :min="10" :max="400" size="small" controls-position="right" @change="onScaleChange" />
      </div>
      <div class="prop-row">
        <span class="prop-label-sm">Path</span>
        <el-input-number v-model="pathOffsetValue" size="small" controls-position="right" title="Type on path start offset" @change="onPathOffsetChange" />
        <span class="unit">offset</span>
      </div>
      <div class="prop-row">
        <span class="prop-label-sm">OT</span>
        <el-button size="small" class="fmt-btn" :type="otLiga ? 'primary' : ''" title="Standard Ligatures (liga)" @click="toggleOT('liga')">Lig</el-button>
        <el-button size="small" class="fmt-btn" :type="otDLiga ? 'primary' : ''" title="Discretionary Ligatures (dlig)" @click="toggleOT('dlig')">dLig</el-button>
        <el-button size="small" class="fmt-btn" :type="otSmallCaps ? 'primary' : ''" title="Small Caps (smcp)" @click="toggleOT('smallCaps')">SC</el-button>
        <el-button size="small" class="fmt-btn" :type="otOldstyle ? 'primary' : ''" title="Oldstyle Numerals (onum)" @click="toggleOT('oldstyleNums')">123</el-button>
        <el-button size="small" class="fmt-btn" :type="otTabular ? 'primary' : ''" title="Tabular Numerals (tnum)" @click="toggleOT('tabularNums')">Tab</el-button>
        <el-button size="small" class="fmt-btn" :type="otFrac ? 'primary' : ''" title="Fractions (frac)" @click="toggleOT('fractions')">Fr</el-button>
      </div>
      <div v-if="isAreaSelected">
        <div class="prop-row">
          <span class="prop-label-sm">Frame</span>
          <el-input-number v-model="frameW" :min="5" :max="5000" :precision="1" size="small" controls-position="right" @change="onFrameSizeChange" />
          <el-input-number v-model="frameH" :min="5" :max="5000" :precision="1" size="small" controls-position="right" @change="onFrameSizeChange" />
          <el-button size="small" class="icon-btn" title="Fit frame height to the text" @click="onFrameAutofit">⤢</el-button>
        </div>
        <div v-if="overflowHint" class="ai-desc">{{ overflowHint }}</div>
        <div v-if="hasOverflow" class="prop-row">
          <el-button size="small" plain class="wide-btn" @click="onFlowOverflow">Flow Overflow to New Frame</el-button>
        </div>
        <div v-if="threadHint" class="ai-desc">{{ threadHint }}</div>
        <div class="prop-row">
          <el-button size="small" class="grid-btn" title="Thread the selected area frames left-to-right" @click="onThreadFrames">Thread</el-button>
          <el-button size="small" class="icon-btn" title="Select previous frame" @click="onThreadNav('prev')">←</el-button>
          <el-button size="small" class="icon-btn" title="Select next frame" @click="onThreadNav('next')">→</el-button>
        </div>
        <div class="prop-row">
          <span class="prop-label-sm">Styles</span>
          <el-input v-model="textPresetName" size="small" class="flex-ctl" placeholder="Preset name" @keyup.enter="onSaveTextPreset" />
          <el-button size="small" class="grid-btn" @click="onSaveTextPreset">Save</el-button>
        </div>
        <div v-for="p in store.textStylePresets" :key="p.id" class="prop-row">
          <el-button size="small" class="grid-btn flex-ctl" :title="`Apply ${p.name}`" @click="onApplyTextPreset(p.id)">{{ p.name }}</el-button>
          <el-button size="small" class="icon-btn" title="Delete preset" @click="onRemoveTextPreset(p.id)">×</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * TextSection (C2: third template slice out of PropertyPanel.vue).
 *
 * The whole Text panel section: character/paragraph styling, OpenType
 * toggles, area-frame editing, overflow/threading and style presets.
 * Same section contract as the sibling editors: the parent renders it
 * unconditionally inside the selection body and calls syncFromStore()
 * on selection changes; the section self-gates on a selected text item
 * and syncs on mount. applyCharFillColor is exposed for the parent fill
 * handler's character-selection branch.
 */
import { ref, inject, onMounted, type Ref } from 'vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { TextAlign, CharRun } from '../../editor/types'
import { cleanTextStylePresets } from '../../editor/property-helpers'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

// Collapsed state lives here (the parent no longer owns this section).
const expanded = ref(true)

// ---- Text properties ----

const fontFamilies = [
  'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia',
  'Times New Roman', 'Courier New', 'Impact', 'sans-serif', 'serif', 'monospace',
]

const isTextSelected = ref(false)
const fontFamily = ref('Arial')
const fontSize = ref(12)
const isBold = ref(false)
const isItalic = ref(false)
const isUnderline = ref(false)
const isStrikethrough = ref(false)
const baselineValue = ref(0)
const hScaleValue = ref(100)
const pathOffsetValue = ref(0)
const textAlign = ref<TextAlign>('left')
const leadingAuto = ref(true)
const leadingValue = ref(14)
const trackingValue = ref(0)
// OpenType feature toggles
const otLiga = ref(true)
const otDLiga = ref(false)
const otSmallCaps = ref(false)
const otOldstyle = ref(false)
const otTabular = ref(false)
const otFrac = ref(false)
// Area-frame editing (single area-text selection only).
const isAreaSelected = ref(false)
const frameW = ref(0)
const frameH = ref(0)
const hasOverflow = ref(false)
const overflowHint = ref('')
const threadHint = ref('')

function getEngine() { return engineRef?.value || null }

/** Text controller behind the type tools (area rewrap + threading). */
function textController() {
  const e = getEngine()
  if (!e) return null
  try {
    return e.getController('type') as {
      selectedAreaItem: () => any
      areaInfo: (item: any) => { frame: { x: number; y: number; width: number; height: number }; raw: string } | null
      areaOverflow: (item: any) => { lines: number; fits: number; overflowChars: number }
      resizeAreaItem: (item: any, w: number, h: number) => boolean
      flowOverflowToNewFrame: (item: any) => boolean
      effectiveLeading: () => number
    } | null
  } catch {
    return null
  }
}

/** First selected point text (annotation labels excluded), if any. */
function getSelectedText(): paper.PointText | null {
  const e = getEngine()
  if (!e) return null
  for (const item of e.getSelection()) {
    if (item instanceof e.scope.PointText && !(item as any).data?.annotation) {
      return item as paper.PointText
    }
  }
  return null
}

/** Read text styling from the first selected point text into the panel. */
function syncFromStore() {
  const item = getSelectedText()
  isTextSelected.value = !!item
  isAreaSelected.value = false
  hasOverflow.value = false
  overflowHint.value = ''
  threadHint.value = ''
  if (!item) return

  // Per-character style readback: when a char range is selected, read from
  // the styled runs instead of the item-level properties.
  const charSel = store.charSelection
  const hasCharSel = !!charSel && charSel.itemId === (item.data as any)?.id
  const runStyle = hasCharSel ? charRunStyleAt(item, charSel.start, charSel.end) : {}

  fontFamily.value = (runStyle.fontFamily as string) ?? ((item.fontFamily as string) || 'Arial')
  fontSize.value = Number(runStyle.fontSize ?? item.fontSize) || 12
  isBold.value = runStyle.fontWeight !== undefined
    ? (String(runStyle.fontWeight) === 'bold' || Number(runStyle.fontWeight) >= 600)
    : (String(item.fontWeight) === 'bold' || Number(item.fontWeight) >= 600)
  isItalic.value = runStyle.fontStyle !== undefined
    ? (runStyle.fontStyle as string) === 'italic'
    : ((item as any).fontStyle as string) === 'italic'
  isUnderline.value = !!(runStyle as any).underline || !!(item as any).underline || !!store.charStyle.underline
  isStrikethrough.value = !!(runStyle as any).strikethrough || !!(item as any).strikethrough || !!store.charStyle.strikethrough
  baselineValue.value = Number((runStyle as any).baselineShift ?? (item as any).baselineShift ?? store.charStyle.baselineShift) || 0
  hScaleValue.value = Number((runStyle as any).horizontalScale ?? (item as any).horizontalScale ?? store.charStyle.horizontalScale) || 100
  pathOffsetValue.value = Number(store.textPathOffset) || 0
  const j = (item as any).justification as string
  const storedAlign = store.paragraphStyle.align
  textAlign.value = j === 'center' || j === 'right' ? j : (storedAlign === 'justify' ? 'justify' : 'left')
  const leading = Number((item as any).leading) || 0
  if (leading > 0) {
    leadingValue.value = Math.round(leading * 10) / 10
    leadingAuto.value = Math.abs(leading - fontSize.value * 1.2) < 0.05 && store.charStyle.autoLeading
  } else {
    leadingValue.value = Math.round(fontSize.value * 1.2 * 10) / 10
    leadingAuto.value = true
  }
  trackingValue.value = Number(store.charStyle.tracking) || 0
  // OpenType features
  const ot = (item as any).data?.openType ?? store.charStyle.openType
  otLiga.value = ot?.liga ?? true
  otDLiga.value = ot?.dlig ?? false
  otSmallCaps.value = ot?.smallCaps ?? false
  otOldstyle.value = ot?.oldstyleNums ?? false
  otTabular.value = ot?.tabularNums ?? false
  otFrac.value = ot?.fractions ?? false
  syncAreaFromSelection()
}

/** Read area-frame size + overflow state for a single area-text selection. */
function syncAreaFromSelection() {
  const tc = textController()
  const e = getEngine()
  if (!tc || !e) return
  const items = e.getSelection()
  const single = items.length === 1 ? items[0] as any : null
  const isArea = !!single && single instanceof e.scope.PointText && (single.data as any)?.textMode === 'area'
  isAreaSelected.value = isArea
  if (!isArea) return
  const info = tc.areaInfo(single)
  if (!info) return
  frameW.value = Math.round(info.frame.width * 10) / 10
  frameH.value = Math.round(info.frame.height * 10) / 10
  const over = tc.areaOverflow(single)
  hasOverflow.value = over.overflowChars > 0
  overflowHint.value = hasOverflow.value
    ? `${over.lines - over.fits} line(s) overflow (${over.overflowChars} chars)`
    : `${over.lines} line(s) fit`
  const data = (single.data as any) ?? {}
  if (data.threadNext || data.threadPrev) {
    threadHint.value = 'Threaded frame (one-way v1: edits do not auto-reflow downstream)'
  }
}

// ------------------------------------------------------------------
// Per-character styling helpers (AI/CDR parity)
// ------------------------------------------------------------------

/** Read the effective style for a character range from an item's styled runs. */
function charRunStyleAt(item: paper.PointText, start: number, end: number): Partial<import('../../editor/types').CharStyle> {
  const runs = ((item as any).data?.runs as CharRun[]) ?? []
  const merged: Record<string, any> = {}
  for (const run of runs) {
    if (run.end <= start || run.start >= end) continue
    for (const [k, v] of Object.entries(run.style)) {
      if (v !== undefined && v !== null) merged[k] = v
    }
  }
  return merged
}

/** Split/insert runs and apply a style to the selected range. */
function applyCharRunStyle(
  item: paper.PointText,
  start: number,
  end: number,
  style: Partial<import('../../editor/types').CharStyle>
) {
  const runs = ((item as any).data?.runs as CharRun[]) ?? []
  const next: CharRun[] = []
  let i = 0
  while (i < runs.length && runs[i].end <= start) { next.push({ ...runs[i] }); i++ }
  if (i < runs.length && runs[i].start < start) {
    next.push({ start: runs[i].start, end: start, style: { ...runs[i].style } })
  }
  next.push({ start, end, style: { ...style } })
  while (i < runs.length && runs[i].end < end) { i++ }
  if (i < runs.length && runs[i].start < end) {
    next.push({ start: end, end: runs[i].end, style: { ...runs[i].style } })
    i++
  }
  while (i < runs.length) { next.push({ ...runs[i] }); i++ }
  // Merge adjacent runs with identical style.
  const merged: CharRun[] = []
  for (const r of next) {
    if (merged.length > 0) {
      const last = merged[merged.length - 1]
      if (last.end === r.start && JSON.stringify(last.style) === JSON.stringify(r.style)) {
        last.end = r.end
        continue
      }
    }
    merged.push({ ...r })
  }
  ;(item as any).data.runs = merged
}

/** Apply a style change to character-selected range, or whole item if no char selection. */
function applyTextStyle(apply: (item: paper.PointText) => void, label: string) {
  const e = getEngine()
  if (!e) return
  const charSel = store.charSelection
  e.getSelection().forEach((item) => {
    if (item instanceof e.scope.PointText) {
      apply(item as paper.PointText)
      e.refreshItemGradient(item as paper.PointText)
    }
  })
  e.scope.view.update()
  e.pushHistory(label)
}

/** Like applyTextStyle but with per-character selection awareness. */
function applyCharStyle(partial: Partial<import('../../editor/types').CharStyle>, label: string) {
  const e = getEngine()
  if (!e) return
  const charSel = store.charSelection
  e.getSelection().forEach((item) => {
    if (!(item instanceof e.scope.PointText)) return
    const textItem = item as paper.PointText
    if (charSel && charSel.itemId === (textItem.data as any)?.id) {
      applyCharRunStyle(textItem, charSel.start, charSel.end, partial)
    } else {
      // Whole-item fallback: apply directly.
      if (partial.fontFamily !== undefined) textItem.fontFamily = partial.fontFamily as string
      if (partial.fontSize !== undefined) textItem.fontSize = partial.fontSize as number
      if (partial.fontWeight !== undefined) textItem.fontWeight = partial.fontWeight as any
      if (partial.fontStyle !== undefined) (textItem as any).fontStyle = partial.fontStyle
    }
    e.refreshItemGradient(textItem)
  })
  e.scope.view.update()
  e.pushHistory(label)
  // Re-draw char highlight (positions may shift on font size changes).
  if (charSel) {
    const sel = e.getSelection().find((i) => i instanceof e.scope.PointText && (i.data as any)?.id === charSel.itemId) as paper.PointText | undefined
    if (sel) {
      const ctrl = e.getController('select') as { drawCharSelection?: (item: paper.PointText) => void } | null
      ctrl?.drawCharSelection?.(sel)
    }
  }
}

/** Apply fill color to character-selected range. */
function applyCharFillColor(color: string, label: string) {
  const e = getEngine()
  if (!e) return
  const charSel = store.charSelection
  e.getSelection().forEach((item) => {
    if (!(item instanceof e.scope.PointText)) return
    const textItem = item as paper.PointText
    if (charSel && charSel.itemId === (textItem.data as any)?.id) {
      applyCharRunStyle(textItem, charSel.start, charSel.end, { fillColor: color } as any)
    } else {
      textItem.fillColor = new e.scope.Color(color)
    }
    e.refreshItemGradient(textItem)
  })
  e.scope.view.update()
  e.pushHistory(label)
  // Re-draw char highlight.
  if (charSel) {
    const sel = e.getSelection().find((i) => i instanceof e.scope.PointText && (i.data as any)?.id === charSel.itemId) as paper.PointText | undefined
    if (sel) {
      const ctrl = e.getController('select') as { drawCharSelection?: (item: paper.PointText) => void } | null
      ctrl?.drawCharSelection?.(sel)
    }
  }
}

function onFontFamilyChange(val: string) {
  store.updateCharStyle({ fontFamily: val })
  if (store.charSelection) {
    applyCharStyle({ fontFamily: val }, 'Change Font')
  } else {
    applyTextStyle((item) => { item.fontFamily = val }, 'Change Font')
  }
}

function onFontSizeChange(val: number | undefined) {
  if (!val) return
  if (leadingAuto.value) {
    const leading = val * 1.2
    leadingValue.value = Math.round(leading * 10) / 10
    store.updateCharStyle({ fontSize: val, leading, autoLeading: true })
    if (store.charSelection) {
      applyCharStyle({ fontSize: val, leading }, 'Change Font Size')
    } else {
      applyTextStyle((item) => {
        item.fontSize = val
        item.leading = leading
      }, 'Change Font Size')
    }
  } else {
    store.updateCharStyle({ fontSize: val })
    if (store.charSelection) {
      applyCharStyle({ fontSize: val }, 'Change Font Size')
    } else {
      applyTextStyle((item) => {
        item.fontSize = val
      }, 'Change Font Size')
    }
  }
  syncAreaFromSelection()
}

function toggleBold() {
  const next = !isBold.value
  isBold.value = next
  store.updateCharStyle({ fontWeight: next ? 'bold' : 'normal' })
  if (store.charSelection) {
    applyCharStyle({ fontWeight: next ? 'bold' : 'normal' }, 'Change Font Weight')
  } else {
    applyTextStyle((item) => { item.fontWeight = next ? 'bold' : 'normal' }, 'Change Font Weight')
  }
}

function toggleItalic() {
  const next = !isItalic.value
  isItalic.value = next
  store.updateCharStyle({ fontStyle: next ? 'italic' : 'normal' })
  if (store.charSelection) {
    applyCharStyle({ fontStyle: next ? 'italic' : 'normal' }, 'Change Font Style')
  } else {
    applyTextStyle((item) => { (item as any).fontStyle = next ? 'italic' : 'normal' }, 'Change Font Style')
  }
}

function toggleUnderline() {
  const next = !isUnderline.value
  isUnderline.value = next
  store.updateCharStyle({ underline: next })
  // Paper.js has no underline primitive: stored on charStyle + item data so
  // SVG export and future text engines can honour it.
  if (store.charSelection) {
    applyCharStyle({ underline: next } as any, next ? 'Underline On' : 'Underline Off')
  } else {
    const e = getEngine()
    e?.getSelection().forEach((item) => { (item as any).data = { ...((item as any).data ?? {}), underline: next } })
    e?.scope.view.update()
    if (store.hasSelection) e?.pushHistory(next ? 'Underline On' : 'Underline Off')
  }
}

function toggleStrikethrough() {
  const next = !isStrikethrough.value
  isStrikethrough.value = next
  store.updateCharStyle({ strikethrough: next })
  if (store.charSelection) {
    applyCharStyle({ strikethrough: next } as any, next ? 'Strikethrough On' : 'Strikethrough Off')
  } else {
    const e = getEngine()
    e?.getSelection().forEach((item) => { (item as any).data = { ...((item as any).data ?? {}), strikethrough: next } })
    e?.scope.view.update()
    if (store.hasSelection) e?.pushHistory(next ? 'Strikethrough On' : 'Strikethrough Off')
  }
}

type OTKey = 'liga' | 'dlig' | 'smallCaps' | 'oldstyleNums' | 'tabularNums' | 'fractions'
const otRefMap: Record<OTKey, typeof otLiga> = {
  liga: otLiga, dlig: otDLiga, smallCaps: otSmallCaps,
  oldstyleNums: otOldstyle, tabularNums: otTabular, fractions: otFrac,
}
function toggleOT(key: OTKey) {
  const ref = otRefMap[key]
  const next = !ref.value
  ref.value = next
  const openType = { ...store.charStyle.openType, [key]: next }
  store.updateCharStyle({ openType })
  const e = getEngine()
  e?.getSelection().forEach((item) => {
    ;(item as any).data = { ...((item as any).data ?? {}), openType }
  })
  e?.scope.view.update()
  if (store.hasSelection) e?.pushHistory('Change OpenType')
}

function onBaselineChange(val: number | undefined) {
  if (val === undefined || !Number.isFinite(val)) {
    baselineValue.value = Number(store.charStyle.baselineShift) || 0
    return
  }
  baselineValue.value = val
  store.updateCharStyle({ baselineShift: val })
  const e = getEngine()
  e?.getSelection().forEach((item) => { (item as any).data = { ...((item as any).data ?? {}), baselineShift: val } })
  e?.scope.view.update()
  if (store.hasSelection) e?.pushHistory('Baseline Shift')
}

function onBaselineQuick(dir: 1 | -1) {
  const step = Math.round(((Number(store.charStyle.fontSize) || 12) / 3) * 10) / 10
  baselineValue.value = Math.round((baselineValue.value + dir * step) * 10) / 10
  onBaselineChange(baselineValue.value)
}

function onScaleChange(val: number | undefined) {
  if (val === undefined || !Number.isFinite(val)) {
    hScaleValue.value = Number(store.charStyle.horizontalScale) || 100
    return
  }
  hScaleValue.value = val
  store.updateCharStyle({ horizontalScale: val })
  const e = getEngine()
  e?.getSelection().forEach((item) => { (item as any).data = { ...((item as any).data ?? {}), horizontalScale: val } })
  e?.scope.view.update()
  if (store.hasSelection) e?.pushHistory('Character Scale')
}

function onPathOffsetChange(val: number | undefined) {
  if (val === undefined || !Number.isFinite(val)) {
    pathOffsetValue.value = Number(store.textPathOffset) || 0
    return
  }
  pathOffsetValue.value = val
  ;store.setTextPathOffset(val)
  const e = getEngine()
  e?.getSelection().forEach((item) => { (item as any).data = { ...((item as any).data ?? {}), pathOffset: val } })
  e?.scope.view.update()
  store.setStatusMessage(`Path text offset ${val}`)
}

function onAlignChange(val: TextAlign) {  // Paper.js justification has no justify: it renders as left (stored on
  // the paragraph style so SVG/export can honour it later).
  const justification = val === 'center' ? 'center' : val === 'right' ? 'right' : 'left'
  store.updateParagraphStyle({ align: val })
  applyTextStyle((item) => { (item as any).justification = justification }, 'Change Text Alignment')
}

/** Named text-style presets: snapshot of char + paragraph, one-click apply. */
const textPresetName = ref('')

function onSaveTextPreset() {
  store.addTextStylePreset(textPresetName.value)
  textPresetName.value = ''
  persistTextPresets()
  store.setStatusMessage('Text style saved')
}

function onApplyTextPreset(id: string) {
  const preset = store.textStylePresets.find((p) => p.id === id)
  if (!preset) return
  const char = JSON.parse(JSON.stringify(preset.char))
  const paragraph = JSON.parse(JSON.stringify(preset.paragraph))
  store.updateCharStyle({ ...char })
  store.updateParagraphStyle({ ...paragraph })
  const justification = paragraph.align === 'center' ? 'center' : paragraph.align === 'right' ? 'right' : 'left'
  applyTextStyle((item) => {
    if (char.fontFamily !== undefined) item.fontFamily = char.fontFamily
    if (char.fontSize !== undefined) item.fontSize = char.fontSize
    if (char.leading !== undefined) (item as any).leading = char.leading
    ;(item as any).justification = justification
  }, `Apply Text Style "${preset.name}"`)
  syncAreaFromSelection()
}

function onRemoveTextPreset(id: string) {
  store.removeTextStylePreset(id)
  persistTextPresets()
}

function persistTextPresets() {
  try {
    localStorage.setItem('vve.textstyles', JSON.stringify(store.textStylePresets))
  } catch { /* private mode */ }
}

onMounted(() => {
  try {
    const raw = localStorage.getItem('vve.textstyles')
    if (!raw) return
    store.setTextStylePresets(cleanTextStylePresets(JSON.parse(raw)))
  } catch { /* corrupt storage: defaults stand */ }
})

function onChangeCase(mode: 'upper' | 'lower' | 'title') {
  const e = getEngine()
  if (!e) return
  if (e.changeCase(mode) === 0) {
    store.setStatusMessage('Change Case needs selected text')
  }
}

function onLorem() {
  const e = getEngine()
  if (!e) return
  if (e.fillPlaceholder() === 0) {
    store.setStatusMessage('Placeholder needs selected text')
  }
}

function onLeadingChange(val: number | undefined) {
  if (!val || val <= 0) {
    leadingValue.value = Number(store.charStyle.leading) || 14
    return
  }
  leadingAuto.value = false
  leadingValue.value = val
  store.updateCharStyle({ leading: val, autoLeading: false })
  applyTextStyle((item) => { (item as any).leading = val }, 'Change Leading')
  syncAreaFromSelection()
}

function toggleLeadingAuto() {
  leadingAuto.value = !leadingAuto.value
  const e = getEngine()
  if (leadingAuto.value) {
    const leading = fontSize.value * 1.2
    leadingValue.value = Math.round(leading * 10) / 10
    store.updateCharStyle({ leading, autoLeading: true })
    applyTextStyle((item) => { (item as any).leading = leading }, 'Change Leading')
  } else {
    store.updateCharStyle({ autoLeading: false, leading: leadingValue.value })
  }
  if (e) e.scope.view.update()
  syncAreaFromSelection()
}

function onTrackingChange(val: number | undefined) {
  if (val === undefined || !Number.isFinite(val)) {
    trackingValue.value = Number(store.charStyle.tracking) || 0
    return
  }
  trackingValue.value = val
  store.updateCharStyle({ tracking: val })
  if (store.charSelection) {
    applyCharStyle({ tracking: val }, 'Change Tracking')
    return
  }
  // Tracking has no Paper.js PointText primitive: area frames re-wrap
  // (visible) and path runs pick it up on next layout; point text stores
  // it for export.
  const tc = textController()
  const e = getEngine()
  if (tc && e) {
    const items = e.getSelection()
    let rewrapped = false
    for (const item of items) {
      const anyItem = item as any
      if (item instanceof e.scope.PointText && anyItem?.data?.textMode === 'area') {
        const info = tc.areaInfo(item as paper.PointText)
        if (info && tc.resizeAreaItem(item as paper.PointText, info.frame.width, info.frame.height)) {
          rewrapped = true
        }
      }
    }
    e.scope.view.update()
    // Point text has no tracking primitive (stored for export/next layout),
    // so only area re-wraps record history; defaults already updated above.
    if (rewrapped) e.pushHistory('Change Tracking')
  }
  syncAreaFromSelection()
}

function onFrameSizeChange() {
  const tc = textController()
  const e = getEngine()
  if (!tc || !e) return
  const item = tc.selectedAreaItem() as paper.PointText | null
  if (!item) return
  if (!Number.isFinite(frameW.value) || !Number.isFinite(frameH.value)) {
    syncAreaFromSelection()
    return
  }
  if (tc.resizeAreaItem(item, frameW.value, frameH.value)) {
    e.clearSelection()
    item.selected = true
    e.syncSelectionToStore()
    e.pushHistory('Resize Text Frame')
    e.scope.view.update()
  }
  syncAreaFromSelection()
}

function onFlowOverflow() {
  const tc = textController()
  const e = getEngine()
  if (!tc || !e) return
  const item = tc.selectedAreaItem() as paper.PointText | null
  if (!item) return
  if (!tc.flowOverflowToNewFrame(item)) {
    store.setStatusMessage('No overflow to flow')
    return
  }
  store.setStatusMessage('Overflow flowed to a new linked frame')
  syncAreaFromSelection()
}

function onFrameAutofit() {
  const tc = textController() as {
    selectedAreaItem?: () => any
    areaInfo?: (item: any) => { frame: { x: number; y: number; width: number; height: number }; raw: string } | null
    areaOverflow?: (item: any) => { lines: number; fits: number; overflowChars: number }
    resizeAreaItem?: (item: any, w: number, h: number) => boolean
    effectiveLeading?: () => number
  } | null
  const e = getEngine()
  if (!tc || !e) return
  const item = tc.selectedAreaItem?.() as paper.PointText | null
  if (!item || !tc.areaInfo || !tc.areaOverflow || !tc.resizeAreaItem || !tc.effectiveLeading) return
  const info = tc.areaInfo(item)
  if (!info) return
  const over = tc.areaOverflow(item)
  const height = Math.max(5, over.lines * tc.effectiveLeading())
  if (!tc.resizeAreaItem(item, info.frame.width, height)) {
    store.setStatusMessage('Frame already fits')
    return
  }
  e.clearSelection()
  item.selected = true
  e.syncSelectionToStore()
  e.pushHistory('Fit Frame to Text')
  e.scope.view.update()
  syncAreaFromSelection()
}

function onThreadFrames() {
  const e = getEngine()
  if (!e) return
  if (e.threadSelectedFrames() < 2) {
    store.setStatusMessage('Thread needs 2+ selected area frames')
    return
  }
  store.setStatusMessage('Frames threaded left-to-right')
  syncAreaFromSelection()
}

function onThreadNav(dir: 'prev' | 'next') {
  const e = getEngine()
  if (!e) return
  if (!e.selectThreadNeighbor(dir)) {
    store.setStatusMessage('No linked frame that way')
  }
}

onMounted(() => {
  syncFromStore()
})

defineExpose({ syncFromStore, applyCharFillColor })
</script>

<style scoped>
/* Row primitives shared with the panel (duplicated: scoped CSS does not
   cross the component boundary). */
.prop-section {
  margin: 0;
  padding: 2px 0 6px;
  border-bottom: 1px solid #1e1e1e;
}

.prop-head {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 0;
  cursor: pointer;
  user-select: none;
}

.prop-head:hover .prop-label {
  color: #fff;
}

.prop-chevron {
  width: 12px;
  flex-shrink: 0;
  text-align: center;
  font-size: 14px;
  line-height: 1;
  color: #8a8a8a;
  transform: rotate(90deg);
  transition: transform 0.12s;
}

.prop-chevron.closed {
  transform: rotate(0deg);
}

.prop-label {
  font-size: 11px;
  color: #dcdcdc;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.prop-body {
  padding-top: 2px;
}

.prop-label-sm {
  font-size: 11px;
  color: #9a9a9a;
  width: 40px;
  flex-shrink: 0;
  line-height: 22px;
}

.prop-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 5px;
  min-width: 0;
}

.prop-row > :not(.prop-label-sm):not(.fmt-btn):not(.icon-btn):not(.app-name):not(.unit) {
  min-width: 0;
}

.prop-row .el-button + .el-button {
  margin-left: 0;
}

.flex-ctl {
  flex: 1;
  min-width: 0;
  width: 100%;
}

.fmt-btn {
  width: 22px;
  flex-shrink: 0;
  padding: 0 !important;
  font-weight: 700;
  margin: 0 !important;
}

.icon-btn {
  width: 24px;
  flex-shrink: 0;
  padding: 0 !important;
  margin: 0 !important;
}

.wide-btn {
  width: 100%;
  margin: 0 !important;
}

.grid-btn {
  width: 100%;
  margin: 0 !important;
}

.grid-btn :deep(span) {
  overflow: hidden;
  text-overflow: ellipsis;
}

.unit {
  font-size: 11px;
  color: #8a8a8a;
  flex-shrink: 0;
}

.ai-desc {
  padding: 10px;
  color: #8a8a8a;
  font-size: 11px;
  line-height: 1.6;
  border-bottom: 1px solid #1b1b1b;
}

/* Full-width segmented control */
:deep(.el-radio-group.seg-full) {
  display: flex;
  width: 100%;
}

:deep(.el-radio-group.seg-full .el-radio-button) {
  flex: 1;
  min-width: 0;
}
</style>
