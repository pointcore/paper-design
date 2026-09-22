// Build-time stub for `html2canvas` (see vite.config.js).
//
// jsPDF lazily imports `html2canvas` only inside its `doc.html()` code path.
// This app never calls `doc.html()` — all PDF export goes through
// `addImage` (raster) and `svg2pdf` (vector) — so the real 197KB library
// would ride the bundle as dead weight (~47KB gzip). The alias redirects
// the lazy import here; if anyone ever calls `doc.html()`, the import
// rejects and jsPDF surfaces its usual "Could not load html2canvas" error.
throw new Error(
  'html2canvas is stubbed out of the bundle: doc.html() is unused, export via addImage/svg2pdf instead.'
)

export default undefined
