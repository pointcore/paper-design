# Vue Vector Editor

A vector graphics editor built with **Vue 3 + TypeScript + Paper.js**, offering pen, path editing, text, annotation, and live shape capabilities. UI state is managed by Pinia; all geometry data is handled by Paper.js.

> Internal project codename `vue-vector-editor` (npm package name `vue-vector-editor`).

---

## Features

- **Pen & Curvature tools**: Dual Pen/Curvature tools with rubber-band preview, hover states, anchor add/delete/convert, handle linkage, 45° Shift constraints and Alt handle breaking.
- **Pencil tool**: Freehand strokes with minimum-spacing capture and zoom-scaled simplify smoothing on release; Escape cancels, dots are discarded.
- **Eraser tool**: Drag paints a fixed screen-size stroke that subtracts from every unlocked path it touches (clicks punch holes); one history entry per drag.
- **Blob brush**: Drag paints a fixed screen-size stroke that expands into a filled shape with the current style (clicks paint dots); same-color merging is out of scope.
- **Brush tool**: Flat-nib calligraphic ribbons (fixed 45° nib, hairline floor, pen pressure when reported) committing as one filled shape in the stroke color.
- **Symbols**: Named definitions behind hidden keepers (undo/save-safe), place instances, delete definitions (instances keep working), break links back to plain art, per-symbol instance counts.
- **Scissors tool**: Click a path to cut it at that point (open paths split in two, closed paths open up); endpoint clicks are no-ops.
- **Eyedropper tool**: Click artwork to load its appearance (fill incl. gradients, stroke, dash, opacity, blend, text styling) into the defaults and repaint the current selection.
- **Path editing**: In Direct Select mode the hit priority is handle > anchor > segment > object; supports anchor and curve-segment sub-selection (click a stroke to select the whole curve with both end anchors in the layer color, drag to move with Shift axis-lock and snapping, Alt-drag duplicates the path, Delete removes the curve and splits the path open, arrows nudge anchors, Ctrl+A takes every anchor).
- **Text tools**: Point, area (dragged frame with canvas-measured word wrap, resizable via the Text panel with overflow readout and one-way flow to a linked frame), path-attached (one rotated glyph per character, tracking-aware, start-offset control, auto re-laid when its path moves or reshapes) and vertical text. Leading (auto 1.2x or custom), tracking, baseline shift, horizontal scale, underline/strikethrough (stored for export) apply to new text and re-wrap area frames; justification adds Justify (stored, renders as left until a text engine lands); UPPER/lower/Title Case buttons apply to selected text. All modes edit through an HTML overlay that mirrors the typography at the current zoom; sessions commit on Escape, a click outside, or a tool switch; double-click a text item with a select tool to re-enter editing. Font family, size, weight, italic and alignment come from the properties panel.
- **Live shapes**: Rectangle, rounded rectangle (radius option), ellipse, line, arc, polygon/star (sides + star toggle with inner-radius ratio), rectangular/polar grids (rows/cols) and Archimedean spiral (turns option) with live preview (not added to history until confirmed). Shift constrains proportions (square/circle, 45° lines), Alt draws from the center. Shape options live in the contextual control bar.
- **Workspace layout**: Contextual control bar under the menu (tool/shape/text/transform quick controls, align shortcuts), grouped tool rail with flyouts + search + single/double column, right dock with Properties / Align+Pathfinder / Layers / Artboards / Swatches / Symbols / History / Actions tabs, artboard doc tabs above the canvas, bottom color bar (fill/stroke target, presets, recents, X swaps target), and an enriched status bar (snap toggle, key-object indicator, board position, zoom presets).
- **Transform**: Selection bounding-box scale handles plus a rotate knob (Shift = uniform / 45° snap), a properties panel with X/Y/W/H, rotate-by degrees, flip H/V and a nine-point reference anchor that drives panel edits, plus Rotate (Shift+R drag about the reference pivot) / Scale (Shift+S) / Mirror (Shift+O click) / Free Transform (Shift+F, select bbox) tools and a contextual control bar (angle/scale/flip), plus destructive envelope presets (arc upper/lower, bulge, wave) on paths via the Object menu.
- **Align & Pathfinder**: Six align modes (to selection, artboard, or a picked key object) and center/equal-gap distribution with an exact-gap value for multi-selections; unite / subtract (Minus Front) / intersect / exclude plus Minus Back / Divide / Trim / Outline (stroke expansion) boolean operations on selected paths.
- **Path construction**: Make/release even-odd compound paths, join two open paths end to end (object join or Ctrl+J on two sub-selected endpoints, same-path ends close), close/open paths, add anchor points to every curve, reverse path direction, arrowheads on open paths (destructive markers), offset paths (expand/inset with join control), simplify anchor counts, outline strokes into filled shapes (paperjs-offset), clean up stray geometry, make/release clipping masks, and a Shape Builder tool (Shift+M drag to unite touched paths, Alt-drag to subtract), plus a Width tool (Shift+W drag on a stroked path to vary its width, expands to a filled outline).
- **Snapping**: Snap pointer and placement to ruler guides, grid crossings and anchor points, plus smart edge/center alignment guides while dragging. Every source has a toggle in Canvas Settings.
- **Clipboard**: Instant internal copy/cut/paste plus OS clipboard SVG exchange (copy out to other apps, paste SVG in), on Ctrl+C/X/V, the Edit menu and the canvas context menu.
- **Save / Open / Export**: Versioned JSON project files (v2 nested snapshot, v1 files still open; files over 150 MB are refused with a message; Save/Open truly round-trips the document, page size, bleed and artboards included); SVG import/export (editor layers stay out of exports; OS files can also be drag-dropped onto the canvas); raster PNG/JPEG/WebP export with 1x–3x scale and artwork/selection/page choice; Copy as PNG (Ctrl+Shift+C) and Export Selection SVG; active-board or all-boards PDF export in Raster (2x images full-bleed) or Vector (selectable paths/text via svg2pdf, fonts referenced not embedded, document bleed + crop marks, one-up pages); bitmap placement (PNG/JPEG/WebP/GIF) with embedded persistent sources.
- **Layers**: Create/delete/rename, visibility/lock/opacity, top-first drag reorder, AI-style nested object tree (live SVG thumbnails with glyph fallback, groups, sublayers, clip/compound/path/text/image/symbol entries with per-row select/visibility/lock/rename), Group/Ungroup plus New Sublayer buttons, drag-drop reorder/reparent across layers and groups, right-click menu (Collect in New Layer, Release to Layers, Expand/Collapse All). Sublayers are flagged groups, so the flat `project.layers` stack (and sync/export/order) is untouched.
- **Artboards**: Multiple named page sheets with white-sheet visuals and labels, add (offset beside active) / duplicate (with overlapping artwork, thread links remapped) / fit-to-artwork / row arrange / delete / rename, click-to-activate with pan, per-board position and size; Save/Open round-trips the set, raster page export targets the active board.
- **Object ops**: Bring to front/back plus stepwise forward/backward, group/ungroup, isolate groups (double-click, banner + Esc to exit), lock/unlock-all, hide/show-all, select same fill/stroke/stroke-width/opacity/blend-mode plus stray points and text objects, adjust colors through HSL, lasso loop selection (Q, Shift adds, Alt removes), magic wand (Y, click a fill, Shift-click adds). Locked items are skipped by selection and tools; hidden items never hit-test.
- **Appearance**: Single fill + stroke with caps, joins, miter limit, dash presets + custom patterns and all 16 canvas blend modes, plus opacity and linear (angle-adjustable via the Gradient tool (G) drag or panel, survives transforms)/radial gradient fills with a stops editor. Swatches panel + bottom color bar (presets, recents, fill/stroke target) apply live from the properties panel to the selection and to subsequently drawn shapes. View > CMYK Preview adds numeric C/M/Y/K readouts with out-of-gamut flags (canvas still renders RGB); fill/stroke accept spot-color placeholder names persisted in project JSON (paints render/export with their RGB preview).
- **Pattern fills**: Procedural dots/stripes/grid/crosshatch swatches (motif color + background + scale + angle) rendered as clipped tile groups, so they survive history, Save/Open and SVG export. Apply/retile/remove from the Properties panel or Object menu; eyedropper picks patterns; remove before boolean ops.
- **Page setup**: Canvas Settings page size (presets, custom W/H, orientation swap) driving New Document, Save/Open persistence and page-area raster export, plus document bleed (dashed canvas guide, persisted, vector PDF pages grow with crop marks).
- **Guides & grid**: Ruler drag-out guides with move/delete (drag back to a ruler) plus a View > Guides dialog with numeric positions and Clear All, line grid with size control (major line every 5 steps, Ctrl+" toggles, grid never leaks into history/files/exports), transparent checkerboard background.
- **Navigator**: Floating whole-scene minimap (artwork plus artboard sheets) with a live viewport rectangle; click or drag to pan (clicking a sheet also activates its artboard), collapsible, toggleable from the View menu.
- **History**: Whole-project JSON snapshots with a 100-entry limit, listed in the History panel with click-to-jump and clearing; Ctrl+Z to undo, Ctrl+Shift+Z / Ctrl+Y to redo. The Actions tab adds working workspace presets (Essentials/Typography/Print rearrange the dock, Print enables CMYK proof; prefs persist across reloads), multi-scale asset export (1x/2x/3x), and a shortcut cheatsheet.
- **Annotation tools**: Callout annotations (leader line plus multi-line label, style edited live in the control bar when the Callout tool is active; double-click a label with a select tool to re-edit it).
- **Measure tool**: Drag for a dashed preview with length (ruler units) and angle in the status bar; both ends snap to geometry; transient, nothing is committed.

Not yet implemented: mesh gradients, opacity masks, and multi-fill/stroke appearance stacks.

---

## Tech Stack

| Category | Choice |
| --- | --- |
| Frontend framework | Vue 3 + TypeScript |
| Graphics engine | Paper.js (`paper` ^0.12.17) + `paperjs-offset` |
| State management | Pinia |
| UI components | Element Plus 2.14 + `@element-plus/icons-vue` |
| Build tool | Vite 5 + `vue-tsc` type checking |
| Testing | `npm test` runs `scripts/check-engine-size.js` plus `vitest run` (unit tests for pure modules like color conversion and shortcut routing) |

---

## Quick Start

### Requirements

- **Node.js ≥ 22.6** (per `engines`; 22 LTS recommended)
- Package manager: npm (`package-lock.json` is gitignored and untracked, so `npm ci` will fail; use `npm install`)

### Install

```bash
npm install
```

### Local development

```bash
npm run dev          # Start the Vite dev server, default http://localhost:5173
```

### Build & preview

```bash
npm run build        # Run type checking (vue-tsc -b) first, then Vite production build
npm run preview      # Preview the production build locally
```

### Run checks

```bash
npm test             # Engine size check (scripts/check-engine-size.js) + unit tests (vitest run)
npm run test:unit    # Unit tests only
```

Available scripts are `dev`, `build`, `preview`, `test` and `test:unit` (see `package.json`).

---

## Project Structure

```
src/
├── editor/                          # Editor core
│   ├── engine.ts                    # EditorEngine: document ops + Vue/Pinia ↔ Paper.js bridge
│   ├── store.ts / store-types.ts    # Pinia store (UI/metadata only, no geometry)
│   ├── types.ts                     # ToolName / StyleState / LayerMeta / Guide / Snap / ... toolbox
│   ├── shortcuts.ts                 # Global tool-switch and clipboard/history shortcuts
│   ├── register-controllers.ts      # One place where every tool controller is registered
│   ├── view-controller.ts           # Zoom/pan (hand + zoom tools)
│   ├── transform/transform-controller.ts # Rotate/Scale/Mirror drag tools
│   ├── path-drawing/                # Pen + curvature + anchor tools, anchor chrome
│   ├── selection/                   # Select / direct-select (bbox transform, marquee, guides)
│   ├── shapes/                      # Live shape tools
│   ├── text/                        # Point / area / path / vertical text controller
│   ├── snap/                        # Pointer snapping + smart alignment guides
│   ├── guides/                      # Ruler guide interaction
│   └── annotation/                  # Callout annotations
├── components/
│   ├── canvas/CanvasHost.vue        # Canvas + rulers + context menu + engine bootstrap
│   ├── canvas/DocTabs.vue + ColorBar.vue # Artboard tabs + bottom palette
│   ├── menus/TopBar.vue             # File/Edit/Object/View menus, settings, export dialogs
│   ├── menus/ControlBar.vue         # Contextual control bar (AI Control / CDR Property bar)
│   ├── panels/LayerPanel.vue        # Layers (reorder, opacity, object tree)
│   ├── panels/AlignPanel.vue        # Align + distribute + Pathfinder (incl. key object)
│   ├── panels/SwatchesPanel.vue     # Swatches + recents
│   ├── panels/ActionsPanel.vue      # Workspaces + asset export + shortcuts
│   ├── panels/PropertyPanel.vue     # Fill/stroke/appearance/text/transform/align/pathfinder
│   └── toolbar/ToolRail.vue         # Grouped tool buttons with flyouts + search
└── main.ts                          # Entry (Pinia + Element Plus, mounts App)
scripts/
└── check-engine-size.js             # Size check run by npm test
```

---

## Architecture Highlights

- **The single source of truth for geometry is Paper.js; Pinia stores only metadata.** The engine reads and writes Paper.js objects directly and syncs the UI panels via selection/layer sync calls.
- **Tool interaction logic lives in controller modules** (`selection/`, `path-drawing/`, `text/`, `shapes/`, `snap/`, `guides/`, `annotation/`); document-level operations (history, clipboard, boolean ops, raster export, save/open, layer and object ops) live on the engine. New tool behavior belongs in a controller.
- User layers are marked `layer.data.isUserLayer = true` (user items carry `data.id` / `data.isUserItem`); grid, overlay, annotation and guide layers are hidden during SVG/raster export.
- The entry `App.vue` constructs the `EditorEngine` once and `provide('engine', engine)`; components access it via `inject<Ref<EditorEngine>>('engine')`.

---

## Notes

- Unit tests live next to the source (`src/**/*.test.ts`, run by `vitest run`); `src/api/` is gitignored and intended for local-only credentials.
- `package-lock.json` is gitignored and untracked, so `npm ci` will fail; dependency versions are not locked.
- Build outputs (`dist/`) and `*.tsbuildinfo` files are generated — do not hand-edit them.

---

## License

Internal project; license per the project owner's terms.
