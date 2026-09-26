<template>
  <div class="object-menu">
    <el-dropdown trigger="click" @command="onObjectCmd">
      <span class="menu-label">Object</span>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item command="transform" :disabled="!store.hasSelection">Transform</el-dropdown-item>
          <el-dropdown-item command="transformEach" :disabled="!store.hasSelection">Transform Each...</el-dropdown-item>
          <el-dropdown-item command="reflect" :disabled="!store.hasSelection">Reflect...</el-dropdown-item>
          <el-dropdown-item command="rotate90cw" :disabled="!store.hasSelection">Rotate 90&#176; CW</el-dropdown-item>
          <el-dropdown-item command="rotate90ccw" :disabled="!store.hasSelection">Rotate 90&#176; CCW</el-dropdown-item>
          <el-dropdown-item command="bringToFront" :disabled="!store.hasSelection">Bring to Front</el-dropdown-item>
          <el-dropdown-item command="bringForward" :disabled="!store.hasSelection">Bring Forward</el-dropdown-item>
          <el-dropdown-item command="sendBackward" :disabled="!store.hasSelection">Send Backward</el-dropdown-item>
          <el-dropdown-item command="sendToBack" :disabled="!store.hasSelection">Send to Back</el-dropdown-item>
          <el-dropdown-item command="reverseOrder" :disabled="!store.hasSelection">Reverse Order</el-dropdown-item>
          <el-dropdown-item command="group" divided :disabled="!store.hasSelection">Group</el-dropdown-item>
          <el-dropdown-item command="ungroup" :disabled="!store.hasSelection">Ungroup</el-dropdown-item>
          <el-dropdown-item command="ungroupAll" :disabled="!store.hasSelection">Ungroup All</el-dropdown-item>
          <el-dropdown-item command="newSublayer">New Sublayer</el-dropdown-item>
          <el-dropdown-item command="collect" :disabled="!store.hasSelection">Collect in New Layer</el-dropdown-item>
          <el-dropdown-item command="releaseLayers" :disabled="!store.hasSelection">Release to Layers</el-dropdown-item>
          <el-dropdown-item command="sendToLayer" :disabled="!store.hasSelection">Send to Current Layer</el-dropdown-item>
          <el-dropdown-item command="isolate" :disabled="!store.hasSelection">Isolate</el-dropdown-item>
          <el-dropdown-item command="exitIsolation" :disabled="!store.isolationActive">Exit Isolation</el-dropdown-item>
          <el-dropdown-item command="makeCompound" divided :disabled="!store.hasSelection">Make Compound Path</el-dropdown-item>
          <el-dropdown-item command="releaseCompound" :disabled="!store.hasSelection">Release Compound Path</el-dropdown-item>
          <el-dropdown-item command="joinPaths" :disabled="!store.hasSelection">Join Paths</el-dropdown-item>
          <el-dropdown-item command="outlineStroke" :disabled="!store.hasSelection">Outline Stroke</el-dropdown-item>
          <el-dropdown-item command="offsetPath" :disabled="!store.hasSelection">Offset Path...</el-dropdown-item>
          <el-dropdown-item command="stepRepeat" :disabled="!store.hasSelection">Step and Repeat...</el-dropdown-item>
          <el-dropdown-item command="radialRepeat" :disabled="!store.hasSelection">Radial Repeat...</el-dropdown-item>
          <el-dropdown-item command="gridRepeat" :disabled="!store.hasSelection">Grid Repeat...</el-dropdown-item>
          <el-dropdown-item command="blend" :disabled="!store.hasSelection">Blend...</el-dropdown-item>
          <el-dropdown-item command="splitGrid" :disabled="!store.hasSelection">Split Into Grid...</el-dropdown-item>
          <el-dropdown-item command="simplifyPath" :disabled="!store.hasSelection">Simplify Path</el-dropdown-item>
          <el-dropdown-item command="addAnchors" :disabled="!store.hasSelection">Add Anchor Points</el-dropdown-item>
          <el-dropdown-item command="roughen" :disabled="!store.hasSelection">Roughen / Zig Zag...</el-dropdown-item>
          <el-dropdown-item command="reversePath" :disabled="!store.hasSelection">Reverse Path Direction</el-dropdown-item>
          <el-dropdown-item command="cleanUp">Clean Up...</el-dropdown-item>
          <el-dropdown-item command="arrowheads" :disabled="!store.hasSelection">Add Arrowheads...</el-dropdown-item>
          <el-dropdown-item command="adjustColors" :disabled="!store.hasSelection">Adjust Colors...</el-dropdown-item>
          <el-dropdown-item command="setDefaults" :disabled="!store.hasSelection">Set Style Defaults</el-dropdown-item>
          <el-dropdown-item command="clearAppearance" :disabled="!store.hasSelection">Clear Appearance</el-dropdown-item>
          <el-dropdown-item command="rasterize" :disabled="!store.hasSelection">Rasterize Selection (2x)</el-dropdown-item>
          <el-dropdown-item command="alignPixel" :disabled="!store.hasSelection">Align to Pixel</el-dropdown-item>
          <el-dropdown-item command="extractImage" :disabled="!store.hasSelection">Extract Image...</el-dropdown-item>
          <el-dropdown-item command="adjustImage" :disabled="!store.hasSelection">Adjust Image...</el-dropdown-item>
          <el-dropdown-item command="downsample" :disabled="!store.hasSelection">Downsample Images...</el-dropdown-item>
          <el-dropdown-item command="replaceImage" :disabled="!store.hasSelection">Replace Image...</el-dropdown-item>
          <el-dropdown-item command="resetImage" :disabled="!store.hasSelection">Reset Image</el-dropdown-item>
          <el-dropdown-item command="closePath" :disabled="!store.hasSelection">Close Path</el-dropdown-item>
          <el-dropdown-item command="openPath" :disabled="!store.hasSelection">Open Path</el-dropdown-item>
          <el-dropdown-item command="envArcUpper" divided :disabled="!store.hasSelection">Envelope: Arc Upper</el-dropdown-item>
          <el-dropdown-item command="envArcLower" :disabled="!store.hasSelection">Envelope: Arc Lower</el-dropdown-item>
          <el-dropdown-item command="envBulge" :disabled="!store.hasSelection">Envelope: Bulge</el-dropdown-item>
          <el-dropdown-item command="envWave" :disabled="!store.hasSelection">Envelope: Wave</el-dropdown-item>
          <el-dropdown-item command="envFlag" :disabled="!store.hasSelection">Envelope: Flag</el-dropdown-item>
          <el-dropdown-item command="envFisheye" :disabled="!store.hasSelection">Envelope: Fisheye</el-dropdown-item>
          <el-dropdown-item command="envSqueeze" :disabled="!store.hasSelection">Envelope: Squeeze</el-dropdown-item>
          <el-dropdown-item command="envPinch" :disabled="!store.hasSelection">Envelope: Pinch</el-dropdown-item>
          <el-dropdown-item command="envRise" :disabled="!store.hasSelection">Envelope: Rise</el-dropdown-item>
          <el-dropdown-item command="envFish" :disabled="!store.hasSelection">Envelope: Fish</el-dropdown-item>
          <el-dropdown-item command="makeMask" divided :disabled="!store.hasSelection">Make Clipping Mask</el-dropdown-item>
          <el-dropdown-item command="releaseMask" :disabled="!store.hasSelection">Release Clipping Mask</el-dropdown-item>
          <el-dropdown-item command="applyPattern" divided :disabled="!store.hasSelection">Apply Pattern Fill</el-dropdown-item>
          <el-dropdown-item command="removePattern" :disabled="!store.hasSelection">Remove Pattern Fill</el-dropdown-item>
          <el-dropdown-item command="flowText" divided :disabled="!store.hasSelection">Flow Text Overflow</el-dropdown-item>
          <el-dropdown-item command="unlinkText" :disabled="!store.hasSelection">Unlink Text Frames</el-dropdown-item>
          <el-dropdown-item command="lock" divided :disabled="!store.hasSelection">Lock</el-dropdown-item>
          <el-dropdown-item command="lockOthers" :disabled="!store.hasSelection">Lock Others</el-dropdown-item>
          <el-dropdown-item command="unlockAll">Unlock All</el-dropdown-item>
          <el-dropdown-item command="hide" divided :disabled="!store.hasSelection">Hide</el-dropdown-item>
          <el-dropdown-item command="showAll">Show All</el-dropdown-item>
          <el-dropdown-item command="isolateVisible" :disabled="!store.hasSelection">Isolate Visible</el-dropdown-item>
          <el-dropdown-item command="sameFill" divided :disabled="!store.hasSelection">Select Same Fill</el-dropdown-item>
          <el-dropdown-item command="sameStroke" :disabled="!store.hasSelection">Select Same Stroke</el-dropdown-item>
          <el-dropdown-item command="sameWidth" :disabled="!store.hasSelection">Select Same Stroke Width</el-dropdown-item>
          <el-dropdown-item command="sameOpacity" :disabled="!store.hasSelection">Select Same Opacity</el-dropdown-item>
          <el-dropdown-item command="sameBlend" :disabled="!store.hasSelection">Select Same Blend Mode</el-dropdown-item>
          <el-dropdown-item command="selectStrays">Select Stray Points</el-dropdown-item>
          <el-dropdown-item command="selectTexts">Select Text Objects</el-dropdown-item>
          <el-dropdown-item command="sameFontFamily" :disabled="!store.hasSelection">Select Same Font Family</el-dropdown-item>
          <el-dropdown-item command="sameFontSize" :disabled="!store.hasSelection">Select Same Font Size</el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <!-- Offset Path Dialog (AI Offset Path parity) -->
    <AppDialog
      v-model="offsetVisible"
      title="Offset Path"
      :width="360"
      confirm-text="Apply"
      cancel-text="Close"
      @confirm="onOffsetConfirm"
      @cancel="offsetVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Distance</span>
            <span class="setting-desc">Positive expands, negative insets</span>
          </div>
          <el-input-number v-model="offsetForm.distance" :precision="1" size="small" style="width: 130px" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Join</span>
          </div>
          <el-select v-model="offsetForm.join" size="small" style="width: 130px">
            <el-option value="miter" label="Miter" />
            <el-option value="round" label="Round" />
            <el-option value="bevel" label="Bevel" />
          </el-select>
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Cap</span>
            <span class="setting-desc">Open-path ends (Auto = default)</span>
          </div>
          <el-select v-model="offsetForm.cap" size="small" style="width: 130px">
            <el-option value="" label="Auto" />
            <el-option value="round" label="Round" />
            <el-option value="butt" label="Butt" />
          </el-select>
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Steps</span>
            <span class="setting-desc">Concentric copies (contour)</span>
          </div>
          <el-input-number v-model="offsetForm.steps" :min="1" :max="20" size="small" style="width: 130px" />
        </div>
      </div>
    </AppDialog>

    <!-- Step and Repeat Dialog (layout staple) -->
    <AppDialog
      v-model="repeatVisible"
      title="Step and Repeat"
      :width="360"
      confirm-text="Apply"
      cancel-text="Close"
      @confirm="onRepeatConfirm"
      @cancel="repeatVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Copies</span>
          </div>
          <el-input-number v-model="repeatForm.count" :min="1" :max="100" size="small" style="width: 130px" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Step X / Y</span>
            <span class="setting-desc">Offset per copy in px</span>
          </div>
          <el-input-number v-model="repeatForm.dx" size="small" style="width: 100px" />
          <el-input-number v-model="repeatForm.dy" size="small" style="width: 100px" />
        </div>
      </div>
    </AppDialog>

    <!-- Grid Repeat Dialog (rows x cols copies with per-axis spacing) -->
    <AppDialog
      v-model="gridRepeatVisible"
      title="Grid Repeat"
      :width="360"
      confirm-text="Apply"
      cancel-text="Close"
      @confirm="onGridRepeatConfirm"
      @cancel="gridRepeatVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Rows / Columns</span>
            <span class="setting-desc">The original fills the 0,0 cell</span>
          </div>
          <el-input-number v-model="gridRepeatForm.rows" :min="1" :max="50" size="small" style="width: 100px" />
          <el-input-number v-model="gridRepeatForm.cols" :min="1" :max="50" size="small" style="width: 100px" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Spacing X / Y</span>
            <span class="setting-desc">Offset per cell in px</span>
          </div>
          <el-input-number v-model="gridRepeatForm.dx" :min="1" size="small" style="width: 100px" />
          <el-input-number v-model="gridRepeatForm.dy" :min="1" size="small" style="width: 100px" />
        </div>
      </div>
    </AppDialog>

    <!-- Blend Dialog (steps interpolated between the two selected paths) -->
    <AppDialog
      v-model="blendVisible"
      title="Blend"
      :width="360"
      confirm-text="Blend"
      cancel-text="Cancel"
      @confirm="onBlendConfirm"
      @cancel="blendVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Blend Mode</span>
          </div>
          <el-radio-group v-model="blendForm.mode" size="small">
            <el-radio-button value="smooth">Smooth Color</el-radio-button>
            <el-radio-button value="steps">Specified Steps</el-radio-button>
          </el-radio-group>
        </div>
        <div v-if="blendForm.mode === 'steps'" class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Steps</span>
            <span class="setting-desc">Shapes between the two paths, back-to-front; solid fills, strokes and opacity blend too</span>
          </div>
          <el-input-number v-model="blendForm.steps" :min="1" :max="200" size="small" style="width: 100px" />
        </div>
        <div v-else class="setting-desc" style="padding: 4px 0">
          Auto-calculate steps for a smooth color transition (up to 256)
        </div>
      </div>
    </AppDialog>

    <!-- Split Into Grid Dialog (tiles the object bounds with cells) -->
    <AppDialog
      v-model="gridSplitVisible"
      title="Split Into Grid"
      :width="360"
      confirm-text="Apply"
      cancel-text="Close"
      @confirm="onGridSplitConfirm"
      @cancel="gridSplitVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Rows / Columns</span>
          </div>
          <el-input-number v-model="gridSplitForm.rows" :min="1" :max="50" size="small" style="width: 100px" />
          <el-input-number v-model="gridSplitForm.cols" :min="1" :max="50" size="small" style="width: 100px" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Gutter X / Y</span>
            <span class="setting-desc">Gap between cells in px</span>
          </div>
          <el-input-number v-model="gridSplitForm.gutterX" :min="0" size="small" style="width: 100px" />
          <el-input-number v-model="gridSplitForm.gutterY" :min="0" size="small" style="width: 100px" />
        </div>
      </div>
    </AppDialog>

    <!-- Reflect Dialog (mirror about an arbitrary axis angle) -->
    <AppDialog
      v-model="reflectVisible"
      title="Reflect"
      :width="360"
      confirm-text="Apply"
      cancel-text="Close"
      @confirm="onReflectConfirm"
      @cancel="reflectVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Axis Angle</span>
            <span class="setting-desc">0 = mirror top/bottom, 90 = mirror left/right</span>
          </div>
          <el-input-number v-model="reflectForm.angle" :min="-360" :max="360" size="small" style="width: 110px" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Reflect a Copy</span>
            <span class="setting-desc">Keep the originals in place</span>
          </div>
          <el-switch v-model="reflectForm.copy" size="small" />
        </div>
      </div>
    </AppDialog>

    <!-- Radial Repeat Dialog (clock faces, badges, rosettes) -->
    <AppDialog
      v-model="radialVisible"
      title="Radial Repeat"
      :width="360"
      confirm-text="Apply"
      cancel-text="Close"
      @confirm="onRadialConfirm"
      @cancel="radialVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Copies</span>
          </div>
          <el-input-number v-model="radialForm.count" :min="1" :max="120" size="small" style="width: 130px" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Angle step</span>
            <span class="setting-desc">Degrees about the reference point</span>
          </div>
          <el-input-number v-model="radialForm.angle" :min="-360" :max="360" size="small" style="width: 130px" />
        </div>
      </div>
    </AppDialog>

    <!-- Transform Each Dialog (beloved batch transform) -->
    <AppDialog
      v-model="eachVisible"
      title="Transform Each"
      :width="360"
      confirm-text="Apply"
      cancel-text="Close"
      @confirm="onEachConfirm"
      @cancel="eachVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Move X / Y</span>
          </div>
          <el-input-number v-model="eachForm.dx" size="small" style="width: 100px" />
          <el-input-number v-model="eachForm.dy" size="small" style="width: 100px" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Rotate</span>
            <span class="setting-desc">Degrees about each center</span>
          </div>
          <el-input-number v-model="eachForm.rotate" size="small" style="width: 130px" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Scale</span>
            <span class="setting-desc">Percent about each center</span>
          </div>
          <el-input-number v-model="eachForm.scale" :min="1" :max="1600" size="small" style="width: 130px" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Copies</span>
            <span class="setting-desc">0 = in place, else cumulative copies</span>
          </div>
          <el-input-number v-model="eachForm.copies" :min="0" :max="50" size="small" style="width: 130px" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Random</span>
            <span class="setting-desc">Jitter per-item rotation/scale</span>
          </div>
          <el-checkbox v-model="eachForm.random" />
        </div>
      </div>
    </AppDialog>

    <!-- Roughen Dialog (AI Roughen parity, destructive) -->
    <AppDialog
      v-model="roughenVisible"
      title="Roughen / Zig Zag"
      :width="360"
      confirm-text="Apply"
      cancel-text="Close"
      @confirm="onRoughenConfirm"
      @cancel="roughenVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Effect</span>
          </div>
          <el-select v-model="roughenForm.kind" size="small" style="width: 130px">
            <el-option value="roughen" label="Roughen" />
            <el-option value="zigzag" label="Zig Zag" />
          </el-select>
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Size</span>
            <span class="setting-desc">Jitter / ridge height in px</span>
          </div>
          <el-input-number v-model="roughenForm.size" :min="1" :max="500" size="small" style="width: 130px" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Detail</span>
            <span class="setting-desc">Subdivisions per curve</span>
          </div>
          <el-input-number v-model="roughenForm.detail" :min="1" :max="10" size="small" style="width: 130px" />
        </div>
      </div>
    </AppDialog>

    <!-- Arrowheads Dialog (destructive v1: plain filled markers) -->
    <AppDialog
      v-model="arrowVisible"
      title="Add Arrowheads"
      :width="360"
      confirm-text="Apply"
      cancel-text="Close"
      @confirm="onArrowConfirm"
      @cancel="arrowVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Ends</span>
          </div>
          <el-checkbox v-model="arrowForm.start">Start</el-checkbox>
          <el-checkbox v-model="arrowForm.end">End</el-checkbox>
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Length</span>
            <span class="setting-desc">Absolute document units</span>
          </div>
          <el-input-number v-model="arrowForm.length" :min="1" :max="200" size="small" style="width: 130px" />
        </div>
      </div>
    </AppDialog>

    <!-- Adjust Colors Dialog (Recolor-lite through HSL) -->
    <AppDialog
      v-model="recolorVisible"
      title="Adjust Colors"
      :width="360"
      confirm-text="Apply"
      cancel-text="Close"
      @confirm="onRecolorConfirm"
      @cancel="recolorVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Hue shift</span>
          </div>
          <el-input-number v-model="recolorForm.hue" :min="-180" :max="180" size="small" style="width: 130px" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Saturation</span>
          </div>
          <el-input-number v-model="recolorForm.sat" :min="-100" :max="100" size="small" style="width: 130px" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Lightness</span>
          </div>
          <el-input-number v-model="recolorForm.light" :min="-100" :max="100" size="small" style="width: 130px" />
        </div>
        <div class="setting-row">
          <el-button size="small" :disabled="!store.hasSelection" @click="onInvertNow">Invert Selection Paints</el-button>
        </div>
      </div>
    </AppDialog>

    <!-- Adjust Image Dialog (bitmap-effects lite, destructive) -->
    <AppDialog
      v-model="imageVisible"
      title="Adjust Image"
      :width="360"
      confirm-text="Apply"
      cancel-text="Close"
      @confirm="onImageConfirm"
      @cancel="imageVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Preset</span>
          </div>
          <el-select v-model="imageForm.preset" size="small" style="width: 130px">
            <el-option value="none" label="None" />
            <el-option value="gray" label="Grayscale" />
            <el-option value="sepia" label="Sepia" />
            <el-option value="invert" label="Invert" />
          </el-select>
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Brightness</span>
            <span class="setting-desc">Percent, applies with the preset</span>
          </div>
          <el-input-number v-model="imageForm.brightness" :min="50" :max="150" size="small" style="width: 130px" />
        </div>
      </div>
    </AppDialog>

    <!-- Downsample Dialog (file/history diet for photo-heavy docs) -->
    <AppDialog
      v-model="downsampleVisible"
      title="Downsample Images"
      :width="360"
      confirm-text="Apply"
      cancel-text="Close"
      @confirm="onDownsampleConfirm"
      @cancel="downsampleVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Scale</span>
            <span class="setting-desc">Pixel fraction (visual size kept)</span>
          </div>
          <el-select v-model="downsampleForm.factor" size="small" style="width: 130px">
            <el-option :value="0.75" label="75%" />
            <el-option :value="0.5" label="50%" />
            <el-option :value="0.25" label="25%" />
          </el-select>
        </div>
      </div>
    </AppDialog>
  </div>
