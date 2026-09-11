/**
 * Pinia Store - only stores UI/metadata; geometry lives in Paper.js
 */
import { defineStore } from 'pinia'
import type {
  ToolName,
  StyleState,
  LayerMeta,
  ArtboardMeta,
  CharStyle,
  ParagraphStyle,
  RightPanelTab,
  RulerUnit,
  SnapSettings,
  ViewSettings,
  ReferencePoint,
  TransformState,
  HistoryEntry,
  CalloutStyle,
  AlignTarget,
  ToolRailDensity,
  WorkspacePreset,
} from './types'

// --- Defaults ---

/** Default style */
export function createDefaultStyle(): StyleState {
  return {
    fillColor: null,
    gradient: null,
    pattern: null,
    fillRule: 'nonzero',
    strokeColor: '#000000',
    strokeWidth: 1,
    strokeAlign: 'center',
    lineCap: 'round',
    lineJoin: 'miter',
    miterLimit: 4,
    dashArray: [],
    dashOffset: 0,
    opacity: 1,
    blendMode: 'source-over',
  }
}

/** Default character style */
export function createDefaultCharStyle(): CharStyle {
  return {
    fontFamily: 'Arial',
    fontSize: 12,
    fontWeight: 'normal',
    fontStyle: 'normal',
    tracking: 0,
    kerning: 0,
    horizontalScale: 100,
    verticalScale: 100,
    baselineShift: 0,
    characterRotation: 0,
    autoLeading: true,
    leading: 14,
    underline: false,
    strikethrough: false,
    align: 'left',
  }
}

/** Default paragraph style */
export function createDefaultParagraphStyle(): ParagraphStyle {
  return {
    align: 'left',
    firstLineIndent: 0,
    spaceBefore: 0,
    spaceAfter: 0,
  }
}

/** Default callout style */
export function createDefaultCalloutStyle(): CalloutStyle {
  return {
    color: '#333333',
    lineWidth: 1.5,
    fillColor: '#ffffff',
    textColor: '#333333',
    fontSize: 12,
    fontFamily: 'Arial',
    offset: 10,
    strokeAlign: 'center',
  }
}

