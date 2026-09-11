<template>
  <div class="top-bar">
    <div class="menus">
      <div class="app-title">Vector Editor</div>
      <div class="menu-group">
        <el-dropdown trigger="click" @command="onFileCmd">
          <span class="menu-label">File</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="new">New Document</el-dropdown-item>
              <el-dropdown-item command="open" divided>Open...</el-dropdown-item>
              <el-dropdown-item command="save">Save</el-dropdown-item>
              <el-dropdown-item command="saveAs">Save As...</el-dropdown-item>
              <el-dropdown-item command="export" divided>Export SVG</el-dropdown-item>
              <el-dropdown-item command="exportSelection" :disabled="!store.hasSelection">Export Selection SVG</el-dropdown-item>
              <el-dropdown-item command="exportBoardsSvg">Export Boards SVG</el-dropdown-item>
              <el-dropdown-item command="exportRaster">Export Raster...</el-dropdown-item>
              <el-dropdown-item command="exportBoardsPng">Export Boards PNG</el-dropdown-item>
              <el-dropdown-item command="exportPdf">Export PDF (Raster)</el-dropdown-item>
              <el-dropdown-item command="exportBoardsPdf">Export All Boards PDF (Raster)</el-dropdown-item>
              <el-dropdown-item command="exportVectorPdf">Export PDF (Vector)</el-dropdown-item>
              <el-dropdown-item command="exportBoardsVectorPdf">Export All Boards PDF (Vector)</el-dropdown-item>
              <el-dropdown-item command="import">Import SVG...</el-dropdown-item>
              <el-dropdown-item command="place">Place Image...</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-dropdown trigger="click" @command="onEditCmd">
          <span class="menu-label">Edit</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="undo" :disabled="!store.canUndo">Undo</el-dropdown-item>
              <el-dropdown-item command="redo" :disabled="!store.canRedo">Redo</el-dropdown-item>
              <el-dropdown-item command="cut" divided :disabled="!store.hasSelection">Cut</el-dropdown-item>
              <el-dropdown-item command="copy" :disabled="!store.hasSelection">Copy</el-dropdown-item>
              <el-dropdown-item command="copySVG" :disabled="!store.hasSelection">Copy as SVG</el-dropdown-item>
              <el-dropdown-item command="copyPNG" :disabled="!store.hasSelection">Copy as PNG</el-dropdown-item>
              <el-dropdown-item command="paste">Paste</el-dropdown-item>
              <el-dropdown-item command="pasteFront">Paste in Front</el-dropdown-item>
              <el-dropdown-item command="pasteBack">Paste in Back</el-dropdown-item>
              <el-dropdown-item command="pasteBoards">Paste on All Artboards</el-dropdown-item>
              <el-dropdown-item command="duplicate">Duplicate In Place</el-dropdown-item>
              <el-dropdown-item command="delete" divided :disabled="!store.hasSelection">Delete</el-dropdown-item>
              <el-dropdown-item command="selectAll" divided>Select All</el-dropdown-item>
              <el-dropdown-item command="invertSelection">Invert Selection</el-dropdown-item>
              <el-dropdown-item command="reselect" :disabled="store.lastSelection.length === 0">Reselect</el-dropdown-item>
              <el-dropdown-item command="saveSelection" :disabled="!store.hasSelection">Save Selection...</el-dropdown-item>
              <el-dropdown-item command="findReplace" divided>Find &amp; Replace...</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-dropdown trigger="click" @command="onObjectCmd">
          <span class="menu-label">Object</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="transform" :disabled="!store.hasSelection">Transform</el-dropdown-item>
              <el-dropdown-item command="bringToFront" :disabled="!store.hasSelection">Bring to Front</el-dropdown-item>
              <el-dropdown-item command="bringForward" :disabled="!store.hasSelection">Bring Forward</el-dropdown-item>
              <el-dropdown-item command="sendBackward" :disabled="!store.hasSelection">Send Backward</el-dropdown-item>
              <el-dropdown-item command="sendToBack" :disabled="!store.hasSelection">Send to Back</el-dropdown-item>
              <el-dropdown-item command="group" divided :disabled="!store.hasSelection">Group</el-dropdown-item>
              <el-dropdown-item command="ungroup" :disabled="!store.hasSelection">Ungroup</el-dropdown-item>
              <el-dropdown-item command="newSublayer">New Sublayer</el-dropdown-item>
              <el-dropdown-item command="collect" :disabled="!store.hasSelection">Collect in New Layer</el-dropdown-item>
              <el-dropdown-item command="releaseLayers" :disabled="!store.hasSelection">Release to Layers</el-dropdown-item>
              <el-dropdown-item command="isolate" :disabled="!store.hasSelection">Isolate</el-dropdown-item>
              <el-dropdown-item command="exitIsolation" :disabled="!store.isolationActive">Exit Isolation</el-dropdown-item>
              <el-dropdown-item command="makeCompound" divided :disabled="!store.hasSelection">Make Compound Path</el-dropdown-item>
              <el-dropdown-item command="releaseCompound" :disabled="!store.hasSelection">Release Compound Path</el-dropdown-item>
              <el-dropdown-item command="joinPaths" :disabled="!store.hasSelection">Join Paths</el-dropdown-item>
              <el-dropdown-item command="outlineStroke" :disabled="!store.hasSelection">Outline Stroke</el-dropdown-item>
              <el-dropdown-item command="offsetPath" :disabled="!store.hasSelection">Offset Path...</el-dropdown-item>
              <el-dropdown-item command="stepRepeat" :disabled="!store.hasSelection">Step and Repeat...</el-dropdown-item>
              <el-dropdown-item command="radialRepeat" :disabled="!store.hasSelection">Radial Repeat...</el-dropdown-item>
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
              <el-dropdown-item command="extractImage" :disabled="!store.hasSelection">Extract Image...</el-dropdown-item>
              <el-dropdown-item command="adjustImage" :disabled="!store.hasSelection">Adjust Image...</el-dropdown-item>
              <el-dropdown-item command="replaceImage" :disabled="!store.hasSelection">Replace Image...</el-dropdown-item>
              <el-dropdown-item command="closePath" :disabled="!store.hasSelection">Close Path</el-dropdown-item>
              <el-dropdown-item command="openPath" :disabled="!store.hasSelection">Open Path</el-dropdown-item>
              <el-dropdown-item command="envArcUpper" divided :disabled="!store.hasSelection">Envelope: Arc Upper</el-dropdown-item>
              <el-dropdown-item command="envArcLower" :disabled="!store.hasSelection">Envelope: Arc Lower</el-dropdown-item>
              <el-dropdown-item command="envBulge" :disabled="!store.hasSelection">Envelope: Bulge</el-dropdown-item>
              <el-dropdown-item command="envWave" :disabled="!store.hasSelection">Envelope: Wave</el-dropdown-item>
              <el-dropdown-item command="envFlag" :disabled="!store.hasSelection">Envelope: Flag</el-dropdown-item>
              <el-dropdown-item command="envFisheye" :disabled="!store.hasSelection">Envelope: Fisheye</el-dropdown-item>
              <el-dropdown-item command="envSqueeze" :disabled="!store.hasSelection">Envelope: Squeeze</el-dropdown-item>
              <el-dropdown-item command="makeMask" divided :disabled="!store.hasSelection">Make Clipping Mask</el-dropdown-item>
              <el-dropdown-item command="releaseMask" :disabled="!store.hasSelection">Release Clipping Mask</el-dropdown-item>
              <el-dropdown-item command="applyPattern" divided :disabled="!store.hasSelection">Apply Pattern Fill</el-dropdown-item>
              <el-dropdown-item command="removePattern" :disabled="!store.hasSelection">Remove Pattern Fill</el-dropdown-item>
              <el-dropdown-item command="flowText" divided :disabled="!store.hasSelection">Flow Text Overflow</el-dropdown-item>
              <el-dropdown-item command="unlinkText" :disabled="!store.hasSelection">Unlink Text Frames</el-dropdown-item>
              <el-dropdown-item command="lock" divided :disabled="!store.hasSelection">Lock</el-dropdown-item>
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
            </el-dropdown-menu>
          </template>
        </el-dropdown>

        <el-dropdown trigger="click" @command="onViewCmd">
          <span class="menu-label">View</span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="fitAll">Fit to Window</el-dropdown-item>
              <el-dropdown-item command="zoomSelection" :disabled="!store.hasSelection">Zoom to Selection</el-dropdown-item>
              <el-dropdown-item command="zoomArtboard">Zoom to Artboard</el-dropdown-item>
              <el-dropdown-item command="zoomIn">Zoom In</el-dropdown-item>
              <el-dropdown-item command="zoomOut">Zoom Out</el-dropdown-item>
              <el-dropdown-item command="zoom100" divided>Actual Size</el-dropdown-item>
              <el-dropdown-item command="rulers" divided :icon="store.view.rulersVisible ? Check : undefined">
                Rulers
              </el-dropdown-item>
              <el-dropdown-item command="grid" :icon="store.view.showGrid ? Check : undefined">
                Grid
              </el-dropdown-item>
              <el-dropdown-item command="guides" :icon="store.view.showGuides ? Check : undefined">
                Guides
              </el-dropdown-item>
              <el-dropdown-item command="guidesDialog">Guides...</el-dropdown-item>
              <el-dropdown-item command="lockGuides" :icon="store.view.guidesLocked ? Check : undefined">
                Lock Guides
              </el-dropdown-item>
              <el-dropdown-item command="transparentBg" :icon="store.view.transparentBackground ? Check : undefined">
                Transparent Background
              </el-dropdown-item>
              <el-dropdown-item command="cmykPreview" :icon="store.view.proofMode === 'cmyk' ? Check : undefined">
                CMYK Preview
              </el-dropdown-item>
              <el-dropdown-item command="navigator" :icon="store.ui.showNavigator ? Check : undefined">
                Navigator
              </el-dropdown-item>
              <el-dropdown-item command="controlBar" :icon="store.ui.showControlBar ? Check : undefined">
                Control Bar
              </el-dropdown-item>
              <el-dropdown-item command="presentation" :icon="store.ui.zenMode ? Check : undefined">
                Presentation (Tab)
              </el-dropdown-item>
              <el-dropdown-item command="preflight">Preflight...</el-dropdown-item>
              <el-dropdown-item command="canvasSettings" divided>Canvas Settings...</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <div class="top-right">
      <el-tooltip content="Help">
        <el-button circle size="small" @click="onHelp">
          <el-icon><QuestionFilled /></el-icon>
        </el-button>
      </el-tooltip>
    </div>

    <!-- Canvas Settings Dialog (settings apply live; footer is just Close) -->
    <AppDialog v-model="settingsVisible" title="Canvas Settings" :width="420" :show-footer="false">
      <template #footer>
        <el-button size="small" @click="settingsVisible = false">Close</el-button>
      </template>
      <div class="settings-body app-settings">
        <div class="setting-section">
          <div class="setting-title">Display</div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Rulers</span>
              <span class="setting-desc">Show rulers along the canvas edges</span>
            </div>
            <el-switch v-model="settings.rulers" size="small" @change="onRulersToggle" />
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Grid</span>
              <span class="setting-desc">Show a grid on the canvas</span>
            </div>
            <el-switch v-model="settings.grid" size="small" @change="onGridToggle" />
          </div>

          <div v-if="settings.grid" class="setting-row setting-sub">
            <div class="setting-label">
              <span class="setting-name">Grid Size</span>
              <span class="setting-desc">Distance between grid lines</span>
            </div>
            <el-input-number v-model="settings.gridSize" :min="1" :max="100" :step="1" size="small"
              @change="onGridSizeChange" />
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Transparent Background</span>
              <span class="setting-desc">Show a checkerboard to indicate transparency</span>
            </div>
            <el-switch v-model="settings.transparent" size="small" @change="onTransparentToggle" />
          </div>
        </div>

        <div class="setting-section">
          <div class="setting-title">Snapping</div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Enable Snapping</span>
              <span class="setting-desc">Master switch for every snap source below</span>
            </div>
            <el-switch v-model="settings.snap" size="small" @change="onSnapToggle" />
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Snap to Grid</span>
              <span class="setting-desc">Pull points onto grid crossings</span>
            </div>
            <el-switch v-model="settings.snapGrid" size="small" :disabled="!settings.snap" @change="onSnapGridToggle" />
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Snap to Guides</span>
              <span class="setting-desc">Pull points onto ruler guide lines</span>
            </div>
            <el-switch v-model="settings.snapGuides" size="small" :disabled="!settings.snap" @change="onSnapGuidesToggle" />
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Snap to Anchors</span>
              <span class="setting-desc">Pull points onto nearby anchor points</span>
            </div>
            <el-switch v-model="settings.snapPoint" size="small" :disabled="!settings.snap" @change="onSnapPointToggle" />
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Smart Guides</span>
              <span class="setting-desc">Align dragged objects to nearby edges and centers</span>
            </div>
            <el-switch v-model="settings.smartGuides" size="small" :disabled="!settings.snap" @change="onSmartGuidesToggle" />
          </div>
        </div>

        <div class="setting-section">
          <div class="setting-title">Page</div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Preset</span>
            </div>
            <el-select v-model="settings.pagePreset" size="small" style="width: 150px" @change="onPagePresetChange">
              <el-option v-for="p in pagePresets" :key="p.value" :label="p.label" :value="p.value" />
            </el-select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Page Size</span>
              <span class="setting-desc">Active artboard size in px</span>
            </div>
            <div class="page-size-inputs">
              <el-input-number v-model="settings.pageWidth" :min="1" :max="16384" size="small" @change="onPageSizeChange" />
              <el-button size="small" title="Swap orientation" @click="onPageOrientationSwap">Swap</el-button>
              <el-input-number v-model="settings.pageHeight" :min="1" :max="16384" size="small" @change="onPageSizeChange" />
            </div>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Bleed</span>
              <span class="setting-desc">Vector PDF page grows by this; crop marks print when above 0</span>
            </div>
            <el-input-number v-model="settings.bleed" :min="0" :max="100" size="small" @change="onBleedChange" />
          </div>
        </div>

        <div class="setting-section">
          <div class="setting-title">Units</div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Ruler Unit</span>
            </div>
            <el-select v-model="settings.unit" size="small" style="width: 120px" @change="onUnitChange">
              <el-option v-for="u in units" :key="u.value" :label="u.label" :value="u.value" />
            </el-select>
          </div>
          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Nudge Step</span>
              <span class="setting-desc">Arrow-key distance in document units (Shift moves 10x)</span>
            </div>
            <el-input-number v-model="settings.nudgeStep" :min="0.1" :max="100" :step="1" size="small"
              @change="onNudgeStepChange" />
          </div>
        </div>
      </div>
    </AppDialog>

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
              <el-option v-for="f in exportFormats" :key="f.value" :label="f.label" :value="f.value" />
            </el-select>
          </div>

          <div class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Scale</span>
            </div>
            <el-select v-model="exportForm.scale" size="small" style="width: 120px">
              <el-option v-for="s in exportScales" :key="s.value" :label="s.label" :value="s.value" />
            </el-select>
          </div>

          <div v-if="exportForm.format !== 'png'" class="setting-row">
            <div class="setting-label">
              <span class="setting-name">Quality</span>
            </div>
            <el-select v-model="exportForm.quality" size="small" style="width: 120px">
              <el-option v-for="q in exportQualities" :key="q.value" :label="q.label" :value="q.value" />
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

    <!-- Guides Dialog (positions edit live; Clear All empties the guide layer) -->    <AppDialog
      v-model="guidesVisible"
      title="Guides"
      :width="380"
      :show-footer="false"
    >
      <template #footer>
        <el-button size="small" @click="guidesVisible = false">Close</el-button>
      </template>
      <div class="settings-body app-settings">
        <div v-if="guideRows.length === 0" class="setting-desc">No guides yet — drag one out from a ruler.</div>
        <div v-for="g in guideRows" :key="g.id" class="setting-row">
          <div class="setting-label">
            <span class="setting-name">{{ g.orientation === 'vertical' ? 'Vertical X' : 'Horizontal Y' }}</span>
          </div>
          <el-input-number :model-value="g.position" :precision="1" size="small" style="width: 130px" @change="(v: number | undefined) => onGuidePosition(g.id, v)" />
          <el-button size="small" title="Delete guide" @click="onGuideDelete(g.id)">×</el-button>
        </div>
        <div v-if="guideRows.length > 0" class="setting-row">
          <div class="setting-label">
            <span class="setting-name">All guides</span>
          </div>
          <el-button size="small" @click="onGuidesClear">Clear All</el-button>
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">At selection</span>
            <span class="setting-desc">Through the center (respects lock)</span>
          </div>
          <el-button size="small" :disabled="!store.hasSelection" @click="onGuideAtSelection('horizontal')">H</el-button>
          <el-button size="small" :disabled="!store.hasSelection" @click="onGuideAtSelection('vertical')">V</el-button>
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Margins</span>
            <span class="setting-desc">Inset rect on the active board</span>
          </div>
          <el-input-number v-model="marginValue" :min="0" :max="500" size="small" style="width: 100px" />
          <el-button size="small" @click="onMarginGuides">Add</el-button>
        </div>
      </div>
    </AppDialog>

    <!-- Offset Path Dialog (AI Offset Path parity) -->    <AppDialog
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

    <!-- Adjust Colors Dialog (Recolor-lite through HSL) -->    <AppDialog
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
      </div>
    </AppDialog>

    <!-- Find & Replace Dialog (AI Find/Change parity + word count) -->    <AppDialog
      v-model="findVisible"
      title="Find & Replace"
      :width="400"
      :show-footer="false"
    >
      <template #footer>
        <el-button size="small" @click="findVisible = false">Close</el-button>
      </template>
      <div class="settings-body app-settings">
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Find</span>
          </div>
          <el-input v-model="findForm.find" size="small" placeholder="Text to find" @input="findIndex = 0" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Replace</span>
          </div>
          <el-input v-model="findForm.replace" size="small" placeholder="Replacement" />
        </div>
        <div class="setting-row">
          <div class="setting-label">
            <span class="setting-name">Match case</span>
          </div>
          <el-checkbox v-model="findForm.matchCase" />
          <el-checkbox v-model="findForm.wholeWord">Whole word</el-checkbox>
          <span class="setting-desc">{{ findCountText }}</span>
        </div>
        <div class="setting-row">
          <el-button size="small" :disabled="findMatches.length === 0" @click="findNext">Find Next</el-button>
          <el-button size="small" :disabled="!store.hasSelection || !findForm.find" @click="replaceOne">Replace</el-button>
          <el-button size="small" :disabled="findMatches.length === 0" @click="replaceAll">Replace All</el-button>
        </div>
        <div class="setting-desc">{{ wordCountText }}</div>
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
          <el-input v-model="saveName" size="small" placeholder="project" @keyup.enter="onSaveConfirm" />
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

    <!-- Save Selection Dialog (named id-list selections, persisted) -->
    <AppDialog
      v-model="savedSelVisible"
      title="Saved Selections"
      :width="400"
      :show-footer="false"
    >
      <template #footer>
        <el-button size="small" @click="savedSelVisible = false">Close</el-button>
      </template>
      <div class="settings-body app-settings">
        <div class="setting-row">
          <el-input v-model="savedSelName" size="small" placeholder="Selection name" @keyup.enter="onSavedSelSave" />
          <el-button size="small" :disabled="!store.hasSelection" @click="onSavedSelSave">Save Current</el-button>
        </div>
        <div v-if="store.savedSelections.length === 0" class="setting-desc">No saved selections yet.</div>
        <div v-for="s in store.savedSelections" :key="s.id" class="setting-row">
          <div class="setting-label">
            <span class="setting-name">{{ s.name }}</span>
            <span class="setting-desc">{{ s.ids.length }} objects</span>
          </div>
          <el-button size="small" @click="onSavedSelLoad(s.id)">Load</el-button>
          <el-button size="small" title="Delete" @click="onSavedSelDelete(s.id)">×</el-button>
        </div>
      </div>
    </AppDialog>

    <!-- Preflight Dialog (print-readiness: overflow / gamut / dpi / layers) -->
    <AppDialog
      v-model="preflightVisible"
      title="Preflight"
      :width="440"
      :show-footer="false"
    >
      <template #footer>
        <el-button size="small" @click="preflightVisible = false">Close</el-button>
      </template>
      <div class="settings-body app-settings">
        <div v-if="preflightRows.length === 0" class="setting-desc">No issues — overflow, gamut, image resolution and empty layers all pass.</div>
        <div v-else class="setting-row">
          <el-button size="small" @click="selectAllIssues">Select All Flagged</el-button>
          <span class="setting-desc">{{ preflightRows.length }} finding(s), capped at 50</span>
        </div>
        <div v-for="(row, i) in preflightRows" :key="i" class="setting-row preflight-row" :class="{ clickable: !!row.itemId }" @click="row.itemId && gotoIssue(row.itemId)">
          <el-tag size="small" :type="preflightTag(row.kind)">{{ preflightKind(row.kind) }}</el-tag>
          <span class="setting-desc">{{ row.message }}</span>
        </div>
      </div>
    </AppDialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, inject, type Ref } from 'vue'