</template>

<script setup lang="ts">
/**
 * ObjectMenu (C2: fourth and last menu slice out of TopBar.vue).
 *
 * The Object dropdown with its dispatch plus every dialog it owns (offset,
 * repeats, blend, grids, reflect, roughen, arrowheads, recolor, image
 * tools). Dialog body styling comes from AppDialog's shared global block;
 * everything else here is self-contained (store + engine only). The blend
 * dialog stays store-backed so Ctrl+Alt+B keeps working without TopBar.
 */
import { ref, reactive, computed, inject, type Ref } from 'vue'
import AppDialog from '../ui/AppDialog.vue'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import { downloadHref, readFileAsDataURL } from './download'
import type { EnvelopePreset } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

function blurMenuFocus() {
  const ae = document.activeElement as HTMLElement | null
  if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur()
}

const offsetVisible = ref(false)
const offsetForm = reactive({
  distance: 10,
  join: 'miter' as 'miter' | 'round' | 'bevel',
  steps: 1,
  cap: '' as '' | 'round' | 'butt',
})
function onOffsetConfirm() {
  const e = engineRef?.value
  if (!e) {
    offsetVisible.value = false
    return
  }
  const d = Number(offsetForm.distance)
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) {
    store.setStatusMessage('Offset needs a non-zero distance')
    return
  }
  if (e.offsetPaths(d, offsetForm.join, Number(offsetForm.steps) || 1, offsetForm.cap || undefined) === 0) {
    store.setStatusMessage('Offset needs a path selection')
    return
  }
  offsetVisible.value = false
}

