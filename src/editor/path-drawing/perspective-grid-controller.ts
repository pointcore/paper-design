/**
 * Perspective Grid controller (AI/CDR parity).
 *
 * Draws a perspective construction grid overlay with draggable vanishing
 * points (VPs) and a horizon line. Supports 1-point, 2-point and 3-point
 * perspective modes. The grid is purely visual (overlay layer, tagged
 * isPreview) and does not mutate document geometry.
 *
 * Interactions:
 *  - Click the canvas (not on a handle) with the perspective-grid tool
 *    active: cycle perspective mode (1→2→3→off).
 *  - Drag a VP handle: repositions the vanishing point, redraws grid.
 *  - Drag the horizon line handle: shifts the horizon, redraws grid.
 *  - Escape or switch tool: hides the grid, restores default tool.
 *
 * Keyboard shortcut: Shift+P (toggled from shortcuts.ts).
 */
import type { EditorEngine } from '../engine'

interface Vec2 { x: number; y: number }

/** Perspective mode: number of vanishing points. */
type PerspMode = 0 | 1 | 2 | 3

const GRID_LINE_COUNT = 20
const HANDLE_RADIUS = 6
const HORIZON_HANDLE_W = 30
const HORIZON_HANDLE_H = 8
const VP_HIT_RADIUS = 12

/** colours for the three plane indicators (AI convention) */
const PLANE_LEFT = '#2196F3'   // blue  — left wall
const PLANE_RIGHT = '#F44336'  // red   — right wall
const PLANE_GROUND = '#4CAF50' // green — ground / floor

const GRID_COLOR_LEFT = 'rgba(33,150,243,0.35)'
const GRID_COLOR_RIGHT = 'rgba(244,67,54,0.35)'
const GRID_COLOR_GROUND = 'rgba(76,175,80,0.35)'
const GRID_COLOR_UNION = 'rgba(128,128,128,0.25)'
const HORIZON_COLOR = 'rgba(255,152,0,0.7)'
const HANDLE_FILL = '#FFFFFF'
const HANDLE_STROKE = '#333333'

export class PerspectiveGridController {
  engine: EditorEngine | null = null
  private scope: any = null
  private overlay: paper.Layer | null = null

  /** Current perspective mode. 0 = off (hidden). */
  private mode: PerspMode = 0

  /** Vanishing points in document coords. Index 0 = left VP, 1 = right VP, 2 = top VP. */
  private vps: Vec2[] = [
    { x: -300, y: 0 },
    { x: 300, y: 0 },
    { x: 0, y: -300 },
  ]

  /** Horizon Y offset from canvas center (document units). */
  private horizonY = 0

  /** Drag state */
  private dragging: 'vp0' | 'vp1' | 'vp2' | 'horizon' | null = null
  private dragStart: Vec2 = { x: 0, y: 0 }
  private vpDragStart: Vec2 = { x: 0, y: 0 }

  /** Reference to the Paper.js tool for cleanup. */
  private paperTool: any = null

  // ---- lifecycle ----

  attachEngine(engine: EditorEngine) {
    this.engine = engine
    this.scope = engine.scope
  }

  activate() {
    if (!this.engine) return
    this.overlay = this.engine.getOverlayLayer()

    // Toggle: if already showing, cycle mode; otherwise show with mode 1.
    if (this.mode === 0) {
      this.mode = 1
    } else {
      // cycle 1→2→3→0(off)
      this.mode = ((this.mode % 3) + 1) as PerspMode
      if (this.mode === 1 && this.engine) {
        // was 3, going to 1 → turn off instead of cycling
        this.mode = 0
      }
    }

    if (this.mode === 0) {
      this.clearGrid()
      this.deactivate()
      // Restore previous tool
      const last = this.engine.store.lastTool || 'select'
      this.engine.store.setTool(last)
      this.engine.setTool(last)
      return
    }

    this.engine.store.setDragging(false)
    this.setupTool()
    this.centerVPs()
    this.drawGrid()
  }

  deactivate() {
    this.dragging = null
    if (this.paperTool) {
      try { this.paperTool.remove() } catch { /* noop */ }
      this.paperTool = null
    }
  }

  /** Called by engine.setTool() to clean up overlay on tool switch. */
  destroy() {
    this.clearGrid()
    this.deactivate()
    this.mode = 0
  }

  // ---- Paper.js tool setup ----

