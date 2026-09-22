<template>
  <div class="top-bar">
    <div class="menus">
      <div class="app-title">Vector Editor{{ store.documentName ? ' — ' + store.documentName : '' }}</div>
      <div class="menu-group">
        <el-dropdown trigger="click" @command="onFileCmd" @visible-change="onFileMenuVisible">
          <span class="menu-label">File</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="new">New Document</el-dropdown-item>
              <el-dropdown-item command="open" divided>Open...</el-dropdown-item>
              <el-dropdown-item command="save">Save</el-dropdown-item>
              <el-dropdown-item command="saveAs">Save As...</el-dropdown-item>
              <el-dropdown-item
                v-for="(rf, i) in recentFiles"
                :key="rf.id"
                :command="'recent:' + rf.id"
                :divided="i === 0"
                :title="'Saved ' + new Date(rf.savedAt).toLocaleString()"
              >{{ rf.name }}</el-dropdown-item>
              <el-dropdown-item v-if="recentFiles.length > 0" command="clearRecent" divided>Clear Recent</el-dropdown-item>
              <el-dropdown-item command="export" divided>Export SVG</el-dropdown-item>
              <el-dropdown-item command="exportSelection" :disabled="!store.hasSelection">Export Selection SVG</el-dropdown-item>
              <el-dropdown-item command="exportBoardsSvg">Export Boards SVG</el-dropdown-item>
              <el-dropdown-item command="exportRaster">Export Raster...</el-dropdown-item>
              <el-dropdown-item command="exportBoardsPng">Export Boards PNG</el-dropdown-item>
              <el-dropdown-item command="exportBoards">Export Boards...</el-dropdown-item>
              <el-dropdown-item command="exportPdf">Export PDF (Raster)</el-dropdown-item>
              <el-dropdown-item command="exportBoardsPdf">Export All Boards PDF (Raster)</el-dropdown-item>
              <el-dropdown-item command="exportVectorPdf">Export PDF (Vector)</el-dropdown-item>
              <el-dropdown-item command="exportBoardsVectorPdf">Export All Boards PDF (Vector)</el-dropdown-item>
              <el-dropdown-item command="import">Import SVG...</el-dropdown-item>
              <el-dropdown-item command="importCdr">Import CDR...</el-dropdown-item>
              <el-dropdown-item command="openCdr">Open CDR...</el-dropdown-item>
              <el-dropdown-item command="place">Place Image...</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <EditMenu />

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

    <!-- Raster Export Dialog -->
    <AppDialog
      v-model="exportVisible"
      title="Export Raster"
      :width="420"
      confirm-text="Export"
      cancel-text="Cancel"
      @confirm="onExportRasterConfirm"
      @cancel="exportVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-section">
          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Format</span>
            </div>
            <el-select v-model="exportForm.format" size="small" style="width: 120px">
              <el-option v-for="f in EXPORT_FORMATS" :key="f.value" :label="f.label" :value="f.value" />
            </el-select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Scale</span>
            </div>
            <el-select v-model="exportForm.scale" size="small" style="width: 120px">
              <el-option v-for="s in EXPORT_SCALES" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
          </div>

          <div v-if="exportForm.format !== 'png'" class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Quality</span>
            </div>
            <el-select v-model="exportForm.quality" size="small" style="width: 120px">
              <el-option v-for="q in EXPORT_QUALITIES" :key="q.value" :label="q.label" :value="q.value" />
            </el-select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Area</span>
            </div>
            <el-radio-group v-model="exportForm.area" size="small">
              <el-radio-button value="artwork">All artwork</el-radio-button>
              <el-radio-button value="selection" :disabled="!store.hasSelection">Selection</el-radio-button>
              <el-radio-button value="page">Page</el-radio-button>
            </el-radio-group>
          </div>
        </div>
      </div>
    </AppDialog>

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

    <!-- Save As Dialog (custom project filename) -->
    <AppDialog
      v-model="saveVisible"
      title="Save As"
      :width="360"
      confirm-text="Save"
      cancel-text="Cancel"
      @confirm="onSaveConfirm"
      @cancel="saveVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Filename</span>
            <span class="setting-desc">Saved as .vec.json</span>
          </div>
          <el-input v-model="saveName" size="small" placeholder="project" />
        </div>
      </div>
    </AppDialog>

    <!-- Boards Export Dialog (Export-for-Screens parity: pick boards + format) -->
    <AppDialog
      v-model="boardsVisible"
      title="Export Boards"
      :width="420"
      confirm-text="Export"
      cancel-text="Cancel"
      @confirm="onBoardsExportConfirm"
      @cancel="boardsVisible = false"
    >
      <div class="settings-body app-settings">
        <div class="setting-section">
          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Format</span>
            </div>
            <el-select v-model="boardsForm.format" size="small" style="width: 110px">
              <el-option value="png" label="PNG" />
              <el-option value="jpeg" label="JPEG" />
              <el-option value="svg" label="SVG" />
              <el-option value="pdf" label="PDF" />
            </el-select>
            <el-select v-if="boardsForm.format !== 'svg'" v-model="boardsForm.scale" size="small" style="width: 80px" title="Raster scale">
              <el-option :value="1" label="1x" />
              <el-option :value="2" label="2x" />
              <el-option :value="3" label="3x" />
            </el-select>
          </div>
          <div v-if="boardsForm.format === 'jpeg'" class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Quality</span>
            </div>
            <el-select v-model="boardsForm.quality" size="small" style="width: 110px">
              <el-option v-for="q in EXPORT_QUALITIES" :key="q.value" :label="q.label" :value="q.value" />
            </el-select>
          </div>
          <div class="setting-row">
            <el-button size="small" @click="boardsCheckAll(true)">All</el-button>
            <el-button size="small" @click="boardsCheckAll(false)">None</el-button>
          </div>
          <div v-for="b in store.artboards" :key="b.id" class="setting-row">
            <el-checkbox :model-value="boardsForm.checked.includes(b.id)" @change="() => boardsToggle(b.id)">
              {{ b.name }} ({{ Math.round(b.width) }}x{{ Math.round(b.height) }})
            </el-checkbox>
          </div>
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
import { ref, reactive, computed, inject, watch, onMounted, type Ref } from 'vue'
import { QuestionFilled } from '@element-plus/icons-vue'
// JSZip stays out of the main bundle: multi-board exports load it on demand
// (same pattern as the jspdf/svg2pdf dynamic imports below).
import AppDialog from '../ui/AppDialog.vue'
import EditMenu from './EditMenu.vue'
import ViewMenu from './ViewMenu.vue'
import { clearRecentProjects, listRecentProjects, loadRecentProjectText } from '../../editor/recent-files'
import { useEditorStore } from '../../editor/store'
import { withBusy, yieldToUI } from '../../editor/busy'
import {
  defaultBoardsExport,
  EXPORT_FORMATS,
  EXPORT_QUALITIES,
  EXPORT_SCALES,
  rasterFailText,
  resolveBoardsToExport,
  sanitizeBoardsExport,
  sanitizeExportForm,
  selectableBoardIds,
} from '../../editor/topbar-dialogs'
import type { EditorEngine } from '../../editor/engine'
import type { RulerUnit, RasterExportFormat, RasterExportArea, EnvelopePreset } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const exportVisible = ref(false)

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

