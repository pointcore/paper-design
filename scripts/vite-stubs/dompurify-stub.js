// Build-time stub for `dompurify` (see vite.config.js).
//
// Same story as the html2canvas stub: jsPDF lazily imports `dompurify`
// only inside its `doc.html()` code path, which this app never calls.
// Nothing else in `src/` imports it (it is not even a direct dependency),
// so the alias reclaims ~11KB gzip with no runtime effect.
throw new Error(
  'dompurify is stubbed out of the bundle: doc.html() is unused, export via addImage/svg2pdf instead.'
)

export default undefined
