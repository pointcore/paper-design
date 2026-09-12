import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import path from 'path'

// Unit tests are colocated: src/**/*.test.ts (see scripts/check-engine-size.js).
// e2e (Playwright) goes to tests/e2e/ when added — kept out of this run.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'tests/e2e/**'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/vite-env.d.ts',
        'src/main.ts',
      ],
      // Baseline guard (2026-09-12: lines/statements ~2.8% — engine.ts and
      // controllers dominate the denominator and are untested; branches ~72%,
      // functions ~57%). Thresholds sit just below the baseline to catch
      // regression. Raise them as store/components/engine get tests.
      thresholds: {
        lines: 2.5,
        functions: 55,
        branches: 70,
        statements: 2.5,
      },
    },
  },
})
