/**
 * Check the project source code size
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = join(fileURLToPath(import.meta.url), '..', '..')

function countLines(dir) {
  let total = 0
  function walk(d) {
    const entries = readdirSync(d, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(d, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && /\.(ts|vue|js|json|html|md)$/.test(entry.name)) {
        const content = readFileSync(fullPath, 'utf8')
        total += content.split('\n').length
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return total
}

/** Same walk, but only *.test.ts (colocated with the modules under src/). */
function countTestLines(dir) {
  let total = 0
  function walk(d) {
    const entries = readdirSync(d, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(d, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath)
      } else if (entry.isFile() && /\.test\.ts$/.test(entry.name)) {
        total += readFileSync(fullPath, 'utf8').split('\n').length
      }
    }
  }
  if (existsSync(dir)) walk(dir)
  return total
}

const srcLines = countLines(join(rootDir, 'src'))
// Tests live next to the modules they cover (src/**/*.test.ts), not in a
// top-level tests/ dir — the old path always reported 0.
const testLines = countTestLines(join(rootDir, 'src'))

console.log(`Source lines: ${srcLines}`)
console.log(`Test lines: ${testLines}`)
console.log('✓ Check passed')
process.exit(0)