// Store-backed so the Ctrl+Shift+S shortcut can open the same dialog.
const saveVisible = computed<boolean>({
  get: () => store.ui.saveDialogOpen,
  set: (v) => store.setSaveDialogOpen(v),
})
const saveName = ref('project')
function onSaveConfirm() {
  const e = engineRef?.value
  if (!e) {
    saveVisible.value = false
    return
  }
  try {
    e.downloadProjectFile(saveName.value)
  } catch {
    store.setStatusMessage('Project save failed')
  }
  saveVisible.value = false
}

const boardsVisible = ref(false)
const boardsForm = reactive({
  ...defaultBoardsExport(),
  checked: [] as string[],
})
try {
  const raw = localStorage.getItem('vve.boardsExport')
  if (raw) Object.assign(boardsForm, sanitizeBoardsExport(JSON.parse(raw)))
} catch { /* private mode: defaults stand */ }

function openBoardsExport() {
  boardsForm.checked = selectableBoardIds(store.artboards)
  boardsVisible.value = true
}
function boardsToggle(id: string) {
  boardsForm.checked = boardsForm.checked.includes(id)
    ? boardsForm.checked.filter((x) => x !== id)
    : [...boardsForm.checked, id]
}
function boardsCheckAll(on: boolean) {
  boardsForm.checked = on ? selectableBoardIds(store.artboards) : []
}
async function onBoardsExportConfirm() {
  const e = engineRef?.value
  if (!e) {
    boardsVisible.value = false
    return
  }
  const boards = resolveBoardsToExport(store.artboards, boardsForm.checked)
  if (boards.length === 0) {
    store.setStatusMessage('Tick at least one artboard')
    return
  }
  try {
    localStorage.setItem(
      'vve.boardsExport',
      JSON.stringify({ format: boardsForm.format, scale: boardsForm.scale, quality: boardsForm.quality })
    )
  } catch { /* private mode */ }
  const previousActive = store.activeArtboardId
  const useZip = boards.length > 1
  const zip = useZip ? new (await import('jszip')).default() : null
  try {
    if (boardsForm.format === 'pdf') {
      const { jsPDF } = await import('jspdf')
      let painted = 0
      for (const board of boards) {
        store.setActiveArtboard(board.id)
        const dataUrl = e.exportRaster({ format: 'png', scale: boardsForm.scale, area: 'page' })
        if (!dataUrl) continue
        const doc = new jsPDF({
          orientation: board.width >= board.height ? 'landscape' : 'portrait',
          unit: 'pt',
          format: [board.width, board.height],
          compress: true,
        })
        doc.addImage(dataUrl, 'PNG', 0, 0, board.width, board.height)
        const filename = `${board.name || 'artboard'}.pdf`
        if (zip) {
          zip.file(filename, doc.output('blob'))
        } else {
          doc.save(filename)
        }
        painted++
      }
      if (zip && painted > 0) {
        const blob = await zip.generateAsync({ type: 'blob' })
        downloadHref(URL.createObjectURL(blob), 'boards-export.zip')
      }
      store.setStatusMessage(painted > 0 ? `Exported ${painted} board PDF${painted === 1 ? '' : 's'}` : 'Board export failed')
    } else if (boardsForm.format === 'svg') {
      let painted = 0
      for (const board of boards) {
        const svg = e.exportBoardVectorSVG(board, { bleed: 0, marks: false })
        if (!svg) continue
        const str = new XMLSerializer().serializeToString(svg)
        const filename = `${board.name || 'artboard'}.svg`
        if (zip) {
          zip.file(filename, str)
        } else {
          downloadHref(URL.createObjectURL(new Blob([str], { type: 'image/svg+xml' })), filename)
        }
        painted++
      }
      if (zip && painted > 0) {
        const blob = await zip.generateAsync({ type: 'blob' })
        downloadHref(URL.createObjectURL(blob), 'boards-export.zip')
      }
      store.setStatusMessage(painted > 0 ? `Exported ${painted} board SVG${painted === 1 ? '' : 's'}` : 'Board export failed')
    } else {
      let painted = 0
      let skipped = 0
      for (const board of boards) {
        store.setActiveArtboard(board.id)
        const dataUrl = e.exportRaster({
          format: boardsForm.format as 'png' | 'jpeg',
          scale: boardsForm.scale,
          area: 'page',
          quality: boardsForm.quality,
        })
        if (!dataUrl) {
          skipped++
          continue
        }
        const filename = `${board.name || 'artboard'}.${boardsForm.format}`
        if (zip) {
          // Convert data URL to blob for ZIP storage.
          const res = await fetch(dataUrl)
          const blob = await res.blob()
          zip.file(filename, blob)
        } else {
          downloadHref(dataUrl, filename)
        }
        painted++
      }
      if (zip && painted > 0) {
        const blob = await zip.generateAsync({ type: 'blob' })
        downloadHref(URL.createObjectURL(blob), 'boards-export.zip')
      }
      store.setStatusMessage(
        painted === 0
          ? 'Board export failed'
          : skipped > 0
            ? `Exported ${painted} of ${boards.length} boards (${skipped} too large)`
            : `Exported ${painted} of ${boards.length} boards`
      )
    }
  } finally {
    store.setActiveArtboard(previousActive)
    e.refreshArtboards()
  }
  boardsVisible.value = false
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

const exportForm = reactive({
  format: 'png' as RasterExportFormat,
  scale: 2,
  area: 'artwork' as RasterExportArea,
  quality: 0.92,
})
try {
  const raw = localStorage.getItem('vve.export')
  if (raw) Object.assign(exportForm, sanitizeExportForm(JSON.parse(raw)))
} catch { /* private mode: defaults stand */ }
function persistExportForm() {
  try {
    localStorage.setItem('vve.export', JSON.stringify(exportForm))
  } catch { /* private mode */ }
}

/**
 * Return keyboard focus to the document after a menu command. Element Plus
 * leaves focus on the dropdown trigger, and a later Space would re-open
 * the menu instead of parking the hand tool for canvas drag.
 */
function blurMenuFocus() {
  const ae = document.activeElement as HTMLElement | null
  if (ae && ae !== document.body && typeof ae.blur === 'function') ae.blur()
}

/**
 * Guard destructive document switches (New/Open replace the scene).
 * Clean documents pass silently; dirty ones need an explicit confirm.
 */
function confirmDiscard(): boolean {
  if (!store.hasUnsavedChanges) return true
  try {
    return window.confirm('Discard unsaved changes?')
  } catch {
    return true
  }
}

// File > Recent: loaded when the menu opens (and once at startup).
const recentFiles = ref<Array<{ id: string; name: string; savedAt: number }>>([])
async function refreshRecentFiles() {
  try {
    recentFiles.value = await listRecentProjects()
  } catch {
    recentFiles.value = []
  }
}
function onFileMenuVisible(visible: boolean) {
  if (visible) void refreshRecentFiles()
}
onMounted(() => {
  void refreshRecentFiles()
})

watch(() => store.documentName, (name) => {
  document.title = name ? `Vue Vector Editor — ${name}` : 'Vue Vector Editor'
})

async function onFileCmd(cmd: string) {
  blurMenuFocus()
  const e = engineRef?.value
  if (cmd === 'clearRecent') {
    await clearRecentProjects()
    recentFiles.value = []
    store.setStatusMessage('Recent files cleared')
    return
  }
  if (cmd.startsWith('recent:')) {
    if (!confirmDiscard()) return
    if (!e) return
    try {
      const meta = recentFiles.value.find((r) => r.id === cmd.slice(7))
      await withBusy(store, `Opening ${meta?.name ?? 'project'}…`, async (report) => {
        const text = await loadRecentProjectText(cmd.slice(7))
        if (!text) throw new Error('That recent file is gone (cleared or overwritten)')
        report(0.4, 'Opening project…')
        await yieldToUI()
        e.importProjectFile(text)
      })
      store.setDocumentName(meta?.name ?? '')
      store.setStatusMessage('Project opened')
    } catch (err) {
      store.setStatusMessage(err instanceof Error ? err.message : 'Project open failed')
    }
    return
  }
  switch (cmd) {
    case 'new': {
      if (!confirmDiscard()) break
      store.setDocumentName('')
      // New documents inherit the active artboard size (what Canvas
      // Settings shows), not the stale pageSize default from an old file.
      const board = store.activeArtboard
      const width = board?.width ?? store.pageSize.width
      const height = board?.height ?? store.pageSize.height
      if (e) {
        e.newDocument(width, height)
        store.setStatusMessage('New document')
      } else {
        store.setPageSize(width, height)
      }
      break
    }
    case 'save': {
      if (!e) break
      try {
        e.downloadProjectFile()
      } catch (err) {
        store.setStatusMessage('Project save failed')
      }
      break
    }
    case 'saveAs':
      // Seed the pristine default from the active board (desktop editors
      // name the file after the document); keep a user-chosen name.
      if (saveName.value === 'project' || !saveName.value.trim()) {
        saveName.value = (store.activeArtboard?.name ?? 'project')
          .replace(/[\/:*?"<>|]+/g, '-')
          .slice(0, 80) || 'project'
      }
      saveVisible.value = true
      break
    case 'open': {
      if (!e) break
      if (!confirmDiscard()) break
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,.vec.json,.cdr,application/json'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file || !e) return
        try {
          if (/\.cdr$/i.test(file.name)) {
            const result = await withBusy(store, `Opening ${file.name}…`, async (report) => {
              const bytes = new Uint8Array(await file.arrayBuffer())
              return e.openCdrBytes(bytes, file.name, report)
            })
            const warn = result.warnings.length ? ` (${result.warnings.length} warnings)` : ''
            const skipped = result.skippedPages > 0 ? `, ${result.skippedPages} skipped` : ''
            store.setStatusMessage(`CDR opened: ${result.pages} page${result.pages > 1 ? 's' : ''}${skipped}${warn}`)
            if (result.warnings.length) console.warn('[CDR open warnings]', result.warnings)
          } else {
            await withBusy(store, `Opening ${file.name}…`, async (report) => {
              const text = await file.text()
              report(0.4, 'Opening project…')
              await yieldToUI()
              e.importProjectFile(text)
            })
            store.setStatusMessage('Project opened')
          }
        } catch (err) {
          store.setStatusMessage(err instanceof Error ? err.message : 'Project open failed')
        }
      }
      input.click()
      break
    }
    case 'exportRaster':
      if (exportForm.area === 'selection' && !store.hasSelection) {
        exportForm.area = 'artwork'
      }
      exportVisible.value = true
      break
    case 'exportBoardsPng':
      void onExportBoardsPng()
      break
    case 'exportBoards':
      openBoardsExport()
      break
    case 'exportPdf':
      void onExportPdf()
      break
    case 'exportBoardsPdf':
      void onExportBoardsPdf()
      break
    case 'exportVectorPdf':
      void onExportVectorPdf()
      break
    case 'exportBoardsVectorPdf':
      void onExportBoardsVectorPdf()
      break
    case 'export':
      if (e) {
        // Temporarily hide non-user layers (grid / overlay / annotation / guides)
        // so they do not leak into the exported SVG.
        const hiddenLayers: any[] = []
        for (const layer of e.project.layers) {
          if (!(layer as any).data?.isUserLayer && layer.visible) {
            layer.visible = false
            hiddenLayers.push(layer)
          }
        }
        e.scope.view.update()

        try {
          const result = e.project.exportSVG({ asString: true })
          const svgStr = typeof result === 'string' ? result : String(result)
          const blob = new Blob([svgStr], { type: 'image/svg+xml' })
          const url = URL.createObjectURL(blob)
          downloadHref(url, 'export.svg')
          store.setStatusMessage('SVG exported')
        } finally {
          // Restore layer visibility
          hiddenLayers.forEach((layer) => {
            layer.visible = true
          })
          e.scope.view.update()
        }
      }
      break
    case 'exportSelection': {
      if (!e) break
      const svg = e.exportSelectionSVG()
      if (!svg) {
        store.setStatusMessage('Nothing selected to export')
        break
      }
      const blob = new Blob([svg], { type: 'image/svg+xml' })
      const url = URL.createObjectURL(blob)
      downloadHref(url, 'selection.svg')
      store.setStatusMessage('Selection exported')
      break
    }
    case 'exportBoardsSvg': {
      if (!e) break
      const boards = store.artboards.filter((b) => b.width > 0 && b.height > 0)
      if (boards.length === 0) {
        store.setStatusMessage('Nothing to export')
        break
      }
      let painted = 0
      for (const board of boards) {
        const svg = e.exportBoardVectorSVG(board, { bleed: 0, marks: false })
        if (!svg) continue
        const str = new XMLSerializer().serializeToString(svg)
        const blob = new Blob([str], { type: 'image/svg+xml' })
        const url = URL.createObjectURL(blob)
        downloadHref(url, `${board.name || 'artboard'}.svg`)
        painted++
      }
      store.setStatusMessage(
        painted > 0 ? `Exported ${painted} of ${boards.length} boards` : 'Board export failed'
      )
      break
    }
    case 'import': {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.svg'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (file && e) {
          try {
            const ok = await withBusy(store, `Importing ${file.name}…`, async (report) => {
              const text = await file.text()
              report(0.4, 'Importing SVG…')
              await yieldToUI()
              return e.importSVGText(text, 'Import SVG')
            })
            if (ok) {
              store.setStatusMessage('SVG imported')
            } else {
              store.setStatusMessage('SVG import failed')
            }
          } catch (err) {
            store.setStatusMessage('SVG import failed')
          }
        }
      }
      input.click()
      break
    }
    case 'importCdr': {
      if (!e) break
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.cdr'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file || !e) return
        try {
          const result = await withBusy(store, `Importing ${file.name}…`, async (report) => {
            const bytes = new Uint8Array(await file.arrayBuffer())
            return e.importCdrBytes(bytes, file.name, report)
          })
          const warn = result.warnings.length ? ` (${result.warnings.length} warnings)` : ''
          const skipped = result.skippedPages > 0 ? `, ${result.skippedPages} skipped` : ''
          store.setStatusMessage(
            result.pages > 0
              ? `CDR imported: ${result.pages} page${result.pages > 1 ? 's' : ''}${skipped}${warn}`
              : 'CDR import failed'
          )
          if (result.warnings.length) console.warn('[CDR import warnings]', result.warnings)
        } catch (err) {
          store.setStatusMessage(err instanceof Error ? err.message : 'CDR import failed')
        }
      }
      input.click()
      break
    }
    case 'openCdr': {
      if (!e) break
      if (!confirmDiscard()) break
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.cdr'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file || !e) return
        try {
          const result = await withBusy(store, `Opening ${file.name}…`, async (report) => {
            const bytes = new Uint8Array(await file.arrayBuffer())
            return e.openCdrBytes(bytes, file.name, report)
          })
          const warn = result.warnings.length ? ` (${result.warnings.length} warnings)` : ''
          const skipped = result.skippedPages > 0 ? `, ${result.skippedPages} skipped` : ''
          store.setStatusMessage(
            `CDR opened: ${result.pages} page${result.pages > 1 ? 's' : ''}${skipped}${warn}`
          )
          if (result.warnings.length) console.warn('[CDR open warnings]', result.warnings)
        } catch (err) {
          store.setStatusMessage(err instanceof Error ? err.message : 'CDR open failed')
        }
      }
      input.click()
      break
    }
    case 'place': {
      if (!e) break
      // SVG joins bitmaps here (matching canvas drag-drop); the separate
      // Import SVG menu item stays for discoverability.
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.svg,image/png,image/jpeg,image/webp,image/gif'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file || !e) return
        if (file.size > 15 * 1024 * 1024) {
          store.setStatusMessage('File too large (15 MB max)')
          return
        }
        try {
          if (/\.svg$/i.test(file.name) || file.type === 'image/svg+xml') {
            const ok = await withBusy(store, `Placing ${file.name}…`, async (report) => {
              const text = await file.text()
              report(0.4, 'Placing SVG…')
              await yieldToUI()
              return e.importSVGText(text, 'Place SVG')
            })
            if (ok) {
              store.setStatusMessage('SVG placed')
            } else {
              store.setStatusMessage('SVG placement failed')
            }
          } else {
            await withBusy(store, `Placing ${file.name}…`, async () => {
              e.placeImage(await readFileAsDataURL(file))
            })
            store.setStatusMessage('Image placed')
          }
        } catch (err) {
          store.setStatusMessage('File placement failed')
        }
      }
      input.click()
      break
    }
  }
}

