/**
 * Editor type definitions
 * All shared TypeScript types are defined here
 */

/** Tool name */
export type ToolName =
  | 'select'          // Select tool V
  | 'direct-select'   // Direct select A
  | 'pen'             // Pen tool P
  | 'curvature'       // Curvature Shift+~
  | 'add-anchor'      // Add anchor +
  | 'delete-anchor'   // Delete anchor -
  | 'convert-anchor'  // Convert anchor Shift+C
  | 'type'            // Text tool T
  | 'area-type'       // Area text
  | 'type-on-path'    // Text on path
  | 'vertical-type'   // Vertical text
  | 'line'            // Line
  | 'rect'            // Rectangle
  | 'rounded-rect'    // Rounded rectangle
  | 'ellipse'         // Ellipse
  | 'polygon'         // Polygon
  | 'arc'             // Arc
  | 'spiral'          // Spiral
  | 'rect-grid'       // Rectangular grid
  | 'polar-grid'      // Polar grid
  | 'pencil'          // Pencil N
  | 'blob-brush'      // Blob brush Shift+B
  | 'brush'           // Brush B
  | 'eraser'          // Eraser Shift+E
  | 'scissors'        // Scissors C
  | 'rotate'          // Rotate R
  | 'scale'           // Scale S
  | 'mirror'          // Mirror O
  | 'free-transform'  // Free transform E
  | 'view-hand'       // Hand tool H
  | 'zoom'            // Zoom Z
  | 'measure'         // Measure tool
  | 'callout'         // Callout
  | 'shape-builder'   // Shape builder Shift+M
  | 'eyedropper'      // Eyedropper I

/** Stroke alignment */
export type StrokeAlign = 'center' | 'inside' | 'outside'

/** Fill rule */
export type FillRule = 'nonzero' | 'evenodd'

/** Anchor type */
export enum AnchorType {
  Straight = 0,
  Smooth = 1,
  Symmetric = 2,
}

/** Line cap */
export type LineCap = 'round' | 'butt' | 'square'

/** Line join */
export type LineJoin = 'miter' | 'round' | 'bevel'

/** Text alignment */
export type TextAlign = 'left' | 'center' | 'right' | 'justify'

/** Text direction */
export type TextDirection = 'horizontal' | 'vertical'

/** One gradient color stop (offset 0-1). */
export interface GradientStopState {
  offset: number
  color: string
}

/** Gradient fill parameters (geometry derives from item bounds). */
export interface GradientState {
  type: 'linear' | 'radial'
  stops: GradientStopState[]
}

/** Character style state */
export interface CharStyle {
  fontFamily: string
  fontSize: number
  fontWeight: number | string
  fontStyle: 'normal' | 'italic' | 'oblique'
  tracking: number        // Tracking, unit em/1000
  kerning: number         // Kerning, unit em/1000
  horizontalScale: number // Horizontal scale %
  verticalScale: number   // Vertical scale %
  baselineShift: number   // Baseline shift pt
  characterRotation: number // Character rotation (deg)
  autoLeading: boolean    // Auto leading
  leading: number         // Leading pt
  underline: boolean
  strikethrough: boolean
  align: TextAlign
}

/** Paragraph style */
export interface ParagraphStyle {
  align: TextAlign
  firstLineIndent: number
  spaceBefore: number
  spaceAfter: number
}

/** Text type */
export type TextType = 'point' | 'area' | 'path' | 'vertical'

/** Style state - centrally manages object appearance */
export interface StyleState {
  fillColor: string | null
  gradient: GradientState | null
  fillRule: FillRule
  strokeColor: string | null
  strokeWidth: number
  strokeAlign: StrokeAlign
  lineCap: LineCap
  lineJoin: LineJoin
  miterLimit: number
  dashArray: number[]
  dashOffset: number
  opacity: number
  blendMode: string
  fontFamily?: string
  fontSize?: number
  charStyle?: CharStyle
  paragraphStyle?: ParagraphStyle
}

/** Layer metadata */
export interface LayerMeta {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  isUserLayer: boolean
  expand: boolean
}

/** Object-tree entry: one selectable user item within a layer. */
export interface LayerItemNode {
  id: string
  name: string
  depth: number
  visible: boolean
  locked: boolean
}

/** Artboard (page sheet) metadata; visuals derive from this list. */
export interface ArtboardMeta {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
}

/** Item metadata */
export interface ItemMeta {
  id: string
  name: string
  locked: boolean
  visible: boolean
  type: string
}

