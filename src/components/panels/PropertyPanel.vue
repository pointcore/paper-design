<template>
  <div class="property-panel ai-panel">
    <div v-if="isSelectNoSelection" class="obj-label">No Selection</div>
    <div v-else-if="!store.hasSelection" class="ai-desc">
      No selection. Click a canvas object with the Selection tool to edit its properties.
    </div>
    <div v-else class="obj-label">{{ selectionLabel }}</div>

    <div v-if="isSelectNoSelection" class="panel-body">
      <div class="prop-section">
        <div class="prop-head" @click="toggleDoc('document')">
          <span class="prop-chevron" :class="{ closed: !openDoc.document }">›</span>
          <span class="prop-label">Document</span>
        </div>
        <div v-show="openDoc.document" class="prop-body">
          <div class="prop-row">
            <span class="prop-label-sm">Unit</span>
            <el-select v-model="rulerUnit" size="small" class="flex-ctl">
              <el-option v-for="u in rulerUnits" :key="u.value" :label="u.label" :value="u.value" />
            </el-select>
          </div>
          <div class="prop-row">
            <span class="prop-label-sm">Boards</span>
            <el-button size="small" class="icon-btn" title="Previous artboard" @click="stepArtboard(-1)">
              <el-icon size="12"><ArrowLeft /></el-icon>
            </el-button>
            <span class="board-count">{{ artboardPosition }}</span>
            <el-button size="small" class="icon-btn" title="Next artboard" @click="stepArtboard(1)">
              <el-icon size="12"><ArrowRight /></el-icon>
            </el-button>
          </div>
          <div class="prop-row">
            <el-button size="small" plain class="wide-btn" @click="editArtboards">Edit Artboards</el-button>
          </div>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-head" @click="toggleDoc('rulers')">
          <span class="prop-chevron" :class="{ closed: !openDoc.rulers }">›</span>
          <span class="prop-label">Rulers &amp; Grid</span>
        </div>
        <div v-show="openDoc.rulers" class="prop-body">
          <div class="icon-row">
            <el-button
              size="small" class="tool-btn"
              :type="store.view.rulersVisible ? 'primary' : ''"
              title="Show / hide rulers"
              @click="store.updateView({ rulersVisible: !store.view.rulersVisible })"
            >
              <el-icon size="14"><View /></el-icon>
            </el-button>
            <el-button
              size="small" class="tool-btn"
              :type="store.view.showGrid ? 'primary' : ''"
              title="Show / hide grid"
              @click="toggleGrid()"
            >
              <el-icon size="14"><Grid /></el-icon>
            </el-button>
            <el-button
              size="small" class="tool-btn"
              :type="store.snap.grid ? 'primary' : ''"
              title="Snap to grid"
              @click="store.updateSnap({ grid: !store.snap.grid })"
            >
              <el-icon size="14"><Magnet /></el-icon>
            </el-button>
          </div>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-head" @click="toggleDoc('guides')">
          <span class="prop-chevron" :class="{ closed: !openDoc.guides }">›</span>
          <span class="prop-label">Guides</span>
        </div>
        <div v-show="openDoc.guides" class="prop-body">
          <div class="icon-row">
            <el-button
              size="small" class="tool-btn"
              :type="store.view.showGuides ? 'primary' : ''"
              title="Show / hide guides"
              @click="store.updateView({ showGuides: !store.view.showGuides })"
            >
              <el-icon size="14"><Guide /></el-icon>
            </el-button>
            <el-button
              size="small" class="tool-btn"
              :type="store.snap.guides ? 'primary' : ''"
              title="Snap to guides"
              @click="store.updateSnap({ guides: !store.snap.guides })"
            >
              <el-icon size="14"><Aim /></el-icon>
            </el-button>
            <el-button
              size="small" class="tool-btn"
              :type="store.snap.smartGuides ? 'primary' : ''"
              title="Smart guides"
              @click="store.updateSnap({ smartGuides: !store.snap.smartGuides })"
            >
              <el-icon size="14"><MagicStick /></el-icon>
            </el-button>
          </div>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-head" @click="toggleDoc('prefs')">
          <span class="prop-chevron" :class="{ closed: !openDoc.prefs }">›</span>
          <span class="prop-label">Preferences</span>
        </div>
        <div v-show="openDoc.prefs" class="prop-body">
          <div class="prop-row">
            <span class="prop-label-sm wide-label">Nudge</span>
            <el-input-number v-model="nudgeStep" :min="0.1" :max="100" :precision="1" size="small" controls-position="right" @change="onNudgeStepChange" />
            <span class="unit">px</span>
          </div>
          <div class="prop-row">
            <span class="prop-label-sm wide-label">Grid</span>
            <el-input-number v-model="gridSize" :min="1" :max="500" size="small" controls-position="right" @change="onGridSizeChange" />
            <span class="unit">px</span>
          </div>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-head" @click="toggleDoc('quick')">
          <span class="prop-chevron" :class="{ closed: !openDoc.quick }">›</span>
          <span class="prop-label">Quick Actions</span>
        </div>
        <div v-show="openDoc.quick" class="prop-body">
          <div class="btn-grid-2">
            <el-button size="small" class="grid-btn" @click="openSettings">Canvas Setup</el-button>
            <el-button size="small" class="grid-btn" @click="fitContent">Fit to Content</el-button>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="panel-body">
      <div class="prop-section">
        <div class="prop-head" @click="toggle('transform')">
          <span class="prop-chevron" :class="{ closed: !open.transform }">›</span>
          <span class="prop-label">Transform</span>
        </div>
        <div v-show="open.transform" class="prop-body">
          <div class="tf-grid">
            <div class="ref-grid tf-ref">
              <div
                v-for="rp in refPoints"
                :key="rp"
                class="ref-cell"
                :class="{ active: store.referencePoint === rp }"
                @click="onReferencePointChange(rp)"
              />
            </div>
            <div class="tf-cell">
              <span>X</span>
              <el-input-number v-model="posX" :precision="1" size="small" controls-position="right" @change="onTransformChange" />
            </div>
            <div class="tf-cell">
              <span>W</span>
              <el-input-number v-model="posW" :precision="1" :min="0.1" size="small" controls-position="right" @change="onTransformChange" />
              <el-button size="small" class="icon-btn wh-link" :type="whLink ? 'primary' : ''" :title="whLink ? 'Aspect ratio locked' : 'Lock aspect ratio'" @click="whLink = !whLink">&#9935;</el-button>
            </div>
            <div class="tf-cell">
              <span>Y</span>
              <el-input-number v-model="posY" :precision="1" size="small" controls-position="right" @change="onTransformChange" />
            </div>
            <div class="tf-cell">
              <span>H</span>
              <el-input-number v-model="posH" :precision="1" :min="0.1" size="small" controls-position="right" @change="onTransformChange" />
            </div>
          </div>
          <div class="prop-row">
            <span class="prop-label-sm">Rotate</span>
            <el-input-number v-model="rotateBy" :precision="1" size="small" controls-position="right" placeholder="deg" @change="onRotateByChange" />
            <el-button size="small" class="icon-btn" title="Rotate a copy (keeps the original)" @click="onRotateCopy">⧉</el-button>
            <el-button size="small" class="icon-btn" :type="store.transform.flipH ? 'primary' : ''" title="Flip Horizontal" @click="onFlipH">⇔</el-button>
            <el-button size="small" class="icon-btn" :type="store.transform.flipV ? 'primary' : ''" title="Flip Vertical" @click="onFlipV">⇕</el-button>
          </div>
          <div class="prop-row">
            <span class="prop-label-sm">Skew</span>
            <el-input-number v-model="skewXBy" :precision="1" size="small" controls-position="right" placeholder="X deg" @change="onSkewChange" />
            <el-input-number v-model="skewYBy" :precision="1" size="small" controls-position="right" placeholder="Y deg" @change="onSkewChange" />
          </div>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-head" @click="toggle('fill')">
          <span class="prop-chevron" :class="{ closed: !open.fill }">›</span>
          <span class="prop-label">Appearance</span>
        </div>
        <div v-show="open.fill" class="prop-body">
          <div class="prop-row">
            <!-- Read-only projection of store.style.gradient: bind the value
                 one-way, the @change handler writes the store. -->
            <el-radio-group :model-value="fillKind" size="small" class="seg-full" @change="onFillKindChange">
              <el-radio-button value="solid">Fill</el-radio-button>
              <el-radio-button value="gradient">Gradient</el-radio-button>
            </el-radio-group>
            <template v-if="fillKind === 'solid'">
              <el-color-picker v-model="fillColorValue" size="small" show-alpha @change="onFillChange" />
              <el-button size="small" class="icon-btn" type="danger" plain title="No fill" @click="onClearFill">×</el-button>
            </template>
          </div>
          <GradientSection v-show="fillKind === 'gradient'" ref="gradientRef" />
          <div class="prop-row">
            <el-color-picker v-model="strokeColorValue" size="small" show-alpha @change="onStrokeChange" />
            <span class="app-name">Stroke</span>
            <el-input-number v-model="strokeWidth" :min="0.1" :max="100" size="small" controls-position="right" @change="onStyleChange" />
            <span class="unit">pt</span>
            <el-button size="small" class="icon-btn" type="danger" plain title="No stroke" @click="onClearStroke">×</el-button>
          </div>
          <div class="prop-row">
            <el-select v-model="lineCap" size="small" class="flex-ctl" title="Cap" @change="onStrokeAppearanceChange">
              <el-option v-for="c in lineCaps" :key="c.value" :label="c.label" :value="c.value" />
            </el-select>
            <el-select v-model="lineJoin" size="small" class="flex-ctl" title="Join" @change="onStrokeAppearanceChange">
              <el-option v-for="j in lineJoins" :key="j.value" :label="j.label" :value="j.value" />
            </el-select>
          </div>
          <template v-if="lineJoin === 'miter'">
            <div class="prop-row">
              <span class="prop-label-sm">Miter</span>
              <el-input-number v-model="miterLimit" :min="1" :max="100" size="small" controls-position="right" @change="onStrokeAppearanceChange" />
              <span class="prop-label-sm">Dash</span>
              <el-select v-model="dashPreset" size="small" class="flex-ctl" placeholder="Preset" @change="onDashPreset">
                <el-option v-for="d in DASH_PRESETS" :key="d.value" :label="d.label" :value="d.value" />
              </el-select>
              <el-input-number v-model="dashOffset" size="small" controls-position="right" title="Dash offset" style="max-width: 76px" @change="onDashOffsetChange" />
            </div>
            <div class="prop-row">
              <span class="prop-label-sm" />
              <el-input v-model="dashPattern" size="small" placeholder="e.g. 4 2" @change="onDashChange" />
            </div>
            <div class="prop-row">
              <span class="prop-label-sm">Rule</span>
              <el-select v-model="fillRule" size="small" class="flex-ctl" title="Fill rule" @change="onFillRuleChange">
                <el-option value="nonzero" label="Nonzero" />
                <el-option value="evenodd" label="Even-Odd" />
              </el-select>
            </div>
          </template>
          <template v-else>
            <div class="prop-row">
              <span class="prop-label-sm">Dash</span>
              <el-select v-model="dashPreset" size="small" class="flex-ctl" placeholder="Preset" @change="onDashPreset">
                <el-option v-for="d in DASH_PRESETS" :key="d.value" :label="d.label" :value="d.value" />
              </el-select>
              <el-input-number v-model="dashOffset" size="small" controls-position="right" title="Dash offset" style="max-width: 76px" @change="onDashOffsetChange" />
            </div>
            <div class="prop-row">
              <span class="prop-label-sm" />
              <el-input v-model="dashPattern" size="small" placeholder="e.g. 4 2" @change="onDashChange" />
            </div>
            <div class="prop-row">
              <span class="prop-label-sm">Rule</span>
              <el-select v-model="fillRule" size="small" class="flex-ctl" title="Fill rule" @change="onFillRuleChange">
                <el-option value="nonzero" label="Nonzero" />
                <el-option value="evenodd" label="Even-Odd" />
              </el-select>
            </div>
          </template>
          <div class="op-row">
            <span class="app-name">Opacity</span>
            <el-slider v-model="opacityValue" :min="0" :max="100" size="small" @change="onOpacityChange" />
            <span class="op-val">{{ opacityValue }}%</span>
          </div>
          <div class="prop-row">
            <span class="prop-label-sm">Mode</span>
            <el-select v-model="blendMode" size="small" class="flex-ctl" @change="onBlendChange">
              <el-option v-for="b in blendModes" :key="b.value" :label="b.label" :value="b.value" />
            </el-select>
          </div>
          <div v-if="store.view.proofMode === 'cmyk'" class="proof-block">
            <div class="prop-row">
              <span class="prop-label-sm">F-CMYK</span>
              <span class="cmyk-val">{{ fillCmyk }}<span v-if="fillOutOfGamut" class="oog" title="Out of CMYK gamut — expect a press shift"> ⚠</span></span>
            </div>
            <div class="prop-row">
              <span class="prop-label-sm">S-CMYK</span>
              <span class="cmyk-val">{{ strokeCmyk }}<span v-if="strokeOutOfGamut" class="oog" title="Out of CMYK gamut — expect a press shift"> ⚠</span></span>
            </div>
            <div class="ai-desc">Numeric preview only — the canvas still renders RGB.</div>
          </div>
          <div class="prop-row">
            <span class="prop-label-sm">Spot F</span>
            <el-input v-model="spotFillName" size="small" placeholder="e.g. PANTONE 185 C" @change="onSpotChange" />
          </div>
          <div class="prop-row">
            <span class="prop-label-sm">Spot S</span>
            <el-input v-model="spotStrokeName" size="small" placeholder="optional" @change="onSpotChange" />
          </div>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-head" @click="toggle('pattern')">
          <span class="prop-chevron" :class="{ closed: !open.pattern }">›</span>
          <span class="prop-label">Pattern</span>
        </div>
        <div v-show="open.pattern" class="prop-body">
          <PatternSection ref="patternRef" />
        </div>
      </div>

      <TextSection ref="textRef" />

      <div class="prop-section">
        <div class="prop-head" @click="toggle('align')">
          <span class="prop-chevron" :class="{ closed: !open.align }">›</span>
          <span class="prop-label">Align</span>
        </div>
        <div v-show="open.align" class="prop-body">
          <div class="btn-row">
            <el-radio-group v-model="alignTarget" size="small">
              <el-radio-button value="selection">Selection</el-radio-button>
              <el-radio-button value="board">Artboard</el-radio-button>
              <el-radio-button value="key">Key</el-radio-button>
            </el-radio-group>
          </div>
          <div class="btn-grid-3">
            <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onAlign('left', 'Align Left')">Left</el-button>
            <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onAlign('centerX', 'Align Center')">Center</el-button>
            <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onAlign('right', 'Align Right')">Right</el-button>
            <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onAlign('top', 'Align Top')">Top</el-button>
            <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onAlign('centerY', 'Align Middle')">Middle</el-button>
            <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onAlign('bottom', 'Align Bottom')">Bottom</el-button>
          </div>
          <div class="btn-grid-2">
            <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 3" @click="onDistribute('horizontal')">Distr H</el-button>
            <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 3" @click="onDistribute('vertical')">Distr V</el-button>
          </div>
          <div class="btn-grid-2">
            <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 3" @click="onDistributeGap('horizontal')">Gap H</el-button>
            <el-button size="small" class="grid-btn" :disabled="store.selectedItemIds.length < 3" @click="onDistributeGap('vertical')">Gap V</el-button>
          </div>
          <div class="btn-grid-3">
            <el-button size="small" class="grid-btn" title="Average sub-selected anchors horizontally" @click="onAverage('horizontal')">Avg H</el-button>
            <el-button size="small" class="grid-btn" title="Average sub-selected anchors vertically" @click="onAverage('vertical')">Avg V</el-button>
            <el-button size="small" class="grid-btn" title="Average sub-selected anchors on both axes" @click="onAverage('both')">Avg Both</el-button>
          </div>
        </div>
      </div>

      <div class="prop-section">
        <div class="prop-head" @click="toggle('path')">
          <span class="prop-chevron" :class="{ closed: !open.path }">›</span>
          <span class="prop-label">Path</span>
        </div>
        <div v-show="open.path" class="prop-body">
          <div class="btn-grid-2">
            <el-button size="small" class="grid-btn" :disabled="booleanOperandCount() < 2" @click="onBoolean('unite')">Unite</el-button>
            <el-button size="small" class="grid-btn" :disabled="booleanOperandCount() < 2" @click="onBoolean('subtract')">Subtract</el-button>
            <el-button size="small" class="grid-btn" :disabled="booleanOperandCount() < 2" @click="onBoolean('intersect')">Intersect</el-button>
            <el-button size="small" class="grid-btn" :disabled="booleanOperandCount() < 2" @click="onBoolean('exclude')">Exclude</el-button>
          </div>
          <div class="prop-row">
            <span class="prop-label-sm">Offset</span>
            <el-input-number v-model="offsetDist" size="small" controls-position="right" title="Positive expands, negative insets" />
            <el-select v-model="offsetJoin" size="small" class="flex-ctl" title="Join">
              <el-option value="miter" label="Miter" />
              <el-option value="round" label="Round" />
              <el-option value="bevel" label="Bevel" />
            </el-select>
            <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onOffset">Apply</el-button>
          </div>
          <div class="btn-grid-2">
            <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" title="Add a midpoint anchor to every curve" @click="onAddAnchors">Add Anchors</el-button>
            <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" title="Reverse path direction" @click="onReverse">Reverse</el-button>
          </div>
          <div class="prop-row">
            <el-button size="small" plain class="wide-btn" title="Split paths at sub-selected anchors (Direct Select)" @click="onSplitAnchors">Split at Anchors</el-button>
          </div>
          <div class="prop-row">
            <span class="prop-label-sm">Fillet</span>
            <el-input-number v-model="filletRadius" :min="0.5" :max="500" size="small" controls-position="right" title="Round sharp corners" />
            <el-button size="small" class="grid-btn" :disabled="!store.hasSelection" @click="onFillet">Apply</el-button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, inject, type Ref } from 'vue'