/**
 * Trigger a download that also works in Firefox (the anchor must be in the
 * DOM when clicked) and keeps the object URL alive until the download
 * starts instead of revoking it synchronously.
 */
function downloadHref(href: string, filename: string) {
  const a = document.createElement('a')
  a.href = href
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  if (href.startsWith('blob:')) {
    setTimeout(() => URL.revokeObjectURL(href), 4000)
  }
}

/** Read a file as a data URL (embeddable, unlike object URLs). */
function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function onExportRasterConfirm() {
  const e = engineRef?.value
  if (!e) {
    exportVisible.value = false
    return
  }
  if (exportForm.area === 'selection' && !store.hasSelection) {
    store.setStatusMessage('Nothing selected to export')
    return
  }
  try {
    const dataUrl = e.exportRaster({
      format: exportForm.format,
      scale: exportForm.scale,
      area: exportForm.area,
      quality: exportForm.quality,
    })
    if (!dataUrl) {
      store.setStatusMessage(
        rasterFailText(e.estimateRasterSize(exportForm.area, exportForm.scale)) ?? 'Raster export failed'
      )
      return
    }
    downloadHref(dataUrl, `export.${exportForm.format}`)
    exportVisible.value = false
    persistExportForm()
    store.setStatusMessage(`Raster exported (${exportForm.format.toUpperCase()} ${exportForm.scale}x)`)
  } catch (err) {
    store.setStatusMessage('Raster export failed')
  }
}

