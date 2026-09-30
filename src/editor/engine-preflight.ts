/**
 * Print-readiness domain (C1: slice out of engine.ts).
 *
 * Delegation target for the preflight check: takes the engine as an
 * explicit first argument and otherwise runs the historical method body
 * unchanged. The EditorEngine import is type-only, so the runtime
 * dependency flows one way (engine → engine-preflight). Display
 * labels/severity for these findings live in topbar-dialogs.ts.
 */
import type paper from 'paper'
import type { EditorEngine } from './engine'
import { isClipMask } from './paper-types'
import { colorToCSS, isOutOfCmykGamut, parseCssColor, rgbToCmyk } from './color'
import { collectSeparations } from './separations'

/** One preflight finding (print-readiness check). */
export interface PreflightIssue {
  kind:
    | 'overflow'
    | 'gamut'
    | 'tac'
    | 'small'
    | 'hairline'
    | 'dpi'
    | 'empty-layer'
    | 'spot'
    | 'transparency'
    | 'font'
  message: string
  itemId: string
}

export function preflight(e: EditorEngine): PreflightIssue[] {
  const scope = e.scope
  const out: PreflightIssue[] = []
  const labelOf = (item: paper.Item): string => {
    const data = (item as any).data ?? {}
    const raw = (item as any).name ?? data.name
    const name = typeof raw === 'string' && raw.trim() ? raw.trim() : ''
    if (name) return name
    const cls = String((item as any).className ?? 'Object')
    return `${cls} ${(data.id ?? '').toString().slice(0, 6)}`
  }
  const tc = e.getController('type') as {
    areaOverflow?: (item: any) => { lines: number; fits: number; overflowChars: number }
  } | null
  const walk = (node: paper.Item) => {
    const data = (node as any).data ?? {}
    if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard || data.annotation) return
    if (data.isPatternTile || isClipMask(node)) return
    if (node instanceof scope.PointText) {
      if ((data as any).textMode === 'area' && tc?.areaOverflow) {
        try {
          const over = tc.areaOverflow(node as paper.PointText)
          if (over.overflowChars > 0) {
            out.push({
              kind: 'overflow',
              message: `"${labelOf(node)}" overflows by ${over.overflowChars} chars`,
              itemId: String(data.id ?? ''),
            })
          }
        } catch { /* unreadable frames are not findings */ }
      }
      const pt = Number((node as any).fontSize) || 0
      if (pt > 0 && pt < 6) {
        out.push({
          kind: 'small',
          message: `"${labelOf(node)}" is ${Math.round(pt * 10) / 10}pt text (under 6pt)`,
          itemId: String(data.id ?? ''),
        })
      }
      return
    }
    if (node instanceof scope.Raster) {
      try {
        const px = Number((node as any).width) || 0
        const w = Number((node as any).bounds?.width) || 0
        if (px > 0 && w > 0) {
          const dpi = (px / w) * 96
          if (dpi < 150) {
            out.push({
              kind: 'dpi',
              message: `"${labelOf(node)}" is ${Math.round(dpi)} dpi (under 150)`,
              itemId: String(data.id ?? ''),
            })
          }
        }
      } catch { /* unreadable rasters are not findings */ }
      return
    }
    if (node instanceof scope.Path || node instanceof scope.CompoundPath) {
      const w = Number((node as any).strokeWidth) || 0
      if ((node as any).strokeColor && w > 0 && w < 0.5) {
        out.push({
          kind: 'hairline',
          message: `"${labelOf(node)}" has a ${w} hairline stroke (under 0.5)`,
          itemId: String(data.id ?? ''),
        })
        return
      }
      for (const key of ['fillColor', 'strokeColor'] as const) {
        const paint = (node as any)[key]
        if (!paint || paint.gradient) continue
        const css = colorToCSS(paint)
        if (!css) continue
        const rgba = parseCssColor(css)
        if (rgba) {
          const { c, m, y, k } = rgbToCmyk(rgba.r, rgba.g, rgba.b)
          if (c + m + y + k > 280) {
            out.push({
              kind: 'tac',
              message: `"${labelOf(node)}" totals ${c + m + y + k}% ink (over 280%)`,
              itemId: String(data.id ?? ''),
            })
            return
          }
        }
        if (css && isOutOfCmykGamut(css)) {
          out.push({
            kind: 'gamut',
            message: `"${labelOf(node)}" uses out-of-gamut ${key === 'fillColor' ? 'fill' : 'stroke'} ${css}`,
            itemId: String(data.id ?? ''),
          })
          break
        }
      }
      return
    }
    const children = (node as any).children as paper.Item[] | undefined
    if (children) for (const child of children) walk(child)
  }
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer) continue
    if (layer.children.length === 0) {
      out.push({ kind: 'empty-layer', message: `Layer "${(layer as any).name ?? 'Layer'}" is empty`, itemId: '' })
      continue
    }
    for (const child of layer.children) walk(child as paper.Item)
  }
  out.push(...printFindings(e))
  return out.slice(0, 50)
}

/**
 * Findings that only matter once the file is going to a press.
 *
 * The per-item checks above are about how the artwork looks; these are about
 * what the job needs. A spot ink means a separation the printer has to be
 * told about, live transparency is something most presses want flattened, and
 * a text family the PDF only references reflows if it is missing on the press
 * machine. All three were invisible before: the export succeeded and the
 * problem only turned up after the plates were made.
 */
function printFindings(e: EditorEngine): PreflightIssue[] {
  const out: PreflightIssue[] = []
  const scope = e.scope
  const spots = collectSeparations(e)
  for (const sep of spots) {
    out.push({
      kind: 'spot',
      message: `Spot ink "${sep.spot}" on ${sep.items} ${sep.items === 1 ? 'object' : 'objects'} — the job needs a plate for it`,
      itemId: '',
    })
  }
  // One line for the whole document rather than one per object: transparency
  // is flattened (or not) for the job, not per shape.
  let translucent = 0
  const fonts = new Set<string>()
  const walk = (node: paper.Item) => {
    const data = (node as any).data ?? {}
    if (data.isChrome || data.isPreview || data.isGuide || data.isArtboard || data.annotation) return
    if (data.isPatternTile || isClipMask(node)) return
    if (Number((node as any).opacity ?? 1) < 1) translucent += 1
    if (node instanceof scope.PointText) {
      const family = (node as any).fontFamily
      if (typeof family === 'string' && family) fonts.add(family)
    }
    const children = (node as any).children as paper.Item[] | undefined
    if (children) for (const child of children) walk(child)
  }
  for (const layer of e.project.layers) {
    if (!(layer.data as any)?.isUserLayer) continue
    for (const child of layer.children) walk(child as paper.Item)
  }
  if (translucent > 0) {
    out.push({
      kind: 'transparency',
      message: `${translucent} ${translucent === 1 ? 'object carries' : 'objects carry'} live transparency — most presses want it flattened`,
      itemId: '',
    })
  }
  for (const family of fonts) {
    out.push({
      kind: 'font',
      message: `Text in "${family}" — embedded when registered, referenced otherwise (it reflows on a press that lacks it)`,
      itemId: '',
    })
  }
  return out
}