import {
  ArrowLeft, ArrowRight, View, Grid, Magnet, Guide, Aim, MagicStick,
} from '@element-plus/icons-vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import { cssToCmykString, isOutOfCmykGamut } from '../../editor/color'
import { DASH_PRESETS, parseDashPattern } from '../../editor/property-helpers'
import GradientSection from './GradientSection.vue'
import PatternSection from './PatternSection.vue'
import TextSection from './TextSection.vue'
import type { AlignMode, BooleanOperation, DistributeAxis, FillRule, LineCap, LineJoin, ReferencePoint, RulerUnit } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

// Collapsible sections (AI-style). Rarely used groups start collapsed
// so the panel stays scannable in a 264px column.
const open = ref({
  transform: true,
  fill: true,
  pattern: true,
  align: false,
  path: false,
})
function toggle(key: keyof typeof open.value) {
  open.value[key] = !open.value[key]
}

// ---- No-selection (document) view, AI-style ----

/** True in Select mode with nothing selected: show document prefs like AI. */
const isSelectNoSelection = computed(
  () => !store.hasSelection && (store.tool === 'select' || store.tool === 'direct-select'),
)

const openDoc = ref({
  document: true,
  rulers: true,
  guides: true,
  prefs: true,
  quick: true,
})
function toggleDoc(key: keyof typeof openDoc.value) {
  openDoc.value[key] = !openDoc.value[key]
}