import { QuestionFilled, Check } from '@element-plus/icons-vue'
import AppDialog from '../ui/AppDialog.vue'
import { uniqueSelectionName, pruneSelectionIds } from '../../editor/selection/saved-selection'
import { useEditorStore } from '../../editor/store'
import type { EditorEngine } from '../../editor/engine'
import type { RulerUnit, RasterExportFormat, RasterExportArea } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

const settingsVisible = computed({
  get: () => store.ui.settingsOpen,
  set: (v: boolean) => store.setSettingsOpen(v),
})
const exportVisible = ref(false)
const guidesVisible = ref(false)
const guidesTick = ref(0)
/** Guide rows (rebuilt on open + every guide op + history jumps). */
const guideRows = computed(() => {
  void guidesTick.value
  void store.historyIndex
  void guidesVisible.value
  return engineRef?.value?.listGuides() ?? []
})
function openGuidesDialog() {
  guidesTick.value++
  guidesVisible.value = true
}
function onGuidePosition(id: string, v: number | undefined) {
  const e = engineRef?.value
  if (!e || v === undefined || !Number.isFinite(v)) {
    guidesTick.value++
    return
  }
  if (e.moveGuideById(id, v)) {
    e.pushHistory('Move Guide')
  } else {
    store.setStatusMessage('Guide not found')
  }
  guidesTick.value++
}
function onGuideDelete(id: string) {
  const e = engineRef?.value
  if (!e) return
  if (e.deleteGuideById(id)) {
    e.pushHistory('Delete Guide')
  }
  guidesTick.value++
}
function onGuidesClear() {
  const e = engineRef?.value
  if (!e) return
  e.clearGuides()
  e.pushHistory('Clear Guides')
  guidesTick.value++
}
function onGuideAtSelection(orientation: 'horizontal' | 'vertical') {
  const e = engineRef?.value
  if (!e) return
  if (!e.guideAtSelection(orientation)) {
    store.setStatusMessage(store.view.guidesLocked ? 'Guides are locked' : 'Select objects first')
    return
  }
  guidesTick.value++
}
const marginValue = ref(36)
function onMarginGuides() {
  const e = engineRef?.value
  const board = store.activeArtboard
  if (!e || !board) return
  const n = e.addMarginGuides(board.id, Number(marginValue.value) || 0)
  if (n === 0) {
    store.setStatusMessage(store.view.guidesLocked ? 'Guides are locked' : 'Margin must fit inside the board')
    return
  }
  guidesTick.value++
}