const repeatVisible = ref(false)
const repeatForm = reactive({ count: 3, dx: 20, dy: 20 })
function onRepeatConfirm() {
  const e = engineRef?.value
  if (!e) {
    repeatVisible.value = false
    return
  }
  if (e.stepRepeat(Number(repeatForm.count), Number(repeatForm.dx), Number(repeatForm.dy)) === 0) {
    store.setStatusMessage('Step and Repeat needs artwork and a non-zero step')
    return
  }
  repeatVisible.value = false
}

const radialVisible = ref(false)
const radialForm = reactive({ count: 5, angle: 60 })
const gridRepeatVisible = ref(false)
const gridRepeatForm = reactive({ rows: 3, cols: 3, dx: 100, dy: 100 })
function onGridRepeatConfirm() {
  const e = engineRef?.value
  if (!e) {
    gridRepeatVisible.value = false
    return
  }
  if (e.gridRepeat(Number(gridRepeatForm.rows), Number(gridRepeatForm.cols), Number(gridRepeatForm.dx), Number(gridRepeatForm.dy)) === 0) {
    store.setStatusMessage('Grid Repeat needs artwork, rows x cols >= 2 and positive spacing')
    return
  }
  gridRepeatVisible.value = false
}

// Blend dialog visibility lives on the store so Ctrl+Alt+B can open it.
const blendVisible = computed({
  get: () => store.ui.blendDialogOpen,
  set: (v) => store.setBlendDialogOpen(v),
})
const blendForm = reactive({ mode: 'smooth' as 'smooth' | 'steps', steps: 6 })
function onBlendConfirm() {
  const e = engineRef?.value
  if (!e) {
    blendVisible.value = false
    return
  }
  const steps = blendForm.mode === 'smooth'
    ? e.autoBlendSteps()
    : Number(blendForm.steps)
  if (e.blendSelection(steps) === 0) {
    store.setStatusMessage('Blend needs exactly two unlocked paths')
    return
  }
  blendVisible.value = false
}

