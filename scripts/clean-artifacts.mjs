/**
 * Remove build/test artifacts that accumulate in the working tree.
 *
 * Vite bundles vite.config.js into `vite.config.js.timestamp-<hash>.mjs`
 * before evaluating it and deletes it on a clean exit. Interrupting the dev
 * server (Ctrl+C, a closed terminal, a crashed watcher) leaves the file
 * behind, and nothing else ever removes it, so the repo root slowly fills with
 * one of these per session.
 *
 * Playwright is redirected away from the repo root in playwright.config.ts
 * (its default `test-results/` is not covered by .gitignore), but a run from
 * an older checkout may still have left one behind.
 *
 * Wired to predev / prebuild / pretest. Node 22's fs.rm is enough; no glob
 * dependency needed for a two-entry sweep.
 */
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

/** Vite's config-bundle temporaries, matched by prefix as the hash varies. */
const viteTempPrefix = 'vite.config.js.timestamp-'
const fixedTargets = ['test-results', 'playwright-report']

let removed = 0

for (const entry of readdirSync(root)) {
  if (!entry.startsWith(viteTempPrefix)) continue
  rmSync(join(root, entry), { force: true })
  removed++
}

for (const target of fixedTargets) {
  rmSync(join(root, target), { force: true, recursive: true })
}

if (removed > 0) {
  console.log(`clean: removed ${removed} stale vite config temp file(s)`)
}