/**
 * Export the active artboard as PDF (2x board raster embedded full-bleed).
 * The jsPDF orientation matches the board aspect so the page keeps the
 * exact board dimensions.
 */
async function onExportPdf() {
  const e = engineRef?.value
  if (!e) return
  const board = store.activeArtboard ?? store.artboards[0]
  if (!board || board.width < 1 || board.height < 1) {
    store.setStatusMessage('Nothing to export')
    return
  }
  try {
    const dataUrl = e.exportRaster({ format: 'png', scale: 2, area: 'page' })
    if (!dataUrl) {
      const size = e.estimateRasterSize('page', 2)
      store.setStatusMessage(
        size && (size.width > 16384 || size.height > 16384)
          ? `Board too large for raster PDF (${size.width}x${size.height}px) — try Vector PDF`
          : 'PDF export failed'
      )
      return
    }
    const { jsPDF } = await import('jspdf')
    const doc = new jsPDF({
      orientation: board.width >= board.height ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [board.width, board.height],
      compress: true,
    })
    doc.addImage(dataUrl, 'PNG', 0, 0, board.width, board.height)
    doc.save('export.pdf')
    store.setStatusMessage('PDF exported')
  } catch (err) {
    store.setStatusMessage('PDF export failed')
  }
}

/**
 * Export every artboard as a 2x PNG. A single board downloads directly;
 * multiple boards are zipped into one file so the browser cannot block
 * the second and later downloads of the same gesture. The active board
 * is restored afterwards.
 */
