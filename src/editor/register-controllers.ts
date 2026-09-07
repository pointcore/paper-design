/**
 * Register all tool controllers in one place
 */
import { EditorEngine } from './engine'
import { SelectController } from './selection/select-controller'
import { PenController } from './path-drawing/pen-controller'
import { PencilController } from './path-drawing/pencil-controller'
import { EraserController } from './path-drawing/eraser-controller'
import { BlobBrushController } from './path-drawing/blob-brush-controller'
import { BrushController } from './path-drawing/brush-controller'
import { ScissorsController } from './path-drawing/scissors-controller'
import { EyedropperController } from './selection/eyedropper-controller'
import { CurvatureController } from './path-drawing/curvature-controller'
import { AnchorController } from './path-drawing/anchor-controller'
import { ShapeController } from './shapes/shape-controller'
import { TextController } from './text/text-controller'
import { CalloutController } from './annotation/callout-controller'
import { MeasureController } from './annotation/measure-controller'
import { ViewController } from './view-controller'

export function registerAllControllers(engine: EditorEngine) {
  // Select tool (select and direct-select share the same implementation)
  const selectCtrl = new SelectController()
  engine.registerController('select', selectCtrl)
  engine.registerController('direct-select', selectCtrl)

  // Pen tool
  engine.registerController('pen', new PenController())

  // Pencil tool (freehand)
  engine.registerController('pencil', new PencilController())

  // Eraser tool (stroke subtraction)
  engine.registerController('eraser', new EraserController())

  // Blob brush (filled union strokes)
  engine.registerController('blob-brush', new BlobBrushController())

  // Calligraphic brush (flat-nib ribbon strokes)
  engine.registerController('brush', new BrushController())

  // Scissors tool (cut path at click)
  engine.registerController('scissors', new ScissorsController())

  // Eyedropper tool (appearance pickup)
  engine.registerController('eyedropper', new EyedropperController())

  // Curvature tool (independent of the pen tool)
  engine.registerController('curvature', new CurvatureController())

  // Anchor point tools (add / delete / convert)
  const anchorCtrl = new AnchorController()
  engine.registerController('add-anchor', anchorCtrl)
  engine.registerController('delete-anchor', anchorCtrl)
  engine.registerController('convert-anchor', anchorCtrl)

  // Shape tools (every registered tool draws its own geometry; unlisted
  // ToolName shapes stay available for scripts but have no drawing UI)
  const shapeCtrl = new ShapeController()
  for (const shape of [
    'rect', 'rounded-rect', 'ellipse', 'polygon', 'line', 'spiral'
  ] as const) {
    engine.registerController(shape, shapeCtrl)
  }

  // Text tools (one shared controller; the mode follows the active tool)
  const textCtrl = new TextController()
  engine.registerController('type', textCtrl)
  engine.registerController('area-type', textCtrl)
  engine.registerController('type-on-path', textCtrl)
  engine.registerController('vertical-type', textCtrl)

  // Annotation tools
  engine.registerController('callout', new CalloutController())
  engine.registerController('measure', new MeasureController())

  // View tools (hand / zoom share the same controller)
  const viewCtrl = new ViewController()
  engine.registerController('view-hand', viewCtrl)
  engine.registerController('zoom', viewCtrl)
}