const rulerUnits: Array<{ value: RulerUnit; label: string }> = [
  { value: 'px', label: 'Pixels' },
  { value: 'pt', label: 'Points' },
  { value: 'mm', label: 'Millimeters' },
  { value: 'cm', label: 'Centimeters' },
  { value: 'in', label: 'Inches' },
]

const rulerUnit = computed<RulerUnit>({
  get: () => store.rulerUnit,
  set: (v) => store.setRulerUnit(v),
})

/** "2 / 5" position readout for the artboard stepper. */
const artboardPosition = computed(() => {
  const boards = store.artboards
  if (boards.length === 0) return '0 / 0'
  const idx = boards.findIndex((b) => b.id === store.activeArtboardId)
  return `${(idx < 0 ? 0 : idx) + 1} / ${boards.length}`
})

function activateArtboard(id: string) {
  const e = getEngine()
  store.setActiveArtboard(id)
  const board = store.activeArtboard
  if (!e || !board) return
  e.refreshArtboards()
  e.panViewTo(new e.scope.Point(board.x + board.width / 2, board.y + board.height / 2))
}

function stepArtboard(dir: 1 | -1) {
  const boards = store.artboards
  if (boards.length === 0) return
  const idx = boards.findIndex((b) => b.id === store.activeArtboardId)
  const next = boards[((idx < 0 ? 0 : idx) + dir + boards.length) % boards.length]
  activateArtboard(next.id)
}

