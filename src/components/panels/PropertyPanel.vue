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
          <template v-if="fillKind === 'gradient'">
            <div class="prop-row">
              <el-radio-group v-model="gradientType" size="small" class="seg-full" @change="onGradientChange">
                <el-radio-button value="linear">Linear</el-radio-button>
                <el-radio-button value="radial">Radial</el-radio-button>
              </el-radio-group>
            </div>
            <div v-if="gradientType === 'linear'" class="prop-row">
              <span class="prop-label-sm">Angle</span>
              <el-input-number v-model="gradientAngle" :min="0" :max="360" size="small" controls-position="right" @change="onGradientChange" />
              <el-button size="small" class="icon-btn" title="Reverse gradient direction" @click="onGradientReverse">⇄</el-button>
              <span class="unit">deg</span>
            </div>
            <div class="prop-row" v-for="(stop, index) in gradientStops" :key="index">
              <el-color-picker v-model="stop.color" size="small" show-alpha @change="onGradientChange" />
              <el-input-number v-model="stop.offset" :min="0" :max="100" size="small" controls-position="right" @change="onGradientChange" />
              <el-button size="small" class="icon-btn" type="danger" plain :disabled="gradientStops.length <= 2" @click="removeGradientStop(index)">×</el-button>
            </div>
            <div class="prop-row">
              <el-button size="small" plain class="wide-btn" @click="addGradientStop">Add Stop</el-button>
            </div>
          </template>
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
                <el-option v-for="d in dashPresets" :key="d.value" :label="d.label" :value="d.value" />
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
                <el-option v-for="d in dashPresets" :key="d.value" :label="d.label" :value="d.value" />
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
          <div class="prop-row">
            <el-select v-model="patternKind" size="small" class="flex-ctl" title="Pattern preset">
              <el-option v-for="p in patternPresets" :key="p.value" :label="p.label" :value="p.value" />
            </el-select>
            <el-color-picker v-model="patternColor" size="small" show-alpha title="Motif color" />
          </div>
          <div class="prop-row">
            <span class="prop-label-sm">Back</span>
            <el-color-picker v-model="patternBackground" size="small" show-alpha title="Background" :disabled="patternTransparent" />
            <el-button size="small" class="grid-btn" :type="patternTransparent ? 'primary' : ''" title="Transparent background" @click="patternTransparent = !patternTransparent">None</el-button>
          </div>
          <div class="prop-row">
            <span class="prop-label-sm">Scale</span>
            <el-input-number v-model="patternScale" :min="0.25" :max="4" :step="0.25" :precision="2" size="small" controls-position="right" />
            <span class="prop-label-sm">Angle</span>
            <el-input-number v-model="patternAngle" :min="0" :max="180" :step="15" size="small" controls-position="right" />
          </div>
          <div class="btn-grid-2">
            <el-button size="small" class="grid-btn" :disabled="!canApplyPattern" @click="onApplyPattern">Apply</el-button>
            <el-button size="small" class="grid-btn" :disabled="!isPatternSelected" @click="onRemovePattern">Remove</el-button>
          </div>
          <div v-if="patternHint" class="ai-desc">{{ patternHint }}</div>
        </div>
      </div>

      <div v-if="isTextSelected" class="prop-section">
        <div class="prop-head" @click="toggle('text')">
          <span class="prop-chevron" :class="{ closed: !open.text }">›</span>
          <span class="prop-label">Text</span>
        </div>
        <div v-show="open.text" class="prop-body">
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
          </div>
        </div>
      </div>

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
import type { AlignMode, BooleanOperation, DistributeAxis, FillRule, GradientState, LineCap, LineJoin, PatternFillState, ReferencePoint, RulerUnit, TextAlign } from '../../editor/types'

const store = useEditorStore()
const engineRef = inject<Ref<EditorEngine | null>>('engine')