  private setupTool() {
    if (!this.scope) return
    if (this.paperTool) {
      try { this.paperTool.remove() } catch { /* noop */ }
    }
    const Tool = this.scope.Tool
    this.paperTool = new Tool()

    this.paperTool.onMouseDown = (event: any) => {
      if (!this.engine) return
      const pt = event.point
      const hit = this.hitTest(pt)
      if (hit) {
        this.dragging = hit
        this.dragStart = { x: pt.x, y: pt.y }
        if (hit.startsWith('vp')) {
          const idx = parseInt(hit.charAt(2))
          this.vpDragStart = { ...this.vps[idx] }
        } else {
          this.dragStart = { x: 0, y: this.horizonY }
        }
        this.engine.store.setDragging(true)
      }
    }

    this.paperTool.onMouseDrag = (event: any) => {
      if (!this.dragging || !this.engine) return
      const pt = event.point
      if (this.dragging === 'vp0' || this.dragging === 'vp1' || this.dragging === 'vp2') {
        const idx = parseInt(this.dragging.charAt(2))
        this.vps[idx] = { x: pt.x, y: pt.y }
        // Constrain VPs to the horizon line in 1-point and 2-point modes
        if (this.mode <= 2 && idx < 2) {
          this.vps[idx].y = this.getHorizonY()
        }
        // Top VP (index 2) only moves vertically in 3-point
        if (this.mode === 3 && idx === 2) {
          this.vps[2].x = this.getCenter().x
        }
      } else if (this.dragging === 'horizon') {
        this.horizonY = pt.y - this.getCenter().y
        // Move VPs with the horizon
        for (let i = 0; i < Math.min(this.mode, 2); i++) {
          this.vps[i].y = this.getHorizonY()
        }
      }
      this.drawGrid()
    }

    this.paperTool.onMouseUp = (_event: any) => {
      if (this.dragging) {
        this.dragging = null
        this.engine?.store.setDragging(false)
      }
    }

    this.paperTool.onMouseMove = (event: any) => {
      if (!this.engine) return
      const pt = event.point
      const hit = this.hitTest(pt)
      if (hit) {
        this.engine.canvas.style.cursor = 'move'
      } else {
        this.engine.canvas.style.cursor = 'crosshair'
      }
    }

    this.paperTool.onKeyDown = (event: any) => {
      if (event.key === 'escape') {
        this.clearGrid()
        this.mode = 0
        this.deactivate()
        const last = this.engine?.store.lastTool || 'select'
        this.engine?.store.setTool(last)
        this.engine?.setTool(last)
      }
    }
  }

  // ---- geometry helpers ----

  private getCenter(): Vec2 {
    if (!this.engine) return { x: 0, y: 0 }
    const v = this.scope.view
    return { x: v.center.x, y: v.center.y }
  }

  private getHorizonY(): number {
    return this.getCenter().y + this.horizonY
  }

  private centerVPs() {
    const c = this.getCenter()
    const hy = this.getHorizonY()
    if (this.mode >= 1) {
      this.vps[0] = { x: c.x - 400, y: hy }
    }
    if (this.mode >= 2) {
      this.vps[1] = { x: c.x + 400, y: hy }
    }
    if (this.mode >= 3) {
      this.vps[2] = { x: c.x, y: c.y - 400 }
    }
  }

  // ---- hit testing ----

  private hitTest(pt: paper.Point): 'vp0' | 'vp1' | 'vp2' | 'horizon' | null {
    // Check VP handles first (they sit on top of the horizon)
    for (let i = 0; i < Math.min(this.mode, 3); i++) {
      const vp = this.vps[i]
      const dx = pt.x - vp.x
      const dy = pt.y - vp.y
      if (dx * dx + dy * dy < VP_HIT_RADIUS * VP_HIT_RADIUS) {
        return `vp${i}` as 'vp0' | 'vp1' | 'vp2'
      }
    }
    // Check horizon line handle
    if (this.mode >= 1) {
      const hy = this.getHorizonY()
      const cx = this.getCenter().x
      if (
        Math.abs(pt.y - hy) < HORIZON_HANDLE_H &&
        Math.abs(pt.x - cx) < HORIZON_HANDLE_W / 2
      ) {
        return 'horizon'
      }
    }
    return null
  }

  // ---- drawing ----