/** Jump to the Artboards tab where the Artboard panel lives. */
function editArtboards() {
  store.setRightTab('artboards')
}

function toggleGrid() {
  store.updateView({ showGrid: !store.view.showGrid })
  getEngine()?.refreshGrid()
}

const nudgeStep = ref(store.nudgeStep)
function onNudgeStepChange(val: number | undefined) {
  if (!val || val <= 0) {
    nudgeStep.value = store.nudgeStep
    return
  }
  store.setNudgeStep(val)
}

const gridSize = ref(store.snap.gridSize)
function onGridSizeChange(val: number | undefined) {
  if (!val) {
    gridSize.value = store.snap.gridSize
    return
  }
  store.updateSnap({ gridSize: val })
  getEngine()?.refreshGrid()
}
// Other panels (TopBar) can change these too, so mirror the store.
watch(() => store.nudgeStep, (v) => { nudgeStep.value = v })
watch(() => store.snap.gridSize, (v) => { gridSize.value = v })

function openSettings() {
  store.setSettingsOpen(true)
}

function fitContent() {
  getEngine()?.fitToContent()
}

const fillColorValue = ref(store.style.fillColor || '#000000')
const strokeColorValue = ref(store.style.strokeColor || '#000000')
const strokeWidth = ref(store.style.strokeWidth)
const opacityValue = ref(Math.round(store.style.opacity * 100))

// Fill kind follows the store gradient (solid when none is set).
const fillKind = computed(() => (store.style.gradient ? 'gradient' : 'solid'))
// Gradient stop editor lives in GradientSection (v-show keeps it mounted
// so kind switches can sync + paint synchronously).
const gradientRef = ref<InstanceType<typeof GradientSection> | null>(null)
// Pattern editor lives in PatternSection (same shell contract).
const patternRef = ref<InstanceType<typeof PatternSection> | null>(null)
// Text editor lives in TextSection (self-gated on a selected text item).
const textRef = ref<InstanceType<typeof TextSection> | null>(null)

/** Mirror the first selected item's solid paints into the Appearance controls. */
function syncStyleFromSelection() {
  const e = getEngine()
  if (!e || !store.hasSelection) return
  const items = e.getSelection()
  if (items.length === 0) return
  const style = e.getStyleFromItem(items[0])
  fillColorValue.value = style.fillColor ?? ''
  strokeColorValue.value = style.strokeColor ?? ''
  strokeWidth.value = style.strokeWidth
  lineCap.value = style.lineCap
  lineJoin.value = style.lineJoin
  miterLimit.value = style.miterLimit
  dashPattern.value = (style.dashArray ?? []).join(' ')
  dashOffset.value = style.dashOffset ?? 0
  fillRule.value = style.fillRule ?? 'nonzero'
  blendMode.value = style.blendMode
  opacityValue.value = Math.round((style.opacity ?? 1) * 100)
}

const lineCap = ref<LineCap>(store.style.lineCap)
const lineJoin = ref<LineJoin>(store.style.lineJoin)
const miterLimit = ref(store.style.miterLimit)
const dashPattern = ref(store.style.dashArray.join(' '))
const dashOffset = ref(store.style.dashOffset ?? 0)
const fillRule = ref<FillRule>(store.style.fillRule ?? 'nonzero')
const blendMode = ref(store.style.blendMode)

// CMYK proof readouts follow the current fill/stroke paints.
const fillCmyk = computed(() => cssToCmykString(fillColorValue.value) ?? '—')
const strokeCmyk = computed(() => cssToCmykString(strokeColorValue.value) ?? '—')
const fillOutOfGamut = computed(() => isOutOfCmykGamut(fillColorValue.value))
const strokeOutOfGamut = computed(() => isOutOfCmykGamut(strokeColorValue.value))

// Spot-color placeholders (item.data metadata, persisted in project JSON).
const spotFillName = ref('')
const spotStrokeName = ref('')

/** Read spot names from the first selected item into the panel. */
function syncSpotFromSelection() {
  const e = getEngine()
  if (!e || !store.hasSelection) {
    spotFillName.value = ''
    spotStrokeName.value = ''
    return
  }
  const spot = e.getSpotFromSelection()
  spotFillName.value = spot.fill ?? ''
  spotStrokeName.value = spot.stroke ?? ''
}

function onSpotChange() {
  const e = getEngine()
  if (!e) return
  e.setSpotForSelection(spotFillName.value || null, spotStrokeName.value || null)
  syncSpotFromSelection()
}

const lineCaps: Array<{ value: LineCap; label: string }> = [
  { value: 'round', label: 'Round' },
  { value: 'butt', label: 'Butt' },
  { value: 'square', label: 'Square' },
]

const lineJoins: Array<{ value: LineJoin; label: string }> = [
  { value: 'miter', label: 'Miter' },
  { value: 'round', label: 'Round' },
  { value: 'bevel', label: 'Bevel' },
]

const blendModes = [
  { value: 'source-over', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'screen', label: 'Screen' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'darken', label: 'Darken' },
  { value: 'lighten', label: 'Lighten' },
  { value: 'color-dodge', label: 'Color Dodge' },
  { value: 'color-burn', label: 'Color Burn' },
  { value: 'hard-light', label: 'Hard Light' },
  { value: 'soft-light', label: 'Soft Light' },
  { value: 'difference', label: 'Difference' },
  { value: 'exclusion', label: 'Exclusion' },
  { value: 'hue', label: 'Hue' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'color', label: 'Color' },
  { value: 'luminosity', label: 'Luminosity' },
]

