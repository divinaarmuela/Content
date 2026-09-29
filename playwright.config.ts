import { defineConfig, devices } from '@playwright/test'
import { E2E, devServerEnv, unsafeReasons } from './e2e/support/env'

// An unsafe run starts NO server: the global setup then refuses with the reasons.
// (Playwright starts the web server before the global setup runs.)
const safe = unsafeReasons().length === 0

/**
 * THE POSTING JOURNEYS IN A REAL BROWSER (SPEC §8.4, package P9).
 *
 *   npm run e2e
 *
 * Starts its OWN dev server on a spare port (E2E_PORT, default 3107) with
 * every outside effect switched to its test form (e2e/support/env.ts
 * `devServerEnv`: the dry-run publisher, test-only email, Inngest in local
 * mode). It never reuses a server that is already running, because that
 * server's settings are unknown.
 *
 * The global setup refuses to start without the settings in .env.e2e.example
 * and says which are missing. Journeys work on the ZZ E2E Test Client only and
 * clean up what they made. Test files are `e2e/**\/*.pw.ts` so vitest never
 * picks them up.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  globalSetup: './e2e/support/global-setup.ts',
  // the journeys share one test client and its board: one at a time
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 3 * 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: E2E.baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    timezoneId: 'Australia/Melbourne',
    locale: 'en-AU',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: !safe ? undefined : {
    // webpack, not Turbopack: Turbopack refuses a node_modules that is a symlink
    // out of the project (a git worktree's), and webpack serves both the same
    command: process.env.E2E_DEV_COMMAND || `npx next dev --webpack --port ${E2E.port}`,
    url: `${E2E.baseURL}/sign-in`,
    reuseExistingServer: false,
    timeout: 240_000,
    env: devServerEnv(),
    stdout: 'pipe',
    stderr: 'pipe',
  },
})