  private clearGrid() {
    if (!this.overlay) return
    const children = (this.overlay as any).children.slice() as paper.Item[]
    for (const child of children) {
      if ((child as any).data?.isPerspGrid) {
        try { child.remove() } catch { /* noop */ }
      }
    }
  }

  private drawGrid() {
    this.clearGrid()
    if (this.mode === 0 || !this.overlay || !this.scope) return

    const hy = this.getHorizonY()
    const c = this.getCenter()
    const v = this.scope.view
    const bounds = v.bounds

    // Extend grid lines well beyond the viewport
    const ext = Math.max(bounds.width, bounds.height) * 3

    // --- Horizon line ---
    this.addLine(
      { x: bounds.left - ext, y: hy },
      { x: bounds.right + ext, y: hy },
      HORIZON_COLOR, 1.5, [8, 4]
    )

    // --- Grid lines from canvas edges converging to VPs ---
    const drawCount = Math.min(this.mode, 3)
    for (let vi = 0; vi < drawCount; vi++) {
      const vp = this.vps[vi]
      const color = vi === 0 ? GRID_COLOR_LEFT : vi === 1 ? GRID_COLOR_RIGHT : GRID_COLOR_GROUND

      // Radial lines from VP to evenly-spaced points on the canvas edge
      for (let i = 0; i < GRID_LINE_COUNT; i++) {
        const t = (i / (GRID_LINE_COUNT - 1)) - 0.5 // -0.5..0.5
        // Target point on the opposite edge
        let target: Vec2
        if (vi === 2) {
          // Top VP: lines spread horizontally at the bottom
          target = { x: bounds.left + t * bounds.width * 2, y: bounds.bottom + ext }
        } else if (vi === 0) {
          // Left VP: lines spread vertically on the right edge
          target = { x: bounds.right + ext, y: bounds.top + t * bounds.height * 2 }
        } else {
          // Right VP: lines spread vertically on the left edge
          target = { x: bounds.left - ext, y: bounds.top + t * bounds.height * 2 }
        }
        this.addLine(vp, target, color, 0.7)
      }
    }

    // --- Cross-lines (orthogonal grid on the ground plane in 2-point) ---
    if (this.mode >= 2) {
      const crossCount = 12
      for (let i = 0; i < crossCount; i++) {
        const t = (i / (crossCount - 1)) - 0.5
        // Lines connecting corresponding points on left-VP and right-VP rays
        const leftRay = this.rayEndpoint(this.vps[0], hy, t, bounds, ext, 'h')
        const rightRay = this.rayEndpoint(this.vps[1], hy, t, bounds, ext, 'h')
        if (leftRay && rightRay) {
          this.addLine(leftRay, rightRay, GRID_COLOR_UNION, 0.5)
        }
      }
    }

    // --- Ground cross-lines in 1-point ---
    if (this.mode === 1) {
      const crossCount = 12
      const vp = this.vps[0]
      for (let i = 0; i < crossCount; i++) {
        const t = (i / (crossCount - 1))
        const y = hy + (bounds.bottom + ext - hy) * t
        // Horizontal line at each y, clipped to the cone from VP
        const spread = Math.abs(y - hy) * 0.8
        this.addLine(
          { x: vp.x - spread, y },
          { x: vp.x + spread, y },
          GRID_COLOR_GROUND, 0.5
        )
      }
    }

    // --- VP handles ---
    for (let i = 0; i < drawCount; i++) {
      this.addHandle(this.vps[i], i === 0 ? PLANE_LEFT : i === 1 ? PLANE_RIGHT : PLANE_GROUND)
    }

    // --- Horizon handle ---
    this.addHorizonHandle(c.x, hy)

    // --- Plane labels ---
    if (this.mode >= 2) {
      this.addLabel(this.vps[0], 'L', PLANE_LEFT)
      this.addLabel(this.vps[1], 'R', PLANE_RIGHT)
    }
    if (this.mode >= 3) {
      this.addLabel(this.vps[2], 'B', PLANE_GROUND)
    }

    // Ensure overlay stays on top
    this.overlay.parent?.addChild(this.overlay)
  }

  /** Compute where a ray from VP hits the viewport edge at parameter t ∈ [0,1]. */
  private rayEndpoint(
    vp: Vec2, horizonY: number, t: number,
    bounds: any, ext: number, _axis: 'h' | 'v'
  ): Vec2 | null {
    // Spread from horizon downward
    const y = horizonY + (bounds.height + ext) * (t - 0.5) * 2
    const dx = vp.x < bounds.center.x ? 1 : -1
    return { x: vp.x + dx * Math.abs(y - horizonY) * 1.5, y }
  }