async function onExportBoardsPng() {
  const e = engineRef?.value
  if (!e) return
  const boards = store.artboards.filter((b) => b.width > 0 && b.height > 0)
  if (boards.length === 0) {
    store.setStatusMessage('Nothing to export')
    return
  }
  const previousActive = store.activeArtboardId
  const zip = boards.length > 1 ? new (await import('jszip')).default() : null
  try {
    let painted = 0
    let skipped = 0
    for (const board of boards) {
      store.setActiveArtboard(board.id)
      const dataUrl = e.exportRaster({ format: 'png', scale: 2, area: 'page' })
      if (!dataUrl) {
        skipped++
        continue
      }
      const filename = `${board.name || 'artboard'}.png`
      if (zip) {
        // A data URL cannot go into a ZIP entry directly; fetch it as a blob first.
        const res = await fetch(dataUrl)
        zip.file(filename, await res.blob())
      } else {
        downloadHref(dataUrl, filename)
      }
      painted++
    }
    if (zip && painted > 0) {
      const blob = await zip.generateAsync({ type: 'blob' })
      downloadHref(URL.createObjectURL(blob), 'boards-export.zip')
    }
    store.setStatusMessage(
      painted === 0
        ? 'Board export failed'
        : skipped > 0
          ? `Exported ${painted} of ${boards.length} boards (${skipped} too large)`
          : `Exported ${painted} of ${boards.length} boards`
    )
  } finally {
    store.setActiveArtboard(previousActive)
    e.refreshArtboards()
  }
}