const gridSplitVisible = ref(false)
const gridSplitForm = reactive({ rows: 3, cols: 3, gutterX: 0, gutterY: 0 })
function onGridSplitConfirm() {
  const e = engineRef?.value
  if (!e) {
    gridSplitVisible.value = false
    return
  }
  if (e.splitSelectionGrid(Number(gridSplitForm.rows), Number(gridSplitForm.cols), Number(gridSplitForm.gutterX), Number(gridSplitForm.gutterY)) === 0) {
    store.setStatusMessage('Select one unlocked object; rows x cols must fit inside its bounds')
    return
  }
  gridSplitVisible.value = false
}
const eachVisible = ref(false)
const eachForm = reactive({ dx: 0, dy: 0, rotate: 0, scale: 100, copies: 0, random: false })
const reflectVisible = ref(false)
const reflectForm = reactive({ angle: 0, copy: false })
function onReflectConfirm() {
  const e = engineRef?.value
  if (!e) {
    reflectVisible.value = false
    return
  }
  if (!e.reflectSelection(Number(reflectForm.angle) || 0, reflectForm.copy)) {
    store.setStatusMessage('Reflect needs unlocked artwork')
    return
  }
  e.pushHistory(reflectForm.copy ? 'Reflect Copy' : 'Reflect')
  e.stampSelectionFrame()
  reflectVisible.value = false
}
function onEachConfirm() {
  const e = engineRef?.value
  if (!e) {
    eachVisible.value = false
    return
  }
  if (
    e.transformEach({
      dx: Number(eachForm.dx) || 0,
      dy: Number(eachForm.dy) || 0,
      rotate: Number(eachForm.rotate) || 0,
      scale: Number(eachForm.scale) || 100,
      copies: Number(eachForm.copies) || 0,
      random: eachForm.random,
    }) === 0
  ) {
    store.setStatusMessage('Transform Each needs artwork and a non-zero change')
    return
  }
  eachVisible.value = false
}