const posX = ref(0)
const posY = ref(0)
const posW = ref(0)
const posH = ref(0)
// AI transform-panel aspect lock: when on, editing one dimension derives
// the other from the ratio the selection had before this edit.
const whLink = ref(false)
let lastPosW = 0
let lastPosH = 0
// Relative rotation in degrees applied on change, then reset to zero.
const rotateBy = ref(0)
// Relative skew in degrees applied on change, then reset to zero.
const skewXBy = ref(0)
const skewYBy = ref(0)

// Align target: united selection, active artboard, or picked key object.
const alignTarget = ref<'selection' | 'board' | 'key'>('selection')

// Nine-point reference anchors in grid order.
const refPoints: ReferencePoint[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]

/** Object-type label shown under the tab, like AI ("Path", "Text", ...). */
const selectionLabel = computed(() => {
  const n = store.selectedItemIds.length
  if (n === 0) return ''
  if (n > 1) return `Mixed (${n})`
  const item = getEngine()?.getSelection()?.[0] as any
  const name = String(item?.className ?? item?.constructor?.name ?? '')
  if (/pointtext/i.test(name)) return 'Text'
  if (/compoundpath/i.test(name)) return 'Compound Path'
  if (/group/i.test(name)) return 'Group'
  if (/raster/i.test(name)) return 'Image'
  if (/path/i.test(name)) return 'Path'
  return 'Object'
})

function getEngine() { return engineRef?.value || null }

// ------------------------------------------------------------------
// Per-character styling helpers (AI/CDR parity)
// ------------------------------------------------------------------

function onFillChange(val: string) {
  const e = getEngine()
  if (!e) return
  store.updateStyle({ fillColor: val || null })
  if (store.charSelection) {
    textRef.value?.applyCharFillColor(val || '#000000', 'Change Fill')
    return
  }
  e.getSelection().forEach((item: any) => {
    if (item.fillColor !== undefined) {
      item.fillColor = val || null
    }
  })
  e.scope.view.update()
  e.pushCoalescedHistory('Change Fill')
}

function onClearFill() {
  const e = getEngine()
  if (!e) return
  store.updateStyle({ fillColor: null })
  e.getSelection().forEach((item: any) => {
    item.fillColor = null
  })
  fillColorValue.value = ''
  e.scope.view.update()
  e.pushHistory('Clear Fill')
}

function onFillKindChange(kind: 'solid' | 'gradient') {
  const e = getEngine()
  if (!e) return
  if (kind === 'gradient') {
    gradientRef.value?.activate()
  } else {
    store.updateStyle({ gradient: null })
    e.getSelection().forEach((item: any) => {
      e.applyStyleToItem(item, e.store.style)
    })
    e.scope.view.update()
    e.pushCoalescedHistory('Change Fill')
  }
}

function onStrokeChange(val: string) {
  const e = getEngine()
  if (!e) return
  store.updateStyle({ strokeColor: val || null })
  e.getSelection().forEach((item: any) => {
    if (item.strokeColor !== undefined) {
      item.strokeColor = val || null
    }
  })
  e.scope.view.update()
  e.pushCoalescedHistory('Change Stroke')
}

function onClearStroke() {
  const e = getEngine()
  if (!e) return
  store.updateStyle({ strokeColor: null })
  e.getSelection().forEach((item: any) => {
    item.strokeColor = null
  })
  strokeColorValue.value = ''
  e.scope.view.update()
  e.pushHistory('Clear Stroke')
}

function onStyleChange() {
  const e = getEngine()
  if (!e) return
  store.updateStyle({
    strokeWidth: strokeWidth.value,
  })
  e.getSelection().forEach((item: any) => {
    if (item.strokeWidth !== undefined) item.strokeWidth = strokeWidth.value
  })
  e.scope.view.update()
  e.pushHistory('Change Stroke Style')
}

function onStrokeAppearanceChange() {
  const e = getEngine()
  if (!e) return
  // A cleared miter field falls back instead of blocking cap/join edits.
  const miter =
    Number.isFinite(miterLimit.value) && (miterLimit.value as number) >= 1
      ? miterLimit.value
      : store.style.miterLimit
  miterLimit.value = miter
  store.updateStyle({
    lineCap: lineCap.value,
    lineJoin: lineJoin.value,
    miterLimit: miter,
  })
  e.getSelection().forEach((item: any) => {
    if (item.strokeCap !== undefined) item.strokeCap = lineCap.value
    if (item.strokeJoin !== undefined) item.strokeJoin = lineJoin.value
    if (item.miterLimit !== undefined) item.miterLimit = miter
  })
  e.scope.view.update()
  e.pushHistory('Change Stroke Style')
}

function onDashChange() {
  const e = getEngine()
  if (!e) return
  const dashArray = parseDashPattern(dashPattern.value)
  store.updateStyle({ dashArray })
  e.getSelection().forEach((item: any) => {
    if (item.dashArray !== undefined) item.dashArray = [...dashArray]
  })
  e.scope.view.update()
  e.pushHistory('Change Dash Pattern')
}

const dashPreset = ref('')

function onDashPreset(val: string) {
  dashPattern.value = val || ''
  onDashChange()
}

function onDashOffsetChange() {
  const e = getEngine()
  if (!e) return
  const offset = Number(dashOffset.value) || 0
  dashOffset.value = offset
  store.updateStyle({ dashOffset: offset })
  e.getSelection().forEach((item: any) => {
    if (item.dashOffset !== undefined) item.dashOffset = offset
  })
  e.scope.view.update()
  e.pushCoalescedHistory('Change Dash Offset')
}

function onFillRuleChange(val: FillRule) {
  const e = getEngine()
  if (!e) return
  fillRule.value = val
  store.updateStyle({ fillRule: val })
  e.getSelection().forEach((item: any) => {
    if ('fillRule' in item) item.fillRule = val
  })
  e.scope.view.update()
  e.pushHistory(val === 'evenodd' ? 'Even-Odd Fill' : 'Nonzero Fill')
}

function onBlendChange() {
  const e = getEngine()
  if (!e) return
  store.updateStyle({ blendMode: blendMode.value })
  e.getSelection().forEach((item: any) => {
    item.blendMode = blendMode.value
  })
  e.scope.view.update()
  e.pushHistory('Change Blend Mode')
}

function onOpacityChange(val: number) {
  const e = getEngine()
  if (!e) return
  const opacity = val / 100
  store.updateStyle({ opacity })
  e.getSelection().forEach((item: any) => {
    item.opacity = opacity
  })
  e.scope.view.update()
  e.pushCoalescedHistory('Change Opacity')
}

