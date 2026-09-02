/**
 * Register all tool controllers in one place
 */
import { EditorEngine } from './engine'
import { SelectController } from './selection/select-controller'
import { PenController } from './path-drawing/pen-controller'
import { ShapeController } from './shapes/shape-controller'
import { CalloutController } from './annotation/callout-controller'
import { ViewController } from './view-controller'

export function registerAllControllers(engine: EditorEngine) {
  // Select tool (select and direct-select share the same implementation)
  const selectCtrl = new SelectController()
  engine.registerController('select', selectCtrl)
  engine.registerController('direct-select', selectCtrl)

  // Pen tool
  const penCtrl = new PenController()
  engine.registerController('pen', penCtrl)
  engine.registerController('curvature', penCtrl)

  // Shape tools
  const shapeCtrl = new ShapeController()
  for (const shape of [
    'rect', 'rounded-rect', 'ellipse', 'polygon', 'line',
    'arc', 'spiral', 'rect-grid', 'polar-grid'
  ] as const) {
    engine.registerController(shape, shapeCtrl)
  }

  // Annotation tools
  engine.registerController('callout', new CalloutController())

  // View tools (hand / zoom share the same controller)
  const viewCtrl = new ViewController()
  engine.registerController('view-hand', viewCtrl)
  engine.registerController('zoom', viewCtrl)
}