/** Live shape parameters */
export interface LiveShapeParams {
  kind: 'rect' | 'rounded-rect' | 'ellipse' | 'polygon' | 'line' | 'arc' | 'spiral' | 'rect-grid' | 'polar-grid'
  /** Common parameters */
  x?: number
  y?: number
  width?: number
  height?: number
  rx?: number
  ry?: number
  radius?: number
  radiusX?: number
  radiusY?: number
  startAngle?: number
  endAngle?: number
  innerRadius?: number
  twist?: number
  segments?: number
  rows?: number
  columns?: number
}

/** Transform state */
export interface TransformState {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  flipH: boolean
  flipV: boolean
}

/** Reference point */
export type ReferencePoint =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

/** Alignment edge for align-to-selection operations. */
export type AlignMode =
  | 'left' | 'centerX' | 'right'
  | 'top' | 'centerY' | 'bottom'

/** Axis for even distribution of selection centers. */
export type DistributeAxis = 'horizontal' | 'vertical'

/** Pathfinder boolean operation for combining paths. */
export type BooleanOperation = 'unite' | 'subtract' | 'intersect' | 'exclude'

/** Ruler unit */
export type RulerUnit = 'px' | 'pt' | 'mm' | 'cm' | 'in'

/** Right-panel tab */
export type RightPanelTab = 'property' | 'layer' | 'history'

/** History entry */
export interface HistoryEntry {
  name: string
  icon: string
  timestamp: number
}

/** Callout style */
export interface CalloutStyle {
  color: string
  lineWidth: number
  fillColor: string
  textColor: string
  fontSize: number
  fontFamily: string
  offset: number
  strokeAlign: StrokeAlign
}

/** Callout content model */
export interface CalloutModel {
  id: string
  text: string
  points: { x: number; y: number }[] // Callout line anchor points
  textPosition: { x: number; y: number }
  style: CalloutStyle
}

/** Path edit operation type */
export type PathEditOperation = 'move' | 'add-anchor' | 'delete-anchor' | 'convert-anchor' | 'adjust-handle'

/** Guide orientation */
export type GuideOrientation = 'horizontal' | 'vertical'

/** Guide definition (persisted on the guide layer) */
export interface GuideData {
  id: string
  /** Vertical guides run vertically at a fixed document X; horizontal guides run horizontally at a fixed document Y. */
  orientation: GuideOrientation
  /** Document coordinate — x for vertical guides, y for horizontal guides. */
  position: number
}

/** Snap settings */
export interface SnapSettings {
  enable: boolean
  point: boolean  // Snap to anchors
  grid: boolean   // Snap to grid
  guides: boolean // Snap to guides
  smartGuides: boolean // Smart guides
  gridSize: number
}

/** Canvas view settings */
export interface ViewSettings {
  zoom: number
  rulersVisible: boolean
  showGrid: boolean
  showGuides: boolean
  smartGuides: boolean
  pixelPreview: boolean
  /** Whether the canvas shows a transparent (checkerboard) background */
  transparentBackground: boolean
}

/** Export format */
export type ExportFormat = 'svg' | 'png' | 'jpeg' | 'pdf' | 'webp'

/** Raster export format supported by the canvas capture. */
export type RasterExportFormat = 'png' | 'jpeg' | 'webp'

/** Artwork source for raster export (page means the page-size rect). */
export type RasterExportArea = 'artwork' | 'selection' | 'page'

/** Options for rasterizing artwork through the paper.js view. */
export interface RasterExportOptions {
  format: RasterExportFormat
  /** Pixel scale multiplier (document units to output pixels). */
  scale: number
  /** Which artwork fills the output frame. */
  area: RasterExportArea
}

/** Versioned project file envelope used by Save/Open. */
export interface ProjectFileData {
  app: string
  version: number
  pageSize: { width: number; height: number }
  /** Paper.js project JSON string captured via project.exportJSON(). */
  snapshot: string
  /** Artboards (absent in files predating multi-artboard support). */
  artboards?: ArtboardMeta[]
  activeArtboardId?: string
}

/** Import result */
export interface ImportResult {
  success: boolean
  items: number
  message?: string
}

/** Annotation tool type */
export type AnnotationTool = 'callout' | 'measure'

/** SVG import options */
export interface SvgImportOptions {
  insert?: boolean
  applyTransform?: boolean
  expandShapes?: boolean
  embedImages?: boolean
  asImage?: boolean
  collapseFills?: boolean
}