  private addLine(from: Vec2, to: Vec2, color: string, width: number, dash?: number[]) {
    if (!this.overlay || !this.scope) return
    const path = new this.scope.Path({
      from: new this.scope.Point(from.x, from.y),
      to: new this.scope.Point(to.x, to.y),
      strokeColor: color,
      strokeWidth: width,
      dashArray: dash ?? [],
      data: { isPerspGrid: true },
    })
    ;(path as any).locked = true
    this.overlay.addChild(path)
  }

  private addHandle(pos: Vec2, color: string) {
    if (!this.overlay || !this.scope) return
    const circle = new this.scope.Path.Circle({
      center: new this.scope.Point(pos.x, pos.y),
      radius: HANDLE_RADIUS,
      fillColor: HANDLE_FILL,
      strokeColor: color,
      strokeWidth: 2,
      data: { isPerspGrid: true },
    })
    ;(circle as any).locked = true
    this.overlay.addChild(circle)
  }

  private addHorizonHandle(cx: number, cy: number) {
    if (!this.overlay || !this.scope) return
    const rect = new this.scope.Path.Rectangle({
      from: new this.scope.Point(cx - HORIZON_HANDLE_W / 2, cy - HORIZON_HANDLE_H / 2),
      to: new this.scope.Point(cx + HORIZON_HANDLE_W / 2, cy + HORIZON_HANDLE_H / 2),
      fillColor: 'rgba(255,152,0,0.3)',
      strokeColor: HORIZON_COLOR,
      strokeWidth: 1.5,
      cornerRadius: 3,
      data: { isPerspGrid: true },
    })
    ;(rect as any).locked = true
    this.overlay.addChild(rect)
  }

  private addLabel(pos: Vec2, text: string, color: string) {
    if (!this.overlay || !this.scope) return
    const label = new this.scope.PointText({
      point: new this.scope.Point(pos.x, pos.y - HANDLE_RADIUS - 8),
      content: text,
      fontSize: 11,
      fillColor: color,
      justification: 'center',
      data: { isPerspGrid: true },
    })
    ;(label as any).locked = true
    this.overlay.addChild(label)
  }

  // ---- public API for snap integration ----

  /** Returns the current vanishing points (document coords). */
  getVanishingPoints(): Vec2[] {
    return this.vps.slice(0, this.mode)
  }

  /** Returns the horizon Y in document coords. */
  getHorizon(): number {
    return this.getHorizonY()
  }

  /** Returns the current perspective mode (0=off, 1/2/3 = VP count). */
  getMode(): PerspMode {
    return this.mode
  }

  /**
   * Snap a point to the nearest perspective grid intersection.
   * Returns the snapped point, or the original if no snap is close enough.
   */
  snapToPerspective(pt: Vec2, tolerance: number = 10): Vec2 {
    if (this.mode === 0) return pt

    const hy = this.getHorizonY()
    let best = pt
    let bestDist = tolerance

    // Snap to horizon line
    if (Math.abs(pt.y - hy) < bestDist) {
      best = { x: pt.x, y: hy }
      bestDist = Math.abs(pt.y - hy)
    }

    // Snap to VP radial lines
    for (let vi = 0; vi < this.mode; vi++) {
      const vp = this.vps[vi]
      const snapped = this.snapToRay(pt, vp, tolerance)
      if (snapped.dist < bestDist) {
        best = snapped.point
        bestDist = snapped.dist
      }
    }

    return best
  }

  /** Snap point to the nearest position on a ray from origin. */
  private snapToRay(pt: Vec2, origin: Vec2, tolerance: number): { point: Vec2; dist: number } {
    const dx = pt.x - origin.x
    const dy = pt.y - origin.y
    const len = Math.sqrt(dx * dx + dy * dy)
    if (len < 1e-6) return { point: pt, dist: Infinity }
    // Project pt onto the ray
    const t = dx / len
    const projX = origin.x + t * len
    const projY = origin.y + (dy / len) * len
    const dist = Math.abs((pt.y - origin.y) * t - (pt.x - origin.x) * (dy / len))
    if (dist < tolerance) {
      return { point: { x: projX, y: projY }, dist }
    }
    return { point: pt, dist: Infinity }
  }
}