async function onExportBoardsPdf() {  const e = engineRef?.value
  if (!e) return
  const boards = store.artboards.filter((b) => b.width > 0 && b.height > 0)
  if (boards.length === 0) {
    store.setStatusMessage('Nothing to export')
    return
  }
  const previousActive = store.activeArtboardId
  try {
    const { jsPDF } = await import('jspdf')
    let doc = null as InstanceType<typeof jsPDF> | null
    let painted = 0
    let skipped = 0
    for (const board of boards) {
      store.setActiveArtboard(board.id)
      const dataUrl = e.exportRaster({ format: 'png', scale: 2, area: 'page' })
      if (!dataUrl) {
        skipped++
        continue
      }
      const orientation = board.width >= board.height ? 'landscape' : 'portrait'
      if (!doc) {
        doc = new jsPDF({ orientation, unit: 'pt', format: [board.width, board.height], compress: true })
      } else {
        doc.addPage([board.width, board.height], orientation)
      }
      doc.addImage(dataUrl, 'PNG', 0, 0, board.width, board.height)
      painted++
    }
    if (!doc || painted === 0) {
      store.setStatusMessage('PDF export failed')
      return
    }
    doc.save('export-boards.pdf')
    store.setStatusMessage(
      skipped > 0
        ? `PDF exported (${painted} of ${boards.length} boards, ${skipped} too large)`
        : `PDF exported (${painted} of ${boards.length} boards)`
    )
  } catch (err) {
    store.setStatusMessage('PDF export failed')
  } finally {
    store.setActiveArtboard(previousActive)
    e.refreshArtboards()
  }
}