function onRadialConfirm() {
  const e = engineRef?.value
  if (!e) {
    radialVisible.value = false
    return
  }
  if (e.radialRepeat(Number(radialForm.count), Number(radialForm.angle)) === 0) {
    store.setStatusMessage('Radial Repeat needs artwork and a non-zero angle')
    return
  }
  radialVisible.value = false
}

const roughenVisible = ref(false)
const roughenForm = reactive({
  kind: 'roughen' as 'roughen' | 'zigzag',
  size: 8,
  detail: 3,
})
function onRoughenConfirm() {
  const e = engineRef?.value
  if (!e) {
    roughenVisible.value = false
    return
  }
  if (e.stylizeRoughen(roughenForm.kind, Number(roughenForm.size), Number(roughenForm.detail)) === 0) {
    store.setStatusMessage('Roughen needs a path selection')
    return
  }
  roughenVisible.value = false
}

const arrowVisible = ref(false)
const arrowForm = reactive({ start: false, end: true, length: 12 })
function onArrowConfirm() {
  const e = engineRef?.value
  if (!e) {
    arrowVisible.value = false
    return
  }
  const n = e.addArrowheads(arrowForm.start, arrowForm.end, Number(arrowForm.length))
  if (n === 0) {
    store.setStatusMessage('Arrowheads need an open path selection')
    return
  }
  store.setStatusMessage(`Added ${n} arrowhead${n === 1 ? '' : 's'}`)
  arrowVisible.value = false
}

