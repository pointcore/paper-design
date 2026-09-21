/**
 * Mesh-gradient domain (C1: slice out of engine.ts).
 *
 * Delegation target for simulated mesh gradients (triangle
 * tessellation): each function takes the engine as an explicit first
 * argument and otherwise runs the historical method body unchanged. The
 * EditorEngine import is type-only, so the runtime dependency flows one
 * way (engine → engine-mesh). The private triangle helpers move along
 * as module functions since all of their callers live here.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import type { MeshGradientState, MeshGradientVertex } from './types'

export function getMeshGradient(e: EditorEngine, item: paper.Item): MeshGradientState | null {
  const data = (item.data as any) ?? {}
  return (data.meshGradient as MeshGradientState) ?? null
}

/** Create a default mesh gradient (2×2 grid, 4 vertices). */
export function createDefaultMeshGradient(e: EditorEngine, item: paper.Item): MeshGradientState {
  const bounds = item.bounds
  if (!bounds) {
    return { cols: 2, rows: 2, vertices: [] }
  }
  const w = bounds.width
  const h = bounds.height
  const vertices: MeshGradientVertex[] = [
    { x: 0, y: 0, color: '#ff0000' },
    { x: w, y: 0, color: '#ffff00' },
    { x: 0, y: h, color: '#0000ff' },
    { x: w, y: h, color: '#00ff00' },
  ]
  return { cols: 2, rows: 2, vertices }
}

/** Apply a mesh gradient to an item by tessellating into gradient-filled triangles. */
export function applyMeshGradient(e: EditorEngine, item: paper.Item, mesh: MeshGradientState): void {
  const data = (item.data as any) ?? {}
  data.meshGradient = mesh
  item.data = data

  // Remove old mesh children
  clearMeshGradientChildren(item)

  // Tessellate and render
  const bounds = item.bounds
  if (!bounds || mesh.vertices.length === 0) return

  const originX = bounds.x
  const originY = bounds.y
  const cellW = bounds.width / Math.max(mesh.cols - 1, 1)
  const cellH = bounds.height / Math.max(mesh.rows - 1, 1)

  const group = new e.scope.Group()
  ;(group as any).data = { isMeshGradientGroup: true, id: e.genId(), isUserItem: true }

  for (let r = 0; r < mesh.rows - 1; r++) {
    for (let c = 0; c < mesh.cols - 1; c++) {
      const tl = mesh.vertices[r * mesh.cols + c]
      const tr = mesh.vertices[r * mesh.cols + c + 1]
      const bl = mesh.vertices[(r + 1) * mesh.cols + c]
      const br = mesh.vertices[(r + 1) * mesh.cols + c + 1]

      // Upper-left triangle: tl, tr, bl
      renderMeshTriangle(e, group, originX, originY, tl, tr, bl)
      // Lower-right triangle: tr, br, bl
      renderMeshTriangle(e, group, originX, originY, tr, br, bl)
    }
  }

  item.parent?.insertChild(item.parent.children.length, group)
}

function renderMeshTriangle(
  e: EditorEngine,
  parent: paper.Group,
  ox: number, oy: number,
  v0: MeshGradientVertex, v1: MeshGradientVertex, v2: MeshGradientVertex,
) {
  const scope = e.scope
  const path = new scope.Path({
    segments: [
      [ox + v0.x, oy + v0.y],
      [ox + v1.x, oy + v1.y],
      [ox + v2.x, oy + v2.y],
    ],
    closed: true,
    insert: false,
  })

  // Compute centroid for gradient center
  const cx = (v0.x + v1.x + v2.x) / 3
  const cy = (v0.y + v1.y + v2.y) / 3

  // Use a linear gradient from v0→v2 blending the 3 vertex colors
  // This is an approximation; full barycentric would require per-pixel rendering
  const grad = new scope.Gradient()
  grad.stops = [
    new scope.GradientStop(new scope.Color(v0.color), 0),
    new scope.GradientStop(new scope.Color(v1.color), 0.5),
    new scope.GradientStop(new scope.Color(v2.color), 1),
  ]
  grad.radial = false

  const origin = new scope.Point(ox + v0.x, oy + v0.y)
  const destination = new scope.Point(ox + v2.x, oy + v2.y)
  path.fillColor = new scope.Color(grad, origin, destination)
  path.strokeWidth = 0
  ;(path as any).data = { isMeshTriangle: true }
  parent.addChild(path)
}

/** Remove all mesh gradient child triangles from an item. */
function clearMeshGradientChildren(item: paper.Item): void {
  const children = item.parent?.children ?? []
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i]
    const d = (child.data as any) ?? {}
    if (d.isMeshGradientGroup) {
      child.remove()
    }
  }
}

/** Remove mesh gradient from an item. */
export function removeMeshGradient(e: EditorEngine, item: paper.Item): void {
  const data = (item.data as any) ?? {}
  delete data.meshGradient
  item.data = data
  clearMeshGradientChildren(item)
}