/**
 * Export the active artboard as a vector PDF (paths/text stay selectable;
 * fonts are referenced, not embedded — stick to standard families for
 * fidelity). The page grows by the document bleed with crop marks at the
 * trim corners. Falls back to the raster PDF when vector rendering fails.
 */
async function onExportVectorPdf() {
  const e = engineRef?.value
  if (!e) return
  const board = store.activeArtboard ?? store.artboards[0]
  if (!board || board.width < 1 || board.height < 1) {
    store.setStatusMessage('Nothing to export')
    return
  }
  try {
    const bleed = Number(store.bleed) || 0
    const svg = e.exportBoardVectorSVG(board, { bleed, marks: true })
    if (!svg) {
      store.setStatusMessage('PDF export failed')
      return
    }
    const pageWidth = board.width + bleed * 2
    const pageHeight = board.height + bleed * 2
    const { jsPDF } = await import('jspdf')
    const { svg2pdf } = await import('svg2pdf.js')
    const doc = new jsPDF({
      orientation: pageWidth >= pageHeight ? 'landscape' : 'portrait',
      unit: 'pt',
      format: [pageWidth, pageHeight],
      compress: true,
    })
    // Embed registered fonts into the PDF
    await e.applyFontsToPdf(doc)
    await svg2pdf(svg, doc, { x: 0, y: 0, width: pageWidth, height: pageHeight })
    doc.save('export-vector.pdf')
    store.setStatusMessage(bleed > 0 ? `Vector PDF exported (bleed ${bleed})` : 'Vector PDF exported')
  } catch (err) {
    store.setStatusMessage('Vector PDF failed, use PDF (Raster)')
  }
}

