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

/** Ruler unit */
export type RulerUnit = 'px' | 'pt' | 'mm' | 'cm' | 'in'

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