const recolorVisible = ref(false)
const recolorForm = reactive({ hue: 0, sat: 0, light: 0 })
function onRecolorConfirm() {
  const e = engineRef?.value
  if (!e) {
    recolorVisible.value = false
    return
  }
  const n = e.adjustColors(Number(recolorForm.hue) || 0, Number(recolorForm.sat) || 0, Number(recolorForm.light) || 0)
  if (n === 0) {
    store.setStatusMessage('Adjust Colors needs painted artwork selected')
    return
  }
  store.setStatusMessage(`Recolored ${n} object${n === 1 ? '' : 's'}`)
  recolorVisible.value = false
}

function onInvertNow() {
  const e = engineRef?.value
  if (!e) return
  if (e.invertPaints() === 0) {
    store.setStatusMessage('Invert needs painted artwork selected')
  }
}

const imageVisible = ref(false)
const imageForm = reactive({
  preset: 'none' as 'none' | 'gray' | 'sepia' | 'invert',
  brightness: 100,
})
function onImageConfirm() {
  const e = engineRef?.value
  if (!e) {
    imageVisible.value = false
    return
  }
  if (!e.adjustImage(imageForm.preset, Number(imageForm.brightness) || 100)) {
    store.setStatusMessage('Adjust needs a selected image')
    return
  }
  imageVisible.value = false
}

const downsampleVisible = ref(false)
const downsampleForm = reactive({ factor: 0.5 })
function onDownsampleConfirm() {
  const e = engineRef?.value
  if (!e) {
    downsampleVisible.value = false
    return
  }
  if (e.downsampleImages(Number(downsampleForm.factor) || 0.5) === 0) {
    store.setStatusMessage('Downsample needs a selected image')
    return
  }
  downsampleVisible.value = false
}

