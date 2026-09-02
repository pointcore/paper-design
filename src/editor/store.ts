/**
 * Pinia Store - only stores UI/metadata; geometry lives in Paper.js
 */
import { defineStore } from 'pinia'
import type {
  ToolName,
  StyleState,
  LayerMeta,
  CharStyle,
  ParagraphStyle,
  RulerUnit,
  SnapSettings,
  ViewSettings,
  ReferencePoint,
  TransformState,
  HistoryEntry,
  LiveShapeParams,
  CalloutStyle,
} from './types'

// --- Defaults ---

/** Default style */
export function createDefaultStyle(): StyleState {
  return {
    fillColor: null,
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
    /** Name of the last operation (for menu state) */
    lastOperation: '',
    /** Ruler unit */
    rulerUnit: 'px' as RulerUnit,
    /** View settings */
    view: {
      zoom: 1,
      rulersVisible: true,
      showGrid: false,
      showGuides: true,
      smartGuides: true,
      pixelPreview: false,
      transparentBackground: false,
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
    /** Live shape parameters */
    liveShape: null as LiveShapeParams | null,
    /** History list */
    history: [] as HistoryEntry[],
    /** History index (-1 means empty) */
    historyIndex: -1,
    /** History stack size limit */
    historyLimit: 100,
    /** Callout style */
    calloutStyle: createDefaultCalloutStyle() as CalloutStyle,
    /** Current annotation tool subtype */
    annotationTool: 'callout' as 'callout' | 'measure',
    /** Cursor position (shown in the status bar) */
    cursorPos: { x: 0, y: 0 },
    /** Status bar message */
    statusMessage: '',
    /** Page settings (document width/height) */
    pageSize: { width: 1920, height: 1080 },
    /** UI state */
    ui: {
      panelCollapsed: false,
      showLayerPanel: true,
      showPropertyPanel: true,
      showTransformPanel: false,
      panelWidth: 240,
    },
    /** Clipboard copy queue */
    clipboard: null as any,
    /** Cutting state */
    isCutting: false,
    /** Whether previewing (during Live Shape drag) */
    isPreviewing: false,
  }),

  getters: {
    /** Currently selected layer */
    activeLayer(state): LayerMeta | undefined {
      return state.layers.find((l) => l.id === state.activeLayerId)
    },
    /** Number of selected items */
    selectedCount(state): number {
      return state.selectedItemIds.length
    },
    /** Whether there is a selection */
    hasSelection(state): boolean {
      return state.selectedItemIds.length > 0
    },
    /** Whether undo is available */
    canUndo(state): boolean {
      return state.historyIndex >= 0
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

    /** Update live shape parameters */
    setLiveShape(params: LiveShapeParams | null) {
      this.liveShape = params
    },

    /** Push a history entry */
    pushHistory(name: string, icon: string = 'history') {
      const entry: HistoryEntry = {
        name,
        icon,
        timestamp: Date.now(),
      }
      // Truncate the redo portion
      this.history = this.history.slice(0, this.historyIndex + 1)
      this.history.push(entry)
      // Enforce the length limit
      if (this.history.length > this.historyLimit) {
        this.history.shift()
      }
      this.historyIndex = this.history.length - 1
    },

    /** Set history index */
    setHistoryIndex(index: number) {
      this.historyIndex = index
    },

    /** Set history list */
    setHistory(history: HistoryEntry[], index: number) {
      this.history = history
      this.historyIndex = index
    },

    /** Set annotation tool */
    setAnnotationTool(tool: 'callout' | 'measure') {
      this.annotationTool = tool
    },

    /** Mark dragging state */
    setDragging(val: boolean) {
      this.isDragging = val
    },

    /** Toggle preview mode */
    setPreviewing(val: boolean) {
      this.isPreviewing = val
    },

    /** Update panel UI state */
    setPanelCollapsed(val: boolean) {
      this.ui.panelCollapsed = val
    },

    /** Set page size */
    setPageSize(width: number, height: number) {
      this.pageSize = { width, height }
    },

    /** Set ruler unit */
    setRulerUnit(unit: RulerUnit) {
      this.rulerUnit = unit
    },

    /** Set clipboard data */
    setClipboard(data: any) {
      this.clipboard = data
    },

    /** Set cutting state */
    setCutting(val: boolean) {
      this.isCutting = val
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
