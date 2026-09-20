// Pre-test gate: test health + dist bundle size.
// - Test health: colocated unit tests under src/ must exist.
// - Bundle size: if dist/ exists, main bundle gzip must stay under budget
//   (baseline 2026-09-12: index-*.js gzip ~366 kB, total js gzip ~625 kB).
//   If dist/ is missing (test without build), size check is skipped.
//
// Fails with exit 1 on violation — this is a real gate, not a line counter.
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const rootDir = join(fileURLToPath(import.meta.url), '..', '..')

// Baselines — bump deliberately, not silently.
// 2026-09-20: total 700 -> 720 KB for the D1-D4 feature batch (command
// palette async chunk, global colors, text presets, pixel tools, export
// presets). Main bundle stays at 420 KB.
const MIN_TEST_FILES = 10
const MIN_TEST_LINES = 1000
const MAIN_BUNDLE_GZIP_KB = 420
const TOTAL_JS_GZIP_KB = 720

function collect(dir, re) {
  const out = []
  function walk(d) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && re.test(entry.name)) out.push(full)
    }
  }
  if (existsSync(dir)) walk(dir)
  return out
}

function countLines(files) {
  return files.reduce((n, f) => n + readFileSync(f, 'utf8').split('\n').length, 0)
}

let failed = false
const fail = (msg) => {
  console.error(`✗ ${msg}`)
  failed = true
}

// 1. Test health
const testFiles = collect(join(rootDir, 'src'), /\.test\.ts$/)
const testLines = countLines(testFiles)
const srcFiles = collect(join(rootDir, 'src'), /\.(ts|vue)$/)
const srcLines = countLines(srcFiles.filter((f) => !/\.test\.ts$/.test(f)))

console.log(`Source files: ${srcFiles.length - testFiles.length} (${srcLines} lines)`)
console.log(`Test files: ${testFiles.length} (${testLines} lines)`)

if (testFiles.length < MIN_TEST_FILES) {
  fail(`test files ${testFiles.length} < minimum ${MIN_TEST_FILES} — add tests for new modules`)
}
if (testLines < MIN_TEST_LINES) {
  fail(`test lines ${testLines} < minimum ${MIN_TEST_LINES} — test suite shrank`)
}

// 2. Bundle size (only when dist exists)
const distAssets = join(rootDir, 'dist', 'assets')
if (!existsSync(distAssets)) {
  console.log('! dist/ missing — skipping bundle-size check (run npm run build to enforce)')
} else {
  const jsFiles = collect(distAssets, /\.js$/)
  if (jsFiles.length === 0) {
    fail('dist/assets has no .js bundles — build output looks broken')
  } else {
    const sizes = jsFiles.map((f) => {
      const raw = readFileSync(f)
      const gz = gzipSync(raw).length
      return { name: f.split(/[\\/]/).pop(), rawKb: raw.length / 1024, gzKb: gz / 1024 }
    })
    sizes.sort((a, b) => b.gzKb - a.gzKb)
    for (const s of sizes) {
      console.log(`  ${s.name}: raw ${s.rawKb.toFixed(1)} KB / gzip ${s.gzKb.toFixed(1)} KB`)
    }
    const main = sizes[0]
    const totalGz = sizes.reduce((n, s) => n + s.gzKb, 0)
    console.log(`Main bundle: ${main.name} gzip ${main.gzKb.toFixed(1)} KB (limit ${MAIN_BUNDLE_GZIP_KB} KB)`)
    console.log(`Total js gzip: ${totalGz.toFixed(1)} KB (limit ${TOTAL_JS_GZIP_KB} KB)`)
    if (main.gzKb > MAIN_BUNDLE_GZIP_KB) {
      fail(`main bundle gzip ${main.gzKb.toFixed(1)} KB exceeds ${MAIN_BUNDLE_GZIP_KB} KB budget`)
    }
    if (totalGz > TOTAL_JS_GZIP_KB) {
      fail(`total js gzip ${totalGz.toFixed(1)} KB exceeds ${TOTAL_JS_GZIP_KB} KB budget`)
    }
  }
}

if (failed) {
  console.error('✗ Check failed')
  process.exit(1)
}
console.log('✓ Check passed')