/**
 * Export every artboard as one vector PDF page each (one-up imposition:
 * every board is its own page). Boards keep their own page sizes plus the
 * shared bleed; registered fonts are embedded.
 */
async function onExportBoardsVectorPdf() {
  const e = engineRef?.value
  if (!e) return
  const boards = store.artboards.filter((b) => b.width > 0 && b.height > 0)
  if (boards.length === 0) {
    store.setStatusMessage('Nothing to export')
    return
  }
  try {
    const bleed = Number(store.bleed) || 0
    const { jsPDF } = await import('jspdf')
    const { svg2pdf } = await import('svg2pdf.js')
    let doc = null as InstanceType<typeof jsPDF> | null
    let painted = 0
    for (const board of boards) {
      const svg = e.exportBoardVectorSVG(board, { bleed, marks: true })
      if (!svg) continue
      const pageWidth = board.width + bleed * 2
      const pageHeight = board.height + bleed * 2
      const orientation = pageWidth >= pageHeight ? 'landscape' : 'portrait'
      if (!doc) {
        doc = new jsPDF({ orientation, unit: 'pt', format: [pageWidth, pageHeight], compress: true })
        // Embed registered fonts into the PDF
        await e.applyFontsToPdf(doc)
      } else {
        doc.addPage([pageWidth, pageHeight], orientation)
      }
      await svg2pdf(svg, doc, { x: 0, y: 0, width: pageWidth, height: pageHeight })
      painted++
    }
    if (!doc || painted === 0) {
      store.setStatusMessage('PDF export failed')
      return
    }
    doc.save('export-boards-vector.pdf')
    store.setStatusMessage(`Vector PDF exported (${painted} of ${boards.length} boards)`)
  } catch (err) {
    store.setStatusMessage('Vector PDF failed, use PDF (Raster)')
  }
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

.top-right {
  display: flex;
  align-items: center;
  gap: 4px;
}

.page-size-inputs {
  display: flex;
  align-items: center;
  gap: 4px;
}

.page-size-inputs .el-input-number {
  width: 90px;
}

.preflight-row {
  align-items: flex-start;
  gap: 8px;
}
.preflight-row.clickable {
  cursor: pointer;
}
.preflight-row.clickable:hover .setting-desc {
  color: #d5d5d5;
}
.preflight-row .setting-desc {
  flex: 1;
  margin-top: 0;
  line-height: 1.5;
}
</style>
