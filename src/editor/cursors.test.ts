/**
 * Cursor + tool-icon catalog coverage.
 *
 * The TS types guarantee Record<ToolName, ...> completeness at compile time;
 * these tests pin the runtime behavior: every tool resolves to a non-empty
 * cursor, the tools that used to fall back to a plain crosshair now carry
 * their own AI/CDR SVG cursor, and the icon set covers the same tool list so
 * the rail never renders an empty button.
 */
import { describe, expect, it } from 'vitest'
import {
  TOOL_CURSORS,
  cursorForTool,
  zoomCursor,
  handCursor,
  ringCursor,
  arrowResizeCursor,
  applyToolCursor,
} from './cursors'
import { TOOL_ICON_PATHS, toolIcon } from '../components/toolbar/tool-icons'

const isSvgCursor = (v: string) => v.startsWith('url("data:image/svg+xml,')

describe('tool cursors', () => {
  it('resolves a non-empty cursor for every tool', () => {
    for (const [tool, cursor] of Object.entries(TOOL_CURSORS)) {
      expect(cursor, tool).toBeTruthy()
      expect(typeof cursor, tool).toBe('string')
      expect(cursorForTool(tool as keyof typeof TOOL_CURSORS), tool).toBe(cursor)
    }
    expect(cursorForTool('nonexistent' as never)).toBe('default')
  })

  it('gives the icon tools their own SVG cursor (was plain crosshair)', () => {
    const iconTools = [
      'wand', 'lasso', 'knife', 'width', 'spray', 'gradient', 'scale', 'mirror',
      'free-transform', 'smooth', 'reshape', 'shape-builder', 'perspective-grid',
      'pen', 'curvature', 'add-anchor', 'delete-anchor', 'convert-anchor',
      'pencil', 'scissors', 'eyedropper', 'rotate',
    ] as const
    for (const tool of iconTools) {
      expect(isSvgCursor(TOOL_CURSORS[tool]), tool).toBe(true)
    }
  })

  it('keeps the AI crosshair convention for the shape tools', () => {
    for (const tool of ['line', 'rect', 'rounded-rect', 'ellipse', 'polygon', 'arc', 'spiral', 'rect-grid', 'polar-grid'] as const) {
      expect(TOOL_CURSORS[tool]).toBe('crosshair')
    }
  })

  it('keeps native cursors where AI uses them', () => {
    expect(TOOL_CURSORS.select).toBe('default')
    expect(TOOL_CURSORS.type).toBe('text')
    expect(TOOL_CURSORS['vertical-type']).toBe('vertical-text')
    expect(TOOL_CURSORS['view-hand']).toBe('grab')
  })
})

describe('zoom cursor', () => {
  it('swaps the + badge for − on zoom-out', () => {
    const inCursor = zoomCursor(false)
    const outCursor = zoomCursor(true)
    expect(isSvgCursor(inCursor)).toBe(true)
    expect(isSvgCursor(outCursor)).toBe(true)
    expect(inCursor).not.toBe(outCursor)
    // The plus badge is a two-stroke cross; zoom-out keeps only the bar.
    expect(decodeURIComponent(inCursor)).toContain('V13.8')
    expect(decodeURIComponent(outCursor)).not.toContain('V13.8')
  })

  it('carries the magnifier into the tool table', () => {
    expect(TOOL_CURSORS.zoom).toBe(zoomCursor(false))
  })
})

describe('stateful cursors', () => {
  it('hand: open at rest, fist while dragging', () => {
    expect(handCursor(false)).toBe('grab')
    expect(handCursor(true)).toBe('grabbing')
  })

  it('ring cursor follows the tool diameter and clamps tiny sizes', () => {
    expect(isSvgCursor(ringCursor(20))).toBe(true)
    expect(ringCursor(20)).not.toBe(ringCursor(40))
    expect(ringCursor(2)).toBe(ringCursor(6))
  })

  it('resize arrow folds by angle and caches', () => {
    expect(arrowResizeCursor(45)).toBe(arrowResizeCursor(225))
    expect(arrowResizeCursor(0)).not.toBe(arrowResizeCursor(45))
    expect(isSvgCursor(arrowResizeCursor(30))).toBe(true)
  })

  it('applyToolCursor writes the tool cursor onto the canvas', () => {
    const canvas = document.createElement('canvas')
    applyToolCursor(canvas, 'knife')
    expect(canvas.style.cursor).toBe(TOOL_CURSORS.knife)
    applyToolCursor(null, 'knife')
  })
})

describe('tool icon set', () => {
  it('covers every tool so the rail never renders an empty button', () => {
    for (const tool of Object.keys(TOOL_CURSORS)) {
      expect(toolIcon(tool), tool).not.toBe('')
    }
  })

  it('renders fragments (no <svg> wrapper of its own)', () => {
    for (const fragment of Object.values(TOOL_ICON_PATHS)) {
      expect(fragment).not.toContain('<svg')
      expect(fragment).toContain('<')
    }
  })

  it('unknown names resolve to empty (glyph fallback shows)', () => {
    expect(toolIcon('no-such-tool')).toBe('')
  })
})