// Collapsible sections (AI-style). Rarely used groups start collapsed
// so the panel stays scannable in a 264px column.
const open = ref({
  text: true,
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
const gradientType = ref<'linear' | 'radial'>('linear')
const gradientAngle = ref(0)
// Editable gradient stops (offsets in percent for the inputs).
const gradientStops = ref<Array<{ offset: number; color: string }>>([])

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

/** Mirror the store gradient into the editable stop list. */
function syncGradientFromStore() {
  const gradient = store.style.gradient
  gradientType.value = gradient?.type ?? 'linear'
  gradientAngle.value = Math.round(gradient?.angle ?? 0)
  gradientStops.value = gradient
    ? gradient.stops.map((stop) => ({ offset: Math.round(stop.offset * 100), color: stop.color }))
    : []
}

// ---- Pattern fill (procedural presets rendered as clipped tiles) ----

const patternPresets: Array<{ value: PatternFillState['kind']; label: string }> = [
  { value: 'dots', label: 'Dots' },
  { value: 'stripes', label: 'Stripes' },
  { value: 'grid', label: 'Grid' },
  { value: 'crosshatch', label: 'Crosshatch' },
]

const patternKind = ref<PatternFillState['kind']>('dots')
const patternColor = ref('#000000')
const patternBackground = ref('#ffffff')
const patternTransparent = ref(false)
const patternScale = ref(1)
const patternAngle = ref(45)
const isPatternSelected = ref(false)
const canApplyPattern = ref(false)
const patternHint = ref('')

/** Read pattern state from the current selection into the panel. */
function syncPatternFromSelection() {
  const e = getEngine()
  isPatternSelected.value = false
  canApplyPattern.value = false
  patternHint.value = ''
  if (!e || !store.hasSelection) return
  const items = e.getSelection()
  if (items.length === 0) return
  const first = items[0] as any
  const found = e.getPatternFromItem(first)
  if (found) {
    isPatternSelected.value = true
    patternKind.value = found.kind
    patternColor.value = found.color || '#000000'
    patternTransparent.value = !found.background
    patternBackground.value = found.background || '#ffffff'
    patternScale.value = found.scale || 1
    patternAngle.value = found.angle || 0
  } else if (store.style.pattern) {
    const p = store.style.pattern
    patternKind.value = p.kind
    patternColor.value = p.color
    patternTransparent.value = !p.background
    patternBackground.value = p.background || '#ffffff'
    patternScale.value = p.scale
    patternAngle.value = p.angle
  }
  canApplyPattern.value = items.some((item: any) => {
    if (e.isPatternGroup(item)) return true
    const name = String(item?.className ?? item?.constructor?.name ?? '')
    return /path/i.test(name)
  })
  if (!canApplyPattern.value) {
    patternHint.value = 'Select a path to apply a pattern.'
  } else if (isPatternSelected.value) {
    patternHint.value = 'Pattern moves/scales with its shape. Remove before boolean ops.'
  }
}

function currentPattern(): PatternFillState {
  return {
    kind: patternKind.value,
    color: patternColor.value || '#000000',
    background: patternTransparent.value ? null : (patternBackground.value || null),
    scale: Math.min(4, Math.max(0.25, Number(patternScale.value) || 1)),
    angle: Number(patternAngle.value) || 0,
  }
}

function onApplyPattern() {
  const e = getEngine()
  if (!e) return
  const applied = e.applyPatternFill(currentPattern())
  syncPatternFromSelection()
  if (applied === 0) {
    store.setStatusMessage('Pattern needs a path selection')
  }
}

function onRemovePattern() {
  const e = getEngine()
  if (!e) return
  if (e.removePatternFill() === 0) {
    // Also covers Release Clipping Mask on a pattern group.
    if (!e.releaseClippingMask()) {
      store.setStatusMessage('Select a pattern to remove')
    }
  }
  syncPatternFromSelection()
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
// Area-frame editing (single area-text selection only).
const isAreaSelected = ref(false)
const frameW = ref(0)
const frameH = ref(0)
const hasOverflow = ref(false)
const overflowHint = ref('')
const threadHint = ref('')

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

/** Object-type label shown under the tab, like AI ("Path", "Text", ...). */
const selectionLabel = computed(() => {
  const n = store.selectedItemIds.length
  if (n === 0) return ''
  if (n > 1) return `Mixed (${n})`
  if (isTextSelected.value) return 'Text'
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
function syncTextFromSelection() {
  const item = getSelectedText()
  isTextSelected.value = !!item
  isAreaSelected.value = false
  hasOverflow.value = false
  overflowHint.value = ''
  threadHint.value = ''
  if (!item) return
  fontFamily.value = (item.fontFamily as string) || 'Arial'
  fontSize.value = Number(item.fontSize) || 12
  isBold.value = String(item.fontWeight) === 'bold' || Number(item.fontWeight) >= 600
  isItalic.value = ((item as any).fontStyle as string) === 'italic'
  isUnderline.value = !!(item as any).underline || !!store.charStyle.underline
  isStrikethrough.value = !!(item as any).strikethrough || !!store.charStyle.strikethrough
  baselineValue.value = Number((item as any).baselineShift ?? store.charStyle.baselineShift) || 0
  hScaleValue.value = Number((item as any).horizontalScale ?? store.charStyle.horizontalScale) || 100
  pathOffsetValue.value = Number((store as any).textPathOffset) || 0
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

/** Apply a style change to every selected point text and record history. */
function applyTextStyle(apply: (item: paper.PointText) => void, label: string) {
  const e = getEngine()
  if (!e) return
  e.getSelection().forEach((item) => {
    if (item instanceof e.scope.PointText) {
      apply(item as paper.PointText)
      e.refreshItemGradient(item as paper.PointText)
    }
  })
  e.scope.view.update()
  e.pushHistory(label)
}

function onFontFamilyChange(val: string) {
  store.updateCharStyle({ fontFamily: val })
  applyTextStyle((item) => { item.fontFamily = val }, 'Change Font')
}

function onFontSizeChange(val: number | undefined) {
  if (!val) return
  if (leadingAuto.value) {
    const leading = val * 1.2
    leadingValue.value = Math.round(leading * 10) / 10
    store.updateCharStyle({ fontSize: val, leading, autoLeading: true })
    applyTextStyle((item) => {
      item.fontSize = val
      item.leading = leading
    }, 'Change Font Size')
  } else {
    store.updateCharStyle({ fontSize: val })
    applyTextStyle((item) => {
      item.fontSize = val
    }, 'Change Font Size')
  }
  syncAreaFromSelection()
}

function toggleBold() {
  const next = !isBold.value
  isBold.value = next
  store.updateCharStyle({ fontWeight: next ? 'bold' : 'normal' })
  applyTextStyle((item) => { item.fontWeight = next ? 'bold' : 'normal' }, 'Change Font Weight')
}

function toggleItalic() {
  const next = !isItalic.value
  isItalic.value = next
  store.updateCharStyle({ fontStyle: next ? 'italic' : 'normal' })
  applyTextStyle((item) => { (item as any).fontStyle = next ? 'italic' : 'normal' }, 'Change Font Style')
}

function toggleUnderline() {
  const next = !isUnderline.value
  isUnderline.value = next
  store.updateCharStyle({ underline: next })
  // Paper.js has no underline primitive: stored on charStyle + item data so
  // SVG export and future text engines can honour it.
  const e = getEngine()
  e?.getSelection().forEach((item) => { (item as any).data = { ...((item as any).data ?? {}), underline: next } })
  e?.scope.view.update()
  if (store.hasSelection) e?.pushHistory(next ? 'Underline On' : 'Underline Off')
}

function toggleStrikethrough() {
  const next = !isStrikethrough.value
  isStrikethrough.value = next
  store.updateCharStyle({ strikethrough: next })
  const e = getEngine()
  e?.getSelection().forEach((item) => { (item as any).data = { ...((item as any).data ?? {}), strikethrough: next } })
  e?.scope.view.update()
  if (store.hasSelection) e?.pushHistory(next ? 'Strikethrough On' : 'Strikethrough Off')
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
    pathOffsetValue.value = Number((store as any).textPathOffset) || 0
    return
  }
  pathOffsetValue.value = val
  ;(store as any).setTextPathOffset?.(val)
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

function onFillChange(val: string) {
  const e = getEngine()
  if (!e) return
  store.updateStyle({ fillColor: val || null })
  e.getSelection().forEach((item: any) => {
    if (item.fillColor !== undefined) {
      item.fillColor = val || null
    }
  })
  e.scope.view.update()
  e.pushHistory('Change Fill')
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

/** Build normalized gradient parameters from the editable stop list. */
function currentGradient(): GradientState {
  const stops = gradientStops.value
    .map((stop) => ({
      offset: Math.min(1, Math.max(0, (Number(stop.offset) || 0) / 100)),
      color: stop.color || '#000000',
    }))
    .sort((a, b) => a.offset - b.offset)
  const angle = gradientType.value === 'linear'
    ? ((Number(gradientAngle.value) || 0) % 360 + 360) % 360
    : undefined
  return angle === undefined ? { type: gradientType.value, stops } : { type: gradientType.value, stops, angle }
}

/** Write the edited gradient to the store and repaint the selection. */
function applyGradientToSelection(label: string) {
  const e = getEngine()
  if (!e) return
  const gradient = currentGradient()
  if (gradient.stops.length === 0) return
  store.updateStyle({ gradient })
  syncGradientFromStore()
  e.getSelection().forEach((item: any) => {
    e.applyStyleToItem(item, e.store.style)
  })
  e.scope.view.update()
  e.pushHistory(label)
}

function onFillKindChange(kind: 'solid' | 'gradient') {
  const e = getEngine()
  if (!e) return
  if (kind === 'gradient') {
    if (!store.style.gradient) {
      const from = store.style.fillColor || '#000000'
      store.updateStyle({
        gradient: { type: 'linear', stops: [{ offset: 0, color: from }, { offset: 1, color: '#ffffff' }] },
      })
    }
    syncGradientFromStore()
    applyGradientToSelection('Change Gradient')
  } else {
    store.updateStyle({ gradient: null })
    e.getSelection().forEach((item: any) => {
      e.applyStyleToItem(item, e.store.style)
    })
    e.scope.view.update()
    e.pushHistory('Change Fill')
  }
}

function onGradientChange() {
  applyGradientToSelection('Change Gradient')
}

function onGradientReverse() {
  gradientAngle.value = (Math.round(Number(gradientAngle.value) || 0) + 180) % 360
  applyGradientToSelection('Reverse Gradient')
}

function addGradientStop() {
  gradientStops.value.push({ offset: 50, color: '#808080' })
  applyGradientToSelection('Change Gradient')
}

function removeGradientStop(index: number) {
  if (gradientStops.value.length <= 2) return
  gradientStops.value.splice(index, 1)
  applyGradientToSelection('Change Gradient')
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
  e.pushHistory('Change Stroke')
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

/** Parse a dash pattern like "4 2" into lengths (empty means solid). */
function parseDashPattern(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n) && n >= 0)
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

const dashPresets = [
  { value: '', label: 'Solid' },
  { value: '4 2', label: 'Dashed' },
  { value: '1 2', label: 'Dotted' },
  { value: '6 2 1 2', label: 'Dash-Dot' },
  { value: '8 3 2 3', label: 'Long Dash' },
]
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
  e.pushHistory('Change Dash Offset')
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
  e.pushHistory('Change Opacity')
}

function onTransformChange() {
  const e = getEngine()
  if (!e) return
  if (!Number.isFinite(posW.value) || !Number.isFinite(posH.value)) return
  if (posW.value <= 0 || posH.value <= 0) return
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
  e.pushHistory('Transform')
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
  rotateBy.value = 0
}

// `immediate` covers the panel mounting after a selection already exists
// (the panel is v-if'd on hasSelection, so its first selection change is
// missed without it).
watch(() => store.selectedItemIds, () => {
  syncTransformFromSelection()
  syncGradientFromStore()
  syncStyleFromSelection()
  syncTextFromSelection()
  syncPatternFromSelection()
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