export const useEditorStore = defineStore('editor', {
  state: () => ({
    /** Current tool */
    tool: 'select' as ToolName,
    /** Previous tool (restored when pressing Esc) */
    lastTool: 'select' as ToolName,
    /** Whether dragging */
    isDragging: false,
    /** Current style */
    style: createDefaultStyle() as StyleState,
    /** Current character style */
    charStyle: createDefaultCharStyle() as CharStyle,
    /** Current paragraph style */
    paragraphStyle: createDefaultParagraphStyle() as ParagraphStyle,
    /** Layer list */
    layers: [] as LayerMeta[],
    /** Currently active layer id */
    activeLayerId: '',
    /** List of selected Paper.js item ids */
    selectedItemIds: [] as string[],
    /** Ruler unit */
    rulerUnit: 'px' as RulerUnit,
    /** Arrow-key nudge distance in document units (Shift = x10) */
    nudgeStep: 1,
    /** View settings */
    view: {
      zoom: 1,
      rulersVisible: true,
      showGrid: false,
      showGuides: true,
      guidesLocked: true,
      transparentBackground: false,
      proofMode: 'rgb',
    } as ViewSettings,
    /** Snap settings */
    snap: {
      enable: true,
      point: true,
      grid: false,
      guides: true,
      smartGuides: true,
      gridSize: 10,
    } as SnapSettings,
    /** Transform panel state */
    transform: {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      flipH: false,
      flipV: false,
    } as TransformState,
    /** Reference point */
    referencePoint: 'center' as ReferencePoint,
    /** History list */
    history: [] as HistoryEntry[],
    /** History index (-1 means empty) */
    historyIndex: -1,
    /** History stack size limit */
    historyLimit: 100,
    /** Callout style */
    calloutStyle: createDefaultCalloutStyle() as CalloutStyle,
    /** Key object id for align-to-key (AI Alt-click parity, '' = none) */
    keyObjectId: '',
    /** Align target for the Align panel / control bar */
    alignTarget: 'selection' as AlignTarget,
    /** Exact gap used by distribute-gap-exact (document units) */
    distributeGap: 10,
    /** Recent fill/stroke colors for the Swatches panel + color bar */
    recentColors: [] as string[],
    /** Live-shape options surfaced in the contextual control bar */
    polygonSides: 5,
    polygonStar: false,
    starRatio: 0.5,
    /** Brush/blob/eraser footprint in screen px ([ ] resize, ControlBar edits) */
    brushSize: 20,
    spiralTurns: 3,
    roundedRadius: 12,
    gridRows: 4,
    gridCols: 4,
    /** Path-text start offset (document units along the path) */
    textPathOffset: 0,
    /** Cursor position (shown in the status bar) */
    cursorPos: { x: 0, y: 0 },
    /** Status bar message */
    statusMessage: '',
    /** Page settings (default size for new documents and artboards) */
    pageSize: { width: 1920, height: 1080 },
    /** Print bleed in document units (vector PDF page grows by this; 0 = trim only) */
    bleed: 0,
    /** Artboard list */
    artboards: [] as ArtboardMeta[],
    /** Currently active artboard id */
    activeArtboardId: '',
    /** UI state */
    ui: {
      panelCollapsed: false,
      showLayerPanel: true,
      showPropertyPanel: true,
      panelWidth: 240,
      rightTab: 'property' as RightPanelTab,
      settingsOpen: false,
      showNavigator: true,
      zenMode: false,
      showControlBar: true,
      toolRailDensity: 'single' as ToolRailDensity,
      workspace: 'essentials' as WorkspacePreset,
    },
    /** Whether isolated group editing is active */
    isolationActive: false,
  }),

  getters: {
    /** Currently selected layer */
    activeLayer(state): LayerMeta | undefined {
      return state.layers.find((l) => l.id === state.activeLayerId)
    },
    /** Currently active artboard */
    activeArtboard(state): ArtboardMeta | undefined {
      return state.artboards.find((b) => b.id === state.activeArtboardId)
    },
    /** Number of selected items */
    selectedCount(state): number {
      return state.selectedItemIds.length
    },
    /** Whether there is a selection */
    hasSelection(state): boolean {
      return state.selectedItemIds.length > 0
    },
    /** Whether undo is available (undo() steps back, so index 0 is inert) */
    canUndo(state): boolean {
      return state.historyIndex > 0
    },
    /** Whether redo is available */
    canRedo(state): boolean {
      return state.historyIndex < state.history.length - 1
    },
  },

  actions: {
    /** Switch tool */
    setTool(tool: ToolName) {
      if (this.tool !== tool) {
        this.lastTool = this.tool
        this.tool = tool
      }
    },

    /** Switch back to the previous tool */
    restoreTool() {
      this.tool = this.lastTool
    },

    /** Update style (partial update) */
    updateStyle(partial: Partial<StyleState>) {
      this.style = { ...this.style, ...partial }
    },

    /** Update character style */
    updateCharStyle(partial: Partial<CharStyle>) {
      this.charStyle = { ...this.charStyle, ...partial }
    },

    /** Update paragraph style */
    updateParagraphStyle(partial: Partial<ParagraphStyle>) {
      this.paragraphStyle = { ...this.paragraphStyle, ...partial }
    },

    /** Update callout style */
    updateCalloutStyle(partial: Partial<CalloutStyle>) {
      this.calloutStyle = { ...this.calloutStyle, ...partial }
    },

    /** Sync layer list */
    syncLayers(layers: LayerMeta[]) {
      this.layers = layers
      if (layers.length > 0 && !this.activeLayerId) {
        this.activeLayerId = layers[layers.length - 1].id
      }
    },

    /** Set the active layer */
    setActiveLayer(id: string) {
      this.activeLayerId = id
    },

    /** Set selected items */
    setSelection(itemIds: string[]) {
      this.selectedItemIds = [...itemIds]
    },

    /** Clear selection */
    clearSelection() {
      this.selectedItemIds = []
    },

    /** Add to selection */
    addToSelection(itemId: string) {
      if (!this.selectedItemIds.includes(itemId)) {
        this.selectedItemIds.push(itemId)
      }
    },

    /** Remove from selection */
    removeFromSelection(itemId: string) {
      this.selectedItemIds = this.selectedItemIds.filter((id) => id !== itemId)
    },

    /** Record cursor position */
    setCursorPos(x: number, y: number) {
      this.cursorPos = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
    },

    /** Set status bar message */
    setStatusMessage(msg: string) {
      this.statusMessage = msg
    },

    /** Update view settings */
    updateView(partial: Partial<ViewSettings>) {
      this.view = { ...this.view, ...partial }
    },

    /** Update snap settings */
    updateSnap(partial: Partial<SnapSettings>) {
      this.snap = { ...this.snap, ...partial }
    },

    /** Update transform panel */
    updateTransform(partial: Partial<TransformState>) {
      this.transform = { ...this.transform, ...partial }
    },

    /** Set reference point */
    setReferencePoint(point: ReferencePoint) {
      this.referencePoint = point
    },

    /** Set history index */
    setHistoryIndex(index: number) {
      this.historyIndex = index
    },

    /**
     * Mirror the engine history stack. Copied (not shared) so later engine
     * slices never alias the panel list; the engine owns snapshots.
     */
    setHistory(history: HistoryEntry[], index: number) {
      this.history = history.slice()
      this.historyIndex = index
    },

    /** Mark dragging state */
    setDragging(val: boolean) {
      this.isDragging = val
    },

    /** Update panel UI state */
    setPanelCollapsed(val: boolean) {
      this.ui.panelCollapsed = val
    },

    /** Enter or leave isolated group editing (banner driver) */
    setIsolationActive(val: boolean) {
      this.isolationActive = val
    },

    /** Show or hide the navigator minimap */
    setShowNavigator(val: boolean) {
      this.ui.showNavigator = val
    },

    /** Presentation mode: canvas only (Tab toggles, button exits) */
    setZenMode(val: boolean) {
      this.ui.zenMode = val
    },

    /** Show or hide the contextual control bar (AI Control / CDR Property bar) */
    setShowControlBar(val: boolean) {
      this.ui.showControlBar = val
    },

    /** Single- vs double-column tool rail */
    setToolRailDensity(val: ToolRailDensity) {
      this.ui.toolRailDensity = val
    },

    /** Apply a saved workspace preset */
    setWorkspace(val: WorkspacePreset) {
      this.ui.workspace = val
    },

    /** Switch the right-panel tab */
    setRightTab(tab: RightPanelTab) {
      this.ui.rightTab = tab
    },

    /** Open/close the canvas settings dialog */
    setSettingsOpen(val: boolean) {
      this.ui.settingsOpen = val
    },

    /** Set page size */
    setPageSize(width: number, height: number) {
      this.pageSize = { width, height }
    },

    /** Set print bleed (clamped to 0–100 document units) */
    setBleed(bleed: number) {
      if (!Number.isFinite(bleed)) return
      this.bleed = Math.min(100, Math.max(0, bleed))
    },

    /** Replace the artboard list (active id falls back to the first board) */
    setArtboards(boards: ArtboardMeta[]) {
      this.artboards = boards
      if (!boards.some((b) => b.id === this.activeArtboardId)) {
        this.activeArtboardId = boards.length > 0 ? boards[0].id : ''
      }
    },

    /** Set the active artboard */
    setActiveArtboard(id: string) {
      this.activeArtboardId = id
    },

    /** Add an artboard and activate it */
    addArtboard(board: ArtboardMeta) {
      this.artboards.push(board)
      this.activeArtboardId = board.id
    },

    /** Remove an artboard (the active id falls back to the first board) */
    removeArtboard(id: string) {
      const idx = this.artboards.findIndex((b) => b.id === id)
      if (idx >= 0) {
        this.artboards.splice(idx, 1)
        if (this.activeArtboardId === id) {
          this.activeArtboardId = this.artboards.length > 0
            ? this.artboards[Math.min(idx, this.artboards.length - 1)].id
            : ''
        }
      }
    },

    /** Update an artboard */
    updateArtboard(id: string, partial: Partial<ArtboardMeta>) {
      const board = this.artboards.find((b) => b.id === id)
      if (board) {
        Object.assign(board, partial)
      }
    },

    /** Set ruler unit */
    setRulerUnit(unit: RulerUnit) {
      this.rulerUnit = unit
    },

    /** Set/clear the align key object */
    setKeyObject(id: string) {
      this.keyObjectId = id
    },

    /** Set the align target mode */
    setAlignTarget(target: AlignTarget) {
      this.alignTarget = target
    },

    /** Set the exact distribute gap (must stay finite, >= 0) */
    setDistributeGap(gap: number) {
      if (Number.isFinite(gap) && gap >= 0) {
        this.distributeGap = gap
      }
    },

    /** Push a color to the recent-colors strip (dedupe, cap 12) */
    pushRecentColor(color: string) {
      const c = (color || '').trim()
      if (!c) return
      const next = [c, ...this.recentColors.filter((x) => x.toLowerCase() !== c.toLowerCase())]
      this.recentColors = next.slice(0, 12)
    },

    /** Live-shape option setters (clamped to sane ranges) */
    setPolygonSides(n: number) {
      if (Number.isFinite(n)) this.polygonSides = Math.min(64, Math.max(3, Math.round(n)))
    },
    setPolygonStar(on: boolean) {
      this.polygonStar = !!on
    },
    setStarRatio(n: number) {
      if (Number.isFinite(n)) this.starRatio = Math.min(0.9, Math.max(0.1, n))
    },
    setBrushSize(n: number) {
      if (Number.isFinite(n)) this.brushSize = Math.min(200, Math.max(1, Math.round(n)))
    },
    setSpiralTurns(n: number) {
      if (Number.isFinite(n)) this.spiralTurns = Math.min(12, Math.max(1, Math.round(n)))
    },
    setRoundedRadius(n: number) {
      if (Number.isFinite(n)) this.roundedRadius = Math.min(500, Math.max(0, n))
    },
    setGridOptions(rows: number, cols: number) {
      if (Number.isFinite(rows)) this.gridRows = Math.min(20, Math.max(1, Math.round(rows)))
      if (Number.isFinite(cols)) this.gridCols = Math.min(20, Math.max(1, Math.round(cols)))
    },
    setTextPathOffset(n: number) {
      if (Number.isFinite(n)) this.textPathOffset = n
    },

    /** Set arrow-key nudge distance (must stay positive) */
    setNudgeStep(step: number) {
      if (Number.isFinite(step) && step > 0) {
        this.nudgeStep = step
      }
    },

    /** Add a layer */
    addLayer(meta: LayerMeta) {
      this.layers.push(meta)
      this.activeLayerId = meta.id
    },

    /** Remove a layer */
    removeLayer(id: string) {
      const idx = this.layers.findIndex((l) => l.id === id)
      if (idx >= 0) {
        this.layers.splice(idx, 1)
        if (this.activeLayerId === id) {
          this.activeLayerId = this.layers.length > 0
            ? this.layers[Math.min(idx, this.layers.length - 1)].id
            : ''
        }
      }
    },

    /** Update a layer */
    updateLayer(id: string, partial: Partial<LayerMeta>) {
      const layer = this.layers.find((l) => l.id === id)
      if (layer) {
        Object.assign(layer, partial)
      }
    },

    /** Reorder layers */
    reorderLayer(fromIdx: number, toIdx: number) {
      const [layer] = this.layers.splice(fromIdx, 1)
      this.layers.splice(toIdx, 0, layer)
    },
  },
})
