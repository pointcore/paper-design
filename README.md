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
- **Path editing**: In Direct Select mode the hit priority is handle > anchor > object; supports anchor sub-selection, marquee select, move, duplicate and delete.
- **Text tools**: Point, area (dragged frame with canvas-measured word wrap), path-attached (one rotated glyph per character) and vertical text. All modes edit through an HTML overlay that mirrors the typography at the current zoom; sessions commit on Escape, a click outside, or a tool switch; double-click a text item with a select tool to re-enter editing. Font family, size, weight, italic and alignment come from the properties panel.
- **Live shapes**: Rectangle, rounded rectangle, ellipse, line, pentagon and Archimedean spiral with live preview (not added to history until confirmed). Shift constrains proportions (square/circle, 45° lines), Alt draws from the center.
- **Transform**: Selection bounding-box scale handles plus a rotate knob (Shift = uniform / 45° snap), and a properties panel with X/Y/W/H, rotate-by degrees, flip H/V and a nine-point reference anchor that drives panel edits.
- **Align & Pathfinder**: Six align modes and horizontal/vertical distribution for multi-selections (align-to-selection); unite / subtract / intersect / exclude boolean operations on selected paths.
- **Path construction**: Make/release even-odd compound paths, join two open paths end to end, close/open paths, simplify anchor counts, outline strokes into filled shapes (paperjs-offset), and make/release clipping masks.
- **Snapping**: Snap pointer and placement to ruler guides, grid crossings and anchor points, plus smart edge/center alignment guides while dragging. Every source has a toggle in Canvas Settings.
- **Clipboard**: Instant internal copy/cut/paste plus OS clipboard SVG exchange (copy out to other apps, paste SVG in), on Ctrl+C/X/V, the Edit menu and the canvas context menu.
- **Save / Open / Export**: Versioned JSON project files (Save/Open truly round-trip the document, page size included); SVG import/export (editor layers stay out of exports); raster PNG/JPEG/WebP export with 1x–3x scale and artwork/selection/page choice; active-board or all-boards PDF export (2x rasters embedded full-bleed); bitmap placement (PNG/JPEG/WebP/GIF) with embedded persistent sources.
- **Layers**: Create/delete/rename, visibility/lock/opacity, top-first drag reorder, AI-style nested object tree (live SVG thumbnails with glyph fallback, groups, sublayers, clip/compound/path/text/image/symbol entries with per-row select/visibility/lock/rename), Group/Ungroup plus New Sublayer buttons, drag-drop reorder/reparent across layers and groups, right-click menu (Collect in New Layer, Release to Layers, Expand/Collapse All). Sublayers are flagged groups, so the flat `project.layers` stack (and sync/export/order) is untouched.
- **Artboards**: Multiple named page sheets with white-sheet visuals and labels, add (offset beside active) / delete / rename, click-to-activate with pan, per-board position and size; Save/Open round-trips the set, raster page export targets the active board.
- **Object ops**: Bring to front/back plus stepwise forward/backward, group/ungroup, isolate groups (double-click, banner + Esc to exit), lock/unlock-all, hide/show-all, select same fill/stroke. Locked items are skipped by selection and tools; hidden items never hit-test.
- **Appearance**: Single fill + stroke with caps, joins, miter limit, dash patterns and all 16 canvas blend modes, plus opacity and linear/radial gradient fills with a stops editor. Fill, stroke and stop pickers support alpha; applied live from the properties panel to the selection and to subsequently drawn shapes.
- **Page setup**: Canvas Settings page size (presets, custom W/H, orientation swap) driving New Document, Save/Open persistence and page-area raster export.
- **Guides & grid**: Ruler drag-out guides with move/delete (drag back to a ruler), line grid with size control, transparent checkerboard background.
- **Navigator**: Floating whole-scene minimap (artwork plus artboard sheets) with a live viewport rectangle; click or drag to pan, collapsible, toggleable from the View menu.
- **History**: Whole-project JSON snapshots with a 100-entry limit, listed in the History panel with click-to-jump and clearing; Ctrl+Z to undo, Ctrl+Shift+Z / Ctrl+Y to redo.
- **Annotation tools**: Callout annotations with persisted content/style models.
- **Measure tool**: Drag for a dashed preview with length (ruler units) and angle in the status bar; transient, nothing is committed.

Not yet implemented: pattern fills, mesh gradients, opacity masks, and multi-fill/stroke appearance stacks.

---

## Tech Stack

| Category | Choice |
| --- | --- |
| Frontend framework | Vue 3 + TypeScript |
| Graphics engine | Paper.js (`paper` ^0.12.17) + `paperjs-offset` |
| State management | Pinia |
| UI components | Element Plus 2.14 + `@element-plus/icons-vue` |
| Build tool | Vite 5 + `vue-tsc` type checking |
| Testing | `npm test` runs `scripts/check-engine-size.js` (no committed test suite) |

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
npm test             # Engine size check (scripts/check-engine-size.js)
```

Available scripts are exactly `dev`, `build`, `preview` and `test` (see `package.json`).

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
│   ├── path-drawing/                # Pen + curvature + anchor tools, anchor chrome
│   ├── selection/                   # Select / direct-select (bbox transform, marquee, guides)
│   ├── shapes/                      # Live shape tools
│   ├── text/                        # Point / area / path / vertical text controller
│   ├── snap/                        # Pointer snapping + smart alignment guides
│   ├── guides/                      # Ruler guide interaction
│   └── annotation/                  # Callout annotations
├── components/
│   ├── canvas/CanvasHost.vue        # Canvas + rulers + context menu + engine bootstrap
│   ├── menus/TopBar.vue             # File/Edit/Object/View menus, settings, export dialogs
│   ├── panels/LayerPanel.vue        # Layers (reorder, opacity, object tree)
│   ├── panels/PropertyPanel.vue     # Fill/stroke/appearance/text/transform/align/pathfinder
│   └── toolbar/ToolRail.vue         # Tool buttons
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

- `tests/` and `src/api/` are gitignored and intended for local use (no test suite or credentials are committed).
- `package-lock.json` is gitignored and untracked, so `npm ci` will fail; dependency versions are not locked.
- Build outputs (`dist/`) and `*.tsbuildinfo` files are generated — do not hand-edit them.

---

## License

Internal project; license per the project owner's terms.