function onObjectCmd(cmd: string) {
  blurMenuFocus()
  const e = engineRef?.value
  if (!e) return
  switch (cmd) {
    case 'transform':
      store.setReferencePoint('center')
      break
    case 'transformEach':
      eachVisible.value = true
      break
    case 'reflect':
      reflectVisible.value = true
      break
    case 'sendToLayer': {
      const n = e.moveSelectionToActiveLayer()
      store.setStatusMessage(
        n === 0
          ? 'Nothing to move to the active layer'
          : `Moved ${n} item${n === 1 ? '' : 's'} to the active layer`
      )
      break
    }
    case 'rotate90cw':
    case 'rotate90ccw': {
      const pivot = e.selectionReferencePivot() ?? e.getSelectionBounds()?.center
      if (!pivot) break
      e.rotateSelection(cmd === 'rotate90cw' ? 90 : -90, pivot)
      e.pushHistory('Rotate')
      e.stampSelectionFrame()
      break
    }
    case 'bringToFront':
      e.bringSelectionToFront()
      break
    case 'sendToBack':
      e.sendSelectionToBack()
      break
    case 'reverseOrder': {
      const n = e.reverseOrder()
      store.setStatusMessage(n > 0 ? `Reversed ${n} object${n === 1 ? '' : 's'}` : 'Need 2+ objects sharing a parent')
      break
    }
    case 'group':
      e.groupSelection()
      break
    case 'ungroup':
      e.ungroupSelection()
      break
    case 'ungroupAll': {
      const levels = e.ungroupAllSelected()
      store.setStatusMessage(levels > 0 ? `Ungrouped ${levels} level${levels === 1 ? '' : 's'}` : 'Select a group to ungroup')
      break
    }
    case 'newSublayer':
      if (!e.createSublayer()) {
        store.setStatusMessage('Cannot create sublayer here')
      }
      break
    case 'collect':
      if (!e.collectInNewLayer()) {
        store.setStatusMessage('Nothing to collect')
      }
      break
    case 'releaseLayers':
      if (!e.releaseToLayers()) {
        store.setStatusMessage('Select a group to release')
      }
      break
    case 'isolate': {
      const groups = e.getSelection().filter(
        (i) => i instanceof e.scope.Group && !(i.data as any)?.textMode
      )
      if (groups.length === 0 || !e.enterIsolation(groups[0] as paper.Group)) {
        store.setStatusMessage('Select a group to isolate')
      }
      break
    }
    case 'exitIsolation':
      e.exitIsolation()
      break
    case 'bringForward':
      e.bringForward()
      break
    case 'sendBackward':
      e.sendBackward()
      break
    case 'lock':
      e.setSelectedLocked(true)
      break
    case 'lockOthers': {
      const n = e.lockOthers()
      store.setStatusMessage(n > 0 ? `Locked ${n} other object${n === 1 ? '' : 's'} (Unlock All restores)` : 'Nothing else to lock')
      break
    }
    case 'unlockAll':
      e.unlockAll()
      break
    case 'hide':
      e.setSelectedVisible(false)
      break
    case 'showAll':
      e.showAll()
      break
    case 'isolateVisible': {
      const n = e.isolateVisible()
      store.setStatusMessage(n > 0 ? `Isolated ${n} hidden (Show All restores)` : 'Nothing to isolate')
      break
    }
    case 'sameFill': {
      const count = e.selectSame('fill')
      store.setStatusMessage(`Selected ${count} items with the same fill`)
      break
    }
    case 'sameStroke': {
      const count = e.selectSame('stroke')
      store.setStatusMessage(`Selected ${count} items with the same stroke`)
      break
    }
    case 'sameWidth': {
      const count = e.selectSame('strokeWidth')
      store.setStatusMessage(`Selected ${count} items with the same stroke width`)
      break
    }
    case 'sameOpacity': {
      const count = e.selectSame('opacity')
      store.setStatusMessage(`Selected ${count} items with the same opacity`)
      break
    }
    case 'sameBlend': {
      const count = e.selectSame('blendMode')
      store.setStatusMessage(`Selected ${count} items with the same blend mode`)
      break
    }
    case 'selectStrays': {
      const count = e.selectStrays()
      store.setStatusMessage(count > 0 ? `Selected ${count} stray point${count === 1 ? '' : 's'}` : 'No stray points found')
      break
    }
    case 'selectTexts': {
      const count = e.selectTextObjects()
      store.setStatusMessage(count > 0 ? `Selected ${count} text object${count === 1 ? '' : 's'}` : 'No text objects found')
      break
    }
    case 'sameFontFamily':
    case 'sameFontSize': {
      const count = e.selectSameTextFont(cmd === 'sameFontFamily' ? 'family' : 'size')
      store.setStatusMessage(count === 0 ? 'Select a text object first' : `Selected ${count} matching text item${count === 1 ? '' : 's'}`)
      break
    }
    case 'makeCompound':
      if (!e.makeCompoundPath()) {
        store.setStatusMessage('Compound needs at least two unlocked paths')
      }
      break
    case 'releaseCompound':
      if (!e.releaseCompoundPath()) {
        store.setStatusMessage('Select a compound path to release')
      }
      break
    case 'joinPaths': {
      // Direct-select endpoint join first (two sub-selected endpoints);
      // falls through to object join when there is no sub-selection.
      const sc = e.getController('direct-select') as {
        joinEndpointsFromSubselection?: () => boolean | null
      } | null
      const sub = sc?.joinEndpointsFromSubselection?.() ?? null
      if (sub === true) break
      if (sub === false) {
        store.setStatusMessage('Join needs two selected open endpoints')
        break
      }
      if (!e.joinPaths()) {
        store.setStatusMessage('Join needs exactly two unlocked open paths')
      }
      break
    }
    case 'outlineStroke':
      if (!e.outlineStroke()) {
        store.setStatusMessage('Outline needs a path with a stroke')
      }
      break
    case 'simplifyPath':
      if (e.simplifyPaths() === 0) {
        store.setStatusMessage('Nothing to simplify')
      }
      break
    case 'offsetPath':
      offsetVisible.value = true
      break
    case 'stepRepeat':
      repeatVisible.value = true
      break
    case 'radialRepeat':
      radialVisible.value = true
      break
    case 'splitGrid':
      gridSplitVisible.value = true
      break
    case 'gridRepeat':
      gridRepeatVisible.value = true
      break
    case 'blend':
      blendVisible.value = true
      break
    case 'addAnchors':
      if (e.addAnchorPoints() === 0) {
        store.setStatusMessage('Add Anchors needs a path selection')
      }
      break
    case 'roughen':
      roughenVisible.value = true
      break
    case 'reversePath':
      if (e.reversePaths() === 0) {
        store.setStatusMessage('Reverse needs a path selection')
      }
      break
    case 'cleanUp': {
      const n = e.cleanUp()
      store.setStatusMessage(n > 0 ? `Cleaned up ${n} stray item${n === 1 ? '' : 's'}` : 'Nothing to clean')
      break
    }
    case 'arrowheads':
      arrowVisible.value = true
      break
    case 'setDefaults':
      if (!e.setDefaultsFromSelection()) store.setStatusMessage('Nothing selected')
      break
    case 'clearAppearance':
      if (e.clearAppearance() === 0) store.setStatusMessage('Nothing to reset')
      break
    case 'rasterize':
      if (e && !e.rasterizeSelection()) {
        store.setStatusMessage('Rasterize needs unlocked artwork')
      }
      break
    case 'alignPixel': {
      const ratio = store.view.pixelRatio === 2 ? 2 : 1
      const n = e.alignSelectionToPixel(ratio)
      if (n > 0) e.pushHistory('Align to Pixel')
      else store.setStatusMessage('Already on pixel')
      break
    }
    case 'extractImage': {
      const hit = e.extractSelectedImage()
      if (!hit) {
        store.setStatusMessage('Extract needs a selected image')
        break
      }
      downloadHref(hit.url, hit.filename)
      store.setStatusMessage(`Extracted ${hit.filename}`)
      break
    }
    case 'adjustImage':
      imageVisible.value = true
      break
    case 'downsample':
      downsampleVisible.value = true
      break
    case 'adjustColors':
      recolorVisible.value = true
      break
    case 'closePath':
      if (e.setPathsClosed(true) === 0) {
        store.setStatusMessage('No open paths to close')
      }
      break
    case 'openPath':
      if (e.setPathsClosed(false) === 0) {
        store.setStatusMessage('No closed paths to open')
      }
      break
    case 'envArcUpper':
    case 'envArcLower':
    case 'envBulge':
    case 'envWave':
    case 'envFlag':
    case 'envFisheye':
    case 'envSqueeze':
    case 'envPinch':
    case 'envRise':
    case 'envFish': {
      const preset = (
        cmd === 'envArcUpper' ? 'arc-upper' :
        cmd === 'envArcLower' ? 'arc-lower' :
        cmd === 'envBulge' ? 'bulge' :
        cmd === 'envWave' ? 'wave' :
        cmd === 'envFlag' ? 'flag' :
        cmd === 'envFisheye' ? 'fisheye' :
        cmd === 'envPinch' ? 'pinch' :
        cmd === 'envRise' ? 'rise' :
        cmd === 'envFish' ? 'fish' : 'squeeze'
      ) as EnvelopePreset
      if (e.envelopeDistort(preset) === 0) {
        store.setStatusMessage('Envelope needs a path selection')
      }
      break
    }
    case 'makeMask':
      if (!e.makeClippingMask()) {
        store.setStatusMessage('Clipping needs art plus a path on top')
      }
      break
    case 'releaseMask':
      if (!e.releaseClippingMask()) {
        store.setStatusMessage('Select a clipping mask to release')
      }
      break
    case 'applyPattern': {
      const fallback = store.style.pattern ?? { kind: 'dots' as const, color: '#000000', background: '#ffffff', scale: 1, angle: 45 }
      if (e.applyPatternFill({ ...fallback }) === 0) {
        store.setStatusMessage('Pattern needs a path selection')
      }
      break
    }
    case 'removePattern':
      if (e.removePatternFill() === 0) {
        store.setStatusMessage('Select a pattern to remove')
      }
      break
    case 'flowText': {
      const tc = e.getController('type') as {
        selectedAreaItem?: () => any
        flowOverflowToNewFrame?: (item: any) => boolean
      } | null
      const area = tc?.selectedAreaItem?.() ?? null
      if (!area || !tc?.flowOverflowToNewFrame?.(area)) {
        store.setStatusMessage('Select an overflowing area text')
      }
      break
    }
    case 'unlinkText': {
      const n = e.unlinkTextFrames()
      store.setStatusMessage(n > 0 ? `Unlinked ${n} frame${n === 1 ? '' : 's'}` : 'No linked frames selected')
      break
    }
    case 'replaceImage': {
      if (!e) break
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/png,image/jpeg,image/webp,image/gif'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file || !e) return
        if (file.size > 15 * 1024 * 1024) {
          store.setStatusMessage('Image too large (15 MB max)')
          return
        }
        try {
          if (!e.replaceSelectedImage(await readFileAsDataURL(file))) {
            store.setStatusMessage('Select an image to replace')
          }
        } catch {
          store.setStatusMessage('Image replacement failed')
        }
      }
      input.click()
      break
    }
    case 'resetImage':
      if (!e.resetImage()) {
        store.setStatusMessage('No edited image selected')
      }
      break
  }
}
</script>

<style scoped>
/* Menu trigger shared with the bar (duplicated: scoped CSS does not cross
   the component boundary). */
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
</style>
