import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'

// E2E_CHANNEL=bundled uses the downloaded Playwright chromium (CI with
// `npx playwright install`); any other value names a system browser
// channel. Default: system Chrome, so a fresh clone runs e2e without a
// browser download (the standalone e2e/*.mjs scripts already did this).
const channel = process.env.E2E_CHANNEL || 'chrome'

export default defineConfig({
  testDir: './e2e',
  // Under node_modules rather than the default `test-results/`, which nothing
  // in .gitignore covers: failure traces and screenshots would otherwise
  // show up as untracked noise in the repo root. node_modules is already
  // ignored, so this needs no .gitignore change — and per project convention
  // .gitignore edits stay local anyway.
  outputDir: 'node_modules/.playwright',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    // 1500x900 is what the acceptance scripts were originally written and
    // calibrated against. A smaller viewport silently breaks the specs that
    // drag a cut line across +/-550 project units: the ends map off-canvas,
    // so paper.js never sees those mouse events and nothing gets cut.
    viewport: { width: 1500, height: 900 },
    ...(channel === 'bundled' ? {} : { channel }),
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    // A cold CI runner has to install nothing but still pay Vite's first-run
    // dependency optimization, which regularly overruns the 30s default and
    // fails the whole job before a single spec executes.
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
  },
} satisfies PlaywrightTestConfig)
