/**
 * AI/CDR-aligned tool icon set — inner-SVG fragments for a 24x24 viewBox.
 *
 * One visual language for the whole rail (Illustrator/CorelDRAW toolbox
 * convention) instead of a mix of Element Plus metaphors and emoji glyphs:
 * line icons in `currentColor`, so hover/active colors come from the rail.
 * The renderer (ToolIcon.vue) supplies the common presentation attributes;
 * individual fragments may override fill/stroke per element.
 */
export const TOOL_ICON_PATHS: Record<string, string> = {
  // --- select -----------------------------------------------------------
  // Solid arrow = select, hollow arrow = direct-select (AI).
  select:
    `<path d='M6 3 L6 17.6 L10 14 L12.6 19.9 L15.3 18.7 L12.7 13 L17.6 12.6 Z' fill='currentColor' stroke='none'/>`,
  'direct-select':
    `<path d='M6 3 L6 17.6 L10 14 L12.6 19.9 L15.3 18.7 L12.7 13 L17.6 12.6 Z'/>`,
  lasso:
    `<path d='M12 4 C6.8 4 3.6 6.9 3.6 10.4 C3.6 13.9 6.8 16.8 12 16.8 C17.2 16.8 20.4 13.9 20.4 10.4 C20.4 6.9 17.2 4 12 4 Z'/>` +
    `<path d='M8.6 16.3 C8 18.7 6.2 20.2 3.8 20.8'/>`,
  wand:
    `<path d='M4.5 19.5 L13.5 10.5'/>` +
    `<path d='M16.2 3.4 V6.6 M14.6 5 H17.8'/>` +
    `<path d='M20 8.4 V10.8 M18.8 9.6 H21.2'/>` +
    `<path d='M14.9 12.1 L16.3 13.5'/>`,
  'free-transform':
    `<rect x='5' y='7' width='14' height='10' stroke-dasharray='2.6 2'/>` +
    `<rect x='3.4' y='5.4' width='3.2' height='3.2' fill='currentColor' stroke='none'/>` +
    `<rect x='17.4' y='5.4' width='3.2' height='3.2' fill='currentColor' stroke='none'/>` +
    `<rect x='3.4' y='15.4' width='3.2' height='3.2' fill='currentColor' stroke='none'/>` +
    `<rect x='17.4' y='15.4' width='3.2' height='3.2' fill='currentColor' stroke='none'/>`,

  // --- pen family ---------------------------------------------------------
  pen:
    `<path d='M4.5 19.5 L6 14.4 L15.4 5 L19 8.6 L9.6 18 Z'/>` +
    `<path d='M4.5 19.5 L9.6 18 L6.7 15.1 Z' fill='currentColor' stroke='none'/>`,
  curvature:
    `<path d='M4 18.5 Q8.8 5.5 12.8 12 T20.5 7.5'/>` +
    `<circle cx='4' cy='18.5' r='1.7'/>` +
    `<circle cx='12.8' cy='12' r='1.7'/>` +
    `<circle cx='20.5' cy='7.5' r='1.7'/>`,
  'add-anchor':
    `<path d='M12 3.5 V9.5 M9 6.5 H15'/>` +
    `<rect x='8.6' y='13' width='6.8' height='6.8'/>`,
  'delete-anchor':
    `<path d='M9 6.5 H15'/>` +
    `<rect x='8.6' y='13' width='6.8' height='6.8'/>`,
  'convert-anchor':
    `<path d='M6 13.5 L12 5 L18 13.5'/>` +
    `<path d='M7 19 H17 M9.5 16.5 L7 19 L9.5 21.5 M14.5 16.5 L17 19 L14.5 21.5'/>`,

  // --- type ---------------------------------------------------------------
  type:
    `<path d='M6 5.5 H18 M12 5.5 V18.5'/>`,
  'area-type':
    `<rect x='4' y='5' width='16' height='14'/>` +
    `<path d='M8.5 9 H15.5 M12 9 V15.5'/>`,
  'type-on-path':
    `<path d='M4 17.5 C7.5 9 15.5 8.5 20 13'/>` +
    `<path d='M10.5 4.5 H15.5 M13 4.5 V9'/>`,
  'vertical-type':
    `<path d='M10 4.5 V19 M6 4.5 H14'/>` +
    `<path d='M18 9.5 V18.5 M15.4 16 L18 18.6 L20.6 16'/>`,

  // --- shapes ---------------------------------------------------------------
  line:
    `<path d='M6.6 17.4 L17.4 6.6'/>` +
    `<rect x='3.5' y='16.5' width='4' height='4' fill='currentColor' stroke='none'/>` +
    `<rect x='16.5' y='3.5' width='4' height='4' fill='currentColor' stroke='none'/>`,
  rect:
    `<rect x='4.5' y='6' width='15' height='12'/>`,
  'rounded-rect':
    `<rect x='4.5' y='6' width='15' height='12' rx='3.2'/>`,
  ellipse:
    `<ellipse cx='12' cy='12' rx='8' ry='6.4'/>`,
  polygon:
    `<path d='M12 3.8 L18.8 8 V16 L12 20.2 L5.2 16 V8 Z'/>`,
  arc:
    `<path d='M4 18 A10.5 10.5 0 0 1 20 18'/>` +
    `<path d='M4 18 L6.6 16.2 M20 18 L17.4 16.2'/>`,
  spiral:
    `<path d='M12 12 a1.6 1.6 0 0 1 -3.2 0 a3.2 3.2 0 0 1 6.4 0 a4.8 4.8 0 0 1 -9.6 0 a6.4 6.4 0 0 1 12.8 0 a8 8 0 0 1 -8 8'/>`,
  'rect-grid':
    `<rect x='4.5' y='4.5' width='15' height='15'/>` +
    `<path d='M4.5 9.5 H19.5 M4.5 14.5 H19.5 M9.5 4.5 V19.5 M14.5 4.5 V19.5'/>`,
  'polar-grid':
    `<circle cx='12' cy='12' r='7.5'/>` +
    `<circle cx='12' cy='12' r='3.6'/>` +
    `<path d='M12 4.5 V8.4 M12 15.6 V19.5 M4.5 12 H8.4 M15.6 12 H19.5'/>`,

  // --- paint ----------------------------------------------------------------
  pencil:
    `<path d='M4.5 19.5 L5.4 16.2 L15.8 5.8 L18.2 8.2 L7.8 18.6 Z'/>` +
    `<path d='M14 7.6 L16.4 10'/>`,
  'blob-brush':
    `<path d='M4.5 18.5 C5.5 10.5 11.5 5.5 19.5 4.5 C13.5 7.5 9.5 11.5 8.2 18.5 Z' fill='currentColor' stroke='none'/>`,
  brush:
    `<path d='M11.5 14.5 L19.2 6.8 C20.2 5.8 20.2 4.6 19.3 3.7 C18.4 2.8 17.2 2.8 16.2 3.8 L8.5 11.5'/>` +
    `<path d='M8.5 11.5 C5.8 12 4.6 14.6 4.2 19.8 C9.4 19.4 12 18.2 12.5 15.5'/>`,
  eraser:
    `<path d='M9.6 18.6 H5.4 L4 17.2 L13.2 8 L19.6 14.4 L15.4 18.6 Z'/>` +
    `<path d='M10 11.2 L14.4 15.6'/>` +
    `<path d='M4 20.6 H20'/>`,
  spray:
    `<rect x='7.5' y='10.5' width='7' height='9.5'/>` +
    `<path d='M9.6 10.5 V7.8 H12.4 V10.5'/>` +
    `<path d='M16.5 5 L18 3.5 M18.5 7.5 H20.5 M17 10 L18.5 11.5'/>` +
    `<circle cx='16.2' cy='7.5' r='0.9' fill='currentColor' stroke='none'/>`,

  // --- edit -----------------------------------------------------------------
  scissors:
    `<circle cx='6.2' cy='17.6' r='2.1'/>` +
    `<circle cx='12.2' cy='17.6' r='2.1'/>` +
    `<path d='M7.8 16 L18.8 4.4 M10.8 16 L14.6 11.2 L18.8 13'/>`,
  knife:
    `<path d='M4 20 L8.4 15.6'/>` +
    `<path d='M8.4 15.6 L19 5 L18.2 10.4 L11.8 16.6 Z'/>`,
  'shape-builder':
    `<circle cx='9' cy='12' r='5.6'/>` +
    `<rect x='11.4' y='7.6' width='8' height='8'/>` +
    `<path d='M4 4 L6.8 6.8' stroke-width='1.2'/>`,
  width:
    `<path d='M6 4.5 V19.5 M18 4.5 V19.5'/>` +
    `<path d='M6 12 H18 M9.2 9.2 L6 12 L9.2 14.8 M14.8 9.2 L18 12 L14.8 14.8'/>`,
  reshape:
    `<path d='M4 16.5 C7.6 16.5 8.8 8.5 12 8.5 C15.2 8.5 16.4 16.5 20 16.5'/>` +
    `<path d='M12 8.5 V3.5 M9.6 5.6 L12 3.2 L14.4 5.6'/>` +
    `<circle cx='12' cy='8.5' r='1.4' fill='currentColor' stroke='none'/>`,
  smooth:
    `<path d='M4 18 Q8.5 3.5 12.5 12 T20.5 7'/>` +
    `<path d='M15.5 16.5 C18 16.5 19.5 14.5 19.5 12.5'/>`,
  gradient:
    `<rect x='4' y='5' width='16' height='14'/>` +
    `<path d='M4 15.5 L14.5 5 M4 10.2 L9.2 5 M9 19 L20 8 M15 19 L20 14' stroke-width='1.1'/>`,
  eyedropper:
    `<path d='M5 19 L5.5 16.4 L15.6 6.3 L17.7 8.4 L7.6 18.5 Z'/>` +
    `<path d='M16.2 5.7 L18.3 3.6 A2.1 2.1 0 0 1 21.2 6.5 L19.1 8.6'/>`,
  'perspective-grid':
    `<path d='M12 4.5 L5.2 19.5 M12 4.5 L18.8 19.5'/>` +
    `<path d='M3.5 19.5 H20.5 M6.8 12 H17.2'/>`,

  // --- transform --------------------------------------------------------------
  rotate:
    `<path d='M18.8 12 A6.8 6.8 0 1 1 12 5.2'/>` +
    `<path d='M12 5.2 L15.4 2.9 M12 5.2 L15.4 7.5'/>` +
    `<circle cx='12' cy='12' r='1.4' fill='currentColor' stroke='none'/>`,
  scale:
    `<rect x='4' y='14' width='6' height='6'/>` +
    `<path d='M10.5 13.5 L20 4 M20 4 H14.8 M20 4 V9.2'/>`,
  mirror:
    `<path d='M12 3 V21' stroke-dasharray='2.6 2'/>` +
    `<path d='M8.8 7.5 V16.5 L3.6 12 Z' fill='currentColor' stroke='none'/>` +
    `<path d='M15.2 7.5 V16.5 L20.4 12 Z'/>`,

  // --- annotate / view ----------------------------------------------------------
  callout:
    `<path d='M4 4.5 H20 V14.5 H12.5 L8.5 19 V14.5 H4 Z'/>` +
    `<path d='M8 9.5 H8.01 M12 9.5 H12.01 M16 9.5 H16.01' stroke-width='2.2'/>`,
  measure:
    `<rect x='2.8' y='9' width='18.4' height='6.4'/>` +
    `<path d='M6.8 9 V11.6 M10.2 9 V12.6 M13.6 9 V11.6 M17 9 V12.6'/>`,
  'view-hand':
    `<path d='M7.6 12.6 V7.2 A1.3 1.3 0 0 1 10.2 7.2 V11.4'/>` +
    `<path d='M10.2 11.4 V5.9 A1.3 1.3 0 0 1 12.8 5.9 V11.4'/>` +
    `<path d='M12.8 11.4 V6.9 A1.3 1.3 0 0 1 15.4 6.9 V12.6'/>` +
    `<path d='M15.4 12.6 V9.6 A1.3 1.3 0 0 1 18 10 L18 14.8 C18 18.3 15.6 20.6 12.4 20.6 C9.4 20.6 8.3 19.4 6.2 16.2 C5.6 15.3 6.4 14.2 7.4 14.7 L7.6 14.9'/>`,
  zoom:
    `<circle cx='10.5' cy='10.5' r='6.6'/>` +
    `<path d='M15.4 15.4 L20.6 20.6'/>` +
    `<path d='M7.9 10.5 H13.1 M10.5 7.9 V13.1'/>`,
} as const

/** Icon key for every tool (ToolRail looks icons up by ToolName). */
export function toolIcon(name: string): string {
  return TOOL_ICON_PATHS[name] ?? ''
}
