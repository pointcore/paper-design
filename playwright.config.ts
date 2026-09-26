import { defineConfig, type PlaywrightTestConfig } from '@playwright/test'

// E2E_CHANNEL=bundled uses the downloaded Playwright chromium (CI with
// `npx playwright install`); any other value names a system browser
// channel. Default: system Chrome, so a fresh clone runs e2e without a
// browser download (the standalone e2e/*.mjs scripts already did this).
const channel = process.env.E2E_CHANNEL || 'chrome'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 1,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1280, height: 720 },
    ...(channel === 'bundled' ? {} : { channel }),
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
} satisfies PlaywrightTestConfig)