const offsetVisible = ref(false)
const offsetForm = reactive({
  distance: 10,
  join: 'miter' as 'miter' | 'round' | 'bevel',
  steps: 1,
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
  if (e.offsetPaths(d, offsetForm.join, Number(offsetForm.steps) || 1) === 0) {
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

const saveVisible = ref(false)
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

const findVisible = ref(false)
const findForm = reactive({ find: '', replace: '', matchCase: false, wholeWord: false })
const findIndex = ref(0)
const findTick = ref(0)
const findMatches = computed(() => {
  void findTick.value
  void store.historyIndex
  void findVisible.value
  const e = engineRef?.value
  if (!e || !findForm.find) return []
  try {
    return e.findText(findForm.find, findForm.matchCase, findForm.wholeWord)
  } catch {
    return []
  }
})
const findCountText = computed(() => {
  if (!findForm.find) return 'Type to search the document'
  const n = findMatches.value.length
  return n === 0 ? 'No matches' : `${n} match${n === 1 ? '' : 'es'}`
})
const wordStats = computed(() => {
  void store.historyIndex
  void store.selectedItemIds.join(',')
  try {
    return engineRef?.value?.textStats() ?? { words: 0, chars: 0, runs: 0 }
  } catch {
    return { words: 0, chars: 0, runs: 0 }
  }
})
const wordCountText = computed(() => {
  const s = wordStats.value
  const scope = store.hasSelection ? 'selection' : 'document'
  return `${s.words} words · ${s.chars} chars · ${s.runs} runs (${scope})`
})
function openFind() {
  findTick.value++
  findIndex.value = 0
  findVisible.value = true
}

const savedSelVisible = ref(false)
const savedSelName = ref('')

function persistSavedSelections() {
  try {
    localStorage.setItem('vve.selections', JSON.stringify(store.savedSelections))
  } catch { /* private mode */ }
}

function restoreSavedSelections() {
  try {
    const raw = localStorage.getItem('vve.selections')
    if (!raw) return
    const list = JSON.parse(raw) as Array<{ id?: unknown; name?: unknown; ids?: unknown }>
    if (!Array.isArray(list)) return
    store.setSavedSelections(
      list
        .filter((s) => s && typeof s === 'object')
        .map((s) => ({
          id: typeof s.id === 'string' ? s.id : '',
          name: typeof s.name === 'string' ? s.name : '',
          ids: Array.isArray(s.ids) ? s.ids.filter((i: unknown): i is string => typeof i === 'string') : [],
        }))
    )
  } catch { /* corrupt storage: start empty */ }
}
let savedSelRestored = false

function openSavedSelections() {
  if (!savedSelRestored) {
    savedSelRestored = true
    restoreSavedSelections()
  }
  savedSelName.value = ''
  savedSelVisible.value = true
}

function onSavedSelSave() {
  if (!store.hasSelection) {
    store.setStatusMessage('Select objects first')
    return
  }
  const base = uniqueSelectionName(
    store.savedSelections.map((s) => s.name),
    (savedSelName.value || '').trim() || 'Selection'
  )
  store.addSavedSelection(base, [...store.selectedItemIds])
  savedSelName.value = ''
  persistSavedSelections()
  store.setStatusMessage(`Selection saved as "${base}"`)
}

function onSavedSelLoad(id: string) {
  const e = engineRef?.value
  if (!e) return
  const entry = store.savedSelections.find((s) => s.id === id)
  if (!entry) return
  const existing = new Set<string>()
  for (const itemId of entry.ids) {
    if ((e as any).getItemById?.(itemId)) existing.add(itemId)
  }
  const pruned = pruneSelectionIds(entry.ids, existing)
  if (pruned.length === 0) {
    store.setStatusMessage('Nothing left of that selection')
    return
  }
  const n = e.selectByIds(pruned)
  store.setStatusMessage(`Loaded "${entry.name}" (${n} objects)`)
}

function onSavedSelDelete(id: string) {
  store.removeSavedSelection(id)
  persistSavedSelections()
}function findNext() {
  const e = engineRef?.value
  const matches = findMatches.value
  if (!e || matches.length === 0) return
  findIndex.value = (findIndex.value + 1) % matches.length
  const target = matches[findIndex.value]
  e.clearSelection()
  target.selected = true
  e.syncSelectionToStore()
}
function replaceOne() {
  const e = engineRef?.value
  if (!e || !findForm.find) return
  const n = e.replaceText(findForm.find, findForm.replace, findForm.matchCase, findForm.wholeWord)
  store.setStatusMessage(n > 0 ? `Replaced in ${n} run${n === 1 ? '' : 's'}` : 'No replacement in the selection')
  findTick.value++
}
function replaceAll() {
  const e = engineRef?.value
  if (!e || !findForm.find) return
  e.clearSelection()
  findMatches.value.forEach((item) => {
    item.selected = true
  })
  e.syncSelectionToStore()
  const n = e.replaceText(findForm.find, findForm.replace, findForm.matchCase, findForm.wholeWord)
  store.setStatusMessage(n > 0 ? `Replaced in ${n} run${n === 1 ? '' : 's'}` : 'Nothing replaced')
  findTick.value++
}

const preflightVisible = ref(false)
const preflightTick = ref(0)
const preflightRows = computed(() => {
  void preflightTick.value
  void store.historyIndex
  void preflightVisible.value
  try {
    return engineRef?.value?.preflight() ?? []
  } catch {
    return []
  }
})
function openPreflight() {
  preflightTick.value++
  preflightVisible.value = true
}
function preflightKind(kind: string): string {
  switch (kind) {
    case 'overflow': return 'Overflow'
    case 'gamut': return 'Gamut'
    case 'tac': return 'Ink'
    case 'small': return 'Type'
    case 'hairline': return 'Stroke'
    case 'dpi': return 'DPI'
    default: return 'Layer'
  }
}
function preflightTag(kind: string): 'danger' | 'warning' | 'info' {
  if (kind === 'overflow' || kind === 'dpi' || kind === 'tac') return 'danger'
  if (kind === 'gamut' || kind === 'hairline' || kind === 'small') return 'warning'
  return 'info'
}
function selectAllIssues() {
  const e = engineRef?.value
  if (!e) return
  const ids = preflightRows.value.map((r) => r.itemId).filter(Boolean)
  if (ids.length === 0) return
  const n = e.selectByIds(ids)
  store.setStatusMessage(`Selected ${n} flagged object${n === 1 ? '' : 's'}`)
}
function gotoIssue(id: string) {
  engineRef?.value?.selectItemById(id)
}
const exportForm = reactive({
  format: 'png' as RasterExportFormat,
  scale: 2,
  area: 'artwork' as RasterExportArea,
  quality: 0.92,
})
const exportQualities = [
  { value: 0.92, label: 'High' },
  { value: 0.75, label: 'Medium' },
  { value: 0.55, label: 'Low' },
]
const exportFormats = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
]
const exportScales = [
  { value: 1, label: '1x' },
  { value: 2, label: '2x' },
  { value: 3, label: '3x' },
]

const pagePresets = [
  { value: 'custom', label: 'Custom' },
  { value: '1920x1080', label: 'HD 1920 x 1080' },
  { value: '3840x2160', label: '4K 3840 x 2160' },
  { value: '1080x1080', label: 'Square 1080 x 1080' },
  { value: '1080x1350', label: 'Post 1080 x 1350' },
  { value: '1080x1920', label: 'Story 1080 x 1920' },
  { value: '595x842', label: 'A4 595 x 842' },
  { value: '842x1191', label: 'A3 842 x 1191' },
  { value: '612x792', label: 'Letter 612 x 792' },
  { value: '792x1224', label: 'Tabloid 792 x 1224' },
]

/** Preset value matching W/H, or custom when nothing matches. */
function matchPagePreset(width: number, height: number): string {
  const found = pagePresets.find((p) => p.value === `${width}x${height}`)
  return found ? found.value : 'custom'
}

const settings = reactive({
  rulers: store.view.rulersVisible,
  grid: store.view.showGrid,
  gridSize: store.snap.gridSize,
  transparent: store.view.transparentBackground,
  unit: store.rulerUnit as RulerUnit,
  snap: store.snap.enable,
  snapGrid: store.snap.grid,
  snapGuides: store.snap.guides,
  snapPoint: store.snap.point,
  smartGuides: store.snap.smartGuides,
  pageWidth: store.activeArtboard?.width ?? store.pageSize.width,
  pageHeight: store.activeArtboard?.height ?? store.pageSize.height,
  pagePreset: matchPagePreset(
    store.activeArtboard?.width ?? store.pageSize.width,
    store.activeArtboard?.height ?? store.pageSize.height
  ),
  bleed: store.bleed,
  nudgeStep: store.nudgeStep,
})

const units = [
  { value: 'px', label: 'px' },
  { value: 'pt', label: 'pt' },
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
  { value: 'in', label: 'in' },
]

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

function onFileCmd(cmd: string) {
  blurMenuFocus()
  const e = engineRef?.value
  switch (cmd) {
    case 'new': {
      if (!confirmDiscard()) break
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
      saveVisible.value = true
      break
    case 'open': {
      if (!e) break
      if (!confirmDiscard()) break
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,.vec.json,application/json'
      input.onchange = async () => {
        const file = input.files?.[0]
        if (!file || !e) return
        try {
          const text = await file.text()
          e.importProjectFile(text)
          store.setStatusMessage('Project opened')
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
      onExportBoardsPng()
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
          const text = await file.text()
          try {
            if (e.importSVGText(text, 'Import SVG')) {
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
    case 'place': {
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
          e.placeImage(await readFileAsDataURL(file))
        } catch (err) {
          store.setStatusMessage('Image placement failed')
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
      store.setStatusMessage(rasterFailText(e) ?? 'Raster export failed')
      return
    }
    downloadHref(dataUrl, `export.${exportForm.format}`)
    exportVisible.value = false
    store.setStatusMessage(`Raster exported (${exportForm.format.toUpperCase()} ${exportForm.scale}x)`)
  } catch (err) {
    store.setStatusMessage('Raster export failed')
  }
}

/**
 * Precise raster-failure reason: oversized output names its pixels and the
 * guard, so users know to lower the scale instead of retrying blindly.
 */
function rasterFailText(e: EditorEngine): string | null {
  const size = e.estimateRasterSize(exportForm.area, exportForm.scale)
  if (!size) return null
  return size.width > 16384 || size.height > 16384
    ? `Too large (${size.width}x${size.height}px, 16384 max) — lower the scale`
    : null
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
 * Export every artboard as one PDF page each (2x rasters embedded
 * full-bleed). The active board is restored afterwards.
 */
/**
 * Export every artboard as a 2x PNG file each (download-per-board, like
 * Boards SVG). The active board is restored afterwards.
 */
function onExportBoardsPng() {
  const e = engineRef?.value
  if (!e) return
  const boards = store.artboards.filter((b) => b.width > 0 && b.height > 0)
  if (boards.length === 0) {
    store.setStatusMessage('Nothing to export')
    return
  }
  const previousActive = store.activeArtboardId
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
      downloadHref(dataUrl, `${board.name || 'artboard'}.png`)
      painted++
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
 * shared bleed; fonts are referenced, not embedded.
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

function onEditCmd(cmd: string) {
  blurMenuFocus()
  const e = engineRef?.value
  if (!e) return
  switch (cmd) {
    case 'undo':
      e.undo()
      break
    case 'redo':
      e.redo()
      break
    case 'cut':
      // Capture the OS copy before the cut deletes the selection.
      e.copyToSystemClipboard().catch(() => undefined)
      e.cutSelectedToClipboard()
      break
    case 'copy':
      e.copySelectedToClipboard()
      e.copyToSystemClipboard().catch(() => undefined)
      break
    case 'copySVG':
      void onCopySVG()
      break
    case 'copyPNG':
      void onCopyPNG()
      break
    case 'paste':
      e.pasteWithSystemFallback().catch(() => undefined)
      break
    case 'pasteFront':
      if (!e.pasteInPlace('front')) store.setStatusMessage('Clipboard is empty')
      break
    case 'pasteBack':
      if (!e.pasteInPlace('back')) store.setStatusMessage('Clipboard is empty')
      break
    case 'pasteBoards': {
      const n = e.pasteOnAllBoards()
      store.setStatusMessage(n > 0 ? `Pasted on all artboards (${n} items)` : 'Clipboard is empty')
      break
    }
    case 'duplicate':
      if (!e.duplicateInPlace()) store.setStatusMessage('Nothing to duplicate')
      break
    case 'delete': {
      // Direct-select sub-selections delete anchors/curves (keyboard
      // parity); otherwise whole objects go.
      const sc = e.getController('direct-select') as {
        deleteSubselection?: () => boolean
      } | null
      if (!sc?.deleteSubselection?.()) e.deleteSelected()
      break
    }
    case 'selectAll': {
      // Direct-select with a path selection takes every anchor (Ctrl+A
      // parity); otherwise the whole artwork is selected.
      const sc = e.getController('direct-select') as {
        selectAllSubselection?: () => boolean
      } | null
      if (!(sc?.selectAllSubselection?.() ?? false)) e.selectAllArtwork()
      break
    }
    case 'invertSelection':
      e.invertSelection()
      break
    case 'reselect': {
      const n = e.reselect()
      store.setStatusMessage(n > 0 ? `Reselected ${n} object${n === 1 ? '' : 's'}` : 'Nothing to reselect')
      break
    }
    case 'saveSelection':
      openSavedSelections()
      break
    case 'findReplace':
      openFind()
      break
  }
}

/** Copy the selection as SVG source text for use in code editors. */
async function onCopySVG() {
  const e = engineRef?.value
  if (!e) return
  const svg = e.exportSelectionSVG()
  if (!svg) {
    store.setStatusMessage('Nothing to copy')
    return
  }
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      store.setStatusMessage('Clipboard unavailable')
      return
    }
    await navigator.clipboard.writeText(svg)
    store.setStatusMessage('SVG copied to clipboard')
  } catch (err) {
    store.setStatusMessage('Copy failed')
  }
}

/** Copy the selection (else all artwork) as PNG pixels. */
async function onCopyPNG() {
  const e = engineRef?.value
  if (!e) return
  try {
    if (await e.copyRasterToClipboard(2)) {
      store.setStatusMessage('PNG copied to clipboard')
    } else {
      store.setStatusMessage('Copy as PNG failed')
    }
  } catch {
    store.setStatusMessage('Copy as PNG failed')
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
    case 'bringToFront':
      e.bringSelectionToFront()
      break
    case 'sendToBack':
      e.sendSelectionToBack()
      break
    case 'group':
      e.groupSelection()
      break
    case 'ungroup':
      e.ungroupSelection()
      break
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
    case 'envSqueeze': {
      const preset = (
        cmd === 'envArcUpper' ? 'arc-upper' :
        cmd === 'envArcLower' ? 'arc-lower' :
        cmd === 'envBulge' ? 'bulge' :
        cmd === 'envWave' ? 'wave' :
        cmd === 'envFlag' ? 'flag' :
        cmd === 'envFisheye' ? 'fisheye' : 'squeeze'
      ) as 'arc-upper' | 'arc-lower' | 'bulge' | 'wave' | 'flag' | 'fisheye' | 'squeeze'
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
  }
}

function onViewCmd(cmd: string) {
  blurMenuFocus()
  const e = engineRef?.value
  if (!e) return
  switch (cmd) {
    case 'fitAll':
      e.fitToContent()
      break
    case 'zoomSelection':
      e.zoomToSelection()
      break
    case 'zoomArtboard':
      e.zoomToArtboard()
      break
    case 'zoomIn':
      e.zoomAt(1.2, e.canvas.width / 2, e.canvas.height / 2)
      break
    case 'zoomOut':
      e.zoomAt(1 / 1.2, e.canvas.width / 2, e.canvas.height / 2)
      break
    case 'zoom100':
      e.zoom = 1
      e.scope.view.zoom = 1
      e.syncViewBookkeeping()
      store.updateView({ zoom: 1 })
      e.scope.view.update()
      e.refreshGrid()
      e.emitViewChange()
      break
    case 'rulers':
      toggleRulers()
      break
    case 'grid':
      toggleGrid()
      break
    case 'guides':
      store.updateView({ showGuides: !store.view.showGuides })
      break
    case 'guidesDialog':
      openGuidesDialog()
      break
    case 'lockGuides':
      store.updateView({ guidesLocked: !store.view.guidesLocked })
      break
    case 'transparentBg':
      toggleTransparent()
      break
    case 'cmykPreview': {
      const next = store.view.proofMode === 'cmyk' ? 'rgb' : 'cmyk'
      store.updateView({ proofMode: next })
      store.setStatusMessage(next === 'cmyk' ? 'CMYK proof on (numeric preview)' : 'CMYK proof off')
      break
    }
    case 'navigator':
      store.setShowNavigator(!store.ui.showNavigator)
      break
    case 'presentation':
      store.setZenMode(!store.ui.zenMode)
      break
    case 'preflight':
      openPreflight()
      break
    case 'controlBar':
      store.setShowControlBar(!store.ui.showControlBar)
      break
    case 'canvasSettings':
      settingsVisible.value = true
      syncSettingsFromStore()
      break
  }
}

function toggleRulers() {
  store.updateView({ rulersVisible: !store.view.rulersVisible })
  settings.rulers = store.view.rulersVisible
}

function toggleGrid() {
  store.updateView({ showGrid: !store.view.showGrid })
  settings.grid = store.view.showGrid
  const e = engineRef?.value
  if (e) e.refreshGrid()
}

function toggleTransparent() {
  store.updateView({ transparentBackground: !store.view.transparentBackground })
  settings.transparent = store.view.transparentBackground
}

function syncSettingsFromStore() {
  settings.rulers = store.view.rulersVisible
  settings.grid = store.view.showGrid
  settings.gridSize = store.snap.gridSize
  settings.transparent = store.view.transparentBackground
  settings.unit = store.rulerUnit as RulerUnit
  settings.snap = store.snap.enable
  settings.snapGrid = store.snap.grid
  settings.snapGuides = store.snap.guides
  settings.snapPoint = store.snap.point
  settings.smartGuides = store.snap.smartGuides
  settings.nudgeStep = store.nudgeStep
  settings.bleed = store.bleed
  syncPageSettings()
}

function onRulersToggle(val: boolean) {
  store.updateView({ rulersVisible: val })
}

function onGridToggle(val: boolean) {
  store.updateView({ showGrid: val })
  const e = engineRef?.value
  if (e) e.refreshGrid()
}

function onGridSizeChange(val: number | undefined) {
  if (!val) return
  store.updateSnap({ gridSize: val })
  const e = engineRef?.value
  if (e) e.refreshGrid()
}

function onTransparentToggle(val: boolean) {
  store.updateView({ transparentBackground: val })
}

function onSnapToggle(val: boolean) {
  store.updateSnap({ enable: val })
}

function onSnapGridToggle(val: boolean) {
  store.updateSnap({ grid: val })
}

function onSnapGuidesToggle(val: boolean) {
  store.updateSnap({ guides: val })
}

function onSnapPointToggle(val: boolean) {
  store.updateSnap({ point: val })
}

function onSmartGuidesToggle(val: boolean) {
  store.updateSnap({ smartGuides: val })
}

function syncPageSettings() {
  const board = store.activeArtboard
  settings.pageWidth = board?.width ?? store.pageSize.width
  settings.pageHeight = board?.height ?? store.pageSize.height
  settings.pagePreset = matchPagePreset(settings.pageWidth, settings.pageHeight)
}

/** Resize the active artboard (page visuals redraw with it). */
function resizeActiveBoard(width: number, height: number) {
  const board = store.activeArtboard
  if (!board) return
  const e = engineRef?.value
  if (e) {
    e.resizeArtboard(board.id, width, height)
  } else {
    store.updateArtboard(board.id, { width, height })
  }
}

function onPagePresetChange(value: string) {
  if (value === 'custom') return
  const [width, height] = value.split('x').map(Number)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return
  resizeActiveBoard(width, height)
  syncPageSettings()
}

function onPageSizeChange() {
  const width = Math.round(settings.pageWidth)
  const height = Math.round(settings.pageHeight)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    syncPageSettings()
    return
  }
  resizeActiveBoard(width, height)
  settings.pagePreset = matchPagePreset(width, height)
}

function onPageOrientationSwap() {
  const board = store.activeArtboard
  if (!board) return
  resizeActiveBoard(board.height, board.width)
  syncPageSettings()
}

/** Bleed change: persist, redraw the dashed bleed guides, confirm. */
function onBleedChange(val: number | undefined) {
  if (val === undefined || !Number.isFinite(val)) {
    settings.bleed = store.bleed
    return
  }
  const before = store.bleed
  store.setBleed(val)
  settings.bleed = store.bleed
  const e = engineRef?.value
  if (e) {
    e.refreshArtboards()
    if (settings.bleed !== before) e.pushHistory('Change Bleed')
  }
}

function onUnitChange(val: string) {
  store.setRulerUnit(val as RulerUnit)
  store.setStatusMessage(`Ruler unit: ${val}`)
}

function onNudgeStepChange(val: number | undefined) {
  if (!val) {
    settings.nudgeStep = store.nudgeStep
    return
  }
  store.setNudgeStep(val)
  settings.nudgeStep = store.nudgeStep
}

function onHelp() {
  store.setStatusMessage('Shortcuts: V Select | A Direct | Q Lasso | Y Wand | P Pen | N Pencil | Shift+E Eraser | Shift+B Blob | B Brush | G Gradient | C Scissors | Shift+M Builder | Shift+W Width | Shift+R Rotate | Shift+S Scale | Shift+O Mirror | Shift+F FreeTf | +/- & Shift+C Anchors | [ ] Brush Size | Tab Present | Space Pan | Ctrl+0 Fit | Arrows Nudge | Ctrl+A Select | Ctrl+Shift+A Reselect | Ctrl+D Duplicate | Ctrl+G Group | Ctrl+2 Lock | Ctrl+3 Hide | Ctrl+C/X/V Clipb | Ctrl+Shift+C PNG | Ctrl+F/B Paste | Ctrl+[ Order | Ctrl+S Save | Ctrl+Shift+I Invert | Esc Cancel')
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

.settings-body {
  max-height: 400px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #4a4a4a transparent;
}

.settings-body::-webkit-scrollbar {
  width: 8px;
}

.settings-body::-webkit-scrollbar-track {
  background: transparent;
}

.settings-body::-webkit-scrollbar-thumb {
  background: #4a4a4a;
  border-radius: 4px;
  border: 2px solid #141414;
}

.setting-section {
  padding: 8px 0;
  border-bottom: 1px solid #2a2a2a;
}

.setting-section:last-child {
  border-bottom: none;
}

.setting-title {
  font-size: 13px;
  font-weight: bold;
  color: #4a90d9;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  gap: 12px;
}

.setting-row.setting-sub {
  padding-left: 24px;
  border-left: 2px solid #4a4a4a;
  margin-left: 8px;
}

.page-size-inputs {
  display: flex;
  align-items: center;
  gap: 4px;
}

.page-size-inputs .el-input-number {
  width: 90px;
}

.setting-label {
  flex: 1;
  min-width: 0;
}

.setting-name {
  display: block;
  font-size: 13px;
  color: #d5d5d5;
  font-weight: 500;
}

.setting-desc {
  display: block;
  font-size: 11px;
  color: #8a8a8a;
  margin-top: 2px;
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

/* Dark form controls inside AppDialog bodies */
.app-settings :deep(.el-input__wrapper),
.app-settings :deep(.el-input-number .el-input__wrapper) {
  background: #111111;
  border: 1px solid #3d3d3d;
  box-shadow: none !important;
  border-radius: 3px;
}

.app-settings :deep(.el-input__wrapper:hover) {
  border-color: #5a5a5a;
}

.app-settings :deep(.el-input__wrapper.is-focus) {
  border-color: #4a90d9;
}

.app-settings :deep(.el-input__inner) {
  color: #e6e6e6;
}

.app-settings :deep(.el-input__inner::placeholder) {
  color: #6a6a6a;
}

.app-settings :deep(.el-select__wrapper) {
  background: #111111;
  border: 1px solid #3d3d3d;
  box-shadow: none !important;
  border-radius: 3px;
}

.app-settings :deep(.el-select__wrapper:hover) {
  border-color: #5a5a5a;
}

.app-settings :deep(.el-select__wrapper.is-focused) {
  border-color: #4a90d9;
}

.app-settings :deep(.el-select__placeholder) {
  color: #6a6a6a;
}

.app-settings :deep(.el-select__selected-item) {
  color: #e6e6e6;
}

.app-settings :deep(.el-select__suffix),
.app-settings :deep(.el-select__caret) {
  color: #8a8a8a;
}

.app-settings :deep(.el-radio-button__inner) {
  background: #1a1a1a;
  border-color: #3d3d3d;
  color: #b5b5b5;
  box-shadow: none !important;
}

.app-settings :deep(.el-radio-button__orig-radio:checked + .el-radio-button__inner) {
  background: #2f6fbf;
  border-color: #2f6fbf;
  color: #fff;
}

.app-settings :deep(.el-radio-button__orig-radio:disabled + .el-radio-button__inner) {
  background: #242424;
  border-color: #333;
  color: #5a5a5a;
}

.app-settings :deep(.el-button--small) {
  background: #333333;
  border-color: #4a4a4a;
  color: #d5d5d5;
}

.app-settings :deep(.el-button--small:hover) {
  background: #3d3d3d;
  border-color: #5a5a5a;
  color: #fff;
}
</style>