function onTransformChange() {
  const e = getEngine()
  if (!e) return
  if (!Number.isFinite(posW.value) || !Number.isFinite(posH.value)) return
  if (posW.value <= 0 || posH.value <= 0) return
  // Aspect lock: whichever dimension the user touched drives the other at
  // the pre-edit ratio (lastPos values are synced on every panel resync).
  if (whLink.value && lastPosW > 0 && lastPosH > 0) {
    const wMoved = Math.abs(posW.value - lastPosW) > 1e-9
    const hMoved = Math.abs(posH.value - lastPosH) > 1e-9
    if (wMoved && !hMoved) {
      posH.value = Math.max(0.1, Math.round(((posW.value * lastPosH) / lastPosW) * 10) / 10)
    } else if (hMoved && !wMoved) {
      posW.value = Math.max(0.1, Math.round(((posH.value * lastPosW) / lastPosH) * 10) / 10)
    }
  }
  // X/Y address the reference point; W/H scale about it so it stays fixed.
  // Multi-selections act on their united bounds (AI): every member keeps
  // its relative layout instead of being stretched to the same size.
  const ref = store.referencePoint
  const items = (e.getSelection() as any[]).filter((item) => {
    if (!item || item.locked) return false
    const b = item.bounds
    return !!b && b.width > 0 && b.height > 0
  })
  if (items.length === 0) return
  let united = items[0].bounds.clone()
  for (let i = 1; i < items.length; i++) {
    united = united.unite(items[i].bounds)
  }
  if (!united || united.width <= 0 || united.height <= 0) return
  const anchor = e.referencePointForRect(united, ref)
  const dx = posX.value - anchor.x
  const dy = posY.value - anchor.y
  const scaleX = posW.value / united.width
  const scaleY = posH.value / united.height
  const pivot = new e.scope.Point(posX.value, posY.value)
  items.forEach((item: any) => {
    if (dx !== 0 || dy !== 0) {
      item.position = item.position.add(new e!.scope.Point(dx, dy))
    }
    item.scale(scaleX, scaleY, pivot)
    e.refreshItemGradient(item)
  })
  e.reflowTextsForItems(items)
  e.scope.view.update()
  e.pushCoalescedHistory('Transform')
  lastPosW = posW.value
  lastPosH = posH.value
}

function onReferencePointChange(point: ReferencePoint) {
  store.setReferencePoint(point)
  // X/Y display follows the reference point, so resync the panel.
  syncTransformFromSelection()
}

function onRotateByChange(val: number | undefined) {
  const e = getEngine()
  if (!e || !val) {
    rotateBy.value = 0
    return
  }
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) {
    rotateBy.value = 0
    return
  }
  e.rotateSelection(val, pivot)
  e.pushHistory('Rotate')
  e.stampSelectionFrame()
  rotateBy.value = 0
}

function onRotateCopy() {
  const e = getEngine()
  const val = Number(rotateBy.value)
  if (!e || !val) {
    rotateBy.value = 0
    store.setStatusMessage('Enter degrees, then Rotate Copy')
    return
  }
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) {
    rotateBy.value = 0
    return
  }
  if (!e.rotateCopy(val, pivot)) {
    store.setStatusMessage('Rotate Copy needs unlocked artwork')
  }
  e.stampSelectionFrame()
  rotateBy.value = 0
}

function onSkewChange() {
  const e = getEngine()
  const skewX = skewXBy.value || 0
  const skewY = skewYBy.value || 0
  skewXBy.value = 0
  skewYBy.value = 0
  if (!e || (skewX === 0 && skewY === 0)) return
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) return
  e.skewSelection(skewX, skewY, pivot)
  e.pushHistory('Skew')
  e.stampSelectionFrame()
}

function onFlipH() {
  const e = getEngine()
  if (!e) return
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) return
  e.flipSelection('horizontal', pivot)
  e.pushHistory('Flip Horizontal')
  e.stampSelectionFrame()
}

function onFlipV() {
  const e = getEngine()
  if (!e) return
  const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
  if (!pivot) return
  e.flipSelection('vertical', pivot)
  e.pushHistory('Flip Vertical')
  e.stampSelectionFrame()
}

function onAlign(mode: AlignMode, label: string) {
  const e = getEngine()
  if (!e) return
  const t = (alignTarget as any).value ?? 'selection'
  const target = t === 'board'
    ? e.getActiveArtboardRect() ?? undefined
    : t === 'key'
      ? (e as any).getKeyObjectBounds?.() ?? undefined
      : undefined
  // Direct-select sub-selection first (anchors); falls through to objects.
  const sc = e.getController('direct-select') as {
    alignSubselection?: (m: AlignMode, t?: paper.Rectangle | null) => boolean | null
  } | null
  const sub = sc?.alignSubselection?.(mode, target ?? null) ?? null
  if (sub === true) return
  if (sub === false) {
    store.setStatusMessage('Nothing to align in the sub-selection')
    return
  }
  if (e.alignSelection(mode, target)) {
    e.pushHistory(label)
  } else {
    store.setStatusMessage('Align needs 2+ objects, a board, or a key object')
  }
}

function onDistribute(axis: DistributeAxis) {
  const e = getEngine()
  if (!e) return
  const sc = e.getController('direct-select') as {
    distributeSubselection?: (a: DistributeAxis) => boolean | null
  } | null
  const sub = sc?.distributeSubselection?.(axis) ?? null
  if (sub === true) return
  if (sub === false) {
    store.setStatusMessage('Distribute needs 3+ sub-selected anchors')
    return
  }
  if (e.distributeSelection(axis)) {
    e.pushHistory(axis === 'horizontal' ? 'Distribute Horizontally' : 'Distribute Vertically')
  }
}

function onDistributeGap(axis: DistributeAxis) {
  const e = getEngine()
  if (!e) return
  const sc = e.getController('direct-select') as {
    distributeSubselection?: (a: DistributeAxis) => boolean | null
  } | null
  const sub = sc?.distributeSubselection?.(axis) ?? null
  if (sub === true) return
  if (sub === false) {
    store.setStatusMessage('Distribute needs 3+ sub-selected anchors')
    return
  }
  if (e.distributeSpacing(axis)) {
    e.pushHistory('Distribute Gaps')
  }
}

function onAverage(axis: 'horizontal' | 'vertical' | 'both') {
  const e = getEngine()
  if (!e) return
  const sc = e.getController('direct-select') as {
    averageSubselection?: (a: 'horizontal' | 'vertical' | 'both') => boolean | null
  } | null
  const sub = sc?.averageSubselection?.(axis) ?? null
  if (sub === true) return
  store.setStatusMessage('Average needs 2+ sub-selected anchors')
}

/** Number of selected unlocked paths usable as boolean operands. */
function booleanOperandCount(): number {
  const e = getEngine()
  if (!e) return 0
  return e.getSelection().filter(
    (item) =>
      !item.locked &&
      (item instanceof e.scope.Path || item instanceof e.scope.CompoundPath)
  ).length
}

function onBoolean(op: BooleanOperation) {
  const e = getEngine()
  if (!e) return
  if (!e.booleanOperation(op)) {
    store.setStatusMessage('Boolean needs at least two unlocked paths')
  }
}

const offsetDist = ref(10)
const offsetJoin = ref<'miter' | 'round' | 'bevel'>('miter')
const filletRadius = ref(8)

function onOffset() {
  const e = getEngine()
  if (!e) return
  const d = Number(offsetDist.value)
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) {
    store.setStatusMessage('Offset needs a non-zero distance')
    return
  }
  if (e.offsetPaths(d, offsetJoin.value) === 0) {
    store.setStatusMessage('Offset needs a path selection')
  }
}

function onAddAnchors() {
  const e = getEngine()
  if (!e) return
  if (e.addAnchorPoints() === 0) {
    store.setStatusMessage('Add Anchors needs a path selection')
  }
}

function onReverse() {
  const e = getEngine()
  if (!e) return
  if (e.reversePaths() === 0) {
    store.setStatusMessage('Reverse needs a path selection')
  }
}

function onSplitAnchors() {
  const e = getEngine()
  if (!e) return
  const sc = e.getController('direct-select') as {
    splitAtSelectedAnchors?: () => boolean | null
  } | null
  const sub = sc?.splitAtSelectedAnchors?.() ?? null
  if (sub === true) return
  store.setStatusMessage('Split needs sub-selected anchors (Direct Select)')
}

function onFillet() {
  const e = getEngine()
  if (!e) return
  const sc = e.getController('direct-select') as {
    roundSelectedCorners?: (radius: number) => number
  } | null
  const n = sc?.roundSelectedCorners?.(Number(filletRadius.value) || 0) ?? 0
  if (n === 0) {
    store.setStatusMessage('Fillet needs sharp corners selected')
  }
}

/** Read the selection bounds (united for multi-selections) into the fields. */
function syncTransformFromSelection() {
  const e = getEngine()
  if (!e || !store.hasSelection) return
  const items = e.getSelection()
  if (items.length === 0) return
  const b = (items.length > 1 ? e.getSelectionBounds() : null) ?? (items[0] as any).bounds
  if (!b) return
  const anchor = e.referencePointForRect(b, store.referencePoint)
  posX.value = Math.round(anchor.x * 10) / 10
  posY.value = Math.round(anchor.y * 10) / 10
  posW.value = Math.round(b.width * 10) / 10
  posH.value = Math.round(b.height * 10) / 10
  lastPosW = posW.value
  lastPosH = posH.value
  rotateBy.value = 0
}

// `immediate` covers the panel mounting after a selection already exists
// (the panel is v-if'd on hasSelection, so its first selection change is
// missed without it).
watch(() => store.selectedItemIds, () => {
  syncTransformFromSelection()
  gradientRef.value?.syncFromStore()
  textRef.value?.syncFromStore()
  syncStyleFromSelection()
  patternRef.value?.syncFromStore()
  syncSpotFromSelection()
}, { immediate: true })
</script>

<style scoped>
.ai-panel {
  background: #252526;
  color: #c9c9c9;
  font-size: 12px;
  overflow-x: hidden;
}

/* ---- AI-style container ---- */
.property-panel {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.ai-desc {
  padding: 10px;
  color: #8a8a8a;
  font-size: 11px;
  line-height: 1.6;
  border-bottom: 1px solid #1b1b1b;
}

/* Object-type label under the tab, like AI ("Path", "Text", ...) */
.obj-label {
  padding: 8px 10px 2px;
  color: #f0f0f0;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.panel-body {
  padding: 2px 8px 12px;
  color: #c9c9c9;
  font-size: 12px;
}

/* ---- Collapsible groups ---- */
.prop-section {
  margin: 0;
  padding: 2px 0 6px;
  border-bottom: 1px solid #1e1e1e;
}

.prop-section:last-child {
  border-bottom: none;
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

.app-name {
  font-size: 11px;
  color: #c9c9c9;
  white-space: nowrap;
}

.unit {
  font-size: 11px;
  color: #8a8a8a;
  flex-shrink: 0;
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

/* Control that fills remaining row width */
.flex-ctl {
  flex: 1;
  min-width: 0;
  width: 100%;
}

/* Transform X/W/Y/H grid with the ref-point block on the left (AI-style) */
.tf-grid {
  display: grid;
  grid-template-columns: auto 1fr 1fr;
  gap: 5px 6px;
  align-items: center;
  margin-top: 5px;
}

.tf-ref {
  grid-row: span 2;
}

.tf-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.tf-cell > span {
  width: 10px;
  flex-shrink: 0;
  font-size: 11px;
  color: #9a9a9a;
}

/* Opacity slider + readout */
.op-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 5px;
}

.op-row :deep(.el-slider) {
  flex: 1;
  min-width: 0;
}

.op-val {
  width: 34px;
  flex-shrink: 0;
  text-align: right;
  font-size: 11px;
  color: #9a9a9a;
}

/* CMYK proof readout (numeric preview, View > CMYK Preview) */
.proof-block {
  margin-top: 5px;
  padding: 4px 6px;
  background: #1a1a1a;
  border: 1px solid #3d3d3d;
  border-radius: 3px;
}

.proof-block .prop-row {
  margin-top: 2px;
}

.cmyk-val {
  font-size: 11px;
  color: #d5d5d5;
  font-variant-numeric: tabular-nums;
}

.cmyk-val .oog {
  color: #e5a13d;
  cursor: help;
}

/* Button grids that always fit the column */
.btn-row {
  display: flex;
  gap: 4px;
  margin-top: 5px;
}

.btn-grid-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  margin-top: 5px;
}

.btn-grid-2 {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
  margin-top: 4px;
}

.grid-btn {
  width: 100%;
  margin: 0 !important;
}

/* AI-style icon toggle row (Rulers & Grid, Guides) */
.icon-row {
  display: flex;
  gap: 4px;
  margin-top: 5px;
}

.tool-btn {
  flex: 1;
  min-width: 0;
  margin: 0 !important;
  display: flex;
  align-items: center;
  justify-content: center;
}

.board-count {
  flex: 1;
  min-width: 0;
  text-align: center;
  font-size: 11px;
  color: #c9c9c9;
}

.wide-label {
  width: 52px;
}

.grid-btn :deep(span) {
  overflow: hidden;
  text-overflow: ellipsis;
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

.fmt-btn {
  width: 22px;
  flex-shrink: 0;
  padding: 0 !important;
  font-weight: 700;
  margin: 0 !important;
}

.prop-row .el-button + .el-button {
  margin-left: 0;
}

.ref-grid {
  display: grid;
  grid-template-columns: repeat(3, 12px);
  grid-template-rows: repeat(3, 12px);
  gap: 2px;
}

.ref-cell {
  width: 12px;
  height: 12px;
  border: 1px solid #555;
  border-radius: 2px;
  cursor: pointer;
  background: #1a1a1a;
}

.ref-cell:hover {
  border-color: #fff;
}

.ref-cell.active {
  background: #4a90d9;
  border-color: #4a90d9;
}

/* ---- Element Plus dark overrides: black inputs / selects / number fields ---- */
.ai-panel :deep(.el-input) {
  flex: 1;
  min-width: 0;
}

.ai-panel :deep(.el-input__wrapper),
.ai-panel :deep(.el-input-number .el-input__wrapper) {
  background: #111111;
  border: 1px solid #3d3d3d;
  box-shadow: none !important;
  border-radius: 3px;
  height: 22px;
  padding: 0 6px;
}

.ai-panel :deep(.el-input-number.is-controls-right .el-input__wrapper) {
  padding-right: 20px;
}

.ai-panel :deep(.el-input__wrapper:hover) {
  border-color: #5a5a5a;
}

.ai-panel :deep(.el-input__wrapper.is-focus) {
  border-color: #4a90d9;
}

.ai-panel :deep(.el-input__inner) {
  color: #e6e6e6;
  font-size: 12px;
  height: 20px;
  line-height: 20px;
  min-width: 0;
}

.ai-panel :deep(.el-input__inner::placeholder) {
  color: #6a6a6a;
}

.ai-panel :deep(.el-input-number) {
  flex: 1;
  min-width: 0;
  width: 100%;
  line-height: 22px;
}

/* Compact up/down spinners stacked on the right (AI-style) */
.ai-panel :deep(.el-input-number.is-controls-right .el-input-number__decrease),
.ai-panel :deep(.el-input-number.is-controls-right .el-input-number__increase) {
  width: 18px;
  background: #1e1e1e;
  border-left: 1px solid #3d3d3d;
  color: #9a9a9a;
}

.ai-panel :deep(.el-input-number.is-controls-right .el-input-number__decrease:hover),
.ai-panel :deep(.el-input-number.is-controls-right .el-input-number__increase:hover) {
  color: #fff;
}

/* el-select renders .el-select__wrapper (not .el-input__wrapper) */
.ai-panel :deep(.el-select) {
  flex: 1;
  min-width: 0;
}

.ai-panel :deep(.el-select__wrapper) {
  background: #111111;
  border: 1px solid #3d3d3d;
  box-shadow: none !important;
  border-radius: 3px;
  min-height: 22px;
  font-size: 12px;
  padding: 0 6px;
}

.ai-panel :deep(.el-select__wrapper:hover) {
  border-color: #5a5a5a;
}

.ai-panel :deep(.el-select__wrapper.is-focused) {
  border-color: #4a90d9;
}

.ai-panel :deep(.el-select__placeholder) {
  color: #6a6a6a;
  font-size: 12px;
}

.ai-panel :deep(.el-select__selected-item) {
  color: #e6e6e6;
  font-size: 12px;
}

.ai-panel :deep(.el-select__suffix),
.ai-panel :deep(.el-select__caret) {
  color: #8a8a8a;
}

.ai-panel :deep(.el-button--small) {
  background: #333333;
  border: 1px solid #4a4a4a;
  color: #d5d5d5;
  border-radius: 3px;
  height: 22px;
  padding: 0 6px;
  font-size: 11px;
}

.ai-panel :deep(.el-button--small:hover) {
  background: #3d3d3d;
  border-color: #5a5a5a;
  color: #fff;
}

.ai-panel :deep(.el-button--small.el-button--primary) {
  background: #2f6fbf;
  border-color: #2f6fbf;
  color: #fff;
}

.ai-panel :deep(.el-button--small.is-plain) {
  background: #2a2a2a;
}

.ai-panel :deep(.el-button--small.el-button--danger) {
  background: transparent;
  border-color: #4a4a4a;
  color: #9a9a9a;
}

.ai-panel :deep(.el-button--small.is-disabled),
.ai-panel :deep(.el-button--small.is-disabled:hover) {
  background: #242424;
  border-color: #333;
  color: #5a5a5a;
  cursor: not-allowed;
}

/* Full-width segmented control (Solid/Gradient, alignments) */
.ai-panel :deep(.el-radio-group.seg-full) {
  display: flex;
  width: 100%;
}

.ai-panel :deep(.el-radio-group.seg-full .el-radio-button) {
  flex: 1;
  min-width: 0;
}

.ai-panel :deep(.el-radio-button__inner) {
  background: #1a1a1a;
  border: 1px solid #3d3d3d;
  color: #b5b5b5;
  font-size: 11px;
  padding: 4px 8px;
  box-shadow: none;
}

.ai-panel :deep(.seg-full .el-radio-button__inner) {
  width: 100%;
  display: block;
  text-align: center;
  padding: 4px 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-panel :deep(.el-radio-button:first-child .el-radio-button__inner) {
  border-radius: 3px 0 0 3px;
}

.ai-panel :deep(.el-radio-button:last-child .el-radio-button__inner) {
  border-radius: 0 3px 3px 0;
}

.ai-panel :deep(.el-radio-button__orig-radio:checked + .el-radio-button__inner) {
  background: #2f6fbf;
  border-color: #2f6fbf;
  color: #fff;
}

.ai-panel :deep(.el-slider__runway) {
  background: #3d3d3d;
  height: 4px;
}

.ai-panel :deep(.el-slider__bar) {
  background: #4a90d9;
  height: 4px;
}

.ai-panel :deep(.el-slider__button) {
  width: 12px;
  height: 12px;
  border: 2px solid #4a90d9;
  background: #fff;
}

.ai-panel :deep(.el-color-picker__trigger) {
  background: #111;
  border: 1px solid #3d3d3d;
  border-radius: 3px;
  width: 26px;
  height: 22px;
  padding: 2px;
  flex-shrink: 0;
}

.ai-panel :deep(.el-color-picker__color) {
  border: 1px solid #000;
  border-radius: 2px;
}
</style>

<!-- Teleported popups (select dropdown, color picker) live outside the
     scoped tree, so they need global dark rules to match the AI theme. -->
<style>
.el-select__popper.el-popper {
  background: #1e1e1e;
  border: 1px solid #3d3d3d;
}

.el-select__popper .el-select-dropdown {
  background: #1e1e1e;
}

.el-select__popper .el-select-dropdown__item {
  color: #d5d5d5;
  font-size: 12px;
  height: 28px;
  line-height: 28px;
}

.el-select__popper .el-select-dropdown__item.is-hovering {
  background: #333333;
}

.el-select__popper .el-select-dropdown__item.is-selected {
  color: #6aa9ec;
  font-weight: 600;
}

.el-popper__arrow::before {
  background: #1e1e1e !important;
  border-color: #3d3d3d !important;
}
</style>
